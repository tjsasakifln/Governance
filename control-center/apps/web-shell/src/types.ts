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

export interface CommercialSnapshot {
  schema_version: "control-center.commercial-snapshot.v1";
  id: ResourceId;
  scope: Scope;
  generated_at: UtcDateTime;
  provenance: Provenance;
  authority: CommercialAuthorityStamp;
  pipeline_open_count: number;
  inbound_unread_count: number;
  at_risk_client_count: number;
  attention_item_ids?: ResourceId[];
}

export interface FinanceSnapshot {
  schema_version: "control-center.finance-snapshot.v1";
  id: ResourceId;
  scope: Scope;
  generated_at: UtcDateTime;
  provenance: Provenance;
  read_model_only: true;
  provider_mutations: "forbidden";
  receivables_open: Money;
  receivables_overdue: Money;
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
