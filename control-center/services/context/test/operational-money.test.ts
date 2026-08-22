import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CATALOG_CURRENCY,
  evidencedMoney,
  nominalPipeline,
  pipelineByCurrency,
  reliableWeightedPipeline,
  type ProvenanceSeed,
} from "../src/operational/money.ts";

const SEED: ProvenanceSeed = {
  source: { system: "warmbly", kind: "crm-read-model", locator: "warmbly/commercial" },
  observed_at: "2026-08-21T12:00:00.000Z",
  freshness_status: "FRESH",
  confidence: 0.9,
};

describe("catalog currency", () => {
  it("is BRL, the CONFENGE contractual currency", () => {
    assert.equal(CATALOG_CURRENCY, "BRL");
  });
});

describe("evidencedMoney currency resolution", () => {
  it("denominates an amount that states no currency in the catalog currency", () => {
    const money = evidencedMoney({ amount_cents: 4_800_000 }, SEED);
    assert.equal(money?.currency, "BRL");
    assert.equal(money?.amount_cents, 4_800_000);
  });

  it("keeps a currency the payload actually stated", () => {
    assert.equal(evidencedMoney({ amount_cents: 100, currency: "EUR" }, SEED)?.currency, "EUR");
  });

  it("fails closed on a stated currency that is not ISO-4217, instead of relabelling it BRL", () => {
    assert.equal(evidencedMoney({ amount_cents: 100, currency: "reais" }, SEED), undefined);
    assert.equal(evidencedMoney({ amount_cents: 100, currency: "R$" }, SEED), undefined);
    assert.equal(evidencedMoney({ amount_cents: 100, currency: 7 }, SEED), undefined);
  });

  it("treats a blank currency as unstated, not as unreadable", () => {
    assert.equal(evidencedMoney({ amount_cents: 100, currency: "  " }, SEED)?.currency, "BRL");
  });
});

describe("nominalPipeline", () => {
  it("reports a BRL catalog pipeline with the reading provenance", () => {
    const money = nominalPipeline({ amount_cents: 4_800_000, currency: "BRL" }, SEED);
    assert.equal(money?.amount_cents, 4_800_000);
    assert.equal(money?.currency, "BRL");
    assert.equal(money?.observed_at, SEED.observed_at);
    assert.equal(money?.source.system, "warmbly");
  });

  it("denominates a pipeline with no stated currency in BRL, never in a foreign default", () => {
    assert.equal(nominalPipeline({ amount_cents: 150_050 }, SEED)?.currency, "BRL");
  });

  it("withholds a zero total: nothing denominated contributed, so it has no currency", () => {
    // This is the "Pipeline nominal USD 0,00" regression read from the other
    // side: a snapshot persisted before the policy landed still carries the
    // zero stamped with whatever code the upstream summary reported.
    assert.equal(nominalPipeline({ amount_cents: 0, currency: "USD" }, SEED), undefined);
    assert.equal(nominalPipeline({ amount_cents: 0, currency: "BRL" }, SEED), undefined);
  });

  it("withholds a total whose stated currency cannot be read", () => {
    assert.equal(nominalPipeline({ amount_cents: 100, currency: "dolares" }, SEED), undefined);
  });

  it("withholds a missing or non-integer total", () => {
    assert.equal(nominalPipeline(undefined, SEED), undefined);
    assert.equal(nominalPipeline({ amount_cents: 1.5, currency: "BRL" }, SEED), undefined);
  });
});

describe("pipelineByCurrency", () => {
  it("keeps one total per currency, sorted, as plain money", () => {
    // Plain money on purpose: the snapshot already carries provenance, and the
    // contract types these buckets as `unsigned_money`, which forbids extras.
    assert.deepEqual(
      pipelineByCurrency([
        { amount_cents: 5_000, currency: "USD" },
        { amount_cents: 10_000, currency: "BRL" },
      ]),
      [
        { amount_cents: 10_000, currency: "BRL" },
        { amount_cents: 5_000, currency: "USD" },
      ],
    );
  });

  it("keeps a zero bucket: a denominated deal created it", () => {
    // The zero rule is for scalar aggregates. Dropping a zero bucket here once
    // collapsed the split to one entry, and the caller then discarded the
    // surviving BRL total as "not a split" — real money lost to a USD 0.
    assert.deepEqual(
      pipelineByCurrency([
        { amount_cents: 10_000, currency: "BRL" },
        { amount_cents: 0, currency: "USD" },
      ]),
      [
        { amount_cents: 10_000, currency: "BRL" },
        { amount_cents: 0, currency: "USD" },
      ],
    );
  });

  it("drops an unreadable entry without taking its readable siblings with it", () => {
    assert.deepEqual(
      pipelineByCurrency([
        { amount_cents: 10_000, currency: "BRL" },
        { amount_cents: 999, currency: "reais" },
      ]),
      [{ amount_cents: 10_000, currency: "BRL" }],
    );
  });

  it("caps the buckets at the schema maximum", () => {
    const many = ["AED", "BRL", "CAD", "CHF", "DKK", "EUR", "GBP", "JPY", "NOK", "SEK"].map(
      (currency, index) => ({ amount_cents: index + 1, currency }),
    );
    assert.equal(pipelineByCurrency(many).length, 8);
  });

  it("is empty for anything that is not an array", () => {
    assert.deepEqual(pipelineByCurrency(undefined), []);
    assert.deepEqual(pipelineByCurrency({ amount_cents: 1, currency: "BRL" }), []);
  });
});

describe("read-boundary currency is strict, not lenient", () => {
  it("refuses a lowercase code rather than widening what this shared helper admits", () => {
    // Before the fix "usd" fell through to BRL. Accepting it as USD would be a
    // widening on a helper that finance stages also use; withholding is the
    // fail-closed direction.
    assert.equal(evidencedMoney({ amount_cents: 100, currency: "usd" }, SEED), undefined);
    assert.equal(evidencedMoney({ amount_cents: 100, currency: " BRL " }, SEED), undefined);
  });
});

describe("reliableWeightedPipeline", () => {
  it("applies the same scalar-aggregate zero rule as the nominal pipeline", () => {
    // Otherwise Comercial shows "Pipeline nominal: sem dados" directly above
    // "Pipeline ponderado: BRL 0,00".
    assert.equal(
      reliableWeightedPipeline(
        { pipeline_weighted: { amount_cents: 0, currency: "BRL", probability_reliable: true } },
        SEED,
      ),
      undefined,
    );
    assert.equal(
      reliableWeightedPipeline(
        { pipeline_weighted: { amount_cents: 500, currency: "BRL", probability_reliable: true } },
        SEED,
      )?.amount_cents,
      500,
    );
  });
});
