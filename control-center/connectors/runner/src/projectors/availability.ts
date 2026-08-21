import {
  AVAILABILITY,
  type Availability,
  type CollectorEnvelope,
  type FreshnessStatus,
} from "./types.ts";

const SECRET_CODES = [
  "BLOCKED_BY_SECRET",
  "MISSING_CREDENTIALS",
  "CREDENTIAL_MISSING",
  "MISSING_SECRET",
];
const CONFIG_CODES = ["NOT_CONFIGURED", "UNCONFIGURED", "INVALID_CONFIG", "MISSING_ALLOWLIST"];

function upper(code: string | undefined): string {
  return (code ?? "").trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
}

export function availabilityFromEnvelope(envelope: CollectorEnvelope): Availability {
  const code = upper(envelope.error?.code);
  if (SECRET_CODES.includes(code) || code.includes("SECRET") || code.includes("CREDENTIAL")) {
    return "BLOCKED_BY_SECRET";
  }
  if (CONFIG_CODES.includes(code) || code.includes("NOT_CONFIGURED") || code.includes("UNCONFIGURED")) {
    return "NOT_CONFIGURED";
  }
  if (envelope.freshness_status === "ERROR" || code === "UPSTREAM_ERROR" || code === "COLLECT_FAILED") {
    return "UPSTREAM_ERROR";
  }
  if (envelope.freshness_status === "STALE") {
    return "STALE";
  }
  if (envelope.freshness_status === "UNKNOWN") {
    return "UNKNOWN";
  }
  if (envelope.freshness_status === "FRESH") {
    return "FRESH";
  }
  return "UNKNOWN";
}

export function freshnessForAvailability(
  availability: Availability,
  collected: FreshnessStatus,
): FreshnessStatus {
  if (availability === "UPSTREAM_ERROR") return "ERROR";
  if (availability === "STALE") return "STALE";
  if (availability === "FRESH") return collected === "FRESH" ? "FRESH" : collected;
  if (availability === "BLOCKED_BY_SECRET" || availability === "NOT_CONFIGURED" || availability === "NO_DATA") {
    return collected === "ERROR" ? "ERROR" : "UNKNOWN";
  }
  return collected;
}

export function isAvailability(value: unknown): value is Availability {
  return typeof value === "string" && (AVAILABILITY as readonly string[]).includes(value);
}

export function neverPaintGreen(availability: Availability, freshness: FreshnessStatus): boolean {
  return availability === "FRESH" && freshness === "FRESH";
}
