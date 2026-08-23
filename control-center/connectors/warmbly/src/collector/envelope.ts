/**
 * Explicit Warmbly success-body normalization.
 *
 * Current Warmbly intel handlers return gin.H{"data": payload}:
 *   GET /v1/confenge/intel/scoreboard          → {"data": Scoreboard}
 *   GET /v1/confenge/intel/executive           → {"data": ExecutiveView}
 *   GET /v1/confenge/intel/report              → {"data": ObservabilityReport}
 *   GET /v1/confenge/intel/exceptions          → {"data": []Exception}
 *   GET /v1/confenge/intel/organic-scoreboard  → {"data": OrganicScoreboard}
 *
 * This helper unwraps `{data: ...}` only for those contracts. A raw object that
 * already is the payload (identifying keys, no wrapper) is preserved. Malformed
 * success bodies are CONTRACT_DRIFT — never guessed into an empty configured
 * scoreboard.
 */

export type IntelSurface =
  | "intel_scoreboard"
  | "intel_executive"
  | "intel_report"
  | "intel_exceptions"
  | "intel_organic_scoreboard";

export type EnvelopeOk = { ok: true; value: unknown };
export type EnvelopeDrift = { ok: false; code: "CONTRACT_DRIFT"; reason: string };
export type EnvelopeResult = EnvelopeOk | EnvelopeDrift;

const SCOREBOARD_KEYS = ["schema_version", "schema", "stages", "separate_metrics", "production_path"] as const;
const EXECUTIVE_KEYS = [
  "schema_version",
  "schema",
  "month",
  "qco",
  "families",
  "inbound_qualified_pipeline",
  "generated_at",
] as const;
const REPORT_KEYS = ["schema_version", "month", "controlled_email", "real_empty"] as const;
const REAL_EXECUTIVE_SCHEMA = "confenge.commercial_intel.v1";
// Producer-owned contract: Warmbly's report type exposes this exact schema.
// Keep the consumer strict, but never validate against a consumer-invented name.
const REAL_REPORT_SCHEMA = "confenge.inbound_learning_report.v1";
const ORGANIC_KEYS = ["schema_version", "windows", "sources", "recommendation", "generated_at"] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasAnyKey(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.some((key) => value[key] !== undefined);
}

function drift(reason: string): EnvelopeDrift {
  return { ok: false, code: "CONTRACT_DRIFT", reason };
}

function looksLikeScoreboard(value: unknown): value is Record<string, unknown> {
  return isPlainObject(value) && hasAnyKey(value, SCOREBOARD_KEYS);
}

function looksLikeExecutive(value: unknown): value is Record<string, unknown> {
  return isPlainObject(value) && hasAnyKey(value, EXECUTIVE_KEYS);
}

function looksLikeReport(value: unknown): value is Record<string, unknown> {
  return isPlainObject(value) && hasAnyKey(value, REPORT_KEYS);
}

function validForSurface(value: unknown, surface: IntelSurface): boolean {
  switch (surface) {
    case "intel_exceptions":
      return looksLikeExceptions(value);
    case "intel_scoreboard":
      return looksLikeScoreboard(value);
    case "intel_executive":
      return looksLikeExecutive(value);
    case "intel_report":
      return looksLikeReport(value);
    case "intel_organic_scoreboard":
      return looksLikeOrganic(value);
  }
}

export function realIntelReportDriftReason(value: unknown): string | null {
  if (!isPlainObject(value)) return "intel_report payload is not an object";
  if (value.schema_version !== REAL_REPORT_SCHEMA) {
    return `intel_report schema_version is not ${REAL_REPORT_SCHEMA}`;
  }
  if (value.include_synthetic !== false) {
    return "intel_report does not prove include_synthetic=false";
  }
  if (typeof value.real_empty !== "boolean") {
    return "intel_report real_empty is not boolean";
  }
  if (!Array.isArray(value.controlled_email)) {
    return "intel_report controlled_email is not an array";
  }
  if (value.controlled_email.some((row) => !isPlainObject(row))) {
    return "intel_report controlled_email contains a non-object row";
  }
  if (value.real_empty && value.controlled_email.length > 0) {
    return "intel_report declares real_empty with controlled_email rows";
  }
  return null;
}

/**
 * The collector always requests the real-only executive view. Validate the
 * producer-owned discriminator and proof flags before its facts can reach a
 * persisted read model.
 */
