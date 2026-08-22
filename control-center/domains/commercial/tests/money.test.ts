import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { majorUnitsToCentsExact, weightedCentsExact } from "../src/money.ts";
import { projectCommercialSummary } from "../src/project.ts";
import { NOW } from "./helpers.ts";

describe("majorUnitsToCentsExact", () => {
  it("converts exact major units without inventing cents", () => {
    assert.equal(majorUnitsToCentsExact(0), 0);
    assert.equal(majorUnitsToCentsExact(8000), 800_000);
    assert.equal(majorUnitsToCentsExact(1500.5), 150_050);
    assert.equal(majorUnitsToCentsExact(10.01), 1001);
  });

  it("fail-closes amounts that are not exact cents", () => {
    assert.equal(majorUnitsToCentsExact(10.001), null);
    assert.equal(majorUnitsToCentsExact(Number.NaN), null);
    assert.equal(majorUnitsToCentsExact(Number.POSITIVE_INFINITY), null);
    assert.equal(majorUnitsToCentsExact(-1), null);
  });
});

describe("projection money fail-closed", () => {
  it("does not include inexact Warmbly floats in nominal pipeline", () => {
    const summary = projectCommercialSummary(
      {
        schema_version: "control-center.commercial-observations.v1",
        observed_at: "2026-08-20T12:00:00Z",
        freshness_status: "FRESH",
        records: [
          {
            id: "deal-bad-float",
            entity: "deal",
            status: "open",
            funnel_stage: "oportunidades",
            value: 10.001,
            currency: "BRL",
            next_action: "fix_amount",
            next_action_at: "2026-08-21T00:00:00Z",
            last_activity_at: "2026-08-19T00:00:00Z",
            stage_entered_at: "2026-08-18T00:00:00Z",
          },
          {
            id: "deal-good",
            entity: "deal",
            status: "open",
            funnel_stage: "propostas",
            amount_cents: 800000,
            currency: "BRL",
            next_action: "send",
            next_action_at: "2026-08-21T00:00:00Z",
            last_activity_at: "2026-08-19T00:00:00Z",
            stage_entered_at: "2026-08-18T00:00:00Z",
          },
        ],
      },
      { now: NOW },
    );
    assert.equal(summary.pipeline.nominal.treatment, "present");
    assert.equal(summary.pipeline.nominal.amount_cents, 800000);
    assert.equal(summary.funnel.oportunidades.value, 1);
    assert.equal(summary.funnel.propostas.value, 1);
  });
});

describe("weightedCentsExact", () => {
  it("keeps cents × probability as integer cents when exact", () => {
    assert.equal(weightedCentsExact(800000, 0.5), 400000);
    assert.equal(weightedCentsExact(800000, 0.25), 200000);
    assert.equal(weightedCentsExact(100, 1), 100);
  });

  it("rejects out-of-range probability", () => {
    assert.equal(weightedCentsExact(800000, 1.5), null);
    assert.equal(weightedCentsExact(800000, -0.1), null);
  });
});

describe("pipeline currency is evidence, not a default", () => {
  const base = {
    schema_version: "control-center.commercial-observations.v1" as const,
    observed_at: "2026-08-20T12:00:00Z",
    freshness_status: "FRESH" as const,
  };

  it("does not report an empty pipeline as a zero in the catalog currency", () => {
    // A pipeline with nothing open has no denominated contribution, so it has
    // no currency to be stated in. "BRL 0,00" would read as a measured amount.
    const summary = projectCommercialSummary({ ...base, records: [] }, { now: NOW });
    assert.equal(summary.pipeline.nominal.treatment, "insufficient_data");
    assert.equal(summary.pipeline.nominal.reason, "no_open_pipeline");
    assert.equal(summary.pipeline.nominal.amount_cents, undefined);
    assert.equal(summary.pipeline.nominal.currency, undefined);
  });

  it("denominates a deal that states no currency in the BRL catalog currency", () => {
    const summary = projectCommercialSummary(
      {
        ...base,
        records: [
          {
            id: "deal-no-currency",
            entity: "deal",
            status: "open",
            funnel_stage: "propostas",
            amount_cents: 800000,
            next_action: "send",
            next_action_at: "2026-08-21T00:00:00Z",
            last_activity_at: "2026-08-19T00:00:00Z",
            stage_entered_at: "2026-08-18T00:00:00Z",
          },
        ],
      },
      { now: NOW },
    );
    assert.equal(summary.pipeline.nominal.treatment, "present");
    assert.equal(summary.pipeline.nominal.currency, "BRL");
    assert.equal(summary.pipeline.nominal.amount_cents, 800000);
  });

  it("does not relabel an unreadable currency as BRL and fold it into the total", () => {
    const summary = projectCommercialSummary(
      {
        ...base,
        records: [
          {
            id: "deal-brl",
            entity: "deal",
            status: "open",
            funnel_stage: "propostas",
            amount_cents: 800000,
            currency: "BRL",
            next_action: "send",
            next_action_at: "2026-08-21T00:00:00Z",
            last_activity_at: "2026-08-19T00:00:00Z",
            stage_entered_at: "2026-08-18T00:00:00Z",
          },
          {
            id: "deal-bad-currency",
            entity: "deal",
            status: "open",
            funnel_stage: "propostas",
            amount_cents: 100000,
            currency: "reais",
            next_action: "send",
            next_action_at: "2026-08-21T00:00:00Z",
            last_activity_at: "2026-08-19T00:00:00Z",
            stage_entered_at: "2026-08-18T00:00:00Z",
          },
        ],
      },
      { now: NOW },
    );
    // The two must not be summed into a single 900000 that looks like one
    // clean BRL figure.
    assert.equal(summary.pipeline.nominal.treatment, "insufficient_data");
    assert.equal(summary.pipeline.nominal.reason, "unreadable_currency");
    assert.equal(summary.pipeline.nominal.amount_cents, undefined);
  });
});
