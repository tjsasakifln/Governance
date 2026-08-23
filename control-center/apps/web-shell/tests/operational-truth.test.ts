import assert from "node:assert/strict";
import { test } from "node:test";
import { operationalTruthBlock, parseOperationalTruth, TRUTH_COPY } from "../src/ui/operational-truth";

const source = { system: "warmbly", kind: "commercial", locator: "operations/activity" };

test("all six truth states explain impact and next action in pt-BR", () => {
  const reasons = {
    ZERO: "confirmed_zero",
    ABSENT: "source_absent",
    UNKNOWN: "recency_unknown",
    STALE: "observation_stale",
    ERROR: "collection_error",
    HEALTHY: "fresh_observation",
  } as const;
  for (const state of ["ZERO", "ABSENT", "UNKNOWN", "STALE", "ERROR", "HEALTHY"] as const) {
    const truth = { state, as_of: "2026-08-22T20:00:00Z", source, confidence: 0.9, reason: reasons[state] };
    const parsed = parseOperationalTruth(truth);
    assert.ok(parsed);
    const html = operationalTruthBlock(parsed);
    assert.match(html, /Impacto:/);
    assert.match(html, /Próxima ação:/);
    assert.match(html, new RegExp(`data-operational-truth="${state}"`));
    assert.match(html, new RegExp(TRUTH_COPY[state].label));
    assert.match(html, /truth_state=/);
  }
});

test("malformed truth is not silently painted as healthy", () => {
  assert.equal(parseOperationalTruth({ state: "HEALTHY" }), null);
  assert.equal(parseOperationalTruth({ state: "HEALTHY", as_of: "2026-08-22T20:00:00Z", source, confidence: 1, reason: "invented" }), null);
  assert.equal(operationalTruthBlock(parseOperationalTruth({ state: "HEALTHY" })), "");
  for (const confidence of [-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(parseOperationalTruth({
      state: "HEALTHY",
      as_of: "2026-08-22T20:00:00Z",
      source,
      confidence,
      reason: "fresh_observation",
    }), null);
  }
  for (const invalid of [
    { state: "HEALTHY", as_of: "2050-01-01T00:00:00Z", source, confidence: 1, reason: "fresh_observation" },
    { state: "HEALTHY", as_of: "2026-02-30T20:00:00Z", source, confidence: 1, reason: "fresh_observation" },
    { state: "HEALTHY", as_of: "2026-08-22T20:00:00+00:00", source, confidence: 1, reason: "fresh_observation" },
    { state: "HEALTHY", as_of: "2026-08-22T20:00:00Z", source, confidence: 1, reason: "collection_error" },
    { state: "ZERO", as_of: "2026-08-22T20:00:00Z", source, confidence: 0, reason: "confirmed_zero" },
  ]) {
    assert.equal(parseOperationalTruth(invalid, Date.parse("2026-08-23T00:00:00Z")), null);
  }

  const inheritedSource = Object.create({ system: "warmbly", kind: "commercial", locator: "activity" });
  assert.equal(parseOperationalTruth({
    state: "HEALTHY",
    as_of: "2026-08-22T20:00:00Z",
    source: inheritedSource,
    confidence: 1,
    reason: "fresh_observation",
  }, Date.parse("2026-08-23T00:00:00Z")), null);
});
