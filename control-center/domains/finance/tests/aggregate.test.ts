import assert from "node:assert/strict";
import { test } from "node:test";
import { aggregateFinanceReadModel, toContractsStub } from "../src/index.js";
import {
  everyFigureHasProvenance,
  snapshotFromFixture,
  sumKind,
  windowedCashMovements,
} from "./helpers.js";

test("unpaid contracted+faturada never counts as caixa", () => {
  const { doc, snapshot } = snapshotFromFixture("unpaid-invoiced");
  const contracted = sumKind(doc.events, "contract_signed");
  const invoiced = sumKind(doc.events, "invoice_issued");
  const receivedFromEvents = sumKind(doc.events, "settlement_received");
  const cashFromEvents = windowedCashMovements(
    doc.events,
    doc.cash_in_window.from,
    doc.cash_in_window.to,
  );

  assert.equal(snapshot.figures.receita_contratada.amount_cents, contracted);
  assert.equal(snapshot.figures.receita_faturada.amount_cents, invoiced);
  assert.equal(snapshot.figures.efetivamente_recebida.amount_cents, receivedFromEvents);
  assert.equal(snapshot.cash_in.amount_cents, cashFromEvents);
  assert.equal(snapshot.figures.efetivamente_recebida.amount_cents, 0);
  assert.equal(snapshot.cash_in.amount_cents, 0);
  assert.equal(snapshot.figures.receita_paga.amount_cents, 0);
  assert.equal(snapshot.figures.a_receber.amount_cents, invoiced);
  assert.equal(snapshot.figures.vencida.amount_cents, 0);
  assert.notEqual(
    snapshot.figures.efetivamente_recebida.amount_cents,
    snapshot.figures.receita_contratada.amount_cents,
  );
  everyFigureHasProvenance(snapshot);
});

test("chargeback drops received and cash-in; does not leave caixa", () => {
  const { doc, snapshot } = snapshotFromFixture("paid-then-chargeback");
  const settled = sumKind(doc.events, "settlement_received");
  const chargebacks = sumKind(doc.events, "chargeback");
  const cashFromEvents = windowedCashMovements(
    doc.events,
    doc.cash_in_window.from,
    doc.cash_in_window.to,
  );

  assert.equal(snapshot.figures.efetivamente_recebida.amount_cents, settled - chargebacks);
  assert.equal(snapshot.cash_in.amount_cents, cashFromEvents);
  assert.equal(snapshot.figures.efetivamente_recebida.amount_cents, 0);
  assert.equal(snapshot.cash_in.amount_cents, 0);
  assert.notEqual(snapshot.figures.receita_contratada.amount_cents, 0);
  assert.equal(snapshot.figures.a_receber.amount_cents, chargebacks);
  everyFigureHasProvenance(snapshot);
});

test("refund drops received and cash-in; does not reopen AR", () => {
  const { doc, snapshot } = snapshotFromFixture("refund");
  const settled = sumKind(doc.events, "settlement_received");
  const refunds = sumKind(doc.events, "refund");
  const cashFromEvents = windowedCashMovements(
    doc.events,
    doc.cash_in_window.from,
    doc.cash_in_window.to,
  );

  assert.equal(snapshot.figures.efetivamente_recebida.amount_cents, settled - refunds);
  assert.equal(snapshot.cash_in.amount_cents, cashFromEvents);
  assert.equal(snapshot.figures.efetivamente_recebida.amount_cents, 0);
  assert.equal(snapshot.cash_in.amount_cents, 0);
  assert.equal(snapshot.figures.a_receber.amount_cents, 0);
  assert.equal(snapshot.figures.vencida.amount_cents, 0);
  everyFigureHasProvenance(snapshot);
});

test("overdue invoice is vencida/a receber, never received cash", () => {
  const { doc, snapshot } = snapshotFromFixture("overdue");
  const invoiced = sumKind(doc.events, "invoice_issued");
  const receivedFromEvents = sumKind(doc.events, "settlement_received");

  assert.equal(snapshot.figures.efetivamente_recebida.amount_cents, receivedFromEvents);
  assert.equal(snapshot.figures.efetivamente_recebida.amount_cents, 0);
  assert.equal(snapshot.cash_in.amount_cents, 0);
  assert.equal(snapshot.figures.vencida.amount_cents, invoiced);
  assert.equal(snapshot.figures.a_receber.amount_cents, invoiced);
  const bucket = snapshot.ar_aging.buckets.find((item) => item.key === "d31_60");
  assert.ok(bucket);
  assert.equal(bucket.amount_cents, invoiced);
  everyFigureHasProvenance(snapshot);
});

test("MRR includes only RECURRING monthly items; Diagnóstico ONE_TIME is 0", () => {
  const { doc, snapshot } = snapshotFromFixture("one-time-vs-recurring");
  const recurring = doc.events
    .filter((event) => event.kind === "contract_signed" && event.billing_mode === "RECURRING")
    .reduce((sum, event) => sum + event.amount_cents, 0);
  const oneTime = doc.events
    .filter((event) => event.kind === "contract_signed" && event.billing_mode === "ONE_TIME")
    .reduce((sum, event) => sum + event.amount_cents, 0);

  assert.ok(oneTime > 0);
  assert.equal(snapshot.mrr.amount_cents, recurring);
  assert.notEqual(snapshot.mrr.amount_cents, recurring + oneTime);
  assert.equal(snapshot.mrr.omitted, false);
  everyFigureHasProvenance(snapshot);
});

