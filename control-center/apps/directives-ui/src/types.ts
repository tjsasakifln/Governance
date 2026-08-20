/**
 * Local copy of control-center.directive.v1 field/enum contract.
 * Sibling `control-center/contracts/` is read-only and not on this branch.
 * Convergence must pin the schema `$id` rather than this duplicate.
 */

export const SCHEMA_VERSION = "control-center.directive.v1" as const;

export const DIRECTIVE_KINDS = [
  "decision",
  "directive",
  "fact",
  "constraint",
  "priority",
  "risk",
  "hypothesis",
] as const;
export type DirectiveKind = (typeof DIRECTIVE_KINDS)[number];

export const AUTHORITATIVE_KINDS = ["decision", "directive", "fact", "constraint"] as const;
export type AuthoritativeKind = (typeof AUTHORITATIVE_KINDS)[number];

export const ORIENTATIVE_KINDS = ["priority", "risk"] as const;
export type OrientativeKind = (typeof ORIENTATIVE_KINDS)[number];

export const DIRECTIVE_STATUSES = [
  "draft",
  "active",
  "superseded",
  "revoked",
  "expired",
] as const;
export type DirectiveStatus = (typeof DIRECTIVE_STATUSES)[number];

export const CREATE_STATUSES = ["draft", "active"] as const;
export type CreateStatus = (typeof CREATE_STATUSES)[number];

export const SCOPE_LITERALS = [
  "company",
  "commercial",
  "finance",
  "clients",
  "infrastructure",
  "inbound",
] as const;
export type ScopeLiteral = (typeof SCOPE_LITERALS)[number];

export const ACTOR_KINDS = ["human", "agent", "system"] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

export const SESSION_ROLES = ["founder", "operator", "agent"] as const;
export type SessionRole = (typeof SESSION_ROLES)[number];

export const AUDIT_ACTIONS = [
  "created",
  "updated",
  "status_changed",
  "superseded",
  "revoked",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const FRESHNESS_STATUSES = ["FRESH", "STALE", "UNKNOWN", "ERROR"] as const;
export type FreshnessStatus = (typeof FRESHNESS_STATUSES)[number];

export const FORBIDDEN_MUTATIONS = [
  "cobranca",
  "checkout",
  "refund",
  "cancelamento",
  "asaas_write",
  "commercial_send",
] as const;
export type ForbiddenMutation = (typeof FORBIDDEN_MUTATIONS)[number];

export type UtcDateTime = string;
export type ResourceId = string;
export type Scope = string;

export interface ActorRef {
  kind: ActorKind;
  id: string;
  display_name?: string;
}

export interface DirectiveAuditEntry {
  at: UtcDateTime;
  actor: ActorRef;
  action: AuditAction;
  from_status?: DirectiveStatus;
  to_status?: DirectiveStatus;
  note?: string;
}

export interface Directive {
  schema_version: typeof SCHEMA_VERSION;
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
 * Aggregated view wrapper. Directives as stored do not carry provenance;
 * any list/preview shown to an operator or agent MUST.
 */
export interface ObservedDirective {
  record: Directive;
  source: string;
  observed_at: UtcDateTime;
  freshness_status: FreshnessStatus;
  confidence: number;
}

export interface SessionIdentity {
  actor: ActorRef;
  role: SessionRole;
  founderActorId: string;
  source: "env" | "mock-local";
}

export interface FounderApproval {
  approved: boolean;
  canMutate: boolean;
  label: string;
  code: "founder_ok" | "not_founder" | "identity_unconfigured";
}

export interface DirectiveFilter {
  query: string;
  kind: DirectiveKind | "all";
  scope: string | "all";
  status: DirectiveStatus | "all";
}

export interface CreateDirectiveInput {
  kind: DirectiveKind;
  kindConfirm: DirectiveKind;
  title: string;
  body: string;
  scope: Scope;
  status: CreateStatus;
  effective_from: UtcDateTime;
  expires_at: UtcDateTime | null;
  supersedes: ResourceId[] | null;
  tags?: string[];
}

export interface Clock {
  now(): Date;
}

export interface AgentScopePreview {
  title: string;
  scope: Scope;
  as_of: UtcDateTime;
  granted_scopes: Scope[];
  decisions: ObservedDirective[];
  directives: ObservedDirective[];
  facts: ObservedDirective[];
  constraints: ObservedDirective[];
  priorities: ObservedDirective[];
  risks: ObservedDirective[];
  hypotheses: ObservedDirective[];
  excluded_other_scopes: number;
  excluded_inactive: number;
}
