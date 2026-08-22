import assert from "node:assert/strict";
import { test } from "node:test";
import { createMockAdapter } from "../src/adapters/index";
import { healthFrom, safeRunbookHref } from "../src/adapters/map";
import { createMemoryRuntime, mount } from "../src/app";
import { healthCard, presentHealth } from "../src/ui/domains";
import type { Provenance, ServiceHealth } from "../src/types";

const FALLBACK: Provenance = {
  source: { system: "control-center", kind: "http", locator: "relative" },
  observed_at: "2026-08-20T18:00:00Z",
  freshness_status: "UNKNOWN",
  confidence: 0,
};

function fresh(confidence = 0.9): Provenance {
  return {
    source: { system: "collector", kind: "health-probe", locator: "health/x" },
    observed_at: "2026-08-20T18:00:00Z",
    freshness_status: "FRESH",
    confidence,
  };
}

function service(overrides: Partial<ServiceHealth> = {}): ServiceHealth {
  return {
    schema_version: "control-center.service-health.v1",
    id: "cc:service-health:x",
    scope: "infrastructure",
    service_name: "x",
    status: "healthy",
    provenance: fresh(),
    checked_at: "2026-08-20T18:00:00Z",
    ...overrides,
  };
}

test("Infra cards name the service, its function, its endpoint and its evidence", () => {
  const root = { innerHTML: "" };
  const handle = mount(root, createMockAdapter(), createMemoryRuntime("#/infra"));
  try {
    assert.match(root.innerHTML, />Função</);
    assert.match(root.innerHTML, />Endpoint lógico</);
    assert.match(root.innerHTML, />Última verificação</);
    assert.match(root.innerHTML, />Latência observada</);
    assert.match(root.innerHTML, />Freshness</);
    assert.match(root.innerHTML, />Erro recente</);
    const names = [...root.innerHTML.matchAll(/<article class="card health"[\s\S]*?<h3>([^<]*)<\/h3>/g)].map(
      (match) => match[1],
    );
    assert.ok(names.length >= 3);
    assert.equal(new Set(names).size, names.length, `duplicate card names: ${names.join(", ")}`);
    assert.equal(
      names.some((name) => name === "service"),
      false,
      "no card may be called just 'service'",
    );
  } finally {
    handle.unmount();
  }
});

test("healthy with zero confidence is never presented as saudável", () => {
  const zero = service({
    provenance: { ...fresh(0) },
    service_name: "confenge-api-http",
  });
  assert.deepEqual(presentHealth(zero), { status: "unknown", conclusive: false });
  const html = healthCard(zero);
  assert.match(html, /data-conclusive="false"/);
  assert.match(html, /data-raw-status="healthy"/);
  assert.match(html, /data-tone="not-green"/);
  assert.doesNotMatch(html, /saudável/);
  assert.match(html, /Sem evidência conclusiva/);
  assert.match(html, /confiança 0,00/);
});

test("healthy but stale is never presented as saudável either", () => {
  const stale = service({
    provenance: { ...fresh(0.5), freshness_status: "STALE" },
  });
  assert.equal(presentHealth(stale).conclusive, false);
  const html = healthCard(stale);
  assert.match(html, /data-status="unknown"/);
  assert.doesNotMatch(html, /data-tone="green"/);
});

test("a fresh, evidenced service is still allowed to read saudável", () => {
  const html = healthCard(service({ service_name: "github-collector" }));
  assert.match(html, /data-conclusive="true"/);
  assert.match(html, /data-tone="green"/);
  assert.match(html, /saudável/);
});

test("duplicate catalog entries are reported as grouped, not as separate services", () => {
  const html = healthCard(service({ duplicate_count: 3, status: "degraded" }));
  assert.match(html, /data-duplicate-count="3"/);
  assert.match(html, /3 entradas idênticas do catálogo agrupadas/);
});

test("a nameless row is labelled a catalog error instead of becoming another 'service'", () => {
  const item = healthFrom({ status: "healthy", freshness_status: "FRESH", confidence: 0.9 }, FALLBACK);
  assert.equal(item.catalog_error, "missing_service_identity");
  assert.notEqual(item.service_name, "service");
  const html = healthCard(item);
  assert.match(html, /data-catalog-error="missing_service_identity"/);
  assert.match(html, /Erro de catálogo\/telemetria/);
});

test("a degraded service links its runbook, and says so when the catalog has none", () => {
  const linked = healthCard(
    service({ status: "down", runbook_url: "/runbooks/confenge-api-http" }),
  );
  assert.match(linked, /<a class="wrap-any" href="\/runbooks\/confenge-api-http" rel="noreferrer noopener">/);
  const missing = healthCard(service({ status: "down" }));
  assert.match(missing, /Runbook/);
  assert.match(missing, /não cadastrado no catálogo/);
  assert.doesNotMatch(healthCard(service({ status: "healthy" })), /Runbook/);
});

test("an unsafe runbook href never reaches the DOM", () => {
  for (const unsafe of [
    "javascript:alert(1)",
    "//evil.invalid/runbook",
    "https://user:pass@example.invalid/runbook",
    "/run book",
    'https://example.invalid/"onmouseover="alert(1)',
  ]) {
    assert.equal(safeRunbookHref(unsafe), undefined, unsafe);
    const item = healthFrom(
      { service_name: "x", status: "down", runbook_url: unsafe, freshness_status: "FRESH", confidence: 0.9 },
      FALLBACK,
    );
    assert.equal(item.runbook_url, undefined, unsafe);
    assert.doesNotMatch(healthCard(item), /<a href/);
  }
  assert.equal(safeRunbookHref("https://example.invalid/runbook"), "https://example.invalid/runbook");
});

test("collector 'unhealthy' becomes the contract's 'down' rather than an unknown tone", () => {
  const item = healthFrom(
    { service_name: "x", status: "unhealthy", freshness_status: "FRESH", confidence: 0.9 },
    FALLBACK,
  );
  assert.equal(item.status, "down");
});

test("service rows inherit the snapshot's provenance, not a blanket UNKNOWN/0", () => {
  const item = healthFrom(
    { service_name: "x", status: "healthy" },
    { ...fresh(0.88), source: { system: "collector", kind: "host-health", locator: "infra" } },
  );
  assert.equal(item.provenance.freshness_status, "FRESH");
  assert.equal(item.provenance.confidence, 0.88);
  assert.equal(presentHealth(item).conclusive, true);
});
