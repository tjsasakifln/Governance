import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { PNCP_HEALTHY_LABEL } from "../src/index.js";
import { evaluateFixture } from "./helpers.js";

describe("named fixtures through shipped adapter → classify → project", () => {
  test("pipeline vivo → FRESH with timestamp and freshness evidence", async () => {
    const result = await evaluateFixture("pipeline-vivo.json");
    assert.equal(result.serviceHealth.freshness_status, "FRESH");
    assert.equal(result.sourceObservation.freshness_status, "FRESH");
    assert.equal(result.serviceHealth.healthy, true);
    assert.equal(result.serviceHealth.label, PNCP_HEALTHY_LABEL);
    assert.ok(result.serviceHealth.observed_at);
    assert.ok(result.sourceObservation.observed_at);
    assert.ok(result.sourceObservation.source_max_timestamp);
    assert.ok(result.serviceHealth.evidence.last_item_observed_at);
    assert.ok(result.serviceHealth.evidence.last_success_at);
    assert.ok(result.serviceHealth.evidence.source_max_timestamp);
    assert.equal(result.serviceHealth.evidence.recent_window_count, 128);
    assert.equal(result.serviceHealth.evidence.consecutive_errors, 0);
    assert.equal(result.classification.reasons.includes("live_pipeline"), true);
    assert.equal(result.snapshot.source, "pncp");
    assert.equal(result.snapshot.source_kind, "health_artifact");
  });

  test("pipeline morto → STALE, never FRESH, never healthy label", async () => {
    const result = await evaluateFixture("pipeline-morto.json");
    assert.equal(result.serviceHealth.freshness_status, "STALE");
    assert.equal(result.sourceObservation.freshness_status, "STALE");
    assert.notEqual(result.serviceHealth.freshness_status, "FRESH");
    assert.equal(result.serviceHealth.healthy, false);
    assert.notEqual(result.serviceHealth.label, PNCP_HEALTHY_LABEL);
    assert.equal(result.classification.reasons[0], "dead_pipeline");
    assert.equal(result.classification.collector_alive, false);
  });

  test("source silenciosa → UNKNOWN, never FRESH", async () => {
    const result = await evaluateFixture("source-silenciosa.json");
    assert.equal(result.serviceHealth.freshness_status, "UNKNOWN");
    assert.equal(result.sourceObservation.freshness_status, "UNKNOWN");
    assert.notEqual(result.serviceHealth.freshness_status, "FRESH");
    assert.equal(result.serviceHealth.healthy, false);
    assert.notEqual(result.serviceHealth.label, PNCP_HEALTHY_LABEL);
    assert.ok(result.classification.reasons.includes("silent_source"));
    assert.equal(result.sourceObservation.observed_at, null);
  });

  test("credencial indisponível → ERROR", async () => {
    const result = await evaluateFixture("credencial-indisponivel.json");
    assert.equal(result.serviceHealth.freshness_status, "ERROR");
    assert.equal(result.sourceObservation.freshness_status, "ERROR");
    assert.notEqual(result.serviceHealth.freshness_status, "FRESH");
    assert.equal(result.serviceHealth.healthy, false);
    assert.notEqual(result.serviceHealth.label, PNCP_HEALTHY_LABEL);
    assert.ok(result.classification.reasons.includes("credential_unavailable"));
  });

  test("collector alive but data stopped → STALE, not FRESH", async () => {
    const result = await evaluateFixture("collector-alive-data-stopped.json");
    assert.equal(result.serviceHealth.freshness_status, "STALE");
    assert.notEqual(result.serviceHealth.freshness_status, "FRESH");
    assert.equal(result.serviceHealth.healthy, false);
    assert.notEqual(result.serviceHealth.label, PNCP_HEALTHY_LABEL);
    assert.equal(result.classification.collector_alive, true);
    assert.equal(result.classification.collector_stalled, true);
    assert.ok(result.classification.reasons.includes("collector_alive_data_stopped"));
  });
});
