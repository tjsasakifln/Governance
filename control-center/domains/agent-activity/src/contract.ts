/**
 * Local agent-activity / provenance contract for this workstream.
 *
 * This is an EXECUTION LEDGER (what an agent ran, with evidence and leftover
 * work). It is NOT `control-center.agent-session.v1` (context-consult object
 * with status `open|closed|denied`) and NOT `control-center.persistence`
 * `agent_sessions` (context query log). Do not import those sibling trees.
 *
 * Convergence mapping (documented, not imported):
 * - `source` here is a SourceRef `{ system, kind, locator }` matching
 *   contracts `Provenance.source`. MCP string `source` maps to
 *   `{ system, kind: "report", locator: correlation_id }`.
 * - `freshness_status` uppercase here (FRESH|STALE|UNKNOWN|ERROR) matches
 *   contracts. Persistence/MCP lowercase maps:
 *   FRESH↔fresh, STALE↔stale, UNKNOWN↔unknown, ERROR↔error|degraded.
 * - `id` uses `cc:agent-activity:<slug>` (type kebab owned here until catalog
 *   convergence). Persistence UUID ids will be mapped at convergence.
 * - Timestamps are UTC RFC3339 with mandatory Z. Presentation MAY convert
 *   to America/Sao_Paulo.
 * - MCP `confenge.report_session_result` outcomes map via mcp-map.ts:
 *   completed↔DONE, partial↔PARTIAL, failed↔FAILED, blocked↔BLOCKED.
 *   RUNNING and UNKNOWN are ledger-only (no MCP outcome).
 */

export const SCHEMA_VERSION = "control-center.agent-activity.v1" as const;

export const UTC_DATETIME_PATTERN =
  "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]{1,9})?Z$";

export const UTC_DATE_PATTERN = "^[0-9]{4}-[0-9]{2}-[0-9]{2}$";

export const CORRELATION_ID_PATTERN = "^[A-Za-z0-9._:~-]{1,128}$";

export const ACTOR_ID_PATTERN = "^[A-Za-z0-9._:@-]{1,128}$";

export const SOURCE_SYSTEM_PATTERN = "^[a-z][a-z0-9-]{0,63}$";

export const SOURCE_KIND_PATTERN = "^[a-z][a-z0-9._-]{0,63}$";

export const EXECUTION_STATUSES = [
  "RUNNING",
  "DONE",
  "PARTIAL",
  "BLOCKED",
  "FAILED",
  "UNKNOWN",
] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export const TERMINAL_STATUSES = [
  "DONE",
  "PARTIAL",
  "BLOCKED",
  "FAILED",
] as const;
export type TerminalStatus = (typeof TERMINAL_STATUSES)[number];

export const FRESHNESS_STATUSES = ["FRESH", "STALE", "UNKNOWN", "ERROR"] as const;
export type FreshnessStatus = (typeof FRESHNESS_STATUSES)[number];

export const ACTOR_KINDS = ["agent", "founder", "system"] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

export const REVISION_ACTIONS = [
  "started",
  "reported",
  "heartbeat",
  "reconciled",
  "revised",
] as const;
export type RevisionAction = (typeof REVISION_ACTIONS)[number];

export const MCP_OUTCOMES = ["completed", "partial", "failed", "blocked"] as const;
export type McpOutcome = (typeof MCP_OUTCOMES)[number];

/** Default idle window for stale RUNNING detection: 2 hours. */
export const DEFAULT_IDLE_THRESHOLD_SECONDS = 7200;

export const SOURCE_SYSTEM_AGENT = "agent";
export const SOURCE_SYSTEM_GOVERNANCE = "governance";
export const SOURCE_SYSTEM_MANUAL = "manual";
export const SOURCE_KIND_REPORT = "report";
export const SOURCE_KIND_START = "start";
export const SOURCE_KIND_HEARTBEAT = "heartbeat";
export const SOURCE_KIND_RECONCILIATION = "reconciliation";

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

/**
 * Required on every aggregated record. `confidence` is trust, not recency.
 * `freshness_status` is recency. They are not aliases.
 */
export interface Provenance {
  source: SourceRef;
  observed_at: string;
  freshness_status: FreshnessStatus;
  confidence?: number;
}

export interface VcsRefs {
  branch: string | null;
  commit: string | null;
  pr: string | null;
  issues: string[];
}

export interface ContextConsulted {
  context_version: string | null;
  directive_ids: string[];
}

/**
 * Founder approval is a human stamp. Agents cannot create or overwrite it.
 */
export interface FounderApproval {
  approved: true;
  by: string;
  at: string;
}

export interface AgentRef {
  id: string;
  provider: string;
}

export interface ExecutionSession extends Provenance {
  schema_version: typeof SCHEMA_VERSION;
  id: string;
  correlation_id: string;
  revision: number;
  agent: AgentRef;
  repo: string;
  goal: string;
  campaign: string | null;
  started_at: string;
  finished_at: string | null;
  last_heartbeat_at: string | null;
  status: ExecutionStatus;
  needs_reconciliation: boolean;
  refs: VcsRefs;
  summary: string;
  evidence: string[];
  blockers: string[];
  residual_work: string[];
  context_consulted: ContextConsulted;
  actor: ActorRef;
  founder_approval: FounderApproval | null;
}

export interface ExecutionRevision {
  revision: number;
  recorded_at: string;
  actor: ActorRef;
  action: RevisionAction;
  snapshot: ExecutionSession;
  note: string | null;
}

export interface LedgerRecord {
  correlation_id: string;
  head: ExecutionSession;
  revisions: ExecutionRevision[];
}

/** Timeline / last-activity projection for founder and homepage. */
export interface TimelineItem extends Provenance {
  correlation_id: string;
  agent: AgentRef;
  repo: string;
  goal: string;
  campaign: string | null;
  started_at: string;
  finished_at: string | null;
  status: ExecutionStatus;
  needs_reconciliation: boolean;
  refs: VcsRefs;
  summary: string;
  evidence: string[];
  blockers: string[];
  residual_work: string[];
  context_consulted: ContextConsulted;
  actor: ActorRef;
  founder_approval: FounderApproval | null;
  revision: number;
}

export interface TimelineQuery {
  from: string;
  to: string;
}

export interface LastActivityQuery {
  as_of?: string;
}

/**
 * Persistence port. Postgres in `control-center/persistence` should implement
 * the same operations at convergence. This wave uses an in-process Map.
 * Do not confuse with persistence `agent_sessions` (context query log).
 */
export interface AgentActivityRepository {
  get(correlationId: string): LedgerRecord | undefined;
  put(record: LedgerRecord): void;
  list(): LedgerRecord[];
}

export function sessionIdFromCorrelation(correlationId: string): string {
  const slug = correlationId.replace(/:/g, "-");
  return `cc:agent-activity:${slug}`;
}

export function emptyRefs(): VcsRefs {
  return { branch: null, commit: null, pr: null, issues: [] };
}

export function emptyContext(): ContextConsulted {
  return { context_version: null, directive_ids: [] };
}
