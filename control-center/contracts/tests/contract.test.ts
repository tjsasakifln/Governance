import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  allowedMcpToolNames,
  catalogFixturePath,
  catalogType,
  FRESHNESS_STATUSES,
  forbiddenHttpPaths,
  forbiddenMcpOperationNames,
  HOMEPAGE_PRIORITY_LIMIT,
  isForbiddenMcpOperation,
  listResourceTypes,
  loadCatalog,
  loadMcpContract,
  loadOpenApi,
  RESOURCE_ID_PATTERN,
  RESOURCE_TYPE_NAMES,
  SCOPE_PATTERN,
  UTC_DATETIME_PATTERN,
  validate,
  validateFile,
  type ResourceTypeName,
} from "../src/index.js";
import { packageRoot } from "../src/paths.js";

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(path.join(packageRoot(), rel), "utf8"));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const catalog = loadCatalog();
const types = listResourceTypes();

describe("Control Center catalog", () => {
  it("lists exactly the 13 named types", () => {
    assert.deepEqual([...RESOURCE_TYPE_NAMES], [
      "Directive",
      "OperationalSnapshot",
      "SourceObservation",
      "AttentionItem",
      "PriorityRecommendation",
      "AgentSession",
      "ClientStatus",
      "CommercialSnapshot",
      "FinanceSnapshot",
      "EngineeringSnapshot",
      "ServiceHealth",
      "CollectorRun",
      "AuditEvent",
    ]);
    assert.equal(catalog.types.length, 13);
    assert.deepEqual(
      catalog.types.map((t) => t.name),
      [...RESOURCE_TYPE_NAMES],
    );
    assert.deepEqual(types, [...RESOURCE_TYPE_NAMES]);
  });
});

describe("primitives lockstep with JSON Schema", () => {
  const primitives = readJson("schemas/primitives.v1.schema.json") as {
    $defs: Record<string, { pattern?: string; enum?: string[] }>;
  };

  it("keeps scope pattern identical", () => {
    assert.equal(primitives.$defs.scope?.pattern, SCOPE_PATTERN);
  });

  it("encodes FRESH|STALE|UNKNOWN|ERROR", () => {
    assert.deepEqual(primitives.$defs.freshness_status?.enum, [...FRESHNESS_STATUSES]);
  });

  it("encodes UTC Z timestamps and resource IDs", () => {
    assert.equal(primitives.$defs.utc_datetime?.pattern, UTC_DATETIME_PATTERN);
    assert.equal(primitives.$defs.resource_id?.pattern, RESOURCE_ID_PATTERN);
  });

  it("requires provenance fields source, observed_at, freshness_status, confidence", () => {
    const schema = readJson("schemas/primitives.v1.schema.json") as {
      $defs: { provenance: { required: string[] } };
    };
    assert.deepEqual(schema.$defs.provenance.required, [
      "source",
      "observed_at",
      "freshness_status",
      "confidence",
    ]);
  });
});

for (const typeName of types) {
  describe(typeName, () => {
    const row = catalogType(typeName);

    it("accepts the valid fixture via the shipped validator", () => {
      const file = catalogFixturePath("valid", typeName);
      const result = validateFile(typeName, file);
      assert.equal(result.ok, true, JSON.stringify(result.errors));
      assert.equal(result.type, typeName);
      assert.equal(result.schema_version, row.schema_version);
    });

    it("rejects the invalid fixture via the shipped validator", () => {
      const file = catalogFixturePath("invalid", typeName);
      const result = validateFile(typeName, file);
      assert.equal(result.ok, false, `${typeName} invalid fixture was accepted`);
      assert.ok(result.errors.length > 0);
    });

    it("schema_version is a required const in the JSON Schema", () => {
      const schema = readJson(row.schema) as {
        required: string[];
        properties: { schema_version: { const: string } };
      };
      assert.ok(schema.required.includes("schema_version"));
      assert.equal(schema.properties.schema_version.const, row.schema_version);
    });
  });
}

