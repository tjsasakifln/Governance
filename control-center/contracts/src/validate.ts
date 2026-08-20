import { readFileSync } from "node:fs";
import path from "node:path";
import { Ajv2020, type ErrorObject as AjvError } from "ajv/dist/2020.js";
import { catalogType, loadCatalog, schemaVersionToType } from "./catalog.js";
import { classifyCompatibility } from "./compatibility.js";
import { parseResourceId } from "./ids.js";
import { packageRoot } from "./paths.js";
import {
  FORBIDDEN_SECRET_KEY_REGEX,
  HOMEPAGE_PRIORITY_LIMIT,
  RESOURCE_TYPE_NAMES,
  type ResourceTypeName,
} from "./taxonomy.js";

export interface ValidationIssue {
  path: string;
  message: string;
  keyword?: string;
}

export interface ValidationResult {
  ok: boolean;
  type: ResourceTypeName | "unknown";
  schema_version?: string;
  errors: ValidationIssue[];
}

const SCHEMA_FILES = [
  "schemas/primitives.v1.schema.json",
  "schemas/directive.v1.schema.json",
  "schemas/source-observation.v1.schema.json",
  "schemas/attention-item.v1.schema.json",
  "schemas/priority-recommendation.v1.schema.json",
  "schemas/agent-session.v1.schema.json",
  "schemas/agent-activity.v1.schema.json",
  "schemas/client-status.v1.schema.json",
  "schemas/commercial-snapshot.v1.schema.json",
  "schemas/finance-snapshot.v1.schema.json",
  "schemas/engineering-snapshot.v1.schema.json",
  "schemas/service-health.v1.schema.json",
  "schemas/collector-run.v1.schema.json",
  "schemas/audit-event.v1.schema.json",
  "schemas/operational-snapshot.v1.schema.json",
  "schemas/agent-context.v1.schema.json",
] as const;

let ajvSingleton: InstanceType<typeof Ajv2020> | undefined;

function loadJson(rel: string): Record<string, unknown> {
  const raw = readFileSync(path.join(packageRoot(), rel), "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`schema file is not an object: ${rel}`);
  }
  return parsed as Record<string, unknown>;
}

function getAjv(): InstanceType<typeof Ajv2020> {
  if (ajvSingleton !== undefined) {
    return ajvSingleton;
  }
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    validateFormats: false,
  });
  for (const file of SCHEMA_FILES) {
    const schema = loadJson(file);
    ajv.addSchema(schema);
  }
  ajvSingleton = ajv;
  return ajv;
}

function schemaIdFor(type: ResourceTypeName): string {
  const row = catalogType(type);
  const schema = loadJson(row.schema);
  const id = schema.$id;
  if (typeof id !== "string") {
    throw new Error(`schema missing $id: ${row.schema}`);
  }
  return id;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function issue(pathExpr: string, message: string, keyword?: string): ValidationIssue {
  return { path: pathExpr, message, keyword };
}

function collectSecretKeyIssues(value: unknown, pathExpr: string, acc: ValidationIssue[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => collectSecretKeyIssues(item, `${pathExpr}/${i}`, acc));
    return;
  }
  const rec = asRecord(value);
  if (rec === null) {
    return;
  }
  for (const [key, child] of Object.entries(rec)) {
    if (FORBIDDEN_SECRET_KEY_REGEX.test(key)) {
      acc.push(
        issue(
          `${pathExpr}/${key}`,
          `forbidden secret-like property name '${key}'`,
          "secret_key",
        ),
      );
    }
    collectSecretKeyIssues(child, `${pathExpr}/${key}`, acc);
  }
}

function stringField(rec: Record<string, unknown>, key: string): string | undefined {
  const v = rec[key];
  return typeof v === "string" ? v : undefined;
}

