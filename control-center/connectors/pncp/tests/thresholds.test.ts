import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  DEFAULT_THRESHOLDS,
  loadThresholdsFromEnv,
  evaluatePncpFreshness,
  PNCP_HEALTHY_LABEL,
} from "../src/index.js";
import { fixturePath } from "./helpers.js";

describe("configurable thresholds", () => {
  test("defaults match extra-cli PNCP 24h SLA", () => {
    const loaded = loadThresholdsFromEnv({});
    assert.deepEqual(loaded, DEFAULT_THRESHOLDS);
    assert.equal(loaded.lastSuccessSlaHours, 24);
    assert.equal(loaded.dataSlaHours, 24);
  });

  test("env overrides are applied", () => {
    const loaded = loadThresholdsFromEnv({
      PNCP_FRESHNESS_SLA_HOURS: "12",
      PNCP_MIN_RECENT_WINDOW_COUNT: "10",
    });
    assert.equal(loaded.lastSuccessSlaHours, 12);
    assert.equal(loaded.minRecentWindowCount, 10);
  });

  test("tight min window count turns live fixture into not-FRESH", async () => {
    const result = await evaluatePncpFreshness(
      {
        kind: "health_artifact",
        artifactPath: fixturePath("pipeline-vivo.json"),
      },
      { ...DEFAULT_THRESHOLDS, minRecentWindowCount: 10_000 },
    );
    assert.notEqual(result.serviceHealth.freshness_status, "FRESH");
    assert.equal(result.serviceHealth.healthy, false);
    assert.notEqual(result.serviceHealth.label, PNCP_HEALTHY_LABEL);
  });
});
