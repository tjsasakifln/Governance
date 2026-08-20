import {
  PNCP_SOURCE_ID,
  SCHEMA_VERSION,
  type CredentialStatus,
  type MetricsSourceKind,
  type PncpMetricsSnapshot,
} from "./types.js";

const CREDENTIAL_ERROR_CODES = new Set([
  "credential_unavailable",
  "unauthorized",
  "forbidden",
  "auth_failed",
  "401",
  "403",
]);

function firstDefined(
  record: Record<string, unknown>,
  keys: string[],
): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      const value = record[key];
      if (value !== undefined) {
        return value;
      }
    }
  }
  return undefined;
}

export function parseInstant(value: unknown): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return null;
    }
    return value.toISOString();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value < 1e12 ? value * 1000 : value;
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return date.toISOString();
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (
      trimmed === "" ||
      trimmed.toLowerCase() === "never" ||
      trimmed.toLowerCase() === "null"
    ) {
      return null;
    }
    const date = new Date(trimmed);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return date.toISOString();
  }
  return null;
}

export function parseCount(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed);
    }
  }
  return null;
}

export function isCredentialErrorCode(code: string | null): boolean {
  if (!code) {
    return false;
  }
  return CREDENTIAL_ERROR_CODES.has(code.trim().toLowerCase());
}

function parseCredentialStatus(value: unknown, errorCode: string | null): CredentialStatus {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "unavailable" || normalized === "missing") {
      return "unavailable";
    }
    if (normalized === "available" || normalized === "ok") {
      return "available";
    }
  }
  if (isCredentialErrorCode(errorCode)) {
    return "unavailable";
  }
  return "unknown";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

/**
 * Pull a PNCP metrics record from API, DB-view, extra-cli freshness-gate, or
 * Control Center health-artifact envelopes. Does not classify.
 */
export function extractMetricsRecord(payload: unknown): Record<string, unknown> {
  const root = asRecord(payload);
  if (!root) {
    return {};
  }

  const nestedMetrics = asRecord(root.metrics);
  if (nestedMetrics) {
    return nestedMetrics;
  }

  const critical = root.critical_sources;
  if (Array.isArray(critical)) {
    const pncpRow = critical.find((row) => {
      const rec = asRecord(row);
      if (!rec) {
        return false;
      }
      const source = String(rec.source ?? rec.source_name ?? rec.data_source ?? "")
        .trim()
        .toLowerCase();
      return source === "pncp" || source === "pncp_raw_bids" || source === "";
    });
    const rec = asRecord(pncpRow) ?? asRecord(critical[0]);
    if (rec) {
      return rec;
    }
  }

  return root;
}

export function artifactEvaluatedAt(payload: unknown): string | null {
  const root = asRecord(payload);
  if (!root) {
    return null;
  }
  return parseInstant(firstDefined(root, ["evaluated_at", "evaluatedAt", "generated_at", "now"]));
}

function computeLagSeconds(
  explicit: number | null,
  dataTimestamp: string | null,
  now: Date,
): number | null {
  if (explicit !== null) {
    return explicit < 0 ? 0 : explicit;
  }
  if (!dataTimestamp) {
    return null;
  }
  const parsed = Date.parse(dataTimestamp);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return Math.max(0, Math.floor((now.getTime() - parsed) / 1000));
}

function coreFieldsPresent(snapshot: {
  last_item_observed_at: string | null;
  last_success_at: string | null;
  source_max_timestamp: string | null;
  recent_window_count: number | null;
  consecutive_errors: number | null;
}): boolean {
  const hasDataTs = Boolean(snapshot.last_item_observed_at || snapshot.source_max_timestamp);
  return (
    hasDataTs &&
    snapshot.last_success_at !== null &&
    snapshot.recent_window_count !== null &&
    snapshot.consecutive_errors !== null
  );
}

export interface ParseContext {
  sourceKind: MetricsSourceKind;
  now: Date;
  readError?: string | null;
  rawSource?: string | null;
}

export function parseMetricsPayload(
  payload: unknown,
  context: ParseContext,
): PncpMetricsSnapshot {
  const record = extractMetricsRecord(payload);
  const errorCodeRaw = firstDefined(record, ["error_code", "errorCode", "failure_code"]);
  const errorCode =
    typeof errorCodeRaw === "string" && errorCodeRaw.trim() !== ""
      ? errorCodeRaw.trim()
      : errorCodeRaw === null || errorCodeRaw === undefined
        ? null
        : String(errorCodeRaw);

  const lastItem = parseInstant(
    firstDefined(record, [
      "last_item_observed_at",
      "lastItemObservedAt",
      "last_ingested_at",
      "lastIngestedAt",
    ]),
  );
  const lastSuccess = parseInstant(
    firstDefined(record, ["last_success_at", "lastSuccessAt"]),
  );
  const sourceMax = parseInstant(
    firstDefined(record, [
      "source_max_timestamp",
      "sourceMaxTimestamp",
      "latest_business_date",
      "latestBusinessDate",
      "max_timestamp",
    ]),
  );
  const heartbeat = parseInstant(
    firstDefined(record, [
      "collector_heartbeat_at",
      "collectorHeartbeatAt",
      "heartbeat_at",
    ]),
  );
  const recentWindow = parseCount(
    firstDefined(record, [
      "recent_window_count",
      "recentWindowCount",
      "recent_records",
      "recentRecords",
    ]),
  );
  const consecutive = parseCount(
    firstDefined(record, [
      "consecutive_errors",
      "consecutiveErrors",
      "consecutive_failures",
    ]),
  );
  const explicitLag = parseCount(
    firstDefined(record, ["lag_seconds", "lagSeconds", "lag"]),
  );
  const credentialStatus = parseCredentialStatus(
    firstDefined(record, ["credential_status", "credentialStatus"]),
    errorCode,
  );
  const rawSourceValue = firstDefined(record, ["source", "source_name", "raw_source"]);
  const rawSource =
    typeof rawSourceValue === "string" && rawSourceValue.trim() !== ""
      ? rawSourceValue.trim()
      : context.rawSource ?? null;

  const dataTs = sourceMax ?? lastItem;
  const lag = computeLagSeconds(explicitLag, dataTs, context.now);

  const snapshot: PncpMetricsSnapshot = {
    schema_version: SCHEMA_VERSION,
    source: PNCP_SOURCE_ID,
    source_kind: context.sourceKind,
    raw_source: rawSource,
    observed_at: context.now.toISOString(),
    last_item_observed_at: lastItem,
    last_success_at: lastSuccess,
    lag_seconds: lag,
    recent_window_count: recentWindow,
    consecutive_errors: consecutive,
    source_max_timestamp: sourceMax,
    collector_heartbeat_at: heartbeat,
    credential_status: credentialStatus,
    error_code: errorCode,
    read_error: context.readError ?? null,
    raw_complete: false,
  };
  snapshot.raw_complete = coreFieldsPresent(snapshot) && snapshot.read_error === null;
  return snapshot;
}

export function emptySnapshot(
  context: ParseContext,
): PncpMetricsSnapshot {
  return parseMetricsPayload({}, context);
}
