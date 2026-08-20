import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyCompatibility,
  loadCompatibilityTable,
  validate,
  validateUnknown,
} from "../src/index.js";

const REJECT_OR_ADAPTER = new Set(["reject", "adapter_required"]);

describe("compatibility table", () => {
  it("declares the five incompatible shapes as reject or adapter_required", () => {
    const table = loadCompatibilityTable();
    const ids = table.shapes.map((s) => s.id);
    for (const required of [
      "lowercase_freshness",
      "expired_as_freshness",
      "withdrawn_or_inactive_status",
      "scope_object",
      "raw_uuid_id",
    ]) {
      assert.ok(ids.includes(required), `missing ${required}`);
    }
    for (const shape of table.shapes) {
      assert.ok(REJECT_OR_ADAPTER.has(shape.verdict), shape.id);
    }
  });
});

describe("shipped classifier on the five incompatible shapes", () => {
  it("rejects lowercase freshness", () => {
    const result = classifyCompatibility({
      provenance: { freshness_status: "fresh" },
    });
    assert.equal(result.verdict, "reject");
    assert.ok(result.findings.some((f) => f.shape_id === "lowercase_freshness"));
  });

  it("rejects expired used as freshness", () => {
    const result = classifyCompatibility({
      provenance: { freshness_status: "expired" },
    });
    assert.equal(result.verdict, "reject");
    assert.ok(result.findings.some((f) => f.shape_id === "expired_as_freshness"));
  });

  it("rejects withdrawn and inactive statuses", () => {
    const withdrawn = classifyCompatibility({ status: "withdrawn" });
    const inactive = classifyCompatibility({ status: "inactive" });
    assert.equal(withdrawn.verdict, "reject");
    assert.equal(inactive.verdict, "reject");
    assert.ok(withdrawn.findings.some((f) => f.shape_id === "withdrawn_or_inactive_status"));
    assert.ok(inactive.findings.some((f) => f.shape_id === "withdrawn_or_inactive_status"));
  });

  it("requires an adapter for scope as an object", () => {
    const result = classifyCompatibility({ scope: { kind: "company" } });
    assert.equal(result.verdict, "adapter_required");
    assert.ok(result.findings.some((f) => f.shape_id === "scope_object"));
  });

  it("requires an adapter for a raw UUID external id", () => {
    const result = classifyCompatibility({
      id: "550e8400-e29b-41d4-a716-446655440000",
    });
    assert.equal(result.verdict, "adapter_required");
    assert.ok(result.findings.some((f) => f.shape_id === "raw_uuid_id"));
  });

  it("does not silently accept any of the five shapes through the shipped validator", () => {
    const shapes: unknown[] = [
      { schema_version: "control-center.directive.v1", provenance: { freshness_status: "stale" } },
      { schema_version: "control-center.directive.v1", provenance: { freshness_status: "expired" } },
      { schema_version: "control-center.directive.v1", status: "withdrawn" },
      { schema_version: "control-center.directive.v1", scope: { type: "finance" } },
      { schema_version: "control-center.directive.v1", id: "550e8400-e29b-41d4-a716-446655440000" },
    ];
    for (const doc of shapes) {
      const classified = classifyCompatibility(doc);
      assert.ok(REJECT_OR_ADAPTER.has(classified.verdict), JSON.stringify(classified));
      const validated = validateUnknown(doc);
      assert.equal(validated.ok, false);
    }
  });

  it("still classifies a canonical freshness/id/scope document as canonical on those axes", () => {
    const result = classifyCompatibility({
      id: "cc:directive:01K3CC-NO-PROVIDER-MUTATION",
      scope: "finance",
      status: "active",
      provenance: { freshness_status: "FRESH", confidence: 0.7 },
    });
    assert.equal(result.verdict, "canonical");
    assert.equal(result.findings.length, 0);
  });
});

describe("validator surfaces compatibility on typed documents", () => {
  it("marks lowercase freshness as not ok for FinanceSnapshot", () => {
    const result = validate("FinanceSnapshot", {
      schema_version: "control-center.finance-snapshot.v1",
      id: "cc:finance-snapshot:01K3CC-LOWER",
      provenance: { freshness_status: "fresh" },
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.keyword === "compatibility" || e.keyword === "enum"));
  });
});
