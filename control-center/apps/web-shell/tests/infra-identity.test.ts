import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createMockAdapter } from "../src/adapters/index";
import { healthFrom, safeRunbookHref } from "../src/adapters/map";
import { createMemoryRuntime, mount } from "../src/app";
import { catalogErrorExplanation, healthCard, infraCatalogBlock, presentHealth } from "../src/ui/domains";
import { httpAdapterFor } from "./helpers";
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
    assert.match(root.innerHTML, />Atualização</);
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

// --- Adversarial review follow-ups -----------------------------------------

/** The real shape of GET /v1/domains/infrastructure: response -> slot -> snapshot. */
function infraDomainPayload(
  services: Record<string, unknown>[],
  slot: Record<string, unknown> = {},
  snapshot: Record<string, unknown> = {},
) {
  const freshness = (slot.freshness_status as string | undefined) ?? "FRESH";
  const confidence = (slot.confidence as number | undefined) ?? 0.88;
  return {
    schema_version: "control-center.operational-envelope.v1",
    scope: "infrastructure",
    generated_at: "2026-08-20T11:20:00Z",
    freshness_status: freshness,
    confidence,
    domain: "infrastructure",
    snapshot: {
      schema_version: "control-center.operational-domain.v1",
      domain: "infrastructure",
      scope: "infrastructure",
      source: { system: "collector", kind: "host-health", locator: "infrastructure/hosts" },
      observed_at: "2026-08-20T11:20:00Z",
      presence: "present",
      healthy: freshness === "FRESH" && confidence > 0,
      ...slot,
      freshness_status: freshness,
      confidence,
      snapshot: {
        schema_version: "control-center.infrastructure-snapshot.v1",
        availability: "FRESH",
        monitored_service_count: services.length,
        catalog_error_count: 0,
        duplicate_group_count: 0,
        services,
        ...snapshot,
      },
    },
  };
}

async function infraPageFor(payload: unknown) {
  const { adapter } = httpAdapterFor((path) =>
    path.startsWith("/v1/domains/infrastructure") ? payload : undefined,
  );
  const result = await adapter.readDestination("infra");
  assert.equal(result.ok, true);
  assert.equal(result.loading, false);
  assert.ok(result.ok && !result.loading);
  return result.page;
}

test("the HTTP adapter gives a service row the snapshot's provenance, not the blanket UNKNOWN/0", async () => {
  // The row deliberately carries no freshness, confidence, provenance or
  // source of its own: this is the shape that produced "healthy · confiança
  // 0,00" in production. If loadDomain falls back to the adapter default again,
  // this reads UNKNOWN/0 and the card stops being conclusive.
  const page = await infraPageFor(
    infraDomainPayload([
      {
        id: "cc:service-health:confenge-api-http",
        service_name: "Confenge API inbound health",
        role: "Endpoint de health do inbound",
        endpoint: "https://api.confenge.com.br/health",
        status: "healthy",
      },
    ]),
  );
  const service = page.health?.[0];
  assert.ok(service);
  assert.equal(service.provenance.freshness_status, "FRESH");
  assert.equal(service.provenance.confidence, 0.88);
  assert.equal(service.service_name, "Confenge API inbound health");
  assert.equal(presentHealth(service).conclusive, true);
  const html = healthCard(service);
  assert.match(html, /data-conclusive="true"/);
  assert.doesNotMatch(html, /confiança 0,00/);
});

test("the Infra route states why the evidence is weak instead of showing a bare confidence 0", async () => {
  const page = await infraPageFor(
    infraDomainPayload(
      [],
      { freshness_status: "UNKNOWN", confidence: 0, healthy: false },
      {
        availability: "NOT_CONFIGURED",
        unavailability_reason: "NOT_CONFIGURED",
        monitored_service_count: 0,
        catalog_error_count: 0,
      },
    ),
  );
  const summary = page.health_summary;
  assert.ok(summary);
  assert.equal(summary.unavailability_reason, "NOT_CONFIGURED");
  assert.equal(summary.availability, "NOT_CONFIGURED");
  assert.equal(summary.confidence, 0);
  const html = infraCatalogBlock(summary);
  assert.match(html, /NOT_CONFIGURED/);
  assert.match(html, /coletor não configurado neste ambiente/);
  assert.match(html, /confiança 0,00/);
  // A failed probe must not look identical to a collector that never ran.
  const upstream = infraCatalogBlock({
    freshness_status: "ERROR",
    confidence: 0,
    unavailability_reason: "UPSTREAM_ERROR",
  });
  assert.match(upstream, /erro na origem durante a coleta/);
  assert.notEqual(upstream, html);
});

