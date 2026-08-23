import assert from "node:assert/strict";
import { test } from "node:test";
import {
  OPERATIONAL_TRUTH_STATES,
  operationalTruth,
  type OperationalTruthInput,
} from "../src/operational-truth.js";

const base: OperationalTruthInput = {
  as_of: "2026-08-22T20:00:00Z",
  source: { system: "warmbly", kind: "commercial", locator: "operations/activity" },
  confidence: 0.9,
  freshness_status: "FRESH",
  presence: "present",
  complete: true,
};

test("ZERO, ABSENT, UNKNOWN, STALE, ERROR and HEALTHY are mutually exclusive", () => {
  const cases: OperationalTruthInput[] = [
    { ...base, value: 0 },
    { ...base, presence: "absent" },
    { ...base, freshness_status: "UNKNOWN", confidence: 0 },
    { ...base, freshness_status: "STALE", value: 0 },
    { ...base, freshness_status: "ERROR", presence: "absent", value: 0 },
    { ...base, value: 3 },
  ];
  assert.deepEqual(cases.map((row) => operationalTruth(row).state), OPERATIONAL_TRUTH_STATES);
});

test("partial payload is UNKNOWN and cannot masquerade as a real zero", () => {
  const truth = operationalTruth({ ...base, value: 0, complete: false });
  assert.equal(truth.state, "UNKNOWN");
  assert.equal(truth.reason, "partial_payload");
  assert.equal(truth.as_of, base.as_of);
  assert.deepEqual(truth.source, base.source);
  assert.equal(truth.confidence, base.confidence);
});

test("stale or errored zero keeps the transport evidence state", () => {
  assert.equal(operationalTruth({ ...base, value: 0, freshness_status: "STALE" }).state, "STALE");
  assert.equal(operationalTruth({ ...base, value: 0, freshness_status: "ERROR" }).state, "ERROR");
});

test("absence cannot hide stale, unknown, or errored transport evidence", () => {
  assert.equal(
    operationalTruth({ ...base, presence: "absent", freshness_status: "STALE" }).state,
    "STALE",
  );
  assert.equal(
    operationalTruth({ ...base, presence: "absent", freshness_status: "UNKNOWN", confidence: 0 }).state,
    "UNKNOWN",
  );
  assert.equal(
    operationalTruth({ ...base, presence: "absent", freshness_status: "ERROR", confidence: 0 }).state,
    "ERROR",
  );
});

test("ABSENT is reserved for a fresh, credible observation of source absence", () => {
  const truth = operationalTruth({ ...base, presence: "absent", freshness_status: "FRESH", confidence: 0.9 });
  assert.equal(truth.state, "ABSENT");
  assert.equal(truth.reason, "source_absent");
});