test("no expense data omits runway number", () => {
  const { snapshot } = snapshotFromFixture("no-expenses");
  assert.equal(snapshot.runway.omitted, true);
  assert.equal("months" in snapshot.runway, false);
  assert.equal(snapshot.incomplete_reasons.includes("missing_reliable_expenses"), true);
  assert.ok(snapshot.figures.efetivamente_recebida.amount_cents > 0);
  everyFigureHasProvenance(snapshot);
});

test("paid without settlement is paga, not efetivamente recebida or cash-in", () => {
  const { doc, snapshot } = snapshotFromFixture("paid-without-settlement");
  const confirmed = sumKind(doc.events, "payment_confirmed");
  assert.equal(snapshot.figures.receita_paga.amount_cents, confirmed);
  assert.equal(snapshot.figures.efetivamente_recebida.amount_cents, 0);
  assert.equal(snapshot.cash_in.amount_cents, 0);
  assert.equal(snapshot.incomplete_data, true);
  assert.equal(snapshot.incomplete_reasons.includes("paid_without_settlement"), true);
  assert.equal(snapshot.figures.receita_paga.incomplete, true);
});

test("mixed stages: cash-in equals settlements, not contracted; concentration from AR", () => {
  const { doc, snapshot } = snapshotFromFixture("mixed-stages");
  const contracted = sumKind(doc.events, "contract_signed");
  const received = sumKind(doc.events, "settlement_received");
  const cashFromEvents = windowedCashMovements(
    doc.events,
    doc.cash_in_window.from,
    doc.cash_in_window.to,
  );
  assert.equal(snapshot.figures.efetivamente_recebida.amount_cents, received);
  assert.equal(snapshot.cash_in.amount_cents, cashFromEvents);
  assert.notEqual(snapshot.figures.efetivamente_recebida.amount_cents, contracted);
  assert.notEqual(snapshot.cash_in.amount_cents, contracted);
  assert.equal(snapshot.concentracao.basis, "a_receber");
  assert.equal(snapshot.concentracao.clients.length, 1);
  assert.equal(snapshot.concentracao.clients[0]?.client_id, "client:acme");
  assert.equal(snapshot.concentracao.top_share_bps, 10000);
  const stub = toContractsStub(snapshot);
  assert.equal(stub.receivables_open.amount_cents, snapshot.figures.a_receber.amount_cents);
  assert.equal(stub.receivables_overdue.amount_cents, snapshot.figures.vencida.amount_cents);
});

test("duplicate idempotency keys are ingested once", () => {
  const { doc } = snapshotFromFixture("unpaid-invoiced");
  const first = doc.events[0];
  assert.ok(first);
  const doubled = [...doc.events, { ...first, id: "cc:finance-event:dup" }];
  const snapshot = aggregateFinanceReadModel(doubled, {
    as_of: doc.as_of,
    cash_in_window: doc.cash_in_window,
  });
  assert.equal(
    snapshot.figures.receita_contratada.amount_cents,
    sumKind(doc.events, "contract_signed"),
  );
  assert.equal(snapshot.event_count, doc.events.length);
});

test("runway number appears only with cash_balance and reliable expenses", () => {
  const { doc } = snapshotFromFixture("no-expenses");
  const extra = [
    ...doc.events,
    {
      id: "cc:finance-event:burn",
      idempotency_key: "fixture:runway:expense",
      kind: "expense" as const,
      occurred_at: "2026-08-05T00:00:00Z",
      amount_cents: 100000,
      currency: "BRL",
      client_id: "client:ops",
      obligation_id: "ob:opex",
      billing_mode: "UNKNOWN" as const,
      settlement_proven: false,
      source: { system: "manual", kind: "ledger", locator: "opex:2026-08" },
      observed_at: "2026-08-20T11:00:00Z",
      freshness_status: "FRESH" as const,
      confidence: 0.9,
    },
    {
      id: "cc:finance-event:balance",
      idempotency_key: "fixture:runway:balance",
      kind: "cash_balance" as const,
      occurred_at: "2026-08-20T00:00:00Z",
      amount_cents: 350000,
      currency: "BRL",
      client_id: "client:ops",
      obligation_id: "ob:cash",
      billing_mode: "UNKNOWN" as const,
      settlement_proven: true,
      source: { system: "manual", kind: "bank-balance", locator: "bank:primary" },
      observed_at: "2026-08-20T11:00:00Z",
      freshness_status: "FRESH" as const,
      confidence: 0.9,
    },
  ];
  const snapshot = aggregateFinanceReadModel(extra, {
    as_of: doc.as_of,
    cash_in_window: doc.cash_in_window,
  });
  assert.equal(snapshot.runway.omitted, false);
  if (snapshot.runway.omitted) {
    throw new Error("expected runway number");
  }
  assert.equal(snapshot.runway.months, 3);
  assert.equal(Number.isInteger(snapshot.runway.months), true);
});

test("mixed currencies fail closed", () => {
  const { doc } = snapshotFromFixture("unpaid-invoiced");
  const first = doc.events[0];
  assert.ok(first);
  const usd = {
    ...first,
    id: "cc:finance-event:usd",
    idempotency_key: "fixture:usd",
    currency: "USD",
  };
  assert.throws(
    () =>
      aggregateFinanceReadModel([...doc.events, usd], {
        as_of: doc.as_of,
        cash_in_window: doc.cash_in_window,
      }),
    /mixed currencies/,
  );
});
