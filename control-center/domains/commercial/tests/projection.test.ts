import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ATTENTION_NOW_LIMIT,
  FUNNEL_KEYS,
  SUMMARY_SCHEMA_VERSION,
} from "../src/contracts.ts";
import { projectCommercialSummary } from "../src/project.ts";
import {
  NOW,
  declaredFunnelCount,
  declaredOpenPipeline,
  loadJson,
  provenanceFields,
} from "./helpers.ts";

describe("projectCommercialSummary — complete funnel", () => {
  const input = loadJson("complete-funnel.json");
  const summary = projectCommercialSummary(input, { now: NOW });

  it("emits the executive schema with all funnel keys", () => {
    assert.equal(summary.schema_version, SUMMARY_SCHEMA_VERSION);
    assert.equal(summary.scope, "commercial");
    assert.equal(summary.authority.catalog_authority, "governance");
    assert.equal(summary.authority.commercial_runtime, "warmbly");
    assert.equal(summary.authority.this_document, "read_model");
    for (const key of FUNNEL_KEYS) {
      assert.ok(key in summary.funnel, `missing funnel key ${key}`);
      const fig = summary.funnel[key];
      assert.equal(fig.key, key);
      assert.equal(fig.value, declaredFunnelCount(input.records, key));
      assert.deepEqual(provenanceFields(fig), []);
    }
    assert.deepEqual(provenanceFields(summary.provenance), []);
  });

  it("emits nominal pipeline in integer cents when amounts are known", () => {
    assert.equal(summary.pipeline.nominal.treatment, "present");
    assert.equal(typeof summary.pipeline.nominal.amount_cents, "number");
    assert.equal(Number.isInteger(summary.pipeline.nominal.amount_cents), true);
    assert.equal(summary.pipeline.nominal.currency, "BRL");
    const open = declaredOpenPipeline(input.records);
    let expected = 0;
    for (const row of open) {
      if (typeof row.amount_cents === "number") {
        expected += row.amount_cents;
      } else if (typeof row.value === "number") {
        expected += row.value * 100;
      }
    }
    assert.equal(summary.pipeline.nominal.amount_cents, expected);
  });

  it("does not invent weighted pipeline when probabilities are absent", () => {
    assert.equal(summary.pipeline.weighted.treatment, "insufficient_data");
    assert.equal(summary.pipeline.weighted.amount_cents, undefined);
  });

  it("pins Governance identity without copying a catalog", () => {
    assert.equal(summary.authority.offer_pin.authority_id, "CFG-OFFER-AUTHORITY-v1");
    assert.equal(summary.authority.offer_pin.catalog_id, "CFG-OFFER-CATALOG-v1");
    const blob = JSON.stringify(summary);
    assert.equal(blob.includes("Diagnóstico B2G"), false);
    assert.equal(blob.includes("description_short"), false);
    assert.equal(blob.includes("catalog.v1.json"), false);
  });
});

describe("projectCommercialSummary — exceptions and attention", () => {
  const input = loadJson("exceptions-gaps.json");
  const summary = projectCommercialSummary(input, { now: NOW });

  it("emits checkable rows for aging, missing next action, stalled stages, conversion windows", () => {
    const kinds = new Set(summary.exceptions.map((row) => row.kind));
    assert.equal(kinds.has("missing_next_action"), true);
    assert.equal(kinds.has("stalled_stage"), true);
    assert.equal(kinds.has("aging"), true);
    assert.equal(kinds.has("conversion_window_gap"), true);
    const missing = summary.exceptions.find((row) => row.record_id === "deal-missing-next");
    assert.equal(missing?.kind, "missing_next_action");
  });

  it("caps commercial attention at 3 now-horizon items and is non-empty when exceptions exist", () => {
    assert.ok(summary.exceptions.length > 0);
    assert.ok(summary.attention.items.length > 0);
    assert.ok(summary.attention.items.length <= ATTENTION_NOW_LIMIT);
    assert.equal(summary.attention.horizon, "now");
    for (const item of summary.attention.items) {
      assert.equal(item.horizon, "now");
      assert.equal(typeof item.recommended_action, "string");
      assert.ok(item.recommended_action.length > 0);
      assert.deepEqual(provenanceFields(item.provenance), []);
    }
  });
});

