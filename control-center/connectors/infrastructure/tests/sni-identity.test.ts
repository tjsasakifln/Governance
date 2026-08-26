import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAllowlist } from "../src/allowlist.js";
import { runInfraCanary } from "../src/canary.js";
import { collect } from "../src/collect.js";
import { CAPABILITIES, CANARY_COLLECTORS } from "../src/envelope.js";
import {
  buildHttpRequestOptions,
  buildTlsConnectOptions,
  CANONICAL_CONNECT_HOST,
  CANONICAL_HEALTH_URL,
  CANONICAL_HTTP_HOST,
  CANONICAL_TLS_SERVER_NAME,
  identityFor,
} from "../src/identity.js";
import { loadProductionAllowlist } from "../src/production-config.js";
import type { ConnectionIdentity, ProbePorts } from "../src/ports.js";
import { runProbes } from "../src/probes.js";
import type { AgentPayload, HttpSample, ReachabilitySample, TlsSample } from "../src/types.js";

const NOW = new Date("2026-08-21T12:00:00.000Z");

function recordingPorts(input: {
  tcp?: ReachabilitySample;
  http?: HttpSample;
  tls?: TlsSample;
}): ProbePorts & {
  httpCalls: Array<{ url: string; identity?: ConnectionIdentity }>;
  tlsCalls: Array<{ host: string; port: number; identity?: ConnectionIdentity }>;
  tcpCalls: Array<{ host: string; port: number }>;
} {
  const httpCalls: Array<{ url: string; identity?: ConnectionIdentity }> = [];
  const tlsCalls: Array<{ host: string; port: number; identity?: ConnectionIdentity }> = [];
  const tcpCalls: Array<{ host: string; port: number }> = [];
  const ports: ProbePorts & {
    httpCalls: typeof httpCalls;
    tlsCalls: typeof tlsCalls;
    tcpCalls: typeof tcpCalls;
  } = {
    now: () => NOW,
    async reachHost(host, port) {
      tcpCalls.push({ host, port });
      return input.tcp ?? { ok: true, latency_ms: 5 };
    },
    async httpGet(url, _timeoutMs, identity) {
      httpCalls.push(identity ? { url, identity } : { url });
      return input.http ?? { status: 200, elapsed_ms: 10 };
    },
    async readTls(host, port, _timeoutMs, identity) {
      tlsCalls.push(identity ? { host, port, identity } : { host, port });
      return input.tls ?? { not_after: "2027-08-21T00:00:00.000Z" };
    },
    async readAgent(_targetId): Promise<AgentPayload | null> {
      return null;
    },
    httpCalls,
    tlsCalls,
    tcpCalls,
  };
  return ports;
}

test("shipped HTTP options keep Host/SNI as api.confenge.com.br when connect host is the IP", () => {
  const built = buildHttpRequestOptions({
    url: CANONICAL_HEALTH_URL,
    timeoutMs: 1000,
    connectHost: CANONICAL_CONNECT_HOST,
    httpHost: CANONICAL_HTTP_HOST,
    tlsServerName: CANONICAL_TLS_SERVER_NAME,
  });
  assert.equal(built.connectHost, CANONICAL_CONNECT_HOST);
  assert.equal(built.headers.Host, CANONICAL_HTTP_HOST);
  assert.equal(built.tlsServerName, CANONICAL_TLS_SERVER_NAME);
  assert.equal(built.path, "/api/v1/webhooks/confenge/inbound/health");
  assert.notEqual(built.tlsServerName, CANONICAL_CONNECT_HOST);
  assert.notEqual(built.headers.Host, "happysrv.de");
});

test("shipped HTTP options override a non-SAN URL hostname with canonical Host/SNI", () => {
  const built = buildHttpRequestOptions({
    url: "https://happysrv.de/api/v1/webhooks/confenge/inbound/health",
    timeoutMs: 1000,
    connectHost: CANONICAL_CONNECT_HOST,
    httpHost: CANONICAL_HTTP_HOST,
    tlsServerName: CANONICAL_TLS_SERVER_NAME,
  });
  assert.equal(built.connectHost, CANONICAL_CONNECT_HOST);
  assert.equal(built.headers.Host, "api.confenge.com.br");
  assert.equal(built.tlsServerName, "api.confenge.com.br");
  assert.notEqual(built.tlsServerName, "happysrv.de");
});

