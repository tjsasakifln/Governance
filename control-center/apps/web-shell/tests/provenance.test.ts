import assert from "node:assert/strict";
import { test } from "node:test";
import { FINANCE_SNAPSHOT, FRESHNESS_SAMPLES } from "../src/fixtures/catalog";
import { PRESENTATION_TIME_ZONE } from "../src/datetime";
import { formatMoney } from "../src/money";
import { mapProvenance, provenanceFromPresentation } from "../src/provenance";
import { FRESHNESS_STATUSES } from "../src/types";

test("FRESH, STALE, ERROR and UNKNOWN fixtures round-trip into the presentation model", () => {
  for (const status of FRESHNESS_STATUSES) {
    const fixture = FRESHNESS_SAMPLES[status];
    assert.ok(fixture);
    const presentation = mapProvenance(fixture);
    assert.equal(presentation.freshnessStatus, status);
    assert.equal(presentation.sourceSystem, fixture.source.system);
    assert.equal(presentation.sourceKind, fixture.source.kind);
    assert.equal(presentation.sourceLocator, fixture.source.locator);
    assert.equal(presentation.observedAtUtc, fixture.observed_at);
    assert.ok(presentation.observedAtLocal.includes(PRESENTATION_TIME_ZONE));
    assert.equal(presentation.confidence, fixture.confidence);
    assert.match(presentation.confidenceLabel, /confiança/);
    const roundTrip = provenanceFromPresentation(presentation);
    assert.equal(roundTrip.source.system, fixture.source.system);
    assert.equal(roundTrip.source.kind, fixture.source.kind);
    assert.equal(roundTrip.source.locator, fixture.source.locator);
    assert.equal(roundTrip.observed_at, fixture.observed_at);
    assert.equal(roundTrip.freshness_status, fixture.freshness_status);
    assert.equal(roundTrip.confidence, fixture.confidence);
  }
  assert.equal(FRESHNESS_SAMPLES.STALE?.freshness_status, "STALE");
  assert.equal(FRESHNESS_SAMPLES.FRESH?.freshness_status, "FRESH");
  assert.equal(FRESHNESS_SAMPLES.ERROR?.freshness_status, "ERROR");
  assert.equal(FRESHNESS_SAMPLES.UNKNOWN?.freshness_status, "UNKNOWN");
});

test("finance money formats integer cents plus currency", () => {
  const overdue = FINANCE_SNAPSHOT.receivables_overdue;
  assert.ok(overdue);
  const formatted = formatMoney(overdue);
  assert.equal(overdue.amount_cents, 1500000);
  assert.equal(overdue.currency, "BRL");
  assert.equal(formatted, "BRL 15.000,00");
  assert.equal(formatMoney({ amount_cents: 0, currency: "BRL" }), "BRL 0,00");
  assert.equal(formatMoney({ amount_cents: -250, currency: "USD" }), "-USD 2,50");
});
