import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { packageRoot } from "../src/paths.js";
import {
  loadOperationalOpenApi,
  operationalEnvelopeInvalidFixture,
  operationalEnvelopeValidFixture,
  OPERATIONAL_DOMAINS,
  OPERATIONAL_ENVELOPE_SCHEMA_VERSION,
  OPERATIONAL_HTTP_PATHS,
  OPERATIONAL_VIEWS,
  validateOperationalEnvelope,
} from "../src/operational-envelope.js";
import { CONTEXT_PATH_UNCHANGED, OPERATIONAL_GET_ROUTES } from "../src/operational-http.js";
import { catalogType, validateFile } from "../src/index.js";

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(path.join(packageRoot(), rel), "utf8"));
}

describe("operational envelope contract", () => {
  it("accepts the valid envelope fixture via the shipped validator", () => {
    const fixture = operationalEnvelopeValidFixture();
    const result = validateOperationalEnvelope(fixture);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(result.schema_version, OPERATIONAL_ENVELOPE_SCHEMA_VERSION);
    const rec = fixture as {
      schema_version: string;
      snapshots: Record<string, unknown>;
      attention_now: unknown[];
      today: unknown[];
      source_observations: unknown[];
    };
    assert.equal(rec.schema_version, "control-center.operational-envelope.v1");
    assert.deepEqual(Object.keys(rec.snapshots).sort(), [...OPERATIONAL_DOMAINS].sort());
    assert.ok(Array.isArray(rec.attention_now));
    assert.ok(Array.isArray(rec.today));
    assert.ok(rec.today.length <= 3);
    assert.ok(Array.isArray(rec.source_observations));
  });

  it("rejects the invalid envelope that marks STALE as healthy", () => {
    const fixture = operationalEnvelopeInvalidFixture();
    const result = validateOperationalEnvelope(fixture);
    assert.equal(result.ok, false);
    assert.ok(result.errors.length > 0);
  });

  it("rejects an envelope missing required keys or rewriting schema_version", () => {
    const base = operationalEnvelopeValidFixture() as Record<string, unknown>;
    const missing = { ...base };
    delete missing.attention_now;
    assert.equal(validateOperationalEnvelope(missing).ok, false);
    const rewritten = { ...base, schema_version: "control-center.operational-snapshot.v1" };
    assert.equal(validateOperationalEnvelope(rewritten).ok, false);
  });

  it("does not rewrite the existing operational-snapshot.v1 catalog fixture", () => {
    const row = catalogType("OperationalSnapshot");
    assert.equal(row.schema_version, "control-center.operational-snapshot.v1");
    const valid = validateFile("OperationalSnapshot", path.join(packageRoot(), row.valid_fixture));
    assert.equal(valid.ok, true, JSON.stringify(valid.errors));
    const invalid = validateFile("OperationalSnapshot", path.join(packageRoot(), row.invalid_fixture));
    assert.equal(invalid.ok, false);
  });

  it("documents the five GET routes and frozen view names without changing /v1/context", () => {
    const spec = loadOperationalOpenApi();
    assert.equal(spec.openapi.startsWith("3."), true);
    assert.ok(spec.paths["/v1/operational-snapshots"]);
    assert.ok(spec.paths["/v1/domains/{domain}"]);
    assert.ok(spec.paths["/v1/attention"]);
    assert.ok(spec.paths["/v1/today"]);
    assert.ok(spec.paths["/v1/source-observations"]);
    assert.equal(spec.paths[CONTEXT_PATH_UNCHANGED], undefined);
    assert.equal(OPERATIONAL_GET_ROUTES.length, 5);
    assert.deepEqual(OPERATIONAL_HTTP_PATHS, [
      "/v1/operational-snapshots",
      "/v1/domains/{domain}",
      "/v1/attention",
      "/v1/today",
      "/v1/source-observations",
    ]);
    assert.equal(OPERATIONAL_VIEWS.collectorRuns, "control_center.v_latest_collector_runs");
    assert.equal(OPERATIONAL_VIEWS.sourceObservations, "control_center.v_latest_source_observations");
    assert.equal(OPERATIONAL_VIEWS.operationalSnapshots, "control_center.v_latest_operational_snapshots");
  });

  it("keeps catalog.json and http.openapi.json free of the operational envelope type", () => {
    const catalog = readJson("catalog.json") as { types: Array<{ schema_version: string }> };
    assert.equal(
      catalog.types.some((t) => t.schema_version === OPERATIONAL_ENVELOPE_SCHEMA_VERSION),
      false,
    );
    const openapi = readJson("docs/http.openapi.json") as { paths: Record<string, unknown> };
    assert.ok(openapi.paths["/v1/context"]);
    assert.equal(openapi.paths["/v1/operational-snapshots"], undefined);
  });
});
