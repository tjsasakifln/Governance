/**
 * Tiny consumer of the public API. Not the aggregator's unit file.
 * Loads a checked-in fixture and asserts efetivamente recebida / cash-in
 * equal settlement content from the fixture, not contracted revenue.
 */
import {
  aggregateFinanceReadModel,
  assertIntegerCents,
  loadFixtureDocument,
} from "../src/index.js";

const doc = loadFixtureDocument("mixed-stages");
const snapshot = aggregateFinanceReadModel(doc.events, {
  as_of: doc.as_of,
  cash_in_window: doc.cash_in_window,
  freshness_window_seconds: doc.freshness_window_seconds,
  snapshot_id: `cc:finance-snapshot:${doc.id}`,
});
assertIntegerCents(snapshot);

const contracted = doc.events
  .filter((event) => event.kind === "contract_signed")
  .reduce((sum, event) => sum + event.amount_cents, 0);
const received = doc.events
  .filter((event) => event.kind === "settlement_received")
  .reduce((sum, event) => sum + event.amount_cents, 0);
const refundsAndChargebacks = doc.events
  .filter((event) => event.kind === "refund" || event.kind === "chargeback")
  .reduce((sum, event) => sum + event.amount_cents, 0);
const expectedCash = received - refundsAndChargebacks;

if (snapshot.figures.efetivamente_recebida.amount_cents !== expectedCash) {
  throw new Error(
    `efetivamente_recebida ${snapshot.figures.efetivamente_recebida.amount_cents} !== fixture settlements ${expectedCash}`,
  );
}
if (snapshot.cash_in.amount_cents !== expectedCash) {
  throw new Error(
    `cash_in ${snapshot.cash_in.amount_cents} !== fixture settlements ${expectedCash}`,
  );
}
if (snapshot.figures.efetivamente_recebida.amount_cents === contracted) {
  throw new Error("efetivamente_recebida must not equal receita contratada");
}
if (snapshot.cash_in.amount_cents === contracted) {
  throw new Error("cash-in must not equal receita contratada");
}
if (!Number.isInteger(snapshot.figures.efetivamente_recebida.amount_cents)) {
  throw new Error("efetivamente_recebida is not integer cents");
}

const payload = {
  ok: true,
  fixture: doc.id,
  contratada_cents: snapshot.figures.receita_contratada.amount_cents,
  efetivamente_recebida_cents: snapshot.figures.efetivamente_recebida.amount_cents,
  cash_in_cents: snapshot.cash_in.amount_cents,
  contracted_from_fixture_cents: contracted,
  received_from_fixture_cents: expectedCash,
  cash_is_received_not_contracted: true,
};
process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
