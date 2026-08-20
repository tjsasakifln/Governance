import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { cliOutput, evaluatePncpFreshness } from "../src/index.js";
import { fixturePath } from "./helpers.js";

describe("CLI JSON shape from shipped evaluate", () => {
  test("file DEGRADED and FRESH evaluations expose mapped fields", async () => {
    const degraded = await evaluatePncpFreshness({
      kind: "file",
      filePath: fixturePath("contract-degraded.json"),
      now: new Date("2026-08-20T12:00:00.000Z"),
    });
    const out = cliOutput(degraded);
    assert.equal(out.freshness_status, "STALE");
    assert.equal(out.upstream_status, "DEGRADED");
    assert.equal(out.contract_version, "PNCP_CONTRACT_FRESHNESS/1.0");
    assert.deepEqual(out.reason_codes, [
      "LOCK_BUSY_NO_CLOSE",
      "LAG_ABOVE_OPERATIONAL_TARGET",
    ]);
    assert.equal(out.as_of, "2026-08-20T12:00:00Z");
    assert.ok(out.deployed_sha);
    assert.ok(out.policy_version);
    const health = out.serviceHealth as { provenance: { observed_at: string; freshness_status: string; confidence: number; source: { system: string } } };
    assert.ok(health.provenance.source.system);
    assert.ok(health.provenance.observed_at);
    assert.equal(health.provenance.freshness_status, "STALE");
    assert.equal(typeof health.provenance.confidence, "number");

    const fresh = await evaluatePncpFreshness({
      kind: "file",
      filePath: fixturePath("contract-fresh.json"),
      now: new Date("2026-08-20T12:00:00.000Z"),
    });
    const freshOut = cliOutput(fresh);
    assert.equal(freshOut.freshness_status, "FRESH");
    assert.equal(freshOut.upstream_status, "FRESH");
    assert.equal(freshOut.as_of, "2026-08-20T12:00:00Z");
  });
});