describe("projectCommercialSummary — incomplete / UNKNOWN", () => {
  const input = loadJson("incomplete-unknown.json");
  const summary = projectCommercialSummary(input, { now: NOW });

  it("fail-closes to zeros / UNKNOWN / insufficient_data and does not invent counts", () => {
    for (const key of FUNNEL_KEYS) {
      assert.equal(summary.funnel[key].value, 0);
      assert.deepEqual(provenanceFields(summary.funnel[key]), []);
    }
    assert.ok(summary.unclassified.value >= 1);
    assert.equal(summary.provenance.freshness_status, "UNKNOWN");
    assert.equal(
      summary.pipeline.nominal.treatment === "insufficient_data" ||
        summary.pipeline.nominal.amount_cents === 0,
      true,
    );
    assert.equal(summary.pipeline.weighted.treatment, "insufficient_data");
  });

  it("does not throw on empty, null, or partial input", () => {
    assert.doesNotThrow(() => projectCommercialSummary(null, { now: NOW }));
    assert.doesNotThrow(() => projectCommercialSummary({}, { now: NOW }));
    assert.doesNotThrow(() =>
      projectCommercialSummary({ records: [] }, { now: NOW }),
    );
    const empty = projectCommercialSummary({ records: [] }, { now: NOW });
    for (const key of FUNNEL_KEYS) {
      assert.equal(empty.funnel[key].value, 0);
    }
  });
});

describe("projectCommercialSummary — offer pin mismatch and Extra leak", () => {
  const input = loadJson("offer-discrepancy.json");
  const summary = projectCommercialSummary(input, { now: NOW });

  it("flags unknown offer_id, version drift, and Extra 1000000 treated as an offer", () => {
    const kinds = new Set(summary.exceptions.map((row) => row.kind));
    assert.equal(kinds.has("unknown_offer_id"), true);
    assert.equal(kinds.has("offer_version_drift"), true);
    assert.equal(kinds.has("extra_historical_as_offer"), true);
    const extra = summary.exceptions.filter((row) => row.kind === "extra_historical_as_offer");
    assert.ok(extra.length >= 1);
    assert.equal(
      extra.some((row) => row.summary.toLowerCase().includes("not a") || row.summary.includes("not an offer")),
      true,
    );
    assert.equal(
      summary.attention.items.some((item) => item.kind === "extra_historical_as_offer"),
      true,
    );
  });
});

describe("projectCommercialSummary — probabilities", () => {
  it("emits weighted pipeline as cents × probability when every open item is reliable", () => {
    const input = loadJson("probabilities-reliable.json");
    const summary = projectCommercialSummary(input, { now: NOW });
    assert.equal(summary.pipeline.weighted.treatment, "present");
    const open = declaredOpenPipeline(input.records);
    let expected = 0;
    for (const row of open) {
      assert.equal(row.probability_reliable, true);
      assert.equal(typeof row.amount_cents, "number");
      assert.equal(typeof row.probability, "number");
      expected += (row.amount_cents as number) * (row.probability as number);
    }
    assert.equal(summary.pipeline.weighted.amount_cents, expected);
    assert.equal(summary.pipeline.nominal.treatment, "present");
  });

  it("marks weighted insufficient_data when probabilities are absent or unreliable", () => {
    const input = loadJson("probabilities-absent.json");
    const summary = projectCommercialSummary(input, { now: NOW });
    assert.equal(summary.pipeline.nominal.treatment, "present");
    assert.equal(summary.pipeline.weighted.treatment, "insufficient_data");
    assert.equal(summary.pipeline.weighted.amount_cents, undefined);
    assert.equal(summary.pipeline.weighted.reason, "probabilities_missing_or_unreliable");
  });
});

describe("projectCommercialSummary — representative one-screen summary", () => {
  it("fits an action-first view: five funnel figures, pipeline, ≤3 attention", () => {
    const input = loadJson("representative.json");
    const summary = projectCommercialSummary(input, { now: NOW });
    assert.equal(Object.keys(summary.funnel).length, FUNNEL_KEYS.length);
    for (const key of FUNNEL_KEYS) {
      assert.equal(typeof summary.funnel[key].value, "number");
    }
    assert.ok(summary.attention.items.length <= ATTENTION_NOW_LIMIT);
    assert.ok(summary.attention.items.length >= 1);
    assert.equal(summary.pipeline.weighted.treatment, "insufficient_data");
    assert.equal(summary.pipeline.nominal.treatment, "present");
    const kinds = new Set(summary.exceptions.map((row) => row.kind));
    assert.equal(kinds.has("extra_historical_as_offer"), true);
    assert.equal(kinds.has("unknown_offer_id"), true);
    assert.equal(kinds.has("missing_next_action"), true);
  });

  it("is deterministic for the same observations and clock", () => {
    const input = loadJson("representative.json");
    const a = projectCommercialSummary(input, { now: NOW });
    const b = projectCommercialSummary(input, { now: NOW });
    assert.equal(JSON.stringify(a), JSON.stringify(b));
  });
});
