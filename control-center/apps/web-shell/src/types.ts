import type {
  ActorKind,
  DirectiveKind,
  DirectiveStatus,
  FreshnessStatus,
} from "@confenge/control-center-contracts/taxonomy";
import {
  ACTOR_KINDS,
  DIRECTIVE_KINDS,
  DIRECTIVE_STATUSES,
  FRESHNESS_STATUSES,
} from "@confenge/control-center-contracts/taxonomy";
import type {
  ActorRef,
  ResourceId,
  Scope,
  SourceRef,
  UtcDateTime,
} from "@confenge/control-center-contracts/types";

export type {
  ActorKind,
  ActorRef,
  DirectiveKind,
  DirectiveStatus,
  FreshnessStatus,
  ResourceId,
  Scope,
  SourceRef,
  UtcDateTime,
};
export { ACTOR_KINDS, DIRECTIVE_KINDS, DIRECTIVE_STATUSES, FRESHNESS_STATUSES };

export const ATTENTION_SEVERITIES = ["critical", "high", "medium", "low"] as const;
export type AttentionSeverity = (typeof ATTENTION_SEVERITIES)[number];

export const ATTENTION_STATUSES = [
  "open",
  "acknowledged",
  "resolved",
  "dismissed",
] as const;
export type AttentionStatus = (typeof ATTENTION_STATUSES)[number];

export const PRIORITY_HORIZONS = ["now", "today", "this_week"] as const;
export type PriorityHorizon = (typeof PRIORITY_HORIZONS)[number];

export const AGENT_SESSION_STATUSES = ["open", "closed", "denied"] as const;
export type AgentSessionStatus = (typeof AGENT_SESSION_STATUSES)[number];

export const AGENT_ACTIVITY_STATUSES = [
  "running",
  "done",
  "partial",
  "blocked",
  "failed",
] as const;
export type AgentActivityStatus = (typeof AGENT_ACTIVITY_STATUSES)[number];

export const AGENT_ACTIVITY_PRESENTATION_STATUSES = [
  "RUNNING",
  "DONE",
  "PARTIAL",
  "BLOCKED",
  "FAILED",
  "UNKNOWN",
] as const;
export type AgentActivityPresentationStatus = (typeof AGENT_ACTIVITY_PRESENTATION_STATUSES)[number];

export const CLIENT_LIFECYCLES = [
  "lead",
  "active",
  "paused",
  "churn_risk",
  "churned",
  "unknown",
] as const;
export type ClientLifecycle = (typeof CLIENT_LIFECYCLES)[number];

export const HEALTH_STATUSES = ["healthy", "degraded", "down", "unknown"] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export interface Money {
  amount_cents: number;
  currency: string;
}

export interface Provenance {
  source: SourceRef;
  observed_at: UtcDateTime;
  freshness_status: FreshnessStatus;
  confidence: number;
  freshness_window_seconds?: number;
}

export interface DirectiveAuditEntry {
  at: UtcDateTime;
  actor: ActorRef;
  action: "created" | "updated" | "status_changed" | "superseded" | "revoked";
  from_status?: DirectiveStatus;
  to_status?: DirectiveStatus;
  note?: string;
}

export interface Directive {
  schema_version: "control-center.directive.v1";
  id: ResourceId;
  kind: DirectiveKind;
  scope: Scope;
  status: DirectiveStatus;
  title: string;
  body: string;
  effective_from: UtcDateTime;
  expires_at: UtcDateTime | null;
  supersedes: ResourceId[] | null;
  created_by: ActorRef;
  created_at: UtcDateTime;
  updated_at: UtcDateTime;
  audit: DirectiveAuditEntry[];
  tags?: string[];
  related_ids?: ResourceId[];
}

/**
 * Attention-engine metadata that travels beside an alert on the operational
 * wire (`GET /v1/attention`, `GET /v1/today` return `RankedItem`s).
 *
 * Kept out of the contract-mirroring bodies below on purpose: neither
 * `attention-item.v1` nor `priority-recommendation.v1` may grow a property —
 * both are published v1 schemas with `additionalProperties: false`. This is a
 * client-side view annotation, never something the shell serializes back.
 */
export interface AlertRanking {
  /** Full engine prose. Carries the scoring arithmetic; belongs behind a disclosure. */
  reason: string;
  /** receita | cliente | prazo | risco_operacional | blocker | estetica | refactor */
  category?: string;
  /** finance | commercial | clients | infrastructure | engineering | inbound | company */
  domain?: string;
  severity?: AttentionSeverity;
  forced_by_kill_rule?: boolean;
  merge_count?: number;
  score?: number;
  /** `system:kind:locator` for each evidence ref. */
  evidence: string[];
}

