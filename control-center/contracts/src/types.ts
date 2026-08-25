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

export const WORK_ORDER_STAGES = [
  "AWAITING_INPUTS",
  "READY",
  "IN_PROGRESS",
  "BLOCKED",
  "QA",
  "READY_TO_DELIVER",
  "DELIVERED",
  "ACCEPTED",
  "REWORK_REQUIRED",
  "CLOSED",
  "CANCELLED",
] as const;
export type WorkOrderStage = (typeof WORK_ORDER_STAGES)[number];

export const WORK_ORDER_CLOCK_STATES = [
  "NOT_STARTED",
  "RUNNING",
  "PAUSED_CLIENT",
  "PAUSED_INTERNAL",
  "PAUSED_FORCE_MAJEURE",
  "STOPPED",
] as const;
export type WorkOrderClockState = (typeof WORK_ORDER_CLOCK_STATES)[number];

export interface WorkOrderInput {
  input_id: string;
  status: "REQUIRED" | "RECEIVED" | "WAIVED";
  evidence_ref: string | null;
  verified_at: UtcDateTime | null;
  verified_by: ActorRef | null;
}

export interface WorkOrderBlocker {
  blocker_id: string;
  reason_code: string;
  owner: string | null;
  evidence_ref: string;
  opened_at: UtcDateTime;
  resolved_at: UtcDateTime | null;
}

export interface WorkOrderArtifactRef {
  artifact_id: string;
  sha256: string;
  evidence_ref: string;
}

export interface WorkOrderNonconformity {
  nonconformity_id: string;
  status: "OPEN" | "RESOLVED";
  reason_code: string;
  evidence_ref: string;
}

export interface WorkOrderChangeRequest {
  change_request_id: string;
  status: "PROPOSED" | "ACCEPTED" | "REJECTED" | "APPLIED";
  proposed_snapshot_hash: string;
  evidence_ref: string;
}

/** Delivery execution authority. CRM, billing, catalog and binary artifacts stay outside it. */
export interface WorkOrder {
  schema_version: "confenge.work_order.v1";
  work_order_id: ResourceId;
  client_id: string;
  account_id: string;
  opportunity_id: string;
  qco_id: string;
  proposal_id: string;
  proposal_version: string;
  order_id: string;
  provider_refs: string[];
  accepted_snapshot_hash: string;
  offer_id: string;
  offer_version: string;
  deliverable_id: string;
  deliverable_version: string;
  scope_version: string;
  price_version: string;
  terms_version: string;
  inputs_required: WorkOrderInput[];
  inputs_received: string[];
  created_at: UtcDateTime;
  started_at: UtcDateTime | null;
  due_at: UtcDateTime | null;
  business_calendar_version: string;
  clock_state: WorkOrderClockState;
  clock_reason_version: string | null;
  blockers: WorkOrderBlocker[];
  current_stage: WorkOrderStage;
  responsible_owner: string | null;
  estimated_effort_minutes: number | null;
  estimated_capacity_units: number;
  capacity_commitment_id: string;
  actual_effort_minutes: number;
  QA_state: "NOT_STARTED" | "IN_REVIEW" | "PASSED" | "FAILED";
  QA_checklist_version: string | null;
  delivery_artifact_refs: WorkOrderArtifactRef[];
  delivered_at: UtcDateTime | null;
  client_acceptance_state: "PENDING" | "ACCEPTED" | "REWORK_REQUIRED" | "REJECTED" | "CANCELLED";
  nonconformities: WorkOrderNonconformity[];
  change_requests: WorkOrderChangeRequest[];
  outcome: "UNKNOWN" | "ACHIEVED" | "PARTIAL" | "NOT_ACHIEVED";
  expansion_candidate: boolean | null;
  version: number;
  last_event_id: ResourceId;
  synthetic: boolean;
  provenance: Provenance;
}

export const WORK_ORDER_EVENT_TYPES = [
  "WORK_ORDER_CREATED",
  "INPUT_RECEIVED",
  "INPUT_WAIVED",
  "OWNER_ASSIGNED",
  "PRODUCTION_STARTED",
  "WORK_BLOCKED",
  "WORK_RESUMED",
  "EFFORT_RECORDED",
  "QA_SUBMITTED",
  "QA_PASSED",
  "QA_FAILED",
  "DELIVERY_RECORDED",
  "CLIENT_ACCEPTED",
  "CLIENT_REWORK_REQUESTED",
  "REWORK_STARTED",
  "NONCONFORMITY_OPENED",
  "NONCONFORMITY_RESOLVED",
  "CHANGE_REQUEST_OPENED",
  "CHANGE_REQUEST_ACCEPTED",
  "CHANGE_REQUEST_REJECTED",
  "CLOCK_PAUSED_CLIENT",
  "CLOCK_PAUSED_INTERNAL",
  "CLOCK_PAUSED_FORCE_MAJEURE",
  "CLOCK_RESUMED",
  "WORK_ORDER_CANCELLED",
  "WORK_ORDER_CLOSED",
] as const;
export type WorkOrderEventType = (typeof WORK_ORDER_EVENT_TYPES)[number];

export interface WorkOrderEvent {
  schema_version: "confenge.work_order_event.v1";
  event_id: ResourceId;
  event_version: number;
  work_order_id: ResourceId;
  expected_version: number;
  event_type: WorkOrderEventType;
  actor: ActorRef;
  reason_code: string;
  literal_reason_ref: string;
  occurred_at: UtcDateTime;
  idempotency_key: string;
  correlation_id: string;
  causation_id: string | null;
  source_system: string;
  evidence_refs: string[];
  transition: { from_stage: WorkOrderStage; to_stage: WorkOrderStage } | null;
  data: Record<string, unknown>;
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
  /** Absent when the pipeline could not be denominated. Never a zero in a guessed currency. */
  pipeline_nominal?: Money;
  /** One total per currency, only when the pipeline spans more than one. Never summed, never converted. */
  pipeline_nominal_by_currency?: Money[];
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
