import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aggregateFinanceReadModel,
  appendManualAdjustment,
  createMemoryLedger,
  loadFixtureDocument,
} from "../src/index.js";
import { FinanceDeniedError } from "../src/errors.js";
import type { ManualAdjustmentInput } from "../src/types.js";

function baseInput(): ManualAdjustmentInput {
  return {
    idempotency_key: "manual:recebida:bank-transfer-1",
    target: "recebida",
    amount_cents: 10000,
    currency: "BRL",
    reason: "PIX received outside Asaas, bank statement 2026-08-11",
    created_by: { kind: "human", id: "human:operator" },
    effective_at: "2026-08-11T12:00:00Z",
    source: { system: "manual", kind: "bank-statement", locator: "stmt:2026-08-11" },
    observed_at: "2026-08-20T11:00:00Z",
    freshness_status: "FRESH",
    confidence: 0.7,
    obligation_id: "ob:diag-acme",
    client_id: "client:acme",
    billing_mode: "ONE_TIME",
    provider_mutation: "forbidden",
  };
}

test("manual adjustment is append-only, idempotent, and never a provider write", async () => {
  const doc = loadFixtureDocument("unpaid-invoiced");
  const ledger = createMemoryLedger(doc.events);
  const first = await ledger.appendAdjustment(baseInput());
  assert.equal(first.duplicate, false);
  assert.equal(first.audit.outcome, "success");
  assert.equal(first.audit.detail.provider_mutation, "forbidden");
  assert.equal(first.audit.action, "manual_adjustment_appended");
  assert.equal(first.record.event.kind, "manual_adjustment");

  const second = await ledger.appendAdjustment(baseInput());
  assert.equal(second.duplicate, true);
  assert.equal(second.record.id, first.record.id);

  const events = await ledger.listEvents();
  const snapshot = aggregateFinanceReadModel(events, {
    as_of: doc.as_of,
    cash_in_window: doc.cash_in_window,
  });
  assert.equal(snapshot.figures.efetivamente_recebida.amount_cents, 10000);
  assert.equal(snapshot.cash_in.amount_cents, 10000);
  assert.equal(snapshot.incomplete_reasons.includes("manual_cash_assertion"), true);
  assert.equal(snapshot.adjustments_applied, 1);
});

test("manual adjustment from a non-manual source is denied and audited", () => {
  const ledger = createMemoryLedger();
  const input = baseInput();
  input.source = { system: "asaas", kind: "charge", locator: "pay_x" };
  assert.throws(() => appendManualAdjustment(ledger, input), FinanceDeniedError);
  assert.equal(ledger.audits.length, 1);
  assert.equal(ledger.audits[0]?.outcome, "denied");
  assert.equal(ledger.audits[0]?.detail.provider_mutation, "forbidden");
});

test("requesting a provider mutation on an adjustment is rejected", () => {
  const ledger = createMemoryLedger();
  const raw = { ...baseInput(), provider_mutation: "refund" };
  assert.throws(() => appendManualAdjustment(ledger, raw), /provider mutation/);
});