test("shipped TLS options split connect host from SNI servername", () => {
  const opts = buildTlsConnectOptions({
    connectHost: CANONICAL_CONNECT_HOST,
    port: 443,
    tlsServerName: CANONICAL_TLS_SERVER_NAME,
  });
  assert.equal(opts.host, CANONICAL_CONNECT_HOST);
  assert.equal(opts.servername, CANONICAL_TLS_SERVER_NAME);
  assert.notEqual(opts.servername, opts.host);
});

test("production allowlist binds canonical health URL and split identity", () => {
  const allowlist = loadProductionAllowlist();
  const http = allowlist.targets.find((target) => target.checks.includes("http"));
  const tls = allowlist.targets.find((target) => target.checks.includes("tls"));
  const tcp = allowlist.targets.find((target) => target.checks.includes("reachability"));
  assert.ok(http && tls && tcp);
  assert.equal(http.url, CANONICAL_HEALTH_URL);
  assert.equal(http.http_host, CANONICAL_HTTP_HOST);
  assert.equal(http.tls_server_name, CANONICAL_TLS_SERVER_NAME);
  assert.equal(http.connect_host, CANONICAL_CONNECT_HOST);
  assert.equal(tls.tls_server_name, CANONICAL_TLS_SERVER_NAME);
  assert.equal(tls.connect_host, CANONICAL_CONNECT_HOST);
  assert.equal(tcp.connect_host, CANONICAL_CONNECT_HOST);
  assert.equal(http.url?.includes("happysrv.de"), false);
  const identity = identityFor(http);
  assert.equal(identity.httpHost, CANONICAL_HTTP_HOST);
  assert.equal(identity.tlsServerName, CANONICAL_TLS_SERVER_NAME);
  assert.equal(identity.connectHost, CANONICAL_CONNECT_HOST);
  const prepared = allowlist.targets.find((target) => target.id === "confenge-public-edge");
  assert.ok(prepared);
  assert.equal(prepared.lifecycle_state, "PREPARED/NOT_LIVE");
  assert.equal(prepared.connect_host, CANONICAL_CONNECT_HOST);
  assert.equal(prepared.http_host, "confenge.com.br");
  assert.equal(prepared.tls_server_name, "confenge.com.br");
});

test("prepared public edge is visible without probes or false incidents", async () => {
  const allowlist = loadProductionAllowlist();
  const ports = recordingPorts({});
  const result = await collect({ allowlist, ports });
  const preparedHealth = result.service_health.find(
    (item) => item.service_id === "confenge-public-edge",
  );
  assert.ok(preparedHealth);
  assert.equal(preparedHealth.lifecycle_state, "PREPARED/NOT_LIVE");
  assert.equal(preparedHealth.status, "unknown");
  assert.equal(preparedHealth.freshness_status, "UNKNOWN");
  assert.deepEqual(preparedHealth.checks, []);
  assert.equal(
    result.observations.some((item) => item.target_id === "confenge-public-edge"),
    false,
  );
  assert.equal(
    result.exceptions.some((item) => item.target_id === "confenge-public-edge"),
    false,
  );
  assert.equal(ports.tlsCalls.length, 1);
  assert.equal(ports.httpCalls.length, 1);
});

