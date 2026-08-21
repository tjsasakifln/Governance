import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { parseAllowlist } from "../src/allowlist.js";
import { collectFromFixtureFile } from "../src/cli.js";
import { collect, mapCollectResult } from "../src/collect.js";
import { createFixturePorts } from "../src/fixture-ports.js";
import { mapObservation } from "../src/map.js";
import { findPackageRoot } from "../src/paths.js";
import { runProbes } from "../src/probes.js";
import type { CollectResult, ProbeResult } from "../src/types.js";
import { collectFixture, hasProvenance, isHealthyFresh, loadFixtureFile, obs } from "./helpers.js";

function assertProvenance(result: Awaited<ReturnType<typeof collectFixture>>): void {
  assert.ok(result.observations.length > 0, "expected observations");
  assert.ok(result.service_health.length > 0, "expected service health");
  for (const item of result.observations) {
    assert.equal(hasProvenance(item), true, item.observation_id);
    assert.equal(item.scope, "infrastructure");
  }
  for (const item of result.service_health) {
    assert.equal(hasProvenance(item), true, item.service_id);
  }
}

test("healthy allowlist emits FRESH observations and no incidents", async () => {
  const result = await collectFixture("healthy.json");
  assertProvenance(result);
  assert.equal(result.exceptions.length, 0);
  assert.equal(isHealthyFresh(result, "netcup-vps-1"), true);
  assert.equal(isHealthyFresh(result, "extra-contracts"), true);
  assert.equal(isHealthyFresh(result, "cfg-health"), true);
  assert.equal(obs(result, "netcup-vps-1", "host_metrics").freshness_status, "FRESH");
  assert.equal(obs(result, "netcup-vps-1", "docker").freshness_status, "FRESH");
  assert.equal(obs(result, "netcup-vps-1", "backup").freshness_status, "FRESH");
  assert.equal(obs(result, "netcup-vps-1", "uptime").payload.uptime_seconds, 604800);
  assert.equal(obs(result, "netcup-vps-1", "uptime").payload.restart_count, 1);
});

test("incident fixture yields actionable exceptions with evidence and timestamp", async () => {
  const result = await collectFixture("incident.json");
  assertProvenance(result);
  assert.ok(result.exceptions.length >= 2, "expected HTTP and Docker incidents");
  const httpExc = result.exceptions.find((item) => item.target_id === "extra-contracts" && item.check === "http");
  assert.ok(httpExc, "missing HTTP exception");
  assert.match(httpExc.evidence, /extra-contracts/);
  assert.match(httpExc.evidence, /http/);
  assert.match(httpExc.evidence, /503/);
  assert.ok(httpExc.timestamp.endsWith("Z"));
  assert.match(httpExc.title, /extra-contracts/i);
  const dockerExc = result.exceptions.find((item) => item.check === "docker");
  assert.ok(dockerExc, "missing Docker exception");
  assert.match(dockerExc.evidence, /extra-crawler/);
  assert.equal(isHealthyFresh(result, "extra-contracts"), false);
  assert.equal(isHealthyFresh(result, "cfg-health"), true);
  assert.equal(obs(result, "cfg-health", "http").freshness_status, "FRESH");
});

test("host failure is an exception; other targets still emit", async () => {
  const result = await collectFixture("host-failure.json");
  assertProvenance(result);
  const reach = result.exceptions.find((item) => item.check === "reachability");
  assert.ok(reach);
  assert.match(reach.evidence, /netcup-vps-1/);
  assert.equal(obs(result, "netcup-vps-1", "reachability").freshness_status, "ERROR");
  assert.notEqual(
    `${obs(result, "netcup-vps-1", "reachability").payload.service_status}-${obs(result, "netcup-vps-1", "reachability").freshness_status}`,
    "healthy-FRESH",
  );
  assert.equal(isHealthyFresh(result, "extra-contracts"), true);
  assert.equal(isHealthyFresh(result, "cfg-health"), true);
});

test("expired TLS is an actionable exception", async () => {
  const result = await collectFixture("tls-expired.json");
  assertProvenance(result);
  const tls = result.exceptions.find((item) => item.check === "tls");
  assert.ok(tls);
  assert.match(tls.evidence, /tls/i);
  assert.match(tls.evidence, /netcup-vps-1/);
  assert.ok(tls.timestamp.endsWith("Z"));
  assert.equal(obs(result, "netcup-vps-1", "tls").payload.service_status, "unhealthy");
  assert.equal(isHealthyFresh(result, "cfg-health"), true);
});

test("missing backup last-success is fail-closed and exceptional", async () => {
  const result = await collectFixture("backup-missing.json");
  assertProvenance(result);
  const backup = result.exceptions.find((item) => item.check === "backup");
  assert.ok(backup);
  assert.match(backup.evidence, /backup/);
  assert.match(backup.evidence, /netcup-vps-1/);
  const observation = obs(result, "netcup-vps-1", "backup");
  assert.notEqual(`${observation.payload.service_status}-${observation.freshness_status}`, "healthy-FRESH");
  assert.equal(isHealthyFresh(result, "cfg-health"), true);
});

