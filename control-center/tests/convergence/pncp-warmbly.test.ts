import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyRequest } from "../../connectors/warmbly/src/http/allowlist.ts";
import { mapUpstreamStatus } from "../../connectors/pncp/src/map.ts";
import { evaluatePncpContractPayload } from "../../connectors/pncp/src/evaluate.ts";

test("Warmbly allowlist denies PATCH/PUT/DELETE and mutating POST", () => {
  for (const method of ["PATCH", "PUT", "DELETE"] as const) {
    const result = classifyRequest(method, "/v1/crm/deals");
    assert.equal(result.allowed, false);
  }
  const mutating = classifyRequest("POST", "/v1/crm/deals");
  assert.equal(mutating.allowed, false);
  const search = classifyRequest("POST", "/v1/contacts/search");
  assert.equal(search.allowed, true);
  const get = classifyRequest("GET", "/health");
  assert.equal(get.allowed, true);
});

test("PNCP maps PNCP_CONTRACT_FRESHNESS/1.0 without a local classifier", () => {
  assert.equal(mapUpstreamStatus("FRESH").freshness_status, "FRESH");
  assert.equal(mapUpstreamStatus("DEGRADED").freshness_status, "STALE");
  assert.equal(mapUpstreamStatus("STALE").freshness_status, "STALE");
  assert.equal(mapUpstreamStatus("UNKNOWN").freshness_status, "UNKNOWN");
  const failed = evaluatePncpContractPayload({ schema_version: "nope" }, {
    adapterKind: "file",
    locator: "file:x",
    collectedAt: new Date("2026-08-20T12:00:00.000Z"),
  });
  assert.equal(failed.freshness_status, "ERROR");
});
