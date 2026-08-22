import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CATALOG_CURRENCY,
  evidencedMoney,
  nominalPipeline,
  pipelineByCurrency,
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
  it("keeps one total per currency, sorted, and never sums across them", () => {
    const split = pipelineByCurrency(
      [
        { amount_cents: 5_000, currency: "USD" },
        { amount_cents: 10_000, currency: "BRL" },
      ],
      SEED,
    );
    assert.deepEqual(
      split.map((m) => [m.currency, m.amount_cents]),
      [
        ["BRL", 10_000],
        ["USD", 5_000],
      ],
    );
  });

  it("drops unreadable and zero entries rather than denominating them in BRL", () => {
    const split = pipelineByCurrency(
      [
        { amount_cents: 10_000, currency: "BRL" },
        { amount_cents: 999, currency: "reais" },
        { amount_cents: 0, currency: "USD" },
      ],
      SEED,
    );
    assert.deepEqual(split, [
      {
        amount_cents: 10_000,
        currency: "BRL",
        source: SEED.source,
        observed_at: SEED.observed_at,
        freshness_status: SEED.freshness_status,
        confidence: SEED.confidence,
      },
    ]);
  });

  it("is empty for anything that is not an array", () => {
    assert.deepEqual(pipelineByCurrency(undefined, SEED), []);
    assert.deepEqual(pipelineByCurrency({ amount_cents: 1, currency: "BRL" }, SEED), []);
  });
});
