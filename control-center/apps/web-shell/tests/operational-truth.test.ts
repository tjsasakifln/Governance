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
});