export function realIntelExecutiveDriftReason(value: unknown): string | null {
  if (!isPlainObject(value)) return "intel_executive payload is not an object";
  if (value.schema_version !== REAL_EXECUTIVE_SCHEMA) {
    return `intel_executive schema_version is not ${REAL_EXECUTIVE_SCHEMA}`;
  }
  if (value.include_synthetic !== false) {
    return "intel_executive does not prove include_synthetic=false";
  }
  if (typeof value.month !== "string" || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(value.month)) {
    return "intel_executive month is not YYYY-MM";
  }
  if (value.causal_proof !== false) {
    return "intel_executive does not prove causal_proof=false";
  }
  if (typeof value.real_empty !== "boolean") {
    return "intel_executive real_empty is not boolean";
  }
  if (value.weekly_revenue_chains !== undefined) {
    if (!Array.isArray(value.weekly_revenue_chains)) {
      return "intel_executive weekly_revenue_chains is not an array";
    }
    if (value.weekly_revenue_chains.some((row) => !isPlainObject(row))) {
      return "intel_executive weekly_revenue_chains contains a non-object row";
    }
    if (value.weekly_revenue_chains.some((row) => row.synthetic !== false)) {
      return "intel_executive real-only response contains an unproven or synthetic weekly revenue chain";
    }
    if (value.real_empty && value.weekly_revenue_chains.length > 0) {
      return "intel_executive declares real_empty with weekly revenue chains";
    }
  }
  return null;
}

function validateRealReport(value: unknown): EnvelopeDrift | null {
  const reason = realIntelReportDriftReason(value);
  return reason ? drift(reason) : null;
}

function validateRealExecutive(value: unknown): EnvelopeDrift | null {
  const reason = realIntelExecutiveDriftReason(value);
  return reason ? drift(reason) : null;
}

function looksLikeOrganic(value: unknown): value is Record<string, unknown> {
  return isPlainObject(value) && hasAnyKey(value, ORGANIC_KEYS);
}

function looksLikeExceptions(value: unknown): boolean {
  if (Array.isArray(value)) return true;
  if (!isPlainObject(value)) return false;
  return Array.isArray(value.items) || Array.isArray(value.exceptions);
}

function innerFromDataWrapper(json: Record<string, unknown>): EnvelopeResult {
  if (!Object.prototype.hasOwnProperty.call(json, "data")) {
    return drift("success body is not a data envelope and is not the raw payload");
  }
  const inner = json.data;
  if (inner === null || inner === undefined) {
    return drift("malformed success envelope: data is null");
  }
  return { ok: true, value: inner };
}

/**
 * Normalize a 2xx Warmbly intel body.
 *
 * Unwrap `{data: payload}` when that is the contract. Preserve a raw payload
 * object/array that already matches the surface. Do not treat `{data: null}`
 * or an unrelated object as configured data.
 */
export function normalizeIntelEnvelope(json: unknown, surface: IntelSurface): EnvelopeResult {
  if (json === null || json === undefined) {
    return drift("empty success body");
  }

  const rawLooksValid = validForSurface(json, surface);

  if (isPlainObject(json) && Object.prototype.hasOwnProperty.call(json, "data")) {
    const unwrapped = innerFromDataWrapper(json);
    if (!unwrapped.ok) return unwrapped;
    const inner = unwrapped.value;
    const innerValid = validForSurface(inner, surface);
    if (!innerValid) {
      return drift(`unwrapped data is not a ${surface} payload`);
    }
    if (surface === "intel_report") {
      const reportDrift = validateRealReport(inner);
      if (reportDrift) return reportDrift;
    }
    if (surface === "intel_executive") {
      const executiveDrift = validateRealExecutive(inner);
      if (executiveDrift) return executiveDrift;
    }
    return { ok: true, value: inner };
  }

  if (rawLooksValid) {
    if (surface === "intel_report") {
      const reportDrift = validateRealReport(json);
      if (reportDrift) return reportDrift;
    }
    if (surface === "intel_executive") {
      const executiveDrift = validateRealExecutive(json);
      if (executiveDrift) return executiveDrift;
    }
    return { ok: true, value: json };
  }

  return drift(`unrelated success object is not a ${surface} payload`);
}

export function intelSurfaceForRouteKey(
  key: string,
): IntelSurface | null {
  switch (key) {
    case "confenge_intel_scoreboard":
      return "intel_scoreboard";
    case "confenge_intel_executive":
      return "intel_executive";
    case "confenge_intel_report":
      return "intel_report";
    case "confenge_intel_exceptions":
      return "intel_exceptions";
    case "confenge_intel_organic_scoreboard":
      return "intel_organic_scoreboard";
    default:
      return null;
  }
}