test("runProbes passes canonical Host/SNI even when connect host is the raw IP", async () => {
  const allowlist = parseAllowlist({
    version: 1,
    collector_id: "infrastructure.netcup",
    source: "infrastructure",
    default_timeout_ms: 50,
    targets: [
      {
        id: "netcup-vps-tcp",
        display_name: "tcp",
        connect_host: CANONICAL_CONNECT_HOST,
        host: CANONICAL_CONNECT_HOST,
        port: 443,
        checks: ["reachability"],
      },
      {
        id: "netcup-api-tls",
        display_name: "tls",
        connect_host: CANONICAL_CONNECT_HOST,
        host: CANONICAL_CONNECT_HOST,
        tls_server_name: CANONICAL_TLS_SERVER_NAME,
        port: 443,
        checks: ["tls"],
      },
      {
        id: "confenge-api-http",
        display_name: "http",
        url: CANONICAL_HEALTH_URL,
        connect_host: CANONICAL_CONNECT_HOST,
        http_host: CANONICAL_HTTP_HOST,
        tls_server_name: CANONICAL_TLS_SERVER_NAME,
        expect_status: 200,
        checks: ["http"],
      },
    ],
  });
  const ports = recordingPorts({});
  const probes = await runProbes(allowlist, ports);
  assert.equal(ports.tcpCalls[0]?.host, CANONICAL_CONNECT_HOST);
  assert.equal(ports.tlsCalls[0]?.identity?.tlsServerName, CANONICAL_TLS_SERVER_NAME);
  assert.equal(ports.tlsCalls[0]?.host, CANONICAL_CONNECT_HOST);
  assert.equal(ports.httpCalls[0]?.identity?.httpHost, CANONICAL_HTTP_HOST);
  assert.equal(ports.httpCalls[0]?.identity?.tlsServerName, CANONICAL_TLS_SERVER_NAME);
  assert.equal(ports.httpCalls[0]?.identity?.connectHost, CANONICAL_CONNECT_HOST);
  const httpProbe = probes.find((row) => row.check === "http");
  assert.equal(httpProbe?.payload.http_host, CANONICAL_HTTP_HOST);
  assert.equal(httpProbe?.payload.tls_server_name, CANONICAL_TLS_SERVER_NAME);
});

test("SNI/HTTP error is not classified as whole-host TCP unavailability", async () => {
  const allowlist = loadProductionAllowlist();
  const ports = recordingPorts({
    tcp: { ok: true, latency_ms: 8 },
    tls: { not_after: "1970-01-01T00:00:00.000Z", error: "hostname/IP does not match certificate's altnames" },
    http: { status: 0, error: "Hostname/IP does not match certificate's altnames" },
  });
  const result = await collect({ allowlist, ports });
  const tcp = result.observations.find((row) => row.check === "reachability");
  const http = result.observations.find((row) => row.check === "http");
  const tls = result.observations.find((row) => row.check === "tls");
  assert.ok(tcp && http && tls);
  assert.equal(tcp.freshness_status, "FRESH");
  assert.equal(tcp.payload.ok, true);
  assert.equal(http.freshness_status, "ERROR");
  assert.equal(tls.freshness_status, "ERROR");
  assert.notEqual(tcp.freshness_status, "ERROR");
});

test("infra canary envelope, capability enum, and pinned-clock idempotency", async () => {
  const ports = recordingPorts({
    tcp: { ok: true, latency_ms: 4 },
    tls: { not_after: "2027-08-21T00:00:00.000Z" },
    http: { status: 200, elapsed_ms: 12 },
  });
  const first = await runInfraCanary({ now: NOW, ports });
  const second = await runInfraCanary({ now: NOW, ports });
  for (const report of [first, second]) {
    assert.equal(report.collector, "infra");
    assert.ok((CANARY_COLLECTORS as readonly string[]).includes(report.collector));
    assert.ok(["FRESH", "STALE", "UNKNOWN", "ERROR"].includes(report.freshness_status));
    assert.equal(report.observed_at, NOW.toISOString());
    assert.ok(report.observed_at.endsWith("Z"));
    assert.equal(report.source.system, "infrastructure");
    assert.equal(typeof report.source.kind, "string");
    assert.equal(report.source.locator, CANONICAL_HEALTH_URL);
    assert.equal(typeof report.confidence, "number");
    assert.ok(report.error === null || (typeof report.error.code === "string" && typeof report.error.message === "string"));
    assert.equal(typeof report.payload, "object");
    assert.equal(typeof report.idempotency_key, "string");
    assert.ok((CAPABILITIES as readonly string[]).includes(report.capability));
    assert.equal(report.source.locator.includes("happysrv.de"), false);
    const blob = JSON.stringify(report);
    assert.equal(/\$aact_|Bearer |api[_-]?key/i.test(blob), false);
  }
  assert.equal(first.idempotency_key, second.idempotency_key);
  assert.equal(first.capability, second.capability);
  assert.equal(first.freshness_status, "FRESH");
  assert.equal(first.capability, "AVAILABLE");
  assert.equal(first.error, null);
});
