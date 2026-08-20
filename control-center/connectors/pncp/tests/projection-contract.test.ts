import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  CONTRACT_VERSION,
  PNCP_SCOPE,
  PNCP_SERVICE_HEALTH_ID,
  PNCP_SERVICE_NAME,
  PNCP_SOURCE_OBSERVATION_ID,
  SERVICE_HEALTH_SCHEMA,
  SOURCE_OBSERVATION_SCHEMA,
  evaluatePncpFreshness,
} from "../src/index.js";
import { evaluateFixture } from "./helpers.js";

describe("canonical ServiceHealth + SourceObservation projection", () => {
  test("successful 1.0 evaluation carries required provenance on both outputs", async () => {
    const files = [
      "contract-fresh.json",
      "contract-degraded.json",
      "contract-stale.json",
      "contract-unknown.json",
    ] as const;
    for (const file of files) {
      const result = await evaluateFixture(file);
      const { serviceHealth, sourceObservation } = result;

      assert.equal(serviceHealth.schema_version, SERVICE_HEALTH_SCHEMA);
      assert.equal(serviceHealth.id, PNCP_SERVICE_HEALTH_ID);
      assert.equal(serviceHealth.scope, PNCP_SCOPE);
      assert.equal(serviceHealth.service_name, PNCP_SERVICE_NAME);
      assert.ok(serviceHealth.checked_at);

      const provenance = serviceHealth.provenance;
      assert.ok(provenance.source.system);
      assert.ok(provenance.source.kind);
      assert.ok(provenance.source.locator);
      assert.ok(provenance.observed_at);
      assert.ok(
        ["FRESH", "STALE", "UNKNOWN", "ERROR"].includes(
          provenance.freshness_status,
        ),
      );
      assert.equal(typeof provenance.confidence, "number");
      assert.ok(provenance.confidence >= 0 && provenance.confidence <= 1);

      assert.equal(
        sourceObservation.schema_version,
        SOURCE_OBSERVATION_SCHEMA,
      );
      assert.equal(sourceObservation.id, PNCP_SOURCE_OBSERVATION_ID);
      assert.equal(sourceObservation.scope, PNCP_SCOPE);
      assert.deepEqual(sourceObservation.provenance, provenance);
      assert.ok(sourceObservation.collected_at);
      assert.ok(sourceObservation.idempotency_key);
      assert.equal(sourceObservation.payload_schema_ref, CONTRACT_VERSION);
      assert.equal(
        sourceObservation.payload.contract_version,
        CONTRACT_VERSION,
      );
      assert.ok(Array.isArray(sourceObservation.payload.reason_codes));
      assert.ok("as_of" in sourceObservation.payload);
      assert.ok("deployed_sha" in sourceObservation.payload);
      assert.ok("policy_version" in sourceObservation.payload);
      assert.equal(sourceObservation.provenance.freshness_status, result.freshness_status);
    }
  });

  test("ERROR projection includes error on SourceObservation and never FRESH", async () => {
    const result = await evaluatePncpFreshness({
      kind: "file",
      now: new Date("2026-08-20T12:00:00.000Z"),
    });
    assert.equal(result.freshness_status, "ERROR");
    assert.equal(result.serviceHealth.provenance.freshness_status, "ERROR");
    assert.equal(result.serviceHealth.status, "down");
    assert.ok(result.sourceObservation.error);
    assert.equal(typeof result.sourceObservation.error?.code, "string");
    assert.equal(typeof result.sourceObservation.error?.message, "string");
    assert.equal(result.serviceHealth.provenance.confidence, 0);
  });

  test("DEGRADED projection stores upstream_status and reason_codes in payload", async () => {
    const result = await evaluateFixture("contract-degraded.json");
    assert.equal(result.sourceObservation.payload.upstream_status, "DEGRADED");
    assert.deepEqual(result.sourceObservation.payload.reason_codes, [
      "LOCK_BUSY_NO_CLOSE",
      "LAG_ABOVE_OPERATIONAL_TARGET",
    ]);
    assert.equal(
      result.sourceObservation.payload.as_of,
      "2026-08-20T12:00:00Z",
    );
    assert.equal(
      result.serviceHealth.provenance.freshness_status,
      "STALE",
    );
    assert.equal(result.serviceHealth.status, "degraded");
  });
});
