import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  CONTRACT_VERSION,
  evaluatePncpContractPayload,
  mapUpstreamStatus,
} from "../src/index.js";
import { evaluateFixture, readFixtureJson } from "./helpers.js";

const COLLECTED = new Date("2026-08-20T12:00:00.000Z");
const CTX = {
  adapterKind: "file" as const,
  locator: "fixtures/inline",
  collectedAt: COLLECTED,
};

describe("PNCP_CONTRACT_FRESHNESS/1.0 status map (translation, not a classifier)", () => {
  test("FRESH → FRESH", () => {
    const mapped = mapUpstreamStatus("FRESH");
    assert.equal(mapped.freshness_status, "FRESH");
    assert.equal(mapped.upstream_status, "FRESH");
  });

  test("DEGRADED → STALE preserving upstream_status", () => {
    const mapped = mapUpstreamStatus("DEGRADED");
    assert.equal(mapped.freshness_status, "STALE");
    assert.equal(mapped.upstream_status, "DEGRADED");
    assert.notEqual(mapped.freshness_status, "FRESH");
  });

  test("STALE → STALE", () => {
    const mapped = mapUpstreamStatus("STALE");
    assert.equal(mapped.freshness_status, "STALE");
    assert.equal(mapped.upstream_status, "STALE");
  });

  test("UNKNOWN → UNKNOWN, not ERROR", () => {
    const mapped = mapUpstreamStatus("UNKNOWN");
    assert.equal(mapped.freshness_status, "UNKNOWN");
    assert.equal(mapped.upstream_status, "UNKNOWN");
    assert.notEqual(mapped.freshness_status, "ERROR");
    assert.notEqual(mapped.freshness_status, "FRESH");
  });

  test("mapping never promotes DEGRADED/STALE/UNKNOWN to FRESH", () => {
    for (const status of ["DEGRADED", "STALE", "UNKNOWN"] as const) {
      const mapped = mapUpstreamStatus(status);
      assert.notEqual(
        mapped.freshness_status,
        "FRESH",
        `${status} must not promote to FRESH`,
      );
    }
  });

  test("shipped evaluate path: FRESH fixture → CC FRESH with preserved fields", async () => {
    const payload = await readFixtureJson("contract-fresh.json");
    const result = evaluatePncpContractPayload(payload, CTX);
    assert.equal(result.freshness_status, "FRESH");
    assert.equal(result.upstream_status, "FRESH");
    assert.equal(result.contract_version, CONTRACT_VERSION);
    assert.equal(result.as_of, "2026-08-20T12:00:00Z");
    assert.equal(
      result.deployed_sha,
      "9c5e7d47f99902d9d97cf479aefbba8cd391a14d",
    );
    assert.ok(result.policy_version);
    assert.deepEqual(result.reason_codes, []);
    assert.equal(result.serviceHealth.provenance.freshness_status, "FRESH");
    assert.equal(
      result.sourceObservation.payload.contract_version,
      CONTRACT_VERSION,
    );
  });

  test("DEGRADED fixture whose timestamps would look FRESH under a 24h SLA still maps to STALE", async () => {
    const result = await evaluateFixture("contract-degraded.json");
    assert.equal(result.contract?.status, "DEGRADED");
    assert.equal(result.contract?.current_lag_hours, 1.5);
    assert.ok(
      result.contract &&
        result.contract.current_lag_hours !== null &&
        result.contract.current_lag_hours < 24,
    );
    assert.equal(result.freshness_status, "STALE");
    assert.equal(result.upstream_status, "DEGRADED");
    assert.deepEqual(result.reason_codes, [
      "LOCK_BUSY_NO_CLOSE",
      "LAG_ABOVE_OPERATIONAL_TARGET",
    ]);
    assert.equal(
      result.sourceObservation.payload.upstream_status,
      "DEGRADED",
    );
    assert.deepEqual(
      result.sourceObservation.payload.reason_codes,
      result.reason_codes,
    );
    assert.notEqual(result.freshness_status, "FRESH");
  });

  test("STALE fixture → STALE", async () => {
    const result = await evaluateFixture("contract-stale.json");
    assert.equal(result.freshness_status, "STALE");
    assert.equal(result.upstream_status, "STALE");
    assert.ok(result.reason_codes.includes("LAG_ABOVE_HARD_GUARDRAIL"));
    assert.equal(result.contract_version, CONTRACT_VERSION);
    assert.ok(result.as_of);
  });

  test("UNKNOWN fixture stays UNKNOWN, not ERROR", async () => {
    const result = await evaluateFixture("contract-unknown.json");
    assert.equal(result.freshness_status, "UNKNOWN");
    assert.equal(result.upstream_status, "UNKNOWN");
    assert.notEqual(result.freshness_status, "ERROR");
    assert.ok(result.reason_codes.includes("MISSING_EVIDENCE"));
  });
});
