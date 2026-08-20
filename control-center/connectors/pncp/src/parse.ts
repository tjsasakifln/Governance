import { z } from "zod";
import {
  CONTRACT_VERSION,
  UPSTREAM_STATUSES,
  type ErrorObject,
  type ParseResult,
  type PncpContractV1,
  type UpstreamStatus,
} from "./types.js";

const UTC_Z =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})?Z$/;

const SECRET_KEY =
  /secret|token|password|authorization|api[_-]?key|cookie|credential|private[_-]?key|dsn/i;

function fail(
  code: string,
  message: string,
  contract_version: string | null = null,
): ParseResult {
  const error: ErrorObject = { code, message };
  return { ok: false, error, contract_version };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

export function toUtcZ(value: unknown): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    return null;
  }
  if (UTC_Z.test(trimmed)) {
    return trimmed;
  }
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return new Date(parsed).toISOString();
}

function optionalUtc(value: unknown): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  return toUtcZ(value);
}

function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function optionalInt(value: unknown): number | null {
  const n = optionalNumber(value);
  if (n === null) {
    return null;
  }
  return Math.trunc(n);
}

function optionalString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  return null;
}

function optionalObject(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  return stripSecretKeys(record);
}

export function stripSecretKeys(
  record: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (SECRET_KEY.test(key)) {
      continue;
    }
    out[key] = value;
  }
  return out;
}

const ReasonCodesSchema = z.array(z.string());
const UpstreamStatusSchema = z.enum(UPSTREAM_STATUSES);

function readContractVersion(record: Record<string, unknown>): {
  version: string | null;
  kind: "ok" | "missing" | "unknown";
} {
  const raw = record.contract_version;
  if (raw === undefined || raw === null || raw === "") {
    return { version: null, kind: "missing" };
  }
  if (typeof raw !== "string") {
    return { version: String(raw), kind: "unknown" };
  }
  const version = raw.trim();
  if (version === CONTRACT_VERSION) {
    return { version, kind: "ok" };
  }
  return { version, kind: "unknown" };
}

/**
 * Versioned parser of extra-cli PNCP_CONTRACT_FRESHNESS/1.0.
 * Unknown/unsupported contract_version and malformed payloads fail closed.
 * Does not classify lag, windows, or errors.
 */
export function parsePncpContract(payload: unknown): ParseResult {
  const record = asRecord(payload);
  if (!record) {
    return fail("MALFORMED_PAYLOAD", "payload is not a JSON object");
  }

  const versionInfo = readContractVersion(record);
  if (versionInfo.kind === "missing") {
    return fail("MALFORMED_PAYLOAD", "missing contract_version", null);
  }
  if (versionInfo.kind === "unknown") {
    return fail(
      "UNKNOWN_CONTRACT_VERSION",
      `unsupported contract_version ${versionInfo.version ?? "<unreadable>"}`,
      versionInfo.version,
    );
  }

  const statusRaw = record.status;
  const statusParsed = UpstreamStatusSchema.safeParse(statusRaw);
  if (!statusParsed.success) {
    return fail(
      "MALFORMED_PAYLOAD",
      "status must be FRESH|DEGRADED|STALE|UNKNOWN",
      CONTRACT_VERSION,
    );
  }

  const reasonsParsed = ReasonCodesSchema.safeParse(record.reason_codes);
  if (!reasonsParsed.success) {
    return fail(
      "MALFORMED_PAYLOAD",
      "reason_codes must be an array of strings",
      CONTRACT_VERSION,
    );
  }

  const asOf = toUtcZ(record.as_of);
  if (!asOf) {
    return fail(
      "MALFORMED_PAYLOAD",
      "as_of is missing or not a parseable UTC timestamp",
      CONTRACT_VERSION,
    );
  }

  const contract: PncpContractV1 = {
    contract_version: CONTRACT_VERSION,
    status: statusParsed.data,
    reason_codes: [...reasonsParsed.data],
    as_of: asOf,
    deployed_sha: optionalString(record.deployed_sha),
    policy_version: optionalString(record.policy_version),
    current_lag_hours: optionalNumber(record.current_lag_hours),
    lag_p50_hours: optionalNumber(record.lag_p50_hours),
    lag_p95_hours: optionalNumber(record.lag_p95_hours),
    lag_p99_hours: optionalNumber(record.lag_p99_hours),
    lag_sample_n: optionalInt(record.lag_sample_n),
    source_publication_or_update_at: optionalUtc(
      record.source_publication_or_update_at,
    ),
    first_observed_at: optionalUtc(record.first_observed_at),
    persisted_at: optionalUtc(record.persisted_at),
    last_run_at: optionalUtc(record.last_run_at),
    next_run_at: optionalUtc(record.next_run_at),
    latest_successful_closed_window: optionalString(
      record.latest_successful_closed_window,
    ),
    oldest_unresolved_gap: optionalString(record.oldest_unresolved_gap),
    unresolved_window_count: optionalInt(record.unresolved_window_count),
    source_window: record.source_window ?? null,
    slo: optionalObject(record.slo),
    timer: optionalObject(record.timer),
    health_exit: optionalInt(record.health_exit),
    campaign_verdict_hint: optionalString(record.campaign_verdict_hint),
  };

  return { ok: true, contract };
}

export function parsePncpContractText(text: string): ParseResult {
  let payload: unknown;
  try {
    payload = JSON.parse(text) as unknown;
  } catch {
    return fail("INVALID_JSON", "payload is not valid JSON");
  }
  return parsePncpContract(payload);
}

export function isUpstreamStatus(value: unknown): value is UpstreamStatus {
  return (
    typeof value === "string" &&
    (UPSTREAM_STATUSES as readonly string[]).includes(value)
  );
}
