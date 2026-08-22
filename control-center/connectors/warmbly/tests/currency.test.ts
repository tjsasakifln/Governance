import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collectFromWarmblyPayload } from "../src/mapper/normalize.ts";
import {
  CATALOG_CURRENCY,
  majorUnitsToCents,
  normalizeCurrency,
  openDealTotals,
  resolveCurrency,
  sumOpenDealValue,
} from "../src/mapper/money.ts";
import type { WarmblyPayload } from "../src/contracts/warmbly-payload.ts";
import { NOW } from "./helpers.ts";

const deal = (over: Record<string, unknown>): Record<string, unknown> => ({
  id: "d",
  name: "Deal",
  status: "open",
  created_at: NOW.toISOString(),
  updated_at: NOW.toISOString(),
  ...over,
});

function payloadWith(over: Record<string, unknown>): WarmblyPayload {
  return {
    health: { status: "ok" },
    api_version: "v1",
    ...over,
  } as unknown as WarmblyPayload;
}

describe("currency resolution", () => {
  it("reads the CONFENGE catalog currency as BRL, never a foreign default", () => {
    assert.equal(CATALOG_CURRENCY, "BRL");
    assert.notEqual(CATALOG_CURRENCY, "USD");
  });

  it("denominates an amount that states no currency in the contractual catalog currency", () => {
    assert.equal(resolveCurrency(undefined), "BRL");
    assert.equal(resolveCurrency(null), "BRL");
    assert.equal(resolveCurrency("   "), "BRL");
    assert.equal(majorUnitsToCents(1500.5).currency, "BRL");
    assert.equal(majorUnitsToCents(1500.5).amount_cents, 150_050);
  });

  it("fails closed on a currency that is present but not ISO-4217", () => {
    assert.equal(normalizeCurrency("reais"), undefined);
    assert.equal(normalizeCurrency("R$"), undefined);
    assert.equal(normalizeCurrency(7), undefined);
    assert.equal(resolveCurrency("reais"), undefined);
    assert.throws(() => majorUnitsToCents(10, "reais"));
  });

  it("normalizes casing and padding without inventing a code", () => {
    assert.equal(normalizeCurrency(" brl "), "BRL");
    assert.equal(normalizeCurrency("usd"), "USD");
  });
});

describe("open pipeline totals", () => {
  it("totals a BRL catalog pipeline in integer cents", () => {
    const total = sumOpenDealValue([
      { status: "open", value: 1500.5, currency: "BRL" },
      { status: "open", value: 2000 },
      { status: "won", value: 9999, currency: "BRL" },
    ]);
    assert.deepEqual(total, { amount_cents: 350_050, currency: "BRL" });
  });

  it("keeps totals separate per currency instead of summing across them", () => {
    const { totals, foreign_currencies } = openDealTotals([
      { status: "open", value: 100, currency: "BRL" },
      { status: "open", value: 50, currency: "USD" },
      { status: "open", value: 25, currency: "usd" },
    ]);
    assert.deepEqual(totals, [
      { amount_cents: 10_000, currency: "BRL" },
      { amount_cents: 7_500, currency: "USD" },
    ]);
    assert.deepEqual(foreign_currencies, ["USD"]);
    // No implicit conversion: there is no single total to hand to a caller.
    assert.equal(sumOpenDealValue([
      { status: "open", value: 100, currency: "BRL" },
      { status: "open", value: 50, currency: "USD" },
    ]), undefined);
  });

  it("excludes a deal whose currency cannot be read rather than calling it BRL", () => {
    const { totals, unreadable_currency } = openDealTotals([
      { status: "open", value: 100, currency: "BRL" },
      { status: "open", value: 999, currency: "dólares" },
    ]);
    assert.equal(unreadable_currency, 1);
    assert.deepEqual(totals, [{ amount_cents: 10_000, currency: "BRL" }]);
  });
});

describe("deals_summary is not allowed to invent a pipeline currency", () => {
  it("omits the nominal pipeline when the summary reports a zero open value", () => {
    // Regression for the Comercial view showing "Pipeline nominal USD 0,00":
    // Warmbly reported open_value 0 stamped with its own default currency, and
    // the mapper denominated an empty pipeline in it.
    const snapshot = collectFromWarmblyPayload(
      payloadWith({ deals: [], deals_summary: { open_count: 0, open_value: 0, currency: "USD" } }),
      { now: NOW },
    );
    assert.equal(snapshot.deal_value_open, undefined);
    assert.equal(snapshot.deal_value_open_by_currency, undefined);
  });

  it("uses the catalog currency when the summary states none", () => {
    const snapshot = collectFromWarmblyPayload(
      payloadWith({ deals: [], deals_summary: { open_count: 1, open_value: 4800 } }),
      { now: NOW },
    );
    assert.deepEqual(snapshot.deal_value_open, { amount_cents: 480_000, currency: "BRL" });
  });

  it("withholds the total and raises an exception when the summary currency is unreadable", () => {
    const snapshot = collectFromWarmblyPayload(
      payloadWith({ deals: [], deals_summary: { open_count: 1, open_value: 4800, currency: "reais" } }),
      { now: NOW },
    );
    assert.equal(snapshot.deal_value_open, undefined);
    const raised = snapshot.attention.filter((item) => item.id.startsWith("warmbly:currency:"));
    assert.equal(raised.length, 1);
    assert.match(raised[0]?.why ?? "", /ISO-4217/);
  });

  it("flags a foreign currency instead of rendering it as if it were contractual", () => {
    const snapshot = collectFromWarmblyPayload(
      payloadWith({ deals: [], deals_summary: { open_count: 1, open_value: 100, currency: "USD" } }),
      { now: NOW },
    );
    assert.deepEqual(snapshot.deal_value_open, { amount_cents: 10_000, currency: "USD" });
    const raised = snapshot.attention.filter((item) => item.id.startsWith("warmbly:currency:"));
    assert.equal(raised.length, 1);
    assert.match(raised[0]?.why ?? "", /never converted/);
  });
});

describe("multi-currency pipeline", () => {
  it("publishes per-currency totals and no merged nominal", () => {
    const snapshot = collectFromWarmblyPayload(
      payloadWith({
        deals: [
          deal({ id: "d1", value: 100, currency: "BRL" }),
          deal({ id: "d2", value: 50, currency: "USD" }),
        ],
      }),
      { now: NOW },
    );
    assert.equal(snapshot.deal_value_open, undefined);
    assert.deepEqual(snapshot.deal_value_open_by_currency, [
      { amount_cents: 10_000, currency: "BRL" },
      { amount_cents: 5_000, currency: "USD" },
    ]);
    const raised = snapshot.attention.filter((item) => item.id.startsWith("warmbly:currency:"));
    assert.ok(raised.length >= 1);
    assert.ok(raised.some((item) => /no explicit conversion rate/.test(item.why)));
  });

  it("leaves a single-currency BRL pipeline as one total with no split", () => {
    const snapshot = collectFromWarmblyPayload(
      payloadWith({
        deals: [deal({ id: "d1", value: 100 }), deal({ id: "d2", value: 50, currency: "BRL" })],
      }),
      { now: NOW },
    );
    assert.deepEqual(snapshot.deal_value_open, { amount_cents: 15_000, currency: "BRL" });
    assert.equal(snapshot.deal_value_open_by_currency, undefined);
    assert.equal(
      snapshot.attention.filter((item) => item.id.startsWith("warmbly:currency:")).length,
      0,
    );
  });
});
