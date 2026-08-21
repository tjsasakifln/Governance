import type { FreshnessStatus, Scope } from "../types.ts";
import type { RankedItem } from "@confenge/control-center-attention";

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

export const OPERATIONAL_VIEWS = {
  collectorRuns: "control_center.v_latest_collector_runs",
  sourceObservations: "control_center.v_latest_source_observations",
  operationalSnapshots: "control_center.v_latest_operational_snapshots",
} as const;

export const COLLECTOR_RUN_STATUSES = ["started", "succeeded", "failed", "skipped"] as const;
export type CollectorRunStatus = (typeof COLLECTOR_RUN_STATUSES)[number];

export interface SourceRef {
  system: string;
  kind: string;
  locator: string;
  label?: string;
}

export interface EvidencedMoney {
  amount_cents: number;
  currency: string;
  source: SourceRef;
  observed_at: string;
  freshness_status: FreshnessStatus;
  confidence: number;
}

export interface CollectorRunRow {
  id: string;
  collector_name: string;
  scope: string;
  status: CollectorRunStatus;
  started_at: string;
  finished_at: string | null;
  idempotency_key: string;
  read_only: true;
  observations_emitted: number;
  error_code: string | null;
  error_message: string | null;
  source: SourceRef;
  observed_at: string;
  freshness_status: FreshnessStatus;
  confidence: number;
}

export interface SourceObservationRow {
  id: string;
  scope: string;
  observation_kind: string;
  source: SourceRef;
  observed_at: string;
  freshness_status: FreshnessStatus;
  confidence: number;
  collected_at: string;
  idempotency_key: string;
  payload: Record<string, unknown>;
  payload_schema_ref?: string;
  error_code: string | null;
  error_message: string | null;
}

export interface OperationalSnapshotRow {
  id: string;
  scope: string;
  snapshot_kind: string;
  generated_at: string;
  source: SourceRef;
  observed_at: string;
  freshness_status: FreshnessStatus;
  confidence: number;
  payload: Record<string, unknown>;
}

export interface OperationalReadResult {
  collector_runs: CollectorRunRow[];
  source_observations: SourceObservationRow[];
  operational_snapshots: OperationalSnapshotRow[];
}

export interface DomainSlot {
  schema_version: typeof OPERATIONAL_DOMAIN_SCHEMA_VERSION;
  domain: OperationalDomain;
  scope: Scope;
  source: SourceRef;
  observed_at: string;
  freshness_status: FreshnessStatus;
  confidence: number;
  presence: "present" | "absent";
  absence_reason?: AbsenceReason;
  healthy: boolean;
  snapshot: Record<string, unknown> | null;
}

export interface ObservationEntry {
  schema_version: "control-center.source-observation.v1";
  id: string;
  scope: Scope;
  source: SourceRef;
  observed_at: string;
  freshness_status: FreshnessStatus;
  confidence: number;
  collected_at: string;
  idempotency_key: string;
  payload: Record<string, unknown>;
  payload_schema_ref?: string;
  error?: { code: string; message: string };
}

export interface OperationalEnvelope {
  schema_version: typeof OPERATIONAL_ENVELOPE_SCHEMA_VERSION;
  scope: Scope;
  generated_at: string;
  freshness_status: FreshnessStatus;
  confidence: number;
  snapshots: Record<OperationalDomain, DomainSlot | null>;
  attention_now: RankedItem[];
  today: RankedItem[];
  source_observations: ObservationEntry[];
  audit?: unknown[];
}

export interface OperationalDomainResponse {
  schema_version: typeof OPERATIONAL_ENVELOPE_SCHEMA_VERSION;
  scope: Scope;
  generated_at: string;
  freshness_status: FreshnessStatus;
  confidence: number;
  domain: OperationalDomain;
  snapshot: DomainSlot | null;
}

export interface OperationalAttentionResponse {
  schema_version: typeof OPERATIONAL_ENVELOPE_SCHEMA_VERSION;
  scope: Scope;
  generated_at: string;
  freshness_status: FreshnessStatus;
  confidence: number;
  horizon: "now" | "today";
  items: RankedItem[];
  audit?: unknown[];
}

export interface OperationalTodayResponse {
  schema_version: typeof OPERATIONAL_ENVELOPE_SCHEMA_VERSION;
  scope: "company";
  generated_at: string;
  freshness_status: FreshnessStatus;
  confidence: number;
  today: RankedItem[];
  audit?: unknown[];
}

export interface OperationalObservationsResponse {
  schema_version: typeof OPERATIONAL_ENVELOPE_SCHEMA_VERSION;
  scope: Scope;
  generated_at: string;
  freshness_status: FreshnessStatus;
  confidence: number;
  source_observations: ObservationEntry[];
}

export type AttentionHorizon = "now" | "today";
