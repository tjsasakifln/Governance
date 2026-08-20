import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  PNCP_HEALTHY_LABEL,
  SCHEMA_VERSION,
  evaluatePncpFreshness,
} from "../src/index.js";
import { evaluateFixture } from "./helpers.js";

const SERVICE_HEALTH_KEYS = [
  "schema_version",
  "source",
  "observed_at",
  "freshness_status",
  "confidence",
  "service",
  "healthy",
  "label",
  "reasons",
  "evidence",
  "collector_alive",
  "collector_stalled",
] as const;

const SOURCE_OBSERVATION_KEYS = [
  "schema_version",
  "source",
  "observed_at",
  "freshness_status",
  "confidence",
  "last_item_observed_at",
  "last_success_at",
  "lag_seconds",
  "recent_window_count",
  "consecutive_errors",
  "source_max_timestamp",
  "evidence",
] as const;

describe("ServiceHealth + SourceObservation contracts", () => {
  test("every named fixture carries provenance fields", async () => {
    const files = [
      "pipeline-vivo.json",
      "pipeline-morto.json",
      "source-silenciosa.json",
      "credencial-indisponivel.json",
    ];
    for (const file of files) {
      const result = await evaluateFixture(file);
      for (const key of SERVICE_HEALTH_KEYS) {
        assert.ok(key in result.serviceHealth, `missing ServiceHealth.${key} in ${file}`);
      }
      for (const key of SOURCE_OBSERVATION_KEYS) {
        assert.ok(
          key in result.sourceObservation,
          `missing SourceObservation.${key} in ${file}`,
        );
      }
      assert.equal(result.serviceHealth.schema_version, SCHEMA_VERSION);
      assert.equal(result.serviceHealth.source, "pncp");
      assert.ok(result.serviceHealth.observed_at);
      assert.ok(result.serviceHealth.freshness_status);
      if (result.serviceHealth.healthy) {
        assert.equal(result.serviceHealth.freshness_status, "FRESH");
        assert.equal(result.serviceHealth.label, PNCP_HEALTHY_LABEL);
        assert.ok(result.sourceObservation.observed_at);
        assert.ok(result.serviceHealth.evidence.source_max_timestamp);
      } else {
        assert.notEqual(result.serviceHealth.label, PNCP_HEALTHY_LABEL);
        assert.notEqual(result.serviceHealth.freshness_status, "FRESH");
      }
    }
  });

  test("healthy label is unrepresentable from an incomplete snapshot", async () => {
    const result = await evaluatePncpFreshness({
      kind: "db_view",
      now: new Date("2026-08-20T12:00:00.000Z"),
      dbRow: {
        last_success_at: "2026-08-20T11:59:00.000Z",
        consecutive_errors: 0,
      },
    });
    assert.equal(result.serviceHealth.healthy, false);
    assert.notEqual(result.serviceHealth.label, PNCP_HEALTHY_LABEL);
    assert.notEqual(result.serviceHealth.freshness_status, "FRESH");
    const serialized = JSON.stringify(result.serviceHealth);
    assert.equal(serialized.includes(PNCP_HEALTHY_LABEL), false);
  });
});