test("timed-out probe is ERROR not healthy-FRESH; siblings still emit", async () => {
  const result = await collectFixture("timeout.json");
  assertProvenance(result);
  const timed = obs(result, "extra-contracts", "http");
  assert.equal(timed.freshness_status, "ERROR");
  assert.equal(timed.payload.probe_status, "timeout");
  assert.notEqual(`${timed.payload.service_status}-${timed.freshness_status}`, "healthy-FRESH");
  const timeoutExc = result.exceptions.find((item) => item.target_id === "extra-contracts" && item.check === "http");
  assert.ok(timeoutExc);
  assert.match(timeoutExc.title, /timed out/i);
  assert.match(timeoutExc.evidence, /extra-contracts/);
  assert.ok(timeoutExc.timestamp.endsWith("Z"));
  assert.equal(isHealthyFresh(result, "cfg-health"), true);
  assert.equal(isHealthyFresh(result, "netcup-vps-1"), true);
});

test("partial outage keeps healthy targets FRESH", async () => {
  const result = await collectFixture("partial-outage.json");
  assertProvenance(result);
  assert.equal(isHealthyFresh(result, "extra-contracts"), false);
  assert.equal(isHealthyFresh(result, "cfg-health"), true);
  assert.equal(isHealthyFresh(result, "netcup-vps-1"), true);
  const down = result.exceptions.find((item) => item.target_id === "extra-contracts");
  assert.ok(down);
  assert.match(down.evidence, /503/);
  assert.equal(result.observations.length, 3);
});

test("stale agent metrics are STALE not healthy-FRESH; live HTTP remains FRESH", async () => {
  const result = await collectFixture("stale.json");
  assertProvenance(result);
  const metrics = obs(result, "netcup-vps-1", "host_metrics");
  const docker = obs(result, "netcup-vps-1", "docker");
  assert.equal(metrics.freshness_status, "STALE");
  assert.equal(docker.freshness_status, "STALE");
  assert.notEqual(`${metrics.payload.service_status}-${metrics.freshness_status}`, "healthy-FRESH");
  assert.ok(result.exceptions.some((item) => item.freshness_status === "STALE"));
  assert.equal(isHealthyFresh(result, "cfg-health"), true);
  assert.equal(obs(result, "cfg-health", "http").freshness_status, "FRESH");
});

test("same fixture inputs yield the same observation identity", async () => {
  const first = await collectFixture("incident.json");
  const second = await collectFixture("incident.json");
  assert.deepEqual(
    first.observations.map((item) => item.observation_id),
    second.observations.map((item) => item.observation_id),
  );
  assert.deepEqual(
    first.exceptions.map((item) => item.exception_id),
    second.exceptions.map((item) => item.exception_id),
  );
  assert.deepEqual(first.observations, second.observations);
  assert.deepEqual(first.exceptions, second.exceptions);
});

test("mapCollectResult and mapObservation are the shipped mappers used by collect", async () => {
  const fixture = loadFixtureFile("incident.json");
  const allowlist = parseAllowlist(fixture.allowlist);
  const ports = createFixturePorts(fixture, allowlist);
  const probes = await runProbes(allowlist, ports);
  const mapped = mapCollectResult(allowlist, probes, ports.now());
  const collected = await collect({ allowlist, ports });
  assert.deepEqual(mapped.observations, collected.observations);
  assert.deepEqual(mapped.exceptions, collected.exceptions);
  const httpProbe = probes.find((item) => item.check === "http" && item.target_id === "extra-contracts");
  assert.ok(httpProbe);
  const observation = mapObservation(httpProbe, allowlist, ports.now());
  assert.equal(observation.source, "infrastructure");
  assert.equal(observation.freshness_status, "ERROR");
  assert.equal(observation.payload.service_status, "unhealthy");
});

test("collectFromFixtureFile shipped entry reports the incident", async () => {
  const result = (await collectFromFixtureFile(
    join(findPackageRoot(), "fixtures", "incident.json"),
  )) as CollectResult;
  assert.ok(result.exceptions.length > 0);
  const named = result.exceptions.find(
    (item) => item.target_id === "extra-contracts" && item.check === "http",
  );
  assert.ok(named);
  assert.match(named.evidence, /503/);
  assert.ok(named.timestamp.endsWith("Z"));
  assert.equal(hasProvenance(result.observations[0]!), true);
});

test("mapCollectResult fail-closes timeout probes without dropping siblings", () => {
  const fixture = loadFixtureFile("timeout.json");
  const allowlist = parseAllowlist(fixture.allowlist);
  const now = new Date("2026-08-20T15:00:00.000Z");
  const probes: ProbeResult[] = [
    {
      target_id: "extra-contracts",
      check: "http",
      status: "timeout",
      observed_at: now.toISOString(),
      summary: "HTTP health timed out after 40ms",
      payload: { timed_out: true, url: "http://127.0.0.1:18080/health" },
    },
    {
      target_id: "cfg-health",
      check: "http",
      status: "ok",
      observed_at: now.toISOString(),
      summary: "HTTP 200",
      payload: { status: 200, expect_status: 200, url: "http://127.0.0.1:18081/health" },
    },
  ];
  const mapped = mapCollectResult(allowlist, probes, now);
  const failed = mapped.observations.find((item) => item.target_id === "extra-contracts");
  const ok = mapped.observations.find((item) => item.target_id === "cfg-health");
  assert.ok(failed && ok);
  assert.equal(failed.freshness_status, "ERROR");
  assert.notEqual(`${failed.payload.service_status}-${failed.freshness_status}`, "healthy-FRESH");
  assert.equal(ok.freshness_status, "FRESH");
  assert.equal(ok.payload.service_status, "healthy");
  assert.ok(mapped.exceptions.some((item) => item.target_id === "extra-contracts"));
});
