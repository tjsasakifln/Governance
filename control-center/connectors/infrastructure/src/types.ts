/**
 * Local adapter for Control Center contracts that live in the sibling
 * `control-center/contracts/` workstream (not yet on origin/main).
 *
 * Field set is the minimum needed for provenance, freshness, health, and
 * actionable exceptions. Convergence must reconcile these names with the
 * canonical schemas — do not import that tree from this collector.
 */

export const FRESHNESS_STATUSES = ["FRESH", "STALE", "UNKNOWN", "ERROR"] as const;
export type FreshnessStatus = (typeof FRESHNESS_STATUSES)[number];

export const CHECK_KINDS = [
  "reachability",
  "host_metrics",
  "docker",
  "http",
  "tls",
  "backup",
  "uptime",
] as const;
export type CheckKind = (typeof CHECK_KINDS)[number];

export const SERVICE_STATUSES = ["healthy", "degraded", "unhealthy", "unknown"] as const;
export type ServiceStatus = (typeof SERVICE_STATUSES)[number];

export const EXCEPTION_SEVERITIES = ["critical", "warning"] as const;
export type ExceptionSeverity = (typeof EXCEPTION_SEVERITIES)[number];

export const INFRASTRUCTURE_SCOPE = "infrastructure" as const;
export type InfrastructureScope = typeof INFRASTRUCTURE_SCOPE;

export const ADAPTER_SCHEMA_VERSION = "control-center.infrastructure.v1" as const;

export interface SourceObservation {
  readonly observation_id: string;
  readonly source: string;
  readonly observed_at: string;
  readonly freshness_status: FreshnessStatus;
  readonly scope: InfrastructureScope;
  readonly target_id: string;
  readonly check: CheckKind;
  readonly summary: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly confidence?: number;
}

export interface ServiceCheck {
  readonly check: CheckKind;
  readonly status: ServiceStatus;
  readonly freshness_status: FreshnessStatus;
  readonly summary: string;
}

export interface ServiceHealth {
  readonly service_id: string;
  readonly display_name: string;
  /**
   * What the service does, so two rows are never distinguishable only by
   * position. Declared in the catalog, else derived from the checks it runs.
   */
  readonly role: string;
  /**
   * The logical address the checks address. Credential-free by construction:
   * userinfo and query string are stripped before it leaves the collector.
   */
  readonly endpoint: string;
  readonly source: string;
  readonly observed_at: string;
  readonly freshness_status: FreshnessStatus;
  readonly status: ServiceStatus;
  readonly checks: readonly ServiceCheck[];
  readonly uptime_seconds?: number;
  readonly restart_count?: number;
  readonly confidence?: number;
  /** Worst observed round trip across this service's checks. */
  readonly latency_ms?: number;
  /** Summary of the worst non-healthy check, in the collector's own words. */
  readonly last_error?: string;
  /** Operator runbook for this service, from the catalog. Never invented. */
  readonly runbook_url?: string;
}

export interface ActionableException {
  readonly exception_id: string;
  readonly source: string;
  readonly timestamp: string;
  readonly observed_at: string;
  readonly target_id: string;
  readonly check: CheckKind;
  readonly severity: ExceptionSeverity;
  readonly title: string;
  readonly evidence: string;
  readonly freshness_status: FreshnessStatus;
}

export interface CollectorRun {
  readonly schema_version: typeof ADAPTER_SCHEMA_VERSION;
  readonly collector_id: string;
  readonly source: string;
  readonly started_at: string;
  readonly finished_at: string;
  readonly target_count: number;
  readonly observation_count: number;
  readonly exception_count: number;
}

export interface CollectResult {
  readonly collector_run: CollectorRun;
  readonly observations: readonly SourceObservation[];
  readonly service_health: readonly ServiceHealth[];
  readonly exceptions: readonly ActionableException[];
}

export interface AllowlistThresholds {
  readonly stale_after_seconds: number;
  readonly disk_warn_pct: number;
  readonly disk_crit_pct: number;
  readonly mem_warn_pct: number;
  readonly backup_max_age_seconds: number;
  readonly tls_warn_days: number;
  readonly tls_crit_days: number;
}

export interface AllowlistTarget {
  readonly id: string;
  readonly display_name: string;
  /** What this target does. Free text from the catalog; no secrets. */
  readonly role?: string;
  /**
   * Operator runbook for this target: a same-origin absolute path, or an
   * http(s) URL with no credentials. Validated when the allowlist is parsed.
   */
  readonly runbook_url?: string;
  readonly checks: readonly CheckKind[];
  readonly host?: string;
  /** TCP connect address (IP or hostname). Independent of TLS/HTTP identity. */
  readonly connect_host?: string;
  /** SNI servername for TLS. Independent of connect_host. */
  readonly tls_server_name?: string;
  /** HTTP Host header. Independent of connect_host. */
  readonly http_host?: string;
  readonly port?: number;
  readonly url?: string;
  readonly expect_status?: number;
  readonly timeout_ms?: number;
  readonly agent_id?: string;
}

export interface Allowlist {
  readonly version: 1;
  readonly collector_id: string;
  readonly source: string;
  readonly default_timeout_ms: number;
  readonly thresholds: AllowlistThresholds;
  readonly targets: readonly AllowlistTarget[];
}

export interface AgentDisk {
  readonly used_pct: number;
  readonly used_bytes?: number;
  readonly total_bytes?: number;
}

export interface AgentMemory {
  readonly used_pct: number;
  readonly available_bytes?: number;
  readonly total_bytes?: number;
}

export interface AgentLoad {
  readonly load_1: number;
  readonly load_5: number;
  readonly load_15: number;
}

export interface AgentDockerService {
  readonly name: string;
  readonly health: string;
  readonly restart_count?: number;
  readonly uptime_seconds?: number;
}

export interface AgentBackup {
  readonly status: string;
  readonly last_success_at?: string;
}

export interface AgentHost {
  readonly uptime_seconds?: number;
  readonly restart_count?: number;
}

export interface AgentPayload {
  readonly observed_at: string;
  readonly disk?: AgentDisk;
  readonly memory?: AgentMemory;
  readonly load?: AgentLoad;
  readonly docker?: { readonly services: readonly AgentDockerService[] };
  readonly backup?: AgentBackup;
  readonly host?: AgentHost;
}

export interface ReachabilitySample {
  readonly ok: boolean;
  readonly latency_ms?: number;
  readonly error?: string;
}

export interface HttpSample {
  readonly status: number;
  readonly elapsed_ms?: number;
  readonly error?: string;
}

export interface TlsSample {
  readonly not_after: string;
  readonly error?: string;
}

export type ProbeStatus = "ok" | "timeout" | "error" | "missing";

export interface ProbeResult {
  readonly target_id: string;
  readonly check: CheckKind;
  readonly status: ProbeStatus;
  readonly observed_at: string;
  readonly summary: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly agent_observed_at?: string;
}
