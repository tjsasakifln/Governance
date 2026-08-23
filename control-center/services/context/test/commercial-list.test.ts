import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { collectFromWarmblyPayload } from "@confenge/control-center-warmbly-connector";
import { projectCollector } from "../../../connectors/runner/src/projectors/project.ts";
import { frozenClock } from "../src/clock.ts";
import { createRequestListener } from "../src/http.ts";
import { silentLogger } from "../src/log.ts";
import { createFixtureOperationalPort } from "../src/operational/fixture.ts";
import { createOperationalService } from "../src/operational/service.ts";
import type { OperationalSnapshotRow } from "../src/operational/types.ts";
import { REPRESENTATIVE_REPO_DOMAINS } from "../src/representative.ts";
import { FOUNDER, NOW, makeService } from "./helpers.ts";

const OBSERVED_AT = "2026-08-20T11:50:00.000Z";

function projectedRows(count: number, declared = count): OperationalSnapshotRow[] {
  const intel = Array.from({ length: count }, (_, index) => ({
    id: `exc-${String(index).padStart(3, "0")}`,
    kind: index % 2 === 0 ? "missing_version" : "orphan",
    status: index % 3 === 0 ? "acknowledged" : "open",
    why: index === 119 ? "agulha além do cap cinquenta" : `motivo ${index}`,
    owner: index % 4 === 0 ? "Ana" : undefined,
    severity: index % 5 === 0 ? "high" : "low",
    at: new Date(Date.parse(OBSERVED_AT) - index * 60_000).toISOString(),
  }));
  const inbound = Array.from({ length: count }, (_, index) => ({
    lead_id: `activity-${String(index).padStart(3, "0")}`,
    company: `Conta ${index}`,
    status: "done",
    why_now: `atividade ${index}`,
    recommended_action: "arquivar",
  }));
  const snapshot = collectFromWarmblyPayload(
    {
      health: { status: "ok" },
      api_version: "v1",
      confenge_inbound: inbound,
      confenge_intel_exceptions: intel,
    },
    { now: new Date(OBSERVED_AT) },
  );
  if (declared !== count && snapshot.operations) {
    snapshot.operations.intel_exceptions_total = declared;
  }
  return projectCollector({
    collector: "warmbly",
    freshness_status: "FRESH",
    observed_at: OBSERVED_AT,
    source: { system: "warmbly", kind: "crm-read-model", locator: "commercial/pipeline" },
    confidence: 0.9,
    payload: snapshot,
  }).map((snapshot, index) => ({
    id: `cc:operational-snapshot:list-${index}`,
    scope: snapshot.scope,
    snapshot_kind: snapshot.snapshot_kind,
    generated_at: snapshot.observed_at,
    source: snapshot.source,
    observed_at: snapshot.observed_at,
    freshness_status: snapshot.freshness_status,
    confidence: snapshot.confidence,
    payload: snapshot.payload,
  }));
}

