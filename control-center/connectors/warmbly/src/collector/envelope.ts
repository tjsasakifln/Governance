/**
 * Explicit Warmbly success-body normalization.
 *
 * Current Warmbly intel handlers return gin.H{"data": payload}:
 *   GET /v1/confenge/intel/scoreboard          → {"data": Scoreboard}
 *   GET /v1/confenge/intel/executive           → {"data": ExecutiveView}
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

  const rawLooksValid =
    surface === "intel_exceptions"
      ? looksLikeExceptions(json)
      : surface === "intel_scoreboard"
        ? looksLikeScoreboard(json)
        : surface === "intel_executive"
          ? looksLikeExecutive(json)
          : looksLikeOrganic(json);

  if (isPlainObject(json) && Object.prototype.hasOwnProperty.call(json, "data")) {
    const unwrapped = innerFromDataWrapper(json);
    if (!unwrapped.ok) return unwrapped;
    const inner = unwrapped.value;
    const innerValid =
      surface === "intel_exceptions"
        ? looksLikeExceptions(inner)
        : surface === "intel_scoreboard"
          ? looksLikeScoreboard(inner)
          : surface === "intel_executive"
            ? looksLikeExecutive(inner)
            : looksLikeOrganic(inner);
    if (!innerValid) {
      return drift(`unwrapped data is not a ${surface} payload`);
    }
    return { ok: true, value: inner };
  }

  if (rawLooksValid) {
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
    case "confenge_intel_exceptions":
      return "intel_exceptions";
    case "confenge_intel_organic_scoreboard":
      return "intel_organic_scoreboard";
    default:
      return null;
  }
}