/** Instant compare for UTC RFC3339. String order is not chronological when fractional seconds are mixed. */
function utcMillis(value: string): number | undefined {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

function semanticChecks(type: ResourceTypeName, data: unknown): ValidationIssue[] {
  const rec = asRecord(data);
  if (rec === null) {
    return [issue("", "document must be an object", "type")];
  }
  const errors: ValidationIssue[] = [];
  collectSecretKeyIssues(data, "", errors);

  const id = stringField(rec, "id");
  if (id !== undefined) {
    const parsed = parseResourceId(id);
    const expected = catalogType(type).id_type;
    if (parsed === null) {
      errors.push(issue("/id", "id does not match cc:<type>:<id> convention", "id"));
    } else if (parsed.type !== expected) {
      errors.push(
        issue(
          "/id",
          `id type '${parsed.type}' does not match required '${expected}'`,
          "id_type",
        ),
      );
    }
  }

  if (type === "ClientStatus") {
    const slug = stringField(rec, "client_slug");
    const scope = stringField(rec, "scope");
    if (slug !== undefined && scope !== undefined && scope !== `client:${slug}`) {
      errors.push(
        issue(
          "/scope",
          `scope must equal client:<client_slug> (expected client:${slug})`,
          "client_scope",
        ),
      );
    }
  }

  if (type === "Directive") {
    const from = stringField(rec, "effective_from");
    const expires = rec.expires_at;
    if (typeof from === "string" && typeof expires === "string") {
      const fromMs = utcMillis(from);
      const expiresMs = utcMillis(expires);
      if (fromMs === undefined || expiresMs === undefined || expiresMs < fromMs) {
        errors.push(
          issue("/expires_at", "expires_at must be >= effective_from when not null", "dates"),
        );
      }
    }
    const audit = rec.audit;
    if (!Array.isArray(audit) || audit.length < 1) {
      errors.push(issue("/audit", "audit trail must contain at least one entry", "audit"));
    }
  }

  if (type === "AgentActivity") {
    const sessionId = stringField(rec, "session_id");
    if (sessionId !== undefined) {
      const parsed = parseResourceId(sessionId);
      if (parsed === null || parsed.type !== "agent-session") {
        errors.push(
          issue(
            "/session_id",
            "session_id must be a cc:agent-session:... id; AgentActivity is not AgentSession",
            "session_link",
          ),
        );
      }
    }
    const activityId = stringField(rec, "id");
    if (activityId !== undefined) {
      const parsed = parseResourceId(activityId);
      if (parsed !== null && parsed.type === "agent-session") {
        errors.push(
          issue("/id", "AgentActivity id type must be agent-activity, not agent-session", "id_type"),
        );
      }
    }
  }

  if (type === "FinanceSnapshot") {
    if (rec.provider_mutations !== "forbidden") {
      errors.push(
        issue(
          "/provider_mutations",
          "provider_mutations must be forbidden; financial provider writes are not in this ontology",
          "provider_mutations",
        ),
      );
    }
    collectNonIntegerCents(rec, "", errors);
    const cashIn = asRecord(rec.cash_in);
    if (cashIn !== null && cashIn.evidenced !== true) {
      errors.push(
        issue("/cash_in", "cash_in may appear only when settlement is evidenced", "cash_in_evidence"),
      );
    }
    const mrr = asRecord(rec.mrr);
    if (mrr !== null && (mrr.applicable !== true || mrr.basis !== "recurring_monthly")) {
      errors.push(
        issue("/mrr", "mrr may appear only when recurring monthly billing is applicable", "mrr_applicable"),
      );
    }
    const runway = asRecord(rec.runway);
    if (runway !== null && (runway.cash_reliable !== true || runway.expense_reliable !== true)) {
      errors.push(
        issue(
          "/runway",
          "runway may appear only when cash balance and expense are reliable",
          "runway_reliable",
        ),
      );
    }
  }

  if (type === "CommercialSnapshot") {
    for (const key of Object.keys(rec)) {
      if (CATALOG_COPY_KEYS.has(key)) {
        errors.push(
          issue(
            `/${key}`,
            "CommercialSnapshot must pin Governance catalog identity and MUST NOT copy the offer catalog",
            "catalog_copy",
          ),
        );
      }
    }
    const pin = asRecord(rec.offer_pin);
    if (pin !== null) {
      for (const key of CATALOG_COPY_KEYS) {
        if (key in pin) {
          errors.push(
            issue(
              `/offer_pin/${key}`,
              "offer_pin is identity-only; names, prices, terms, and copied offers are forbidden",
              "catalog_copy",
            ),
          );
        }
      }
      if ("known_offers" in pin) {
        errors.push(
          issue(
            "/offer_pin/known_offers",
            "pin known_offer_ids (strings) only; do not copy offer objects",
            "catalog_copy",
          ),
        );
      }
    }
    const weighted = asRecord(rec.pipeline_weighted);
    if (weighted !== null && weighted.probability_reliable !== true) {
      errors.push(
        issue(
          "/pipeline_weighted",
          "pipeline_weighted may appear only with reliable probability",
          "probability_reliable",
        ),
      );
    }
  }

  if (type === "AgentSession") {
    const requested = rec.requested_scopes;
    const granted = rec.granted_scopes;
    const status = stringField(rec, "status");
    if (!Array.isArray(requested) || requested.length < 1) {
      errors.push(
        issue(
          "/requested_scopes",
          "agents MUST request at least one scope; whole-company dump is forbidden",
          "scope_query",
        ),
      );
    }
    if (Array.isArray(requested) && Array.isArray(granted)) {
      const req = new Set(requested.filter((s): s is string => typeof s === "string"));
      for (const [i, scope] of granted.entries()) {
        if (typeof scope === "string" && !req.has(scope)) {
          errors.push(
            issue(
              `/granted_scopes/${i}`,
              "granted scope is not in requested_scopes (fail-closed)",
              "granted_subset",
            ),
          );
        }
      }
      if (status === "open" && granted.length === 0) {
        errors.push(
          issue("/granted_scopes", "open session must grant at least one requested scope", "grant"),
        );
      }
    }
  }

  if (type === "OperationalSnapshot") {
    const priorities = rec.top_priorities;
    if (Array.isArray(priorities)) {
      if (priorities.length > HOMEPAGE_PRIORITY_LIMIT) {
        errors.push(
          issue(
            "/top_priorities",
            `homepage roll-up allows at most ${HOMEPAGE_PRIORITY_LIMIT} priorities`,
            "homepage",
          ),
        );
      }
      const ranks = new Set<number>();
      for (const [i, item] of priorities.entries()) {
        const p = asRecord(item);
        if (p === null) {
          continue;
        }
        const rank = p.rank;
        if (typeof rank === "number") {
          if (ranks.has(rank)) {
            errors.push(issue(`/top_priorities/${i}/rank`, "duplicate rank", "unique_rank"));
          }
          ranks.add(rank);
        }
      }
    }
  }

  if (type === "SourceObservation" || typeHasProvenance(type)) {
    const provenance = asRecord(rec.provenance);
    if (provenance !== null) {
      if (!("freshness_status" in provenance)) {
        errors.push(issue("/provenance/freshness_status", "freshness_status is required", "required"));
      }
      if (!("confidence" in provenance)) {
        errors.push(issue("/provenance/confidence", "confidence is required and distinct from freshness", "required"));
      }
      if (!("source" in provenance) || !("observed_at" in provenance)) {
        errors.push(issue("/provenance", "source and observed_at are required", "required"));
      }
    }
  }

  return errors;
}

const PROVENANCE_TYPES = new Set<ResourceTypeName>([
  "OperationalSnapshot",
  "SourceObservation",
  "AttentionItem",
  "PriorityRecommendation",
  "AgentActivity",
  "ClientStatus",
  "CommercialSnapshot",
  "FinanceSnapshot",
  "EngineeringSnapshot",
  "ServiceHealth",
]);

const CATALOG_COPY_KEYS = new Set([
  "catalog",
  "offers",
  "products",
  "prices",
  "terms",
  "offer_catalog",
  "price_list",
  "copy",
  "skus",
]);

function collectNonIntegerCents(
  value: unknown,
  pathExpr: string,
  acc: ValidationIssue[],
): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => collectNonIntegerCents(item, `${pathExpr}/${i}`, acc));
    return;
  }
  const rec = asRecord(value);
  if (rec === null) {
    return;
  }
  if ("amount_cents" in rec) {
    const cents = rec.amount_cents;
    if (typeof cents !== "number" || !Number.isInteger(cents)) {
      acc.push(
        issue(
          `${pathExpr}/amount_cents`,
          "money amount_cents must be an integer (centavos); floats are invalid",
          "integer_cents",
        ),
      );
    }
  }
  for (const [key, child] of Object.entries(rec)) {
    collectNonIntegerCents(child, `${pathExpr}/${key}`, acc);
  }
}