async function withServer(rows: OperationalSnapshotRow[], fn: (base: string) => Promise<void>): Promise<void> {
  const { service } = makeService();
  const operational = createOperationalService({
    port: createFixtureOperationalPort({ operational_snapshots: rows }),
    clock: frozenClock(NOW),
    founderActorId: FOUNDER.id,
    repoDomains: REPRESENTATIVE_REPO_DOMAINS,
  });
  const server = createServer(createRequestListener({ service, operational, logger: silentLogger }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

function headers(): Record<string, string> {
  return { "x-actor-id": FOUNDER.id, "x-actor-kind": FOUNDER.kind };
}

test("commercial list pages cross the producer's 50-row preview without widening the HTTP payload", async () => {
  const rows = projectedRows(130);
  const commercial = rows.find((row) => row.snapshot_kind === "commercial");
  assert.ok(commercial);
  const operations = commercial.payload.operations as Record<string, unknown>;
  assert.equal((operations.exceptions as unknown[]).length, 50, "headline snapshot stays bounded");
  const pages = rows.filter((row) => row.snapshot_kind === "commercial-list-page");
  assert.ok(pages.length >= 6, "both long queues are persisted as bounded pages");
  for (const page of pages) {
    assert.ok(((page.payload.items as unknown[]) ?? []).length <= 50);
  }

  await withServer(rows, async (base) => {
    const response = await fetch(
      `${base}/v1/domains/commercial/lists/exceptions?scope=commercial&q=agulha&por_pagina=25`,
      { headers: headers() },
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(body.loaded_total, 130);
    assert.equal(body.declared_total, 130);
    assert.equal(body.complete, true);
    assert.deepEqual(body.truth, {
      state: "HEALTHY",
      as_of: OBSERVED_AT,
      source: { system: "warmbly", kind: "crm-read-model", locator: "commercial/pipeline" },
      confidence: 0.9,
      reason: "fresh_observation",
    });
    assert.equal(body.matched, 1);
    assert.equal((body.items as Array<Record<string, unknown>>)[0]?.id, "exc-119");
    assert.ok((body.items as unknown[]).length <= 25, "one response never returns the full queue");

    const third = await fetch(
      `${base}/v1/domains/commercial/lists/exceptions?scope=commercial&pagina=5&por_pagina=25&ordem=identificador`,
      { headers: headers() },
    );
    const thirdBody = (await third.json()) as Record<string, unknown>;
    assert.equal(thirdBody.page, 5);
    assert.equal((thirdBody.items as Array<Record<string, unknown>>)[0]?.id, "exc-100");
    assert.equal((thirdBody.items as unknown[]).length, 25);
  });
});

test("declared rows missing from the collection are reported as incomplete, never searchable total", async () => {
  await withServer(projectedRows(60, 100), async (base) => {
    const response = await fetch(
      `${base}/v1/domains/commercial/lists/exceptions?scope=commercial`,
      { headers: headers() },
    );
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(body.loaded_total, 60);
    assert.equal(body.declared_total, 100);
    assert.equal(body.complete, false);
    assert.equal((body.truth as Record<string, unknown>).state, "UNKNOWN");
    assert.equal((body.truth as Record<string, unknown>).reason, "partial_payload");
    assert.equal(body.matched, 60);
    assert.equal((body.items as unknown[]).length, 25);
  });
});

test("real zero, unproven absence and disguised stale remain three different list truths", async () => {
  await withServer(projectedRows(0), async (base) => {
    const response = await fetch(`${base}/v1/domains/commercial/lists/activity?scope=commercial`, {
      headers: headers(),
    });
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal((body.truth as Record<string, unknown>).state, "ZERO");
    assert.equal((body.truth as Record<string, unknown>).reason, "confirmed_zero");
  });

  await withServer([], async (base) => {
    const response = await fetch(`${base}/v1/domains/commercial/lists/activity?scope=commercial`, {
      headers: headers(),
    });
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal((body.truth as Record<string, unknown>).state, "UNKNOWN");
    assert.equal((body.truth as Record<string, unknown>).reason, "recency_unknown");
  });

  const staleRows = projectedRows(0).map((row) => ({ ...row, freshness_status: "STALE" as const }));
  await withServer(staleRows, async (base) => {
    const response = await fetch(`${base}/v1/domains/commercial/lists/activity?scope=commercial`, {
      headers: headers(),
    });
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal((body.truth as Record<string, unknown>).state, "STALE");
    assert.equal((body.truth as Record<string, unknown>).reason, "observation_stale");
    assert.equal(body.loaded_total, 0);
  });
});

test("explicit facets work when produced and are honestly unavailable when Warmbly has no field", async () => {
  await withServer(projectedRows(70), async (base) => {
    const response = await fetch(
      `${base}/v1/domains/commercial/lists/activity?scope=commercial&condicao=unassigned&origem=warmbly&estado=done&tipo=done&periodo=24h`,
      { headers: headers() },
    );
    const body = (await response.json()) as Record<string, unknown>;
    const facetValues = body.facet_values as Record<string, string[]>;
    assert.ok(facetValues.condicao?.includes("unassigned"));
    assert.ok(facetValues.condicao?.includes("unread"));
    assert.deepEqual(facetValues.origem, ["warmbly"]);
    assert.deepEqual(facetValues.estado, ["done"]);
    assert.deepEqual(facetValues.tipo, ["done"]);
    assert.deepEqual(facetValues.responsavel, []);
    assert.deepEqual(facetValues.prioridade, []);
    assert.equal((body.unavailable_facets as string[]).includes("origem"), false);
    assert.equal((body.unavailable_facets as string[]).includes("responsavel"), true);
    assert.equal((body.unavailable_facets as string[]).includes("prioridade"), true);
    assert.equal(body.matched, 70);
    assert.ok((body.items as Array<Record<string, unknown>>).every((row) => row.source === "warmbly"));

    const exceptionResponse = await fetch(
      `${base}/v1/domains/commercial/lists/exceptions?scope=commercial&responsavel=Ana&prioridade=high`,
      { headers: headers() },
    );
    const exceptionBody = (await exceptionResponse.json()) as Record<string, unknown>;
    assert.equal(exceptionBody.matched, 4);
    assert.ok(
      (exceptionBody.items as Array<Record<string, unknown>>).every(
        (row) => row.owner === "Ana" && row.priority === "high",
      ),
    );
  });
});
