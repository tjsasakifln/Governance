import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  ACTOR_KINDS,
  allowedMcpToolNames,
  CLIENT_IDENTITY_BASES,
  CLIENT_IDENTITY_REASON_CODES,
  CLIENT_IDENTITY_REQUIRED_ACTION,
  CLIENT_IDENTITY_REQUIRED_ACTIONS,
  clientSlugFrom,
  MIN_CLIENT_SLUG_LENGTH,
  resolveClientIdentity,
  catalogFixturePath,
  catalogType,
  DIRECTIVE_STATUSES,
  FRESHNESS_STATUSES,
  forbiddenHttpPaths,
  forbiddenMcpOperationNames,
  HOMEPAGE_PRIORITY_LIMIT,
  isForbiddenMcpOperation,
  isIdentifiedClientSlug,
  isPlaceholderDisplayName,
  isReservedClientSlug,
  isScope,
  listResourceTypes,
  loadCatalog,
  loadMcpContract,
  loadOpenApi,
  RESERVED_CLIENT_SCOPE_PATTERN,
  RESERVED_CLIENT_SLUG_PATTERN,
  RESERVED_CLIENT_SLUGS,
  RESOURCE_ID_PATTERN,
  RESOURCE_TYPE_NAMES,
  SCOPE_CSV_PATTERN,
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
  it("stays in lockstep with RESOURCE_TYPE_NAMES and catalogs AgentActivity apart from AgentSession", () => {
    assert.deepEqual(
      catalog.types.map((t) => t.name),
      [...RESOURCE_TYPE_NAMES],
    );
    assert.deepEqual(types, [...RESOURCE_TYPE_NAMES]);
    assert.equal(catalog.types.length, RESOURCE_TYPE_NAMES.length);
    assert.ok(RESOURCE_TYPE_NAMES.includes("AgentActivity"));
    assert.ok(RESOURCE_TYPE_NAMES.includes("AgentSession"));
    const activity = catalogType("AgentActivity");
    const session = catalogType("AgentSession");
    assert.notEqual(activity.schema_version, session.schema_version);
    assert.notEqual(activity.id_type, session.id_type);
    assert.equal(activity.schema_version, "control-center.agent-activity.v1");
    assert.equal(activity.id_type, "agent-activity");
    assert.equal(session.schema_version, "control-center.agent-session.v1");
    assert.equal(session.id_type, "agent-session");
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

  it("encodes Directive status draft|active|superseded|revoked|expired and typed ActorRef", () => {
    const directive = readJson("schemas/directive.v1.schema.json") as {
      properties: { status: { enum: string[] }; supersedes: { type: string[] | string } };
    };
    assert.deepEqual(directive.properties.status.enum, [...DIRECTIVE_STATUSES]);
    assert.ok(
      Array.isArray(directive.properties.supersedes.type)
        ? directive.properties.supersedes.type.includes("array")
        : directive.properties.supersedes.type === "array",
    );
    const actor = primitives.$defs.actor_ref as { properties?: { kind?: { enum?: string[] } } };
    assert.deepEqual(actor.properties?.kind?.enum, [...ACTOR_KINDS]);
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

  it("compares instants, not RFC3339 strings, when fractional seconds are mixed", () => {
    const laterFrac = clone(valid) as Record<string, unknown>;
    laterFrac.effective_from = "2026-08-20T12:00:00Z";
    laterFrac.expires_at = "2026-08-20T12:00:00.001Z";
    const laterResult = validate("Directive", laterFrac);
    assert.equal(laterResult.ok, true, JSON.stringify(laterResult.errors));

    const earlierWhole = clone(valid) as Record<string, unknown>;
    earlierWhole.effective_from = "2026-08-20T12:00:00.500Z";
    earlierWhole.expires_at = "2026-08-20T12:00:00Z";
    const earlierResult = validate("Directive", earlierWhole);
    assert.equal(earlierResult.ok, false);
    assert.ok(earlierResult.errors.some((e) => e.path === "/expires_at"));
  });
});

describe("scope taxonomy exclusivity", () => {
  it("accepts literals, repo, kebab client, and extra prefix:id", () => {
    assert.equal(isScope("company"), true);
    assert.equal(isScope("repo:tjsasakifln/Governance"), true);
    assert.equal(isScope("client:acme-industria"), true);
    assert.equal(isScope("campaign:CONFENGE-CC"), true);
  });

  it("rejects reserved names with a colon and ill-formed client slugs", () => {
    assert.equal(isScope("company:foo"), false);
    assert.equal(isScope("client:Acme"), false);
    assert.equal(isScope("client:foo_bar"), false);
    assert.equal(isScope("hr"), false);
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

describe("ClientStatus minimum identity", () => {
  const valid = readJson("fixtures/valid/client-status.json") as Record<string, unknown>;

  it("keeps the reserved placeholder rule in lockstep with the JSON Schema", () => {
    const primitives = readJson("schemas/primitives.v1.schema.json") as {
      $defs: Record<string, { pattern?: string; minLength?: number; not?: { $ref?: string } }>;
    };
    assert.equal(primitives.$defs.reserved_client_slug?.pattern, RESERVED_CLIENT_SLUG_PATTERN);
    assert.equal(primitives.$defs.reserved_client_scope?.pattern, RESERVED_CLIENT_SCOPE_PATTERN);
    assert.equal(primitives.$defs.client_slug?.minLength, MIN_CLIENT_SLUG_LENGTH);
    assert.equal(primitives.$defs.client_scope?.minLength, "client:".length + MIN_CLIENT_SLUG_LENGTH);
    // The `not` clauses are what actually reject the placeholder. Assert they
    // are wired, not merely that the defs exist.
    assert.match(String(primitives.$defs.client_slug?.not?.$ref), /reserved_client_slug$/);
    assert.match(String(primitives.$defs.client_scope?.not?.$ref), /reserved_client_scope$/);
    assert.ok(RESERVED_CLIENT_SLUGS.includes("unknown"));
  });

  it("keeps client:<placeholder> out of the generic scope grammar too", () => {
    const primitives = readJson("schemas/primitives.v1.schema.json") as {
      $defs: Record<string, { pattern?: string }>;
    };
    assert.equal(primitives.$defs.scope?.pattern, SCOPE_PATTERN);
    assert.equal(isScope("client:acme-industria"), true);
    for (const slug of RESERVED_CLIENT_SLUGS) {
      assert.equal(isScope(`client:${slug}`), false, `client:${slug} must not be a scope`);
    }
    // The catch-all prefix:id alternative must not readmit it.
    assert.equal(new RegExp(SCOPE_CSV_PATTERN).test("commercial,client:unknown"), false);
    assert.equal(new RegExp(SCOPE_CSV_PATTERN).test("commercial,client:acme-industria"), true);
  });

  it("declares what a client identity may be derived from, and no deal basis", () => {
    const schema = readJson("schemas/client-status.v1.schema.json") as {
      required: string[];
      properties: Record<string, { enum?: string[] }>;
    };
    assert.ok(schema.required.includes("identity_basis"));
    assert.deepEqual(schema.properties.identity_basis?.enum, [...CLIENT_IDENTITY_BASES]);
    for (const basis of CLIENT_IDENTITY_BASES) {
      assert.ok(!/deal|opportunity|negocio/i.test(basis), `${basis} must not be a deal-level basis`);
    }
  });

  it("rejects a client published without stating how its identity was resolved", () => {
    const doc = clone(valid) as Record<string, unknown>;
    delete doc.identity_basis;
    assert.equal(validate("ClientStatus", doc).ok, false);
  });

  it("rejects a deal roll-up that claims a non-client basis", () => {
    const doc = clone(valid) as Record<string, unknown>;
    doc.derived_from_deal_count = 2;
    doc.identity_basis = "manual";
    const result = validate("ClientStatus", doc);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.keyword === "client_identity_basis"));
    doc.identity_basis = "account_key";
    assert.equal(validate("ClientStatus", doc).ok, true);
  });

  it("resolves identity from a client key, never from the record's own deal key", () => {
    // The Warmbly deal shape: a deal id, a deal name, and no account link.
    const deal = { id: "deal-healthy-1", name: "Diagnóstico — Construtora Beta", account_id: null };
    const unlinked = resolveClientIdentity(deal);
    assert.equal(unlinked.slug, null, "a deal key is not a client key");
    assert.deepEqual(unlinked.reasons, ["missing_client_key", "missing_display_name"]);

    const linked = resolveClientIdentity({ ...deal, account_id: "acct-77", company: "Acme Indústria" });
    assert.equal(linked.slug, "acct-77");
    assert.equal(linked.display_name, "Acme Indústria");
    assert.equal(linked.basis, "account_key");
    assert.deepEqual(linked.reasons, []);

    // Two deals, one company, one identity.
    const other = resolveClientIdentity({ id: "deal-2", name: "Expansão", account_id: "acct-77", company: "Acme Indústria" });
    assert.equal(other.slug, linked.slug);

    // Company name alone is still a client-level identifier.
    const byName = resolveClientIdentity({ id: "deal-3", company: "Construtora Beta" });
    assert.equal(byName.slug, "construtora-beta");
    assert.equal(byName.basis, "company_name");
  });

  it("gives each reason code its own correction", () => {
    const actions = new Set(Object.values(CLIENT_IDENTITY_REQUIRED_ACTIONS));
    assert.equal(actions.size, CLIENT_IDENTITY_REASON_CODES.length, "corrections must not be one repeated sentence");
    for (const code of CLIENT_IDENTITY_REASON_CODES) {
      assert.ok(CLIENT_IDENTITY_REQUIRED_ACTIONS[code].length > 0, code);
    }
  });

  it("rejects client:unknown — the placeholder is not an operational client", () => {
    const doc = clone(valid) as Record<string, unknown>;
    doc.id = "cc:client-status:unknown";
    doc.scope = "client:unknown";
    doc.client_slug = "unknown";
    doc.display_name = "Cliente";
    const result = validate("ClientStatus", doc);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.keyword === "client_identity"));
  });

  it("rejects every reserved placeholder slug, not just unknown", () => {
    for (const slug of RESERVED_CLIENT_SLUGS) {
      const doc = clone(valid);
      doc.id = `cc:client-status:${slug}`;
      doc.scope = `client:${slug}`;
      doc.client_slug = slug;
      assert.equal(validate("ClientStatus", doc).ok, false, `expected ${slug} to be rejected`);
    }
  });

  it("rejects a one-character slug as an identity", () => {
    const doc = clone(valid);
    doc.id = "cc:client-status:a";
    doc.scope = "client:a";
    doc.client_slug = "a";
    assert.equal(validate("ClientStatus", doc).ok, false);
  });

  it("rejects a placeholder display_name even when the slug is real", () => {
    const doc = clone(valid);
    doc.display_name = "unknown";
    const result = validate("ClientStatus", doc);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.keyword === "client_identity"));
  });

  it("rejects an id that is not bound to the client_slug", () => {
    const doc = clone(valid);
    doc.id = "cc:client-status:some-other-client";
    const result = validate("ClientStatus", doc);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.keyword === "client_id_slug"));
  });

  it("still accepts a real client identity", () => {
    assert.equal(validate("ClientStatus", clone(valid)).ok, true);
  });

  it("derives a slug fail-closed instead of inventing one", () => {
    assert.equal(clientSlugFrom("Acme Indústria"), "acme-ind-stria");
    assert.equal(clientSlugFrom(undefined), null);
    assert.equal(clientSlugFrom(""), null);
    assert.equal(clientSlugFrom("###"), null);
    assert.equal(clientSlugFrom("unknown"), null);
    assert.equal(clientSlugFrom("Unknown"), null);
    assert.equal(clientSlugFrom("Cliente"), null);
    assert.equal(isReservedClientSlug("unknown"), true);
    assert.equal(isIdentifiedClientSlug("acme-industria"), true);
    assert.equal(isPlaceholderDisplayName("Cliente"), true);
    assert.equal(isPlaceholderDisplayName("Acme Indústria"), false);
  });

  it("names the reason codes and the umbrella correction", () => {
    assert.ok(CLIENT_IDENTITY_REASON_CODES.includes("missing_client_key"));
    assert.ok(CLIENT_IDENTITY_REASON_CODES.includes("reserved_placeholder_slug"));
    assert.ok(CLIENT_IDENTITY_REQUIRED_ACTION.length > 0);
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
  it("accepts the named aggregates on the valid fixture", () => {
    const valid = readJson("fixtures/valid/finance-snapshot.json") as Record<string, unknown>;
    for (const field of [
      "contracted",
      "billed",
      "paid",
      "effectively_received",
      "overdue",
      "receivable",
      "refunds",
      "chargebacks",
    ]) {
      assert.ok(field in valid, `missing ${field}`);
    }
    assert.equal(valid.provider_mutations, "forbidden");
    const result = validate("FinanceSnapshot", valid);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
  });

  it("rejects non-integer cents", () => {
    const valid = readJson("fixtures/valid/finance-snapshot.json") as {
      receivable: { amount_cents: number; currency: string };
    };
    const doc = clone(valid);
    doc.receivable.amount_cents = 10.5;
    assert.equal(validate("FinanceSnapshot", doc).ok, false);
  });

  it("rejects flipping provider_mutations off forbidden", () => {
    const valid = readJson("fixtures/valid/finance-snapshot.json") as Record<string, unknown>;
    const doc = clone(valid);
    doc.provider_mutations = "allowed";
    assert.equal(validate("FinanceSnapshot", doc).ok, false);
  });

  it("rejects missing provider_mutations", () => {
    const valid = readJson("fixtures/valid/finance-snapshot.json") as Record<string, unknown>;
    const doc = clone(valid);
    delete doc.provider_mutations;
    assert.equal(validate("FinanceSnapshot", doc).ok, false);
  });

  it("rejects cash_in without evidence", () => {
    const valid = readJson("fixtures/valid/finance-snapshot.json") as Record<string, unknown>;
    const doc = clone(valid);
    doc.cash_in = { amount_cents: 100, currency: "BRL" };
    assert.equal(validate("FinanceSnapshot", doc).ok, false);
  });

  it("rejects mrr without applicability", () => {
    const valid = readJson("fixtures/valid/finance-snapshot.json") as Record<string, unknown>;
    const doc = clone(valid);
    doc.mrr = { amount_cents: 100, currency: "BRL" };
    assert.equal(validate("FinanceSnapshot", doc).ok, false);
  });

  it("rejects runway without reliable cash and expense", () => {
    const valid = readJson("fixtures/valid/finance-snapshot.json") as Record<string, unknown>;
    const doc = clone(valid);
    doc.runway = {
      months: 3,
      cash_balance: { amount_cents: 1, currency: "BRL" },
      monthly_expense: { amount_cents: 1, currency: "BRL" },
    };
    assert.equal(validate("FinanceSnapshot", doc).ok, false);
  });
});

