import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { validateUnknown } from "@confenge/control-center-contracts";
import { rankFromUnknown } from "../../intelligence/attention/src/index.ts";

const contractsRoot = join(dirname(fileURLToPath(import.meta.url)), "../../contracts");

test("commercial and finance fixtures validate against contracts (cents + currency, no provider mutations)", () => {
  const commercial = JSON.parse(
    readFileSync(join(contractsRoot, "fixtures/valid/commercial-snapshot.json"), "utf8"),
  ) as Record<string, unknown>;
  const finance = JSON.parse(
    readFileSync(join(contractsRoot, "fixtures/valid/finance-snapshot.json"), "utf8"),
  ) as Record<string, unknown>;
  const commercialResult = validateUnknown(commercial);
  const financeResult = validateUnknown(finance);
  assert.equal(commercialResult.ok, true, commercialResult.errors.map((e) => e.message).join("; "));
  assert.equal(financeResult.ok, true, financeResult.errors.map((e) => e.message).join("; "));
  assert.equal(finance.provider_mutations, "forbidden");
  const money = finance.receivable as { amount_cents: number; currency: string };
  assert.equal(Number.isInteger(money.amount_cents), true);
  assert.equal(typeof money.currency, "string");
});

test("attention engine consumes canonical freshness/priority types", () => {
  const fixture = JSON.parse(
    readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../intelligence/attention/fixtures/representative.json"),
      "utf8",
    ),
  ) as unknown;
  const ranked = rankFromUnknown(fixture);
  assert.ok(Array.isArray(ranked.attention_now));
  assert.ok(ranked.attention_now.length >= 1);
  for (const item of ranked.attention_now) {
    assert.ok(["FRESH", "STALE", "UNKNOWN", "ERROR"].includes(item.provenance.freshness_status));
  }
});
