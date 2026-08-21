import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  CONTRACT_VERSION,
  evaluatePncpContractPayload,
  parsePncpContract,
  parsePncpContractText,
} from "../src/index.js";
import { evaluateFixture, readFixtureJson } from "./helpers.js";

const CTX = {
  adapterKind: "file" as const,
  locator: "fixtures/parse",
  collectedAt: new Date("2026-08-20T12:00:00.000Z"),
};

describe("versioned PNCP_CONTRACT_FRESHNESS/1.0 parser (fail-closed)", () => {
  test("parses a valid 1.0 contract through the shipped parser", async () => {
    const payload = await readFixtureJson("contract-fresh.json");
    const parsed = parsePncpContract(payload);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) {
      return;
    }
    assert.equal(parsed.contract.contract_version, CONTRACT_VERSION);
    assert.equal(parsed.contract.status, "FRESH");
    assert.equal(parsed.contract.as_of, "2026-08-20T12:00:00Z");
    assert.equal(
      parsed.contract.deployed_sha,
      "9c5e7d47f99902d9d97cf479aefbba8cd391a14d",
    );
    assert.ok(parsed.contract.policy_version);
  });

  test("unknown contract_version → ERROR, never FRESH even if status is FRESH", async () => {
    const result = await evaluateFixture("contract-unknown-version.json");
    assert.equal(result.freshness_status, "ERROR");
    assert.equal(result.upstream_status, null);
    assert.equal(result.parse_error?.code, "UNKNOWN_CONTRACT_VERSION");
    assert.equal(result.contract_version, "PNCP_CONTRACT_FRESHNESS/9.9");
    assert.equal(
      result.serviceHealth.provenance.freshness_status,
      "ERROR",
    );
    assert.ok(result.sourceObservation.error);
    assert.equal(result.sourceObservation.error?.code, "UNKNOWN_CONTRACT_VERSION");
  });

  test("malformed payload (missing status) → ERROR", async () => {
    const result = await evaluateFixture("contract-malformed.json");
    assert.equal(result.freshness_status, "ERROR");
    assert.equal(result.parse_error?.code, "MALFORMED_PAYLOAD");
    assert.notEqual(result.freshness_status, "FRESH");
  });

  test("invalid JSON text → ERROR INVALID_JSON", () => {
    const parsed = parsePncpContractText("{ this is not json");
    assert.equal(parsed.ok, false);
    if (parsed.ok) {
      return;
    }
    assert.equal(parsed.error.code, "INVALID_JSON");
    const result = evaluatePncpContractPayload(["not", "an", "object"], CTX);
    assert.equal(result.freshness_status, "ERROR");
    assert.equal(result.parse_error?.code, "MALFORMED_PAYLOAD");
  });

  test("invalid upstream status string → MALFORMED, not mapped", () => {
    const parsed = parsePncpContract({
      contract_version: CONTRACT_VERSION,
      status: "HEALTHY",
      reason_codes: [],
      as_of: "2026-08-20T12:00:00Z",
    });
    assert.equal(parsed.ok, false);
    if (parsed.ok) {
      return;
    }
    assert.equal(parsed.error.code, "MALFORMED_PAYLOAD");
  });

  test("missing as_of → MALFORMED", () => {
    const parsed = parsePncpContract({
      contract_version: CONTRACT_VERSION,
      status: "FRESH",
      reason_codes: [],
    });
    assert.equal(parsed.ok, false);
    if (parsed.ok) {
      return;
    }
    assert.equal(parsed.error.code, "MALFORMED_PAYLOAD");
  });
});
