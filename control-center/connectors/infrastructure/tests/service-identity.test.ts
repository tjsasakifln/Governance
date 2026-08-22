import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAllowlist } from "../src/allowlist.js";
import { collect } from "../src/collect.js";
import { createFixturePorts } from "../src/fixture-ports.js";
import { logicalEndpoint, roleFor } from "../src/map.js";
import type { CollectResult, ServiceHealth } from "../src/types.js";
import { collectFixture, loadFixtureFile } from "./helpers.js";

function health(result: CollectResult, id: string): ServiceHealth {
  const found = result.service_health.find((item) => item.service_id === id);
  if (!found) {
    throw new Error(`missing service_health ${id}`);
  }
  return found;
}

test("every monitored service carries a unique name, a function and a logical endpoint", async () => {
  const result = await collectFixture("healthy.json");
  assert.ok(result.service_health.length >= 3);
  const names = new Set<string>();
  const endpoints = new Set<string>();
  for (const item of result.service_health) {
    assert.notEqual(item.service_id.trim(), "");
    assert.notEqual(item.display_name.trim(), "");
    assert.notEqual(item.role.trim(), "");
    assert.notEqual(item.endpoint.trim(), "");
    names.add(item.display_name);
    endpoints.add(item.endpoint);
  }
  assert.equal(names.size, result.service_health.length, "display names must be distinguishable");
  assert.equal(endpoints.size, result.service_health.length, "endpoints must be distinguishable");
  assert.equal(health(result, "extra-contracts").endpoint, "http://127.0.0.1:18080/health");
  assert.equal(health(result, "netcup-vps-1").endpoint, "vps.internal.example:443");
});

test("the derived function names the checks when the catalog declares no role", () => {
  const role = roleFor({
    id: "x",
    display_name: "X",
    checks: ["http", "tls"],
    url: "https://example.invalid/health",
    host: "example.invalid",
  });
  assert.match(role, /endpoint HTTP/);
  assert.match(role, /certificado TLS/);
  const declared = roleFor({
    id: "x",
    display_name: "X",
    role: "Fila de webhooks inbound",
    checks: ["http"],
    url: "https://example.invalid/health",
  });
  assert.equal(declared, "Fila de webhooks inbound");
});

test("the logical endpoint never carries credentials or a query string", () => {
  const endpoint = logicalEndpoint({
    id: "x",
    display_name: "X",
    checks: ["http"],
    url: "https://example.invalid/health?trace=1#frag",
  });
  assert.equal(endpoint, "https://example.invalid/health");
  assert.equal(endpoint.includes("?"), false);
});

test("a degraded service reports latency and names the failing check", async () => {
  const result = await collectFixture("partial-outage.json");
  const broken = health(result, "extra-contracts");
  assert.equal(broken.status, "unhealthy");
  assert.equal(broken.latency_ms, 30);
  assert.match(String(broken.last_error), /^http: /);
  const ok = health(result, "cfg-health");
  assert.equal(ok.status, "healthy");
  assert.equal(ok.last_error, undefined);
});

test("catalog role and runbook travel from the allowlist to service health", async () => {
  const fixture = loadFixtureFile("healthy.json");
  const raw = fixture.allowlist as Record<string, unknown>;
  const targets = (raw.targets as Record<string, unknown>[]).map((target) =>
    target.id === "cfg-health"
      ? { ...target, role: "Painel de configuração", runbook_url: "/runbooks/cfg-health" }
      : target,
  );
  const allowlist = parseAllowlist({ ...raw, targets });
  const result = await collect({ allowlist, ports: createFixturePorts(fixture, allowlist) });
  const item = health(result, "cfg-health");
  assert.equal(item.role, "Painel de configuração");
  assert.equal(item.runbook_url, "/runbooks/cfg-health");
  assert.equal(health(result, "extra-contracts").runbook_url, undefined);
});

test("an unsafe runbook link is refused at the catalog boundary", () => {
  const raw = loadFixtureFile("healthy.json").allowlist as Record<string, unknown>;
  const withRunbook = (value: unknown): unknown => ({
    ...raw,
    targets: [
      {
        id: "cfg-health",
        display_name: "cfg-health HTTP",
        url: "http://127.0.0.1:18081/health",
        checks: ["http"],
        runbook_url: value,
      },
    ],
  });
  assert.throws(() => parseAllowlist(withRunbook("javascript:alert(1)")), /http\(s\)/i);
  assert.throws(() => parseAllowlist(withRunbook("//evil.invalid/runbook")), /protocol-relative/i);
  assert.throws(
    () => parseAllowlist(withRunbook("https://user:pass@example.invalid/runbook")),
    /credential/i,
  );
  assert.throws(() => parseAllowlist(withRunbook("/run book")), /whitespace/i);
});
