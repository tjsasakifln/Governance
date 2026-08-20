import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  PNCP_HEALTHY_LABEL,
  evaluatePncpFreshness,
} from "../src/index.js";
import { evaluateFixture, fixturePath } from "./helpers.js";

describe("fail-closed: no healthy PNCP without timestamp and evidence", () => {
  test("recent collector success without data timestamp does not emit FRESH or healthy label", async () => {
    const result = await evaluateFixture("incomplete-heartbeat-only.json");
    assert.notEqual(result.serviceHealth.freshness_status, "FRESH");
    assert.notEqual(result.sourceObservation.freshness_status, "FRESH");
    assert.equal(result.serviceHealth.healthy, false);
    assert.notEqual(result.serviceHealth.label, PNCP_HEALTHY_LABEL);
    assert.equal(result.sourceObservation.observed_at, null);
    assert.equal(result.sourceObservation.source_max_timestamp, null);
    assert.equal(result.serviceHealth.evidence.last_item_observed_at, null);
    assert.equal(result.classification.collector_alive, true);
    assert.equal(result.classification.collector_stalled, true);
  });

  test("FRESH projections always include timestamp and evidence on both outputs", async () => {
    const result = await evaluateFixture("pipeline-vivo.json");
    assert.equal(result.serviceHealth.freshness_status, "FRESH");
    assert.ok(result.serviceHealth.observed_at);
    assert.ok(result.serviceHealth.evidence.source_max_timestamp);
    assert.ok(result.serviceHealth.evidence.last_success_at);
    assert.notEqual(result.serviceHealth.evidence.recent_window_count, null);
    assert.equal(result.sourceObservation.freshness_status, "FRESH");
    assert.ok(result.sourceObservation.observed_at);
    assert.ok(result.sourceObservation.evidence.source_max_timestamp);
    assert.ok(result.sourceObservation.evidence.last_item_observed_at);
  });

  test("extra-cli freshness-gate row without consecutive_errors is incomplete, never FRESH", async () => {
    const result = await evaluateFixture("extra-cli-freshness-gate-row.json");
    assert.notEqual(result.serviceHealth.freshness_status, "FRESH");
    assert.equal(result.serviceHealth.healthy, false);
    assert.notEqual(result.serviceHealth.label, PNCP_HEALTHY_LABEL);
    assert.equal(result.snapshot.consecutive_errors, null);
    assert.equal(result.snapshot.last_success_at, "2026-08-20T11:40:00.000Z");
    assert.equal(result.snapshot.last_item_observed_at, "2026-08-20T11:30:00.000Z");
    assert.equal(result.snapshot.source_max_timestamp, "2026-08-20T11:45:00.000Z");
    assert.equal(result.snapshot.recent_window_count, 128);
  });

  test("missing artifact is ERROR, never FRESH", async () => {
    const result = await evaluatePncpFreshness({
      kind: "health_artifact",
      artifactPath: fixturePath("does-not-exist.json"),
    });
    assert.equal(result.serviceHealth.freshness_status, "ERROR");
    assert.equal(result.serviceHealth.healthy, false);
    assert.notEqual(result.serviceHealth.label, PNCP_HEALTHY_LABEL);
    assert.ok(result.classification.reasons.includes("metrics_artifact_missing"));
  });

  test("unconfigured adapter is ERROR, never FRESH", async () => {
    const result = await evaluatePncpFreshness({ kind: "health_artifact" });
    assert.equal(result.serviceHealth.freshness_status, "ERROR");
    assert.equal(result.serviceHealth.healthy, false);
    assert.notEqual(result.serviceHealth.label, PNCP_HEALTHY_LABEL);
  });
});