test("doubt about the collector run is shown as a caveat, not written into the service's state", () => {
  const item = service({
    service_name: "netcup-vps-1",
    status: "healthy",
    provenance: fresh(0.95),
    snapshot_evidence: { freshness_status: "ERROR", confidence: 0, conclusive: false },
  });
  // The host answered fresh at 0.95. One sibling probe timing out must not
  // repaint it "fora do ar".
  assert.deepEqual(presentHealth(item), { status: "healthy", conclusive: true });
  const html = healthCard(item);
  assert.match(html, /data-snapshot-evidence="ERROR"/);
  assert.match(html, /Coleta que trouxe este serviço: erro de coleta/);
  assert.doesNotMatch(html, /data-status="down"/);
});

test("latency names the probe it came from, and absence stays absence", () => {
  const timed = healthCard(service({ latency_ms: 42, latency_check: "http" }));
  assert.match(timed, /Latência observada \(http\)/);
  assert.match(timed, /42 ms/);
  const untimed = healthCard(service({ status: "degraded" }));
  assert.match(untimed, /não medida \(sem sonda de tempo neste serviço\)/);
});

test("a runbook URL carrying a secret-looking query key is refused", () => {
  for (const unsafe of [
    "https://runbooks.example/infra?api_key=abc",
    "https://runbooks.example/infra?x=1&token=abc",
    "/runbooks/infra?password=hunter2",
    "/runbooks/infra?api%5Fkey=abc",
  ]) {
    assert.equal(safeRunbookHref(unsafe), undefined, unsafe);
  }
  assert.equal(
    safeRunbookHref("https://runbooks.example/infra?service=api"),
    "https://runbooks.example/infra?service=api",
  );
});

test("the credential-name rule is one rule, not three copies that drift", () => {
  // The collector must not import the contracts tree and the browser bundle
  // must not import the collector, so the module is duplicated on purpose. It
  // is duplicated verbatim, and this is what keeps it that way: `?token[]=`
  // was refused in one copy and rendered by another exactly because the three
  // regexes had drifted apart.
  const here = dirname(fileURLToPath(import.meta.url));
  const shell = readFileSync(join(here, "../src/secret-keys.ts"), "utf8");
  const collector = readFileSync(
    join(here, "../../../connectors/infrastructure/src/secret-keys.ts"),
    "utf8",
  );
  assert.equal(shell, collector, "secret-keys.ts copies have drifted");
  // And no boundary may quietly reintroduce a private list.
  for (const file of ["../src/adapters/map.ts", "../src/ui/domains.ts"]) {
    assert.doesNotMatch(readFileSync(join(here, file), "utf8"), /SECRET_QUERY_KEY\s*=/);
  }
});

test("a query key wearing brackets or encoding is still refused by the shell", () => {
  for (const unsafe of [
    "/runbooks/infra?token[]=abc",
    "/runbooks/infra?token%5B%5D=abc",
    "https://runbooks.example/i?token[]=abc",
    "https://runbooks.example/i?identity=abc",
    "https://runbooks.example/i?x-api-key=abc",
    "/runbooks/infra?%ZZ=1",
  ]) {
    assert.equal(safeRunbookHref(unsafe), undefined, unsafe);
    const item = healthFrom(
      { service_name: "x", status: "down", runbook_url: unsafe, freshness_status: "FRESH", confidence: 0.9 },
      FALLBACK,
    );
    assert.doesNotMatch(healthCard(item), /<a class="wrap-any"/);
  }
  assert.equal(safeRunbookHref("/runbooks/infra?service=api"), "/runbooks/infra?service=api");
});

test("each catalog error explains its own cause and none invents one", () => {
  assert.match(catalogErrorExplanation("missing_service_identity"), /não informou identidade/);
  const ambiguous = catalogErrorExplanation("ambiguous_service_id");
  // The origin DID supply an identity here — two of them. Saying otherwise is
  // a wrong explanation, which is worse than none.
  assert.doesNotMatch(ambiguous, /não informou identidade/);
  assert.match(ambiguous, /mesmo identificador/);
  assert.match(catalogErrorExplanation("something_new"), /nenhuma causa é presumida/);

  const html = healthCard(service({ status: "degraded", catalog_error: "ambiguous_service_id" }));
  assert.match(html, /data-catalog-error="ambiguous_service_id"/);
  assert.match(html, /mesmo identificador/);
  assert.doesNotMatch(html, /não informou identidade/);
});

test("latency and the probe that measured it stay together on the card", () => {
  const html = healthCard(service({ latency_ms: 120, latency_check: "reachability" }));
  assert.match(html, /Latência observada \(reachability\)/);
  assert.doesNotMatch(html, /Latência observada \(http\)/);
});
