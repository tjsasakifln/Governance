/**
 * Local Control Center contracts for PNCP freshness.
 * Sibling workstreams may later converge on these shapes; this path does not
 * import extra-cli or other repos.
 */

export const PNCP_SOURCE_ID = "pncp" as const;
export const SCHEMA_VERSION = "control-center.pncp.freshness/1.0" as const;

/** Portuguese healthy label. Emitted only when FRESH with timestamp + evidence. */
export const PNCP_HEALTHY_LABEL = "PNCP saudável" as const;

export type FreshnessStatus = "FRESH" | "STALE" | "ERROR" | "UNKNOWN";

export type MetricsSourceKind = "http_api" | "db_view" | "health_artifact";

export type CredentialStatus = "available" | "unavailable" | "unknown";

export interface FreshnessThresholds {
  lastSuccessSlaHours: number;
  dataSlaHours: number;
  recentWindowHours: number;
  minRecentWindowCount: number;
  consecutiveErrorThreshold: number;
  collectorAliveMaxAgeHours: number;
  deadPipelineMaxAgeHours: number;
}

export interface PncpMetricsSnapshot {
  schema_version: typeof SCHEMA_VERSION;
  source: typeof PNCP_SOURCE_ID;
  source_kind: MetricsSourceKind;
  raw_source: string | null;
  /** Evaluation clock (UTC ISO). Always set by the adapter. */
  observed_at: string;
  last_item_observed_at: string | null;
  last_success_at: string | null;
  lag_seconds: number | null;
  recent_window_count: number | null;
  consecutive_errors: number | null;
  source_max_timestamp: string | null;
  collector_heartbeat_at: string | null;
  credential_status: CredentialStatus;
  error_code: string | null;
  /** Non-secret adapter/read failure code; never a token or DSN. */
  read_error: string | null;
  raw_complete: boolean;
}

export interface FreshnessEvidence {
  last_item_observed_at: string | null;
  last_success_at: string | null;
  source_max_timestamp: string | null;
  recent_window_count: number | null;
  consecutive_errors: number | null;
  lag_seconds: number | null;
  collector_heartbeat_at: string | null;
  recent_window_hours: number;
  last_success_sla_hours: number;
  data_sla_hours: number;
}

export interface Classification {
  status: FreshnessStatus;
  reasons: string[];
  collector_alive: boolean;
  collector_stalled: boolean;
  confidence: number;
  evidence_present: boolean;
  timestamp_present: boolean;
}

export interface ServiceHealth {
  schema_version: typeof SCHEMA_VERSION;
  source: typeof PNCP_SOURCE_ID;
  observed_at: string;
  freshness_status: FreshnessStatus;
  confidence: number;
  service: typeof PNCP_SOURCE_ID;
  /** True only for FRESH with timestamp and freshness evidence. */
  healthy: boolean;
  /**
   * Display label. Equals PNCP_HEALTHY_LABEL only when `healthy` is true.
   * Dashboards must not invent a healthy PNCP label from any other payload.
   */
  label: string;
  reasons: string[];
  evidence: FreshnessEvidence;
  collector_alive: boolean;
  collector_stalled: boolean;
}

export interface SourceObservation {
  schema_version: typeof SCHEMA_VERSION;
  source: typeof PNCP_SOURCE_ID;
  /** Data timestamp (source max or last item). Null when unknown — never FRESH. */
  observed_at: string | null;
  freshness_status: FreshnessStatus;
  confidence: number;
  last_item_observed_at: string | null;
  last_success_at: string | null;
  lag_seconds: number | null;
  recent_window_count: number | null;
  consecutive_errors: number | null;
  source_max_timestamp: string | null;
  evidence: FreshnessEvidence;
}

export interface PncpFreshnessEvaluation {
  snapshot: PncpMetricsSnapshot;
  classification: Classification;
  serviceHealth: ServiceHealth;
  sourceObservation: SourceObservation;
  thresholds: FreshnessThresholds;
}

export type DbViewQuery = () => Promise<Record<string, unknown> | null>;

export interface AdapterConfig {
  kind: MetricsSourceKind;
  artifactPath?: string;
  httpUrl?: string;
  /**
   * Optional injected fetch for tests. Production uses global fetch.
   * Must not log request headers (they may contain credentials).
   */
  fetchImpl?: typeof fetch;
  /** Injected view row or query callback — no live extra-cli/pg driver here. */
  dbRow?: Record<string, unknown>;
  queryView?: DbViewQuery;
  /** Override evaluation clock (UTC). Artifact `evaluated_at` is used when unset. */
  now?: Date;
  httpTimeoutMs?: number;
}

export const STATUS_LABELS: Record<FreshnessStatus, string> = {
  FRESH: PNCP_HEALTHY_LABEL,
  STALE: "PNCP desatualizado",
  ERROR: "PNCP com erro",
  UNKNOWN: "PNCP sem evidência de freshness",
};
