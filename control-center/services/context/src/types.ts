import type {
  ActorKind,
  CreateStatus,
  DirectiveKind,
  DirectiveStatus,
  FreshnessStatus,
} from "./taxonomy.ts";

export type {
  ActorKind,
  CreateStatus,
  DirectiveKind,
  DirectiveStatus,
  DomainLiteral,
  FreshnessStatus,
  ScopeLiteral,
} from "./taxonomy.ts";

export {
  ACTOR_KINDS,
  CREATE_STATUSES,
  DIRECTIVE_KINDS,
  DIRECTIVE_STATUSES,
  DOMAIN_LITERALS,
  FRESHNESS_STATUSES,
  SCOPE_LITERALS,
} from "./taxonomy.ts";

export const PROTECTED_KINDS = ["constraint", "decision"] as const;
export type ProtectedKind = (typeof PROTECTED_KINDS)[number];

export const PROPOSAL_ACTIONS = [
  "create",
  "version",
  "supersede",
  "expire",
  "activate",
  "revoke",
] as const;
export type ProposalAction = (typeof PROPOSAL_ACTIONS)[number];

export const PROPOSAL_STATUSES = ["pending", "rejected"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/** v1 scope: literal, `repo:<name>`, `client:<slug>`, or future prefix:id. */
export type Scope = string;

export type ResourceId = string;

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

/** @deprecated Use ActorRef. Alias so existing call sites compile during this PR. */
export type Actor = ActorRef;

export interface Provenance {
  source: SourceRef;
  observed_at: string;
  freshness_status: FreshnessStatus;
  confidence: number;
  freshness_window_seconds?: number;
}

export interface DirectiveRecord {
  id: ResourceId;
  revision_id: ResourceId;
  version: number;
  kind: DirectiveKind;
  title: string;
  body: string;
  scope: Scope;
  status: DirectiveStatus;
  effective_from: string;
  expires_at: string | null;
  supersedes: ResourceId[] | null;
  created_by: ActorRef;
  created_at: string;
  updated_at: string;
  provenance: Provenance;
}

export interface DirectiveView {
  id: ResourceId;
  revision_id: ResourceId;
  version: number;
  kind: DirectiveKind;
  title: string;
  body: string;
  scope: Scope;
  status: DirectiveStatus;
  effective_from: string;
  expires_at: string | null;
  supersedes: ResourceId[] | null;
  created_by: ActorRef;
  source: SourceRef;
  observed_at: string;
  freshness_status: FreshnessStatus;
  confidence: number;
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
  source: SourceRef;
  observed_at: string;
  freshness_status: FreshnessStatus;
  confidence: number;
}

export type AgentActivityKind = "session_result" | "blocker";

export interface AgentActivityRecord {
  id: ResourceId;
  correlation_id: string;
  agent_id: string;
  scope: Scope;
  status: "running" | "done" | "partial" | "blocked" | "failed";
  goal: string;
  summary: string;
  started_at: string;
  finished_at: string | null;
  kind: AgentActivityKind;
  payload: Record<string, unknown>;
  provenance: Provenance;
  actor: ActorRef;
}

export interface AuditEvent {
  id: ResourceId;
  at: string;
  actor: ActorRef;
  action: string;
  entity_type: "directive" | "proposal" | "agent_activity";
  entity_id: ResourceId;
  revision_id: ResourceId | null;
  metadata: Record<string, string | number | boolean | null>;
}

export interface DirectiveProposal {
  id: ResourceId;
  status: ProposalStatus;
  action: ProposalAction;
  kind: DirectiveKind;
  title: string;
  body: string;
  scope: Scope;
  target_directive_id: ResourceId | null;
  rationale: string;
  created_by: ActorRef;
  created_at: string;
  provenance: Provenance;
}

export type ProposalRecord = DirectiveProposal;

export interface CreateDirectiveInput {
  kind: DirectiveKind;
  title: string;
  body: string;
  scope: Scope;
  status?: CreateStatus;
  effective_from?: string;
  expires_at?: string | null;
  supersedes?: ResourceId[] | null;
  source: SourceRef;
  observed_at?: string;
  freshness_status?: FreshnessStatus;
  confidence: number;
}

export interface VersionDirectiveInput {
  title?: string;
  body?: string;
  effective_from?: string;
  expires_at?: string | null;
  source?: SourceRef;
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
  target_directive_id?: ResourceId | null;
  rationale: string;
  source: SourceRef;
  observed_at?: string;
  freshness_status?: FreshnessStatus;
  confidence: number;
}

export const LIMITS = {
  jsonBytes: 32 * 1024,
  titleChars: 200,
  bodyChars: 8000,
  sourceSystemChars: 64,
  sourceKindChars: 64,
  sourceLocatorChars: 512,
  sourceLabelChars: 128,
  scopeChars: 128,
  actorIdChars: 128,
  rationaleChars: 4000,
  resourceIdChars: 128,
  supersedesMax: 32,
} as const;
