import assert from "node:assert/strict";
import { test } from "node:test";
import { renderShell } from "../src/ui/render";
import { commercialBlock } from "../src/ui/domains";
import { commercialFrom, fallbackProvenance } from "../src/adapters/map";
import type { CommercialSnapshot } from "../src/types";

const FALLBACK = fallbackProvenance("test", "2026-08-20T18:00:00.000Z");

function comercial(commercial: Record<string, unknown>): string {
  return renderShell({
    destination: "comercial",
    viewKind: "ready",
    mockScenario: "http",
    adapterMode: "http",
    view: {
      kind: "ready",
      data: {
        id: "comercial",
        label: "Comercial",
        scope: "commercial",
        generated_at: "2026-08-20T18:00:00Z",
        operator: { kind: "human", id: "human:operator" },
        headline: "x",
        attention: [],
        priorities: [],
        commercial: {
          schema_version: "control-center.commercial-snapshot.v1",
          id: "cc:commercial-snapshot:currency",
          scope: "commercial",
          generated_at: "2026-08-20T18:00:00Z",
          provenance: {
            source: { system: "warmbly", kind: "crm-read-model", locator: "x" },
            observed_at: "2026-08-20T18:00:00Z",
            freshness_status: "FRESH",
            confidence: 1,
          },
          authority: {
            catalog_authority: "governance",
            commercial_runtime: "warmbly",
            this_document: "read_model",
          },
          pipeline_open_count: 0,
          ...commercial,
        } as unknown as CommercialSnapshot,
      },
    },
  });
}

test("a BRL catalog pipeline is shown in BRL", () => {
  const html = comercial({ pipeline_nominal: { amount_cents: 4_800_000, currency: "BRL" } });
  assert.match(html, /Pipeline nominal[\s\S]{0,200}BRL 48\.000,00/);
  assert.doesNotMatch(html, /USD/);
});

test("an absent pipeline reads sem dados, never 0,00", () => {
  const html = comercial({});
  assert.match(html, /Pipeline nominal[\s\S]{0,200}sem dados/);
  assert.doesNotMatch(html, /Pipeline nominal[\s\S]{0,200}0,00/);
});

test("a multi-currency pipeline shows a total per currency and never a merged one", () => {
  const html = comercial({
    pipeline_nominal_by_currency: [
      { amount_cents: 10_000, currency: "BRL" },
      { amount_cents: 5_000, currency: "USD" },
    ],
  });
  assert.match(html, /data-currency-split="2"/);
  assert.match(html, /BRL 100,00/);
  assert.match(html, /USD 50,00/);
  // 150,00 would be BRL and USD added together, which no rate here justifies.
  assert.doesNotMatch(html, /150,00/);
});

test("a pipeline whose currency the read model could not parse is not painted", () => {
  const html = comercial({ pipeline_nominal: { amount_cents: 100, currency: "reais" } });
  assert.match(html, /Pipeline nominal[\s\S]{0,200}sem dados/);
  assert.doesNotMatch(html, /reais/);
});

test("an open deal with no readable currency reads sem dados instead of borrowing BRL", () => {
  const html = commercialBlock(
    {
      schema_version: "control-center.commercial-snapshot.v1",
      id: "cc:commercial-snapshot:deals",
      scope: "commercial",
      generated_at: "2026-08-20T18:00:00Z",
      provenance: {
        source: { system: "warmbly", kind: "crm-read-model", locator: "x" },
        observed_at: "2026-08-20T18:00:00Z",
        freshness_status: "FRESH",
        confidence: 1,
      },
      authority: {
        catalog_authority: "governance",
        commercial_runtime: "warmbly",
        this_document: "read_model",
      },
      operations: {
        pipeline: [
          { id: "d1", display_name: "Com moeda", status: "open", value: { amount_cents: 100, currency: "BRL" } },
          { id: "d2", display_name: "Sem moeda", status: "open", value: { amount_cents: 100 } },
          { id: "d3", display_name: "Moeda ilegível", status: "open", value: { amount_cents: 100, currency: "reais" } },
        ],
      },
    } as unknown as CommercialSnapshot,
    "pipeline",
  );
  assert.match(html, /BRL 1,00/);
  assert.equal([...html.matchAll(/data-no-data="true">sem dados/g)].length, 2);
  assert.doesNotMatch(html, /reais/);
});

test("commercialFrom carries per-currency totals through only when there is more than one", () => {
  const row = {
    id: "cc:commercial-snapshot:split",
    scope: "commercial",
    generated_at: "2026-08-20T18:00:00Z",
    provenance: {
      source: { system: "warmbly", kind: "crm-read-model", locator: "x" },
      observed_at: "2026-08-20T18:00:00Z",
      freshness_status: "FRESH",
      confidence: 1,
    },
    authority: {
      catalog_authority: "governance",
      commercial_runtime: "warmbly",
      this_document: "read_model",
    },
  };
  const split = commercialFrom(
    {
      ...row,
      pipeline_nominal_by_currency: [
        { amount_cents: 10_000, currency: "BRL" },
        { amount_cents: 5_000, currency: "USD" },
      ],
    },
    FALLBACK,
  );
  assert.equal(split.pipeline_nominal_by_currency?.length, 2);
  const single = commercialFrom(
    { ...row, pipeline_nominal_by_currency: [{ amount_cents: 10_000, currency: "BRL" }] },
    FALLBACK,
  );
  assert.equal(single.pipeline_nominal_by_currency, undefined);
});