function typeHasProvenance(type: ResourceTypeName): boolean {
  return PROVENANCE_TYPES.has(type);
}

function ajvIssues(errors: AjvError[] | null | undefined): ValidationIssue[] {
  if (!errors) {
    return [];
  }
  return errors.map((err) =>
    issue(err.instancePath === "" ? "/" : err.instancePath, err.message ?? "invalid", err.keyword),
  );
}

export function listResourceTypes(): ResourceTypeName[] {
  return [...RESOURCE_TYPE_NAMES];
}

export function validate(type: ResourceTypeName, data: unknown): ValidationResult {
  const ajv = getAjv();
  const schemaId = schemaIdFor(type);
  const validateFn = ajv.getSchema(schemaId);
  if (validateFn === undefined) {
    throw new Error(`schema not registered: ${schemaId}`);
  }
  const schemaOk = validateFn(data) === true;
  const errors = [...ajvIssues(validateFn.errors), ...semanticChecks(type, data)];
  const compat = classifyCompatibility(data);
  if (compat.verdict !== "canonical") {
    for (const finding of compat.findings) {
      errors.push(
        issue(
          finding.path,
          `${finding.verdict}: ${finding.message}`,
          "compatibility",
        ),
      );
    }
  }
  const rec = asRecord(data);
  const schema_version = rec !== null ? stringField(rec, "schema_version") : undefined;
  const unique = dedupeIssues(errors);
  return {
    ok: schemaOk && unique.length === 0,
    type,
    schema_version,
    errors: unique,
  };
}

