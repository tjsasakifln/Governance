import assert from "node:assert/strict";
import { test } from "node:test";
import { formatLocal, isUtcDateTime, PRESENTATION_TIME_ZONE } from "../src/datetime.js";
import { formatMoney } from "../src/money.js";

test("internal UTC Z is preserved; presentation names America/Sao_Paulo", () => {
  assert.equal(isUtcDateTime("2026-08-20T17:39:00Z"), true);
  assert.equal(isUtcDateTime("2026-08-20T17:39:00-03:00"), false);
  const local = formatLocal("2026-08-20T17:39:00Z");
  assert.match(local, /America\/Sao_Paulo/);
  assert.equal(PRESENTATION_TIME_ZONE, "America/Sao_Paulo");
  assert.match(local, /20\/08\/2026/);
  assert.match(local, /14:39/);
});

test("money stays integer cents plus ISO currency", () => {
  assert.equal(formatMoney({ amount_cents: 1500000, currency: "BRL" }), "BRL 15.000,00");
  assert.throws(() => formatMoney({ amount_cents: 10.5, currency: "BRL" }));
  assert.throws(() => formatMoney({ amount_cents: 100, currency: "brl" }));
});