describe("CommercialSnapshot funnel and catalog pin", () => {
  it("accepts funnel, nominal pipeline, gated weighted pipeline, and attention refs", () => {
    const valid = readJson("fixtures/valid/commercial-snapshot.json") as {
      funnel: Record<string, number>;
      offer_pin: Record<string, unknown>;
      attention_item_ids: string[];
    };
    for (const key of ["new_leads", "qualified", "opportunities", "proposals", "clients"]) {
      assert.ok(key in valid.funnel, `missing funnel.${key}`);
    }
    assert.equal(valid.offer_pin.catalog_authority, "governance");
    assert.ok(valid.attention_item_ids.length > 0);
    const result = validate("CommercialSnapshot", valid);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
  });

  it("rejects pipeline_weighted without reliable probability", () => {
    const valid = readJson("fixtures/valid/commercial-snapshot.json") as Record<string, unknown>;
    const doc = clone(valid);
    doc.pipeline_weighted = { amount_cents: 1000, currency: "BRL" };
    assert.equal(validate("CommercialSnapshot", doc).ok, false);
  });

  it("rejects a copied offer catalog inside CommercialSnapshot", () => {
    const valid = readJson("fixtures/valid/commercial-snapshot.json") as Record<string, unknown>;
    const doc = clone(valid);
    doc.offers = [{ name: "Diagnóstico", price_cents: 100000, terms: "net 15" }];
    const result = validate("CommercialSnapshot", doc);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.keyword === "catalog_copy" || e.keyword === "additionalProperties"));
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

  it("encodes SCOPE_PATTERN on every scoped MCP tool input", () => {
    const skip = new Set(["cc_list_scopes", "cc_get_client_status"]);
    for (const tool of mcp.tools) {
      if (skip.has(tool.name)) {
        continue;
      }
      const props = tool.input_schema.properties as Record<string, unknown>;
      const scopes = props.scopes as { items?: { pattern?: string } } | undefined;
      const scope = props.scope as { pattern?: string } | undefined;
      const pattern = scopes?.items?.pattern ?? scope?.pattern;
      assert.equal(pattern, SCOPE_PATTERN, `${tool.name} missing SCOPE_PATTERN`);
    }
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

  it("requires scopes on the context endpoint and names all cataloged resources", () => {
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

  it("requires scope on GET /v1/audit and encodes ScopeCsv", () => {
    const audit = spec.paths["/v1/audit"] as {
      get: { parameters: Array<{ name: string; required?: boolean }> };
    };
    const scopeParam = audit.get.parameters.find((p) => p.name === "scope");
    assert.equal(scopeParam?.required, true);
    const schemas = (spec as unknown as { components: { schemas: Record<string, { pattern?: string }> } })
      .components.schemas;
    assert.equal(schemas.Scope?.pattern, SCOPE_PATTERN);
    assert.equal(schemas.ScopeCsv?.pattern, SCOPE_CSV_PATTERN);
  });
});