describe("Directive semantics", () => {
  const valid = readJson("fixtures/valid/directive.json");

  it("rejects unknown kind", () => {
    const doc = clone(valid) as Record<string, unknown>;
    doc.kind = "note";
    const result = validate("Directive", doc);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => /kind/i.test(e.path) || /enum/i.test(e.keyword ?? "")));
  });

  it("requires scope, status, effective_from, expires_at, supersedes, created_by, audit", () => {
    const schema = readJson("schemas/directive.v1.schema.json") as { required: string[] };
    for (const field of [
      "scope",
      "status",
      "effective_from",
      "expires_at",
      "supersedes",
      "created_by",
      "audit",
    ]) {
      assert.ok(schema.required.includes(field), `missing required ${field}`);
    }
    const doc = clone(valid) as Record<string, unknown>;
    delete doc.scope;
    assert.equal(validate("Directive", doc).ok, false);
  });

  it("rejects expires_at before effective_from", () => {
    const doc = clone(valid) as Record<string, unknown>;
    doc.effective_from = "2026-08-20T12:00:00Z";
    doc.expires_at = "2026-08-19T12:00:00Z";
    const result = validate("Directive", doc);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.path === "/expires_at"));
  });
});

describe("freshness vs confidence", () => {
  const valid = readJson("fixtures/valid/source-observation.json") as {
    provenance: Record<string, unknown>;
  } & Record<string, unknown>;

  it("accepts FRESH with low confidence (fields are independent)", () => {
    const doc = clone(valid);
    doc.provenance.freshness_status = "FRESH";
    doc.provenance.confidence = 0.2;
    const result = validate("SourceObservation", doc);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
  });

  it("accepts ERROR with residual confidence when error is present", () => {
    const doc = clone(valid);
    doc.provenance.freshness_status = "ERROR";
    doc.provenance.confidence = 0.9;
    doc.error = { code: "COLLECTOR_FAILED", message: "origin timeout" };
    const result = validate("SourceObservation", doc);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
  });

  it("rejects ERROR without error object", () => {
    const doc = clone(valid);
    doc.provenance.freshness_status = "ERROR";
    delete doc.error;
    assert.equal(validate("SourceObservation", doc).ok, false);
  });

  it("rejects confidence above 1", () => {
    const doc = clone(valid);
    doc.provenance.confidence = 1.5;
    assert.equal(validate("SourceObservation", doc).ok, false);
  });

  it("rejects substituting freshness with a confidence-like value", () => {
    const doc = clone(valid);
    doc.provenance.freshness_status = "HIGH";
    assert.equal(validate("SourceObservation", doc).ok, false);
  });
});

describe("AgentSession scope query", () => {
  const valid = readJson("fixtures/valid/agent-session.json");

  it("rejects empty requested_scopes", () => {
    const doc = clone(valid) as Record<string, unknown>;
    doc.requested_scopes = [];
    assert.equal(validate("AgentSession", doc).ok, false);
  });

  it("rejects granted scope outside requested (fail-closed)", () => {
    const doc = clone(valid) as Record<string, unknown>;
    doc.requested_scopes = ["finance"];
    doc.granted_scopes = ["finance", "company"];
    const result = validate("AgentSession", doc);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.keyword === "granted_subset"));
  });
});

describe("ClientStatus scope binding", () => {
  it("rejects scope that is not client:<slug>", () => {
    const valid = readJson("fixtures/valid/client-status.json") as Record<string, unknown>;
    const doc = clone(valid);
    doc.scope = "clients";
    assert.equal(validate("ClientStatus", doc).ok, false);
  });
});

describe("OperationalSnapshot homepage limit", () => {
  it(`rejects more than ${HOMEPAGE_PRIORITY_LIMIT} top_priorities`, () => {
    const valid = readJson("fixtures/valid/operational-snapshot.json") as {
      top_priorities: unknown[];
    };
    const doc = clone(valid);
    const extra = clone(doc.top_priorities[0]) as Record<string, unknown>;
    extra.id = "cc:priority-recommendation:01K3CC-RANK-4";
    extra.rank = 4;
    doc.top_priorities.push(extra);
    const result = validate("OperationalSnapshot", doc);
    assert.equal(result.ok, false);
  });
});

