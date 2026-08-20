/**
 * Control Center adapter of extra-cli PNCP_CONTRACT_FRESHNESS/1.0.
 * Canonical ServiceHealth / SourceObservation shapes are emitted here
 * (sibling branch cc/01-architecture-contracts is not imported).
 */

export const CONTRACT_VERSION = "PNCP_CONTRACT_FRESHNESS/1.0" as const;

export const SERVICE_HEALTH_SCHEMA =
  "control-center.service-health.v1" as const;
export const SOURCE_OBSERVATION_SCHEMA =
  "control-center.source-observation.v1" as const;

export const PNCP_SCOPE = "infrastructure" as const;
export const PNCP_SERVICE_NAME = "pncp-contracts" as const;
export const PNCP_SERVICE_HEALTH_ID = "cc:service-health:pncp-contracts" as const;
export const PNCP_SOURCE_OBSERVATION_ID =
  "cc:source-observation:pncp-contracts" as const;

export const EXTRA_CLI_SYSTEM = "extra-cli" as const;
export const EXTRA_CLI_SOURCE_KIND = "pncp-contract-freshness" as const;

/** extra-cli contract statuses. Control Center does not invent others. */
export const UPSTREAM_STATUSES = [
  "FRESH",
  "DEGRADED",
  "STALE",
  "UNKNOWN",
] as const;
export type UpstreamStatus = (typeof UPSTREAM_STATUSES)[number];

/** Canonical Control Center freshness. Mapping never promotes. */
export const FRESHNESS_STATUSES = [
  "FRESH",
  "STALE",
  "UNKNOWN",
  "ERROR",
] as const;
export type FreshnessStatus = (typeof FRESHNESS_STATUSES)[number];

export const HEALTH_STATUSES = [
  "healthy",
  "degraded",
  "down",
  "unknown",
] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export const ADAPTER_KINDS = ["file", "http", "command"] as const;
export type AdapterKind = (typeof ADAPTER_KINDS)[number];

export interface SourceRef {
  system: string;
  kind: string;
  locator: string;
  label?: string;
}

export interface Provenance {
  source: SourceRef;
  observed_at: string;
  freshness_status: FreshnessStatus;
  confidence: number;
  freshness_window_seconds?: number;
}

export interface ErrorObject {
  code: string;
  message: string;
}

export interface ServiceHealthCheck {
  name: string;
  status: HealthStatus;
  detail?: string;
}

export interface ServiceHealth {
  schema_version: typeof SERVICE_HEALTH_SCHEMA;
  id: typeof PNCP_SERVICE_HEALTH_ID;
  scope: typeof PNCP_SCOPE;
  service_name: typeof PNCP_SERVICE_NAME;
  status: HealthStatus;
  provenance: Provenance;
  checked_at: string;
  latency_ms?: number;
  message?: string;
  checks?: ServiceHealthCheck[];
}

export interface SourceObservation {
  schema_version: typeof SOURCE_OBSERVATION_SCHEMA;
  id: typeof PNCP_SOURCE_OBSERVATION_ID;
  scope: typeof PNCP_SCOPE;
  provenance: Provenance;
  collected_at: string;
  idempotency_key: string;
  payload: Record<string, unknown>;
  payload_schema_ref?: string;
  error?: ErrorObject;
}

export interface PncpContractV1 {
  contract_version: typeof CONTRACT_VERSION;
  status: UpstreamStatus;
  reason_codes: string[];
  as_of: string;
  deployed_sha: string | null;
  policy_version: string | null;
  current_lag_hours: number | null;
  lag_p50_hours: number | null;
  lag_p95_hours: number | null;
  lag_p99_hours: number | null;
  lag_sample_n: number | null;
  source_publication_or_update_at: string | null;
  first_observed_at: string | null;
  persisted_at: string | null;
  last_run_at: string | null;
  next_run_at: string | null;
  latest_successful_closed_window: string | null;
  oldest_unresolved_gap: string | null;
  unresolved_window_count: number | null;
  source_window: unknown;
  slo: Record<string, unknown> | null;
  timer: Record<string, unknown> | null;
  health_exit: number | null;
  campaign_verdict_hint: string | null;
}

export interface StatusMapping {
  upstream_status: UpstreamStatus;
  freshness_status: FreshnessStatus;
}

export interface ParseSuccess {
  ok: true;
  contract: PncpContractV1;
}

export interface ParseFailure {
  ok: false;
  error: ErrorObject;
  contract_version: string | null;
}

export type ParseResult = ParseSuccess | ParseFailure;

export interface CommandResult {
  stdout: string;
  stderr?: string;
  exitCode: number;
}

export type CommandRunner = (argv: string[]) => Promise<CommandResult>;

export interface AdapterConfig {
  kind: AdapterKind;
  filePath?: string;
  httpUrl?: string;
  fetchImpl?: typeof fetch;
  httpTimeoutMs?: number;
  commandArgv?: string[];
  commandRunner?: CommandRunner;
  now?: Date;
}

export type AdapterReadResult =
  | {
      ok: true;
      kind: AdapterKind;
      payload: unknown;
      rawText: string;
      locator: string;
      observedAt: Date;
    }
  | {
      ok: false;
      kind: AdapterKind;
      error: ErrorObject;
      locator: string;
      observedAt: Date;
    };

export interface EvaluationContext {
  adapterKind: AdapterKind;
  locator: string;
  collectedAt: Date;
}

export interface PncpFreshnessEvaluation {
  freshness_status: FreshnessStatus;
  upstream_status: UpstreamStatus | null;
  contract_version: string | null;
  reason_codes: string[];
  as_of: string | null;
  deployed_sha: string | null;
  policy_version: string | null;
  mapping: StatusMapping | null;
  parse_error: ErrorObject | null;
  adapter_kind: AdapterKind;
  locator: string;
  contract: PncpContractV1 | null;
  serviceHealth: ServiceHealth;
  sourceObservation: SourceObservation;
}
