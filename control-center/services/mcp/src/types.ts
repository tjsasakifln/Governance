import { FRESHNESS_STATUSES as CONTRACTS_FRESHNESS } from "@confenge/control-center-contracts";

export const FRESHNESS_STATUSES = CONTRACTS_FRESHNESS;
export type FreshnessStatus = (typeof FRESHNESS_STATUSES)[number];

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

export const DIRECTIVE_STATUSES = ["active", "superseded", "expired", "draft"] as const;
export type DirectiveStatus = (typeof DIRECTIVE_STATUSES)[number];

export const SESSION_OUTCOMES = ["completed", "partial", "failed", "blocked"] as const;
export type SessionOutcome = (typeof SESSION_OUTCOMES)[number];

export const BLOCKER_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type BlockerSeverity = (typeof BLOCKER_SEVERITIES)[number];

/** Provenance carried by every aggregated record. */
export interface Provenance {
  source: string;
  observed_at: string;
  freshness_status: FreshnessStatus;
  confidence?: number;
}

export interface AuditEvent {
  at: string;
  action: string;
  by: string;
}

export interface AuditTrail {
  created_at: string;
  updated_at: string;
  events: AuditEvent[];
}

export interface MoneyCents {
  amount_cents: number;
  currency: string;
}

export interface DirectiveRecord extends Provenance {
  id: string;
  kind: DirectiveKind;
  body: string;
  scope: string;
  status: DirectiveStatus;
  effective_from: string;
  expires_at: string | null;
  supersedes: string | null;
  created_by: string;
  audit: AuditTrail;
}

export interface ContextRecord extends Provenance {
  id: string;
  kind: DirectiveKind;
  title: string;
  body: string;
  scope: string;
}

export interface ExceptionRecord extends Provenance {
  id: string;
  title: string;
  body: string;
  scope: string;
  severity: BlockerSeverity;
}

export interface PriorityRecord extends Provenance {
  id: string;
  rank: number;
  title: string;
  body: string;
  scope: string;
  kind: "priority";
}

export interface DecisionRecord extends Provenance {
  id: string;
  kind: "decision";
  title: string;
  body: string;
  scope: string;
  status: DirectiveStatus;
  decided_at: string;
  effective_from: string;
  expires_at: string | null;
  supersedes: string | null;
  created_by: string;
  audit: AuditTrail;
}

export interface CompanyState extends Provenance {
  company_id: string;
  display_timezone: string;
  top_three: PriorityRecord[];
  exceptions: ExceptionRecord[];
}

export interface ScopedContext extends Provenance {
  scope: string;
  records: ContextRecord[];
}

export interface ClientContext extends Provenance {
  client: string;
  display_name: string;
  records: ContextRecord[];
  open_amount: MoneyCents;
}

export interface SessionResultInput {
  session_id?: string;
  scope: string;
  summary: string;
  outcome: SessionOutcome;
  notes?: string;
}

export interface BlockerInput {
  scope: string;
  summary: string;
  severity: BlockerSeverity;
  blocking: boolean;
}

export interface WriteReceipt extends Provenance {
  accepted: true;
  id: string;
  kind: "session_result" | "blocker";
  recorded_at: string;
}

export interface ContextApiPort {
  getCompanyState(): Promise<CompanyState>;
  getContext(scope: string): Promise<ScopedContext>;
  getActiveDirectives(scope: string): Promise<DirectiveRecord[]>;
  getPriorities(): Promise<PriorityRecord[]>;
  getClientContext(client: string): Promise<ClientContext>;
  getDecisions(since?: string): Promise<DecisionRecord[]>;
  reportSessionResult(input: SessionResultInput): Promise<WriteReceipt>;
  reportBlocker(input: BlockerInput): Promise<WriteReceipt>;
}

export const TOOL_NAMES = [
  "confenge.get_company_state",
  "confenge.get_context",
  "confenge.get_active_directives",
  "confenge.get_priorities",
  "confenge.get_client_context",
  "confenge.get_decisions",
  "confenge.report_session_result",
  "confenge.report_blocker",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export const RESOURCE_URIS = {
  checklist: "confenge://preflight/checklist",
  scopes: "confenge://preflight/scopes",
  rules: "confenge://session/operating-rules",
} as const;

export const PROMPT_NAMES = {
  preflight: "confenge.session_preflight",
  close: "confenge.session_close",
} as const;
