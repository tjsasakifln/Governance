import { readFileSync } from "node:fs";
import path from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { packageRoot } from "./paths.js";

export const OPERATIONAL_ENVELOPE_SCHEMA_VERSION =
  "control-center.operational-envelope.v1" as const;

export const OPERATIONAL_DOMAIN_SCHEMA_VERSION =
  "control-center.operational-domain.v1" as const;

export const OPERATIONAL_DOMAINS = [
  "commercial",
  "finance",
  "clients",
  "engineering",
  "infrastructure",
  "pncp",
] as const;

export type OperationalDomain = (typeof OPERATIONAL_DOMAINS)[number];

export const ABSENCE_REASONS = ["no_data", "not_configured", "upstream_error"] as const;
export type AbsenceReason = (typeof ABSENCE_REASONS)[number];

export const OPERATIONAL_HTTP_PATHS = [
  "/v1/operational-snapshots",
  "/v1/domains/{domain}",
  "/v1/attention",
  "/v1/today",
  "/v1/source-observations",
] as const;

export const OPERATIONAL_VIEWS = {
  collectorRuns: "control_center.v_latest_collector_runs",
  sourceObservations: "control_center.v_latest_source_observations",
  operationalSnapshots: "control_center.v_latest_operational_snapshots",
} as const;

export interface ValidationIssue {
  path: string;
  message: string;
  keyword?: string;
}

export interface EnvelopeValidationResult {
  ok: boolean;
  schema_version?: string;
  errors: ValidationIssue[];
}

const SCHEMA_ID =
  "https://github.com/tjsasakifln/Governance/control-center/contracts/schemas/operational-envelope.v1.schema.json";

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
  ajv.addSchema(loadJson("schemas/primitives.v1.schema.json"));
  ajv.addSchema(loadJson("schemas/operational-envelope.v1.schema.json"));
  ajvSingleton = ajv;
  return ajv;
}

function issuesFrom(errors: ReadonlyArray<{ instancePath?: string; message?: string; keyword?: string }> | null | undefined): ValidationIssue[] {
  if (!errors) {
    return [];
  }
  return errors.map((err) => ({
    path: err.instancePath && err.instancePath.length > 0 ? err.instancePath : "/",
    message: err.message ?? "invalid",
    keyword: err.keyword,
  }));
}

function validateAgainst(schemaRef: string, value: unknown): EnvelopeValidationResult {
  const validate = getAjv().getSchema(schemaRef);
  if (!validate) {
    throw new Error(`schema not registered: ${schemaRef}`);
  }
  const ok = validate(value) === true;
  const rec = value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    ok,
    schema_version: typeof rec.schema_version === "string" ? rec.schema_version : undefined,
    errors: ok ? [] : issuesFrom(validate.errors),
  };
}

export function validateOperationalEnvelope(value: unknown): EnvelopeValidationResult {
  return validateAgainst(SCHEMA_ID, value);
}

export function validateOperationalDomainResponse(value: unknown): EnvelopeValidationResult {
  return validateAgainst(`${SCHEMA_ID}#/$defs/domain_query_response`, value);
}

export function validateOperationalAttentionResponse(value: unknown): EnvelopeValidationResult {
  return validateAgainst(`${SCHEMA_ID}#/$defs/attention_query_response`, value);
}

export function validateOperationalTodayResponse(value: unknown): EnvelopeValidationResult {
  return validateAgainst(`${SCHEMA_ID}#/$defs/today_query_response`, value);
}

export function validateOperationalObservationsResponse(value: unknown): EnvelopeValidationResult {
  return validateAgainst(`${SCHEMA_ID}#/$defs/observations_query_response`, value);
}

export function isOperationalDomain(value: unknown): value is OperationalDomain {
  return typeof value === "string" && (OPERATIONAL_DOMAINS as readonly string[]).includes(value);
}

export function loadOperationalOpenApi(): {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, unknown>;
} {
  const parsed: unknown = JSON.parse(
    readFileSync(path.join(packageRoot(), "docs/operational-http.openapi.json"), "utf8"),
  );
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("docs/operational-http.openapi.json is malformed");
  }
  return parsed as {
    openapi: string;
    info: { title: string; version: string };
    paths: Record<string, unknown>;
  };
}

export function operationalEnvelopeValidFixture(): unknown {
  return JSON.parse(
    readFileSync(path.join(packageRoot(), "docs/operational-envelope.valid.json"), "utf8"),
  );
}

export function operationalEnvelopeInvalidFixture(): unknown {
  return JSON.parse(
    readFileSync(path.join(packageRoot(), "docs/operational-envelope.invalid.json"), "utf8"),
  );
}
