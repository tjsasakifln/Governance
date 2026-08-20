import {
  aggregateFinanceReadModel,
  assertIntegerCents,
  loadFixtureDocument,
} from "../src/index.js";
import type { FinanceEvent, FinanceReadModel, FixtureDocument } from "../src/types.js";

export function snapshotFromFixture(name: string): {
  doc: FixtureDocument;
  snapshot: FinanceReadModel;
} {
  const doc = loadFixtureDocument(name);
  const snapshot = aggregateFinanceReadModel(doc.events, {
    as_of: doc.as_of,
    cash_in_window: doc.cash_in_window,
    freshness_window_seconds: doc.freshness_window_seconds,
    snapshot_id: `cc:finance-snapshot:${doc.id}`,
  });
  assertIntegerCents(snapshot);
  return { doc, snapshot };
}

export function sumKind(
  events: readonly FinanceEvent[],
  kind: FinanceEvent["kind"],
): number {
  let total = 0;
  for (const event of events) {
    if (event.kind === kind) {
      total += event.amount_cents;
    }
  }
  return total;
}

export function windowedCashMovements(
  events: readonly FinanceEvent[],
  from: string,
  to: string,
): number {
  const start = Date.parse(from);
  const end = Date.parse(to);
  let total = 0;
  for (const event of events) {
    const t = Date.parse(event.occurred_at);
    if (t < start || t > end) {
      continue;
    }
    if (event.kind === "settlement_received") {
      total += event.amount_cents;
    } else if (event.kind === "refund" || event.kind === "chargeback") {
      total -= event.amount_cents;
    }
  }
  return total;
}

export function everyFigureHasProvenance(snapshot: FinanceReadModel): void {
  const figures = [
    snapshot.figures.receita_contratada,
    snapshot.figures.receita_faturada,
    snapshot.figures.receita_paga,
    snapshot.figures.efetivamente_recebida,
    snapshot.figures.vencida,
    snapshot.figures.a_receber,
    snapshot.cash_in,
    snapshot.mrr,
  ];
  for (const figure of figures) {
    if (!figure.source.system || !figure.observed_at || !figure.freshness_status) {
      throw new Error("figure missing provenance");
    }
    if (typeof figure.confidence !== "number") {
      throw new Error("figure missing confidence");
    }
    if (!Number.isInteger(figure.amount_cents)) {
      throw new Error("figure amount is not integer cents");
    }
  }
}
