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

export const PROTECTED_KINDS = ["constraint", "decision"] as const;
export type ProtectedKind = (typeof PROTECTED_KINDS)[number];

export const DIRECTIVE_STATUSES = [
  "active",
  "inactive",
  "expired",
  "superseded",
] as const;

export type DirectiveStatus = (typeof DIRECTIVE_STATUSES)[number];

export const FRESHNESS_STATUSES = ["fresh", "stale", "unknown"] as const;
export type FreshnessStatus = (typeof FRESHNESS_STATUSES)[number];

export const ACTOR_ROLES = ["founder", "agent"] as const;
export type ActorRole = (typeof ACTOR_ROLES)[number];

export const PROPOSAL_ACTIONS = [
  "create",
  "version",
  "supersede",
  "expire",
  "activate",
  "deactivate",
] as const;
export type ProposalAction = (typeof PROPOSAL_ACTIONS)[number];

export const PROPOSAL_STATUSES = ["pending", "rejected"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export interface Scope {
  company: string;
  domain?: string;
  resource?: string;
}

export interface Actor {
  id: string;
  role: ActorRole;
}

export interface Provenance {
  source: string;
  observed_at: string;
  freshness_status: FreshnessStatus;
  confidence?: number;
}

export interface DirectiveRecord {
  id: string;
  revision_id: string;
  version: number;
  kind: DirectiveKind;
  title: string;
  body: string;
  scope: Scope;
  status: DirectiveStatus;
  effective_from: string;
  expires_at: string | null;
  supersedes: string | null;
  created_by: string;
  created_at: string;
  provenance: Provenance;
}

export interface DirectiveView {
  id: string;
  revision_id: string;
  version: number;
  kind: DirectiveKind;
  title: string;
  body: string;
  scope: Scope;
  status: DirectiveStatus;
  effective_from: string;
  expires_at: string | null;
  supersedes: string | null;
  created_by: string;
  source: string;
  observed_at: string;
  freshness_status: FreshnessStatus;
  confidence?: number;
}

export interface ContextPayload {
  scope: Scope;
  active_directives: DirectiveView[];
  decisions: DirectiveView[];
  facts: DirectiveView[];
  constraints: DirectiveView[];
  priorities: DirectiveView[];
  risks: DirectiveView[];
  directives: DirectiveView[];
  hypotheses: DirectiveView[];
}

export interface AuditEvent {
  id: string;
  at: string;
  actor_id: string;
  actor_role: ActorRole;
  action: string;
  entity_type: "directive" | "proposal";
  entity_id: string;
  revision_id: string | null;
  metadata: Record<string, string | number | boolean | null>;
}

export interface ProposalRecord {
  id: string;
  status: ProposalStatus;
  action: ProposalAction;
  kind: DirectiveKind;
  title: string;
  body: string;
  scope: Scope;
  target_directive_id: string | null;
  rationale: string;
  created_by: string;
  created_at: string;
  provenance: Provenance;
}

export interface CreateDirectiveInput {
  kind: DirectiveKind;
  title: string;
  body: string;
  scope: Scope;
  status?: "active" | "inactive";
  effective_from?: string;
  expires_at?: string | null;
  supersedes?: string | null;
  source: string;
  observed_at?: string;
  freshness_status?: FreshnessStatus;
  confidence?: number;
}

export interface VersionDirectiveInput {
  title?: string;
  body?: string;
  effective_from?: string;
  expires_at?: string | null;
  source?: string;
  observed_at?: string;
  freshness_status?: FreshnessStatus;
  confidence?: number | null;
}

export interface SubmitProposalInput {
  action: ProposalAction;
  kind: DirectiveKind;
  title: string;
  body: string;
  scope: Scope;
  target_directive_id?: string | null;
  rationale: string;
  source: string;
  observed_at?: string;
  freshness_status?: FreshnessStatus;
  confidence?: number;
}

export const LIMITS = {
  jsonBytes: 32 * 1024,
  titleChars: 200,
  bodyChars: 8000,
  sourceChars: 128,
  scopePartChars: 64,
  actorIdChars: 128,
  rationaleChars: 4000,
  companyChars: 64,
} as const;