export interface AttentionItem {
  schema_version: "control-center.attention-item.v1";
  id: ResourceId;
  scope: Scope;
  severity: AttentionSeverity;
  status: AttentionStatus;
  title: string;
  summary: string;
  provenance: Provenance;
  detected_at: UtcDateTime;
  homepage_eligible: boolean;
  recommended_action?: string;
  related_ids?: ResourceId[];
  ranking?: AlertRanking;
}

export interface PriorityRecommendation {
  schema_version: "control-center.priority-recommendation.v1";
  id: ResourceId;
  scope: Scope;
  rank: number;
  title: string;
  rationale: string;
  provenance: Provenance;
  generated_at: UtcDateTime;
  horizon: PriorityHorizon;
  attention_item_ids?: ResourceId[];
  directive_ids?: ResourceId[];
  recommended_action?: string;
  ranking?: AlertRanking;
}

export interface AgentSession {
  schema_version: "control-center.agent-session.v1";
  id: ResourceId;
  agent_id: string;
  requested_scopes: Scope[];
  granted_scopes: Scope[];
  purpose: string;
  started_at: UtcDateTime;
  ended_at: UtcDateTime | null;
  status: AgentSessionStatus;
  created_by: ActorRef;
  include_directives: boolean;
  include_snapshots: boolean;
  include_attention: boolean;
}

export interface ClientStatus {
  schema_version: "control-center.client-status.v1";
  id: ResourceId;
  scope: Scope;
  client_slug: string;
  display_name: string;
  lifecycle: ClientLifecycle;
  provenance: Provenance;
  attention_item_ids?: ResourceId[];
  open_receivables?: Money;
  notes?: string;
  health?: string;
  commitments?: string[];
  owner?: string;
  due_date?: UtcDateTime;
  deliverables?: string[];
  blockers?: string[];
  next_action?: string;
  evidence?: string;
  sources?: {
    warmbly?: string;
    asaas?: string;
    governance?: string;
  };
}

/**
 * A source record that carries no client identity.
 *
 * Produced by the collector's clients projector and carried on the clients
 * snapshot as `data_quality.entries`. It is deliberately not a `ClientStatus`:
 * it must never be counted as a client, and the surface renders it as a
 * data-quality / join-queue entry with its origin, reason and correction.
 */
export interface ClientIdentityException {
  id: string;
  source_id: string | null;
  kind: string;
  why: string;
  reason_codes: string[];
  recommended_next_action: string;
  status: string;
  origin: SourceRef;
  observed_at?: UtcDateTime;
  provenance?: Provenance;
}

export interface CommercialAuthorityStamp {
  catalog_authority: "governance";
  commercial_runtime: "warmbly";
  this_document: "read_model";
}

export interface CommercialFunnel {
  new_leads?: number;
  qualified?: number;
  opportunities?: number;
  proposals?: number;
  clients?: number;
}

export interface WeightedPipeline extends Money {
  probability_reliable: true;
}

export interface ExtraHistorical {
  treated_as_public_offer: false;
  label?: string;
  note?: string;
}

export interface OfferVersionDrift {
  count: number;
  detail?: string;
}

export interface CommercialSnapshot {
  schema_version: "control-center.commercial-snapshot.v1";
  id: ResourceId;
  scope: Scope;
  generated_at: UtcDateTime;
  provenance: Provenance;
  authority: CommercialAuthorityStamp;
  pipeline_open_count?: number;
  inbound_unread_count?: number;
  at_risk_client_count?: number;
  attention_item_ids?: ResourceId[];
  offer_pin?: {
    catalog_authority: "governance";
    catalog_id: string;
    known_offer_ids?: string[];
  };
  funnel?: CommercialFunnel;
  pipeline_nominal?: Money;
  /** Separate totals per currency. Present only when the pipeline spans more than one. */
  pipeline_nominal_by_currency?: Money[];
  pipeline_weighted?: WeightedPipeline;
  aging_count?: number;
  stalled_count?: number;
  missing_next_action_count?: number;
  extra_historical?: ExtraHistorical;
  offer_version_drift?: OfferVersionDrift;
  availability?: string;
  operations?: Record<string, unknown>;
}

export interface EvidencedCashIn extends Money {
  evidenced: true;
  source: SourceRef;
  window?: { from: UtcDateTime; to: UtcDateTime };
}

export interface ApplicableMrr extends Money {
  applicable: true;
  basis: "recurring_monthly";
}

export interface ReliableRunway {
  months: number;
  cash_balance: Money;
  monthly_expense: Money;
  cash_reliable: true;
  expense_reliable: true;
}