describe("FinanceSnapshot money and mutations", () => {
  it("rejects non-integer cents", () => {
    const valid = readJson("fixtures/valid/finance-snapshot.json") as {
      receivables_open: { amount_cents: number; currency: string };
    };
    const doc = clone(valid);
    doc.receivables_open.amount_cents = 10.5;
    assert.equal(validate("FinanceSnapshot", doc).ok, false);
  });

  it("rejects flipping provider_mutations off forbidden", () => {
    const valid = readJson("fixtures/valid/finance-snapshot.json") as Record<string, unknown>;
    const doc = clone(valid);
    doc.provider_mutations = "allowed";
    assert.equal(validate("FinanceSnapshot", doc).ok, false);
  });
});

describe("AuditEvent secret property names", () => {
  it("rejects detail.password via the shipped validator", () => {
    const valid = readJson("fixtures/valid/audit-event.json") as {
      detail: Record<string, unknown>;
    };
    const doc = clone(valid);
    doc.detail.password = "nope";
    assert.equal(validate("AuditEvent", doc).ok, false);
  });
});

describe("MCP principal agent interface", () => {
  const mcp = loadMcpContract();

  it("declares MCP as the principal agent interface and requires scoped tools", () => {
    assert.equal(mcp.interface_role, "principal_agent_interface");
    assert.match(mcp.scope_rule, /scope/i);
    const names = allowedMcpToolNames();
    assert.ok(names.includes("cc_get_context"));
    const getContext = mcp.tools.find((t) => t.name === "cc_get_context");
    assert.ok(getContext);
    const required = (getContext.input_schema.required as string[]) ?? [];
    assert.ok(required.includes("scopes"));
  });

  it("forbids financial and provider mutations and company-memory dump", () => {
    const forbidden = forbiddenMcpOperationNames();
    for (const name of [
      "cc_charge",
      "cc_checkout",
      "cc_refund",
      "cc_cancel_subscription",
      "cc_asaas_write",
      "cc_send_commercial",
      "cc_dump_company_memory",
    ]) {
      assert.ok(forbidden.includes(name), `missing forbidden ${name}`);
      assert.equal(isForbiddenMcpOperation(name), true);
    }
    const allowed = new Set(allowedMcpToolNames());
    for (const name of forbidden) {
      assert.equal(allowed.has(name), false, `${name} must not be an allowed tool`);
    }
  });
});

describe("internal HTTP contract", () => {
  const spec = loadOpenApi();

  it("requires scopes on the context endpoint and names all 13 resources", () => {
    const context = spec.paths["/v1/context"] as {
      get: { parameters: Array<{ name: string; required?: boolean }> };
    };
    const scopesParam = context.get.parameters.find((p) => p.name === "scopes");
    assert.equal(scopesParam?.required, true);
    const dumped = JSON.stringify(spec);
    for (const name of RESOURCE_TYPE_NAMES) {
      assert.ok(dumped.includes(name) || dumped.includes(catalogType(name).schema), name);
    }
  });

  it("lists forbidden financial/provider paths and does not define them", () => {
    const forbidden = forbiddenHttpPaths();
    assert.ok(forbidden.includes("/v1/charges"));
    assert.ok(forbidden.includes("/v1/checkout"));
    assert.ok(forbidden.includes("/v1/refunds"));
    assert.ok(forbidden.includes("/v1/asaas"));
    assert.ok(forbidden.includes("/v1/messages/send"));
    assert.ok(forbidden.includes("/v1/memory/dump"));
    for (const p of forbidden) {
      assert.equal(p in spec.paths, false, `forbidden path defined: ${p}`);
    }
  });
});