export function validateUnknown(data: unknown): ValidationResult {
  const rec = asRecord(data);
  if (rec === null) {
    return {
      ok: false,
      type: "unknown",
      errors: [issue("", "document must be an object", "type")],
    };
  }
  const version = stringField(rec, "schema_version");
  if (version === undefined) {
    const compat = classifyCompatibility(data);
    const errors = [issue("/schema_version", "schema_version is required to infer type", "required")];
    if (compat.verdict !== "canonical") {
      for (const finding of compat.findings) {
        errors.push(issue(finding.path, `${finding.verdict}: ${finding.message}`, "compatibility"));
      }
    }
    return {
      ok: false,
      type: "unknown",
      errors: dedupeIssues(errors),
    };
  }
  const type = schemaVersionToType(version);
  if (type === undefined) {
    const compat = classifyCompatibility(data);
    const errors = [
      issue("/schema_version", `unsupported schema_version '${version}'`, "schema_version"),
    ];
    if (compat.verdict !== "canonical") {
      for (const finding of compat.findings) {
        errors.push(issue(finding.path, `${finding.verdict}: ${finding.message}`, "compatibility"));
      }
    }
    return {
      ok: false,
      type: "unknown",
      schema_version: version,
      errors: dedupeIssues(errors),
    };
  }
  return validate(type, data);
}

export function validateFile(type: ResourceTypeName | undefined, filePath: string): ValidationResult {
  const raw = readFileSync(filePath, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (type === undefined) {
    return validateUnknown(parsed);
  }
  return validate(type, parsed);
}

function dedupeIssues(issues: ValidationIssue[]): ValidationIssue[] {
  const seen = new Set<string>();
  const out: ValidationIssue[] = [];
  for (const item of issues) {
    const key = `${item.path}|${item.message}|${item.keyword ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function catalogFixturePath(kind: "valid" | "invalid", type: ResourceTypeName): string {
  const row = catalogType(type);
  const rel = kind === "valid" ? row.valid_fixture : row.invalid_fixture;
  return path.join(packageRoot(), rel);
}

export { loadCatalog };