export interface FinanceSnapshot {
  schema_version: "control-center.finance-snapshot.v1";
  id: ResourceId;
  scope: Scope;
  generated_at: UtcDateTime;
  provenance: Provenance;
  read_model_only: true;
  provider_mutations: "forbidden";
  contracted?: Money;
  billed?: Money;
  paid?: Money;
  effectively_received?: Money;
  overdue?: Money;
  receivable?: Money;
  refunds?: Money;
  chargebacks?: Money;
  receivables_open?: Money;
  receivables_overdue?: Money;
  cash_in?: EvidencedCashIn;
  mrr?: ApplicableMrr;
  runway?: ReliableRunway;
  attention_item_ids?: ResourceId[];
}

export interface EngineeringSnapshot {
  schema_version: "control-center.engineering-snapshot.v1";
  id: ResourceId;
  scope: Scope;
  generated_at: UtcDateTime;
  provenance: Provenance;
  open_pr_count: number;
  failing_check_count: number;
  open_incident_count: number;
  repo_scopes?: Scope[];
  attention_item_ids?: ResourceId[];
  repository?: string;
  default_branch?: string;
  prs?: Array<{ id?: string; title?: string; status?: string }>;
  ci?: { status?: string; detail?: string };
  p0_count?: number;
  p1_count?: number;
  aging?: { count?: number; oldest_days?: number };
  blockers?: string[];
  last_evidence?: string;
  active_work_without_evidence?: { remains: "hypothesis"; detail?: string };
  repos?: Array<Record<string, unknown>>;
  allowlist?: string[];
}

export interface ServiceHealthCheck {
  name: string;
  status: HealthStatus;
  detail?: string;
}

export interface ServiceHealth {
  schema_version: "control-center.service-health.v1";
  id: ResourceId;
  scope: Scope;
  service_name: string;
  status: HealthStatus;
  provenance: Provenance;
  checked_at: UtcDateTime;
  /** Catalog id of the monitored dependency, when the catalog names one. */
  service_id?: string;
  /** What the service does. */
  role?: string;
  /** Logical address the checks address. Never carries credentials. */
  endpoint?: string;
  /** Worst non-healthy check, in the collector's own words. */
  last_error?: string;
  /** Same-origin path or credential-free http(s) URL for the runbook. */
  runbook_url?: string;
  /** How many identical catalog entries collapsed into this card. */
  duplicate_count?: number;
  /** Set when the row itself is a catalog/telemetry defect. */
  catalog_error?: string;
  /** False when freshness or confidence cannot support a conclusion. */
  evidence_conclusive?: boolean;
  /**
   * Freshness and confidence of the collector run that carried this row. The
   * row's own state is never rewritten from it — one arbitrary probe must not
   * declare the whole fleet down — but doubt about the run is shown as a caveat.
   */
  snapshot_evidence?: { freshness_status: FreshnessStatus; confidence: number; conclusive: boolean };
  latency_ms?: number;
  /** Which check produced latency_ms. TCP connect and HTTP are different measures. */
  latency_check?: string;
  message?: string;
  checks?: ServiceHealthCheck[];
  http?: { status?: string; detail?: string };
  tls?: { status?: string; detail?: string };
  docker?: { status?: string; detail?: string };
  backup?: { status?: string; detail?: string };
  host_metrics?: { status?: string; detail?: string };
  disk?: { used_pct?: number; detail?: string };
  memory?: { used_pct?: number; detail?: string };
  pncp_freshness?: { freshness_status: FreshnessStatus; observed_at?: UtcDateTime; detail?: string };
  partial_outage?: boolean;
}

/**
 * Catalog-level truth about the Infra route: how many dependencies are being
 * watched, how many entries are defective, and why the evidence is weak when it
 * is. Without it "confiança 0,00" is indistinguishable between "never
 * configured" and "the probe failed".
 */
export interface InfraCatalogSummary {
  freshness_status: FreshnessStatus;
  confidence: number;
  monitored_service_count?: number;
  catalog_error_count?: number;
  duplicate_group_count?: number;
  availability?: string;
  unavailability_reason?: string;
}

export interface AgentActivity {
  schema_version: "control-center.agent-activity.v1";
  id: ResourceId;
  agent_id: string;
  provider?: string;
  session_id?: ResourceId;
  scope: Scope;
  repo?: string;
  status: string;
  presentation_status: AgentActivityPresentationStatus;
  started_at: UtcDateTime;
  finished_at: UtcDateTime | null;
  goal: string;
  campaign?: string | null;
  summary: string;
  provenance: Provenance;
  actor?: ActorRef;
  evidence_refs?: string[];
  residual_work?: string[];
  blockers?: string[];
  related_ids?: ResourceId[];
}
