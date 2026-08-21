import type {
  ActorKind,
  AgentActivityStatus,
  AgentSessionStatus,
  AttentionSeverity,
  AttentionStatus,
  AuditOutcome,
  ClientLifecycle,
  CollectorRunStatus,
  DirectiveKind,
  DirectiveStatus,
  FreshnessStatus,
  HealthStatus,
  PriorityHorizon,
} from "./taxonomy.js";

/** UTC RFC3339 with mandatory Z. */
export type UtcDateTime = string;

/** Stable Control Center ID: `cc:<type-kebab>:<ulid-or-slug>`. */
export type ResourceId = string;

/**
 * Scope taxonomy v1.
 * Literals: company | commercial | finance | clients | infrastructure | inbound
 * Parameterized: `repo:<name>`, `client:<slug>`
 * Extension (non-breaking): additional `<prefix>:<id>` namespaces.
 */
export type Scope = string;

export interface SourceRef {
  system: string;
  kind: string;
  locator: string;
  label?: string;
}

export interface ActorRef {
  kind: ActorKind;
  id: string;
  display_name?: string;
}

export interface Money {
  amount_cents: number;
  currency: string;
}

/**
 * Provenance of aggregated information.
 * `freshness_status` is recency; `confidence` is trust. They are not aliases.
 */
export interface Provenance {
  source: SourceRef;
  observed_at: UtcDateTime;
  freshness_status: FreshnessStatus;
  confidence: number;
  freshness_window_seconds?: number;
}

export interface ErrorObject {
  code: string;
  message: string;
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

export interface SourceObservation {
  schema_version: "control-center.source-observation.v1";
  id: ResourceId;
  scope: Scope;
  provenance: Provenance;
  collected_at: UtcDateTime;
  idempotency_key: string;
  payload: Record<string, unknown>;
  payload_schema_ref?: string;
  error?: ErrorObject;
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

/**
 * Execution ledger record. Distinct from AgentSession (context-consult grant).
 * Optional session_id, when present, MUST be a `cc:agent-session:...` id.
 */
export interface AgentActivity {
  schema_version: "control-center.agent-activity.v1";
  id: ResourceId;
  agent_id: string;
  session_id?: ResourceId;
  scope: Scope;
  status: AgentActivityStatus;
  started_at: UtcDateTime;
  finished_at: UtcDateTime | null;
  goal: string;
  summary: string;
  provenance: Provenance;
  actor: ActorRef;
  evidence_refs?: string[];
  residual_work?: string[];
  related_ids?: ResourceId[];
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
}

export interface CommercialAuthorityStamp {
  catalog_authority: "governance";
  commercial_runtime: "warmbly";
  this_document: "read_model";
}

/** Identity pin only. MUST NOT carry names, prices, terms, or offer copy. */
export interface GovernanceOfferPin {
  catalog_authority: "governance";
  catalog_id: string;
  known_offer_ids?: string[];
}

export interface CommercialFunnelCounts {
  new_leads: number;
  qualified: number;
  opportunities: number;
  proposals: number;
  clients: number;
}

export interface WeightedPipeline {
  amount_cents: number;
  currency: string;
  probability_reliable: true;
}

export interface CommercialSnapshot {
  schema_version: "control-center.commercial-snapshot.v1";
  id: ResourceId;
  scope: Scope;
  generated_at: UtcDateTime;
  provenance: Provenance;
  authority: CommercialAuthorityStamp;
  offer_pin: GovernanceOfferPin;
  funnel: CommercialFunnelCounts;
  pipeline_nominal: Money;
  pipeline_weighted?: WeightedPipeline;
  aging_count: number;
  stalled_count: number;
  missing_next_action_count: number;
  pipeline_open_count: number;
  inbound_unread_count: number;
  at_risk_client_count: number;
  attention_item_ids?: ResourceId[];
}

export interface EvidencedCashIn {
  amount_cents: number;
  currency: string;
  evidenced: true;
  source: SourceRef;
  window?: { from: UtcDateTime; to: UtcDateTime };
}

export interface ApplicableMrr {
  amount_cents: number;
  currency: string;
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
  contracted: Money;
  billed: Money;
  paid: Money;
  effectively_received: Money;
  overdue: Money;
  receivable: Money;
  refunds: Money;
  chargebacks: Money;
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
  latency_ms?: number;
  message?: string;
  checks?: ServiceHealthCheck[];
}

export interface CollectorRun {
  schema_version: "control-center.collector-run.v1";
  id: ResourceId;
  collector_name: string;
  scope: Scope;
  status: CollectorRunStatus;
  started_at: UtcDateTime;
  finished_at: UtcDateTime | null;
  idempotency_key: string;
  read_only: true;
  observations_emitted: number;
  error?: ErrorObject;
  cursor?: string | null;
}

export interface AuditEvent {
  schema_version: "control-center.audit-event.v1";
  id: ResourceId;
  at: UtcDateTime;
  actor: ActorRef;
  action: string;
  resource_type: string;
  resource_id: ResourceId | null;
  scope: Scope | null;
  outcome: AuditOutcome;
  detail: Record<string, unknown>;
  request_id?: string;
}

export interface OperationalSnapshot {
  schema_version: "control-center.operational-snapshot.v1";
  id: ResourceId;
  scope: Scope;
  generated_at: UtcDateTime;
  provenance: Provenance;
  headline: string;
  top_priorities: PriorityRecommendation[];
  attention_items: AttentionItem[];
  health: ServiceHealth[];
  commercial_snapshot_id: ResourceId | null;
  finance_snapshot_id: ResourceId | null;
  engineering_snapshot_id: ResourceId | null;
  client_status_ids: ResourceId[];
}

/**
 * HTTP/MCP envelope. Not a stored core resource. Agents receive this
 * only for the scopes they requested and were granted.
 */
export interface AgentContext {
  schema_version: "control-center.agent-context.v1";
  requested_scopes: Scope[];
  granted_scopes: Scope[];
  as_of: UtcDateTime;
  directives: Directive[];
  attention_items: AttentionItem[];
  top_priorities: PriorityRecommendation[];
  snapshots: {
    operational?: OperationalSnapshot;
    commercial?: CommercialSnapshot;
    finance?: FinanceSnapshot;
    engineering?: EngineeringSnapshot;
  };
  client_statuses: ClientStatus[];
  truncated: boolean;
}

export type ControlCenterResource =
  | Directive
  | OperationalSnapshot
  | SourceObservation
  | AttentionItem
  | PriorityRecommendation
  | AgentSession
  | AgentActivity
  | ClientStatus
  | CommercialSnapshot
  | FinanceSnapshot
  | EngineeringSnapshot
  | ServiceHealth
  | CollectorRun
  | AuditEvent;
