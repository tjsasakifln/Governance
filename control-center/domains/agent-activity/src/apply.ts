import {
  SCHEMA_VERSION,
  emptyContext,
  emptyRefs,
  sessionIdFromCorrelation,
  type ActorRef,
  type ContextConsulted,
  type ExecutionRevision,
  type ExecutionSession,
  type ExecutionStatus,
  type FounderApproval,
  type LedgerRecord,
  type RevisionAction,
  type VcsRefs,
} from "./contract.js";
import { parseUtc, toUtcIso } from "./clock.js";
import { LedgerError } from "./errors.js";
import type { ParsedHeartbeat, ParsedReport, ParsedStart } from "./validate.js";

export interface ApplyResult {
  record: LedgerRecord;
  approval_stripped: boolean;
}

export function applyStart(
  existing: LedgerRecord | undefined,
  input: ParsedStart,
  now: Date,
): ApplyResult {
  const recordedAt = toUtcIso(now);
  const { approval, stripped } = resolveFounderApproval(
    input.actor,
    input.founder_approval,
    existing?.head.founder_approval ?? null,
  );
  const startedAt = input.started_at ?? recordedAt;
  const snapshot: ExecutionSession = {
    schema_version: SCHEMA_VERSION,
    id: existing?.head.id ?? sessionIdFromCorrelation(input.correlation_id),
    correlation_id: input.correlation_id,
    revision: 0,
    agent: input.agent,
    repo: input.repo,
    goal: input.goal,
    campaign: input.campaign,
    started_at: existing?.head.started_at ?? startedAt,
    finished_at: null,
    last_heartbeat_at: startedAt,
    status: "RUNNING",
    needs_reconciliation: false,
    refs: input.refs,
    summary: input.summary,
    evidence: [...input.evidence],
    blockers: [...input.blockers],
    residual_work: [...input.residual_work],
    context_consulted: input.context_consulted,
    actor: input.actor,
    founder_approval: approval,
    source: input.provenance.source,
    observed_at: input.provenance.observed_at,
    freshness_status: input.provenance.freshness_status,
    ...(input.provenance.confidence !== undefined
      ? { confidence: input.provenance.confidence }
      : {}),
  };
  const action: RevisionAction = existing ? "revised" : "started";
  const note = stripped
    ? "agent-attributed founder_approval dropped; record stays agent-reported"
    : null;
  return {
    record: appendRevision(existing, snapshot, action, input.actor, recordedAt, note),
    approval_stripped: stripped,
  };
}

export function applyReport(
  existing: LedgerRecord | undefined,
  input: ParsedReport,
  now: Date,
): ApplyResult {
  const recordedAt = toUtcIso(now);
  const { approval, stripped } = resolveFounderApproval(
    input.actor,
    input.founder_approval,
    existing?.head.founder_approval ?? null,
  );
  const base = existing?.head;
  const agent = input.agent ?? base?.agent;
  const repo = input.repo ?? base?.repo;
  const goal = input.goal ?? base?.goal;
  if (!agent || !repo || !goal) {
    throw new LedgerError(
      "invalid_input",
      "report without a prior start requires agent, repo, and goal",
    );
  }
  const startedAt = input.started_at ?? base?.started_at ?? input.provenance.observed_at;
  const finishedAt = resolveFinishedAt(input.status, input.finished_at, recordedAt, base);
  const snapshot: ExecutionSession = {
    schema_version: SCHEMA_VERSION,
    id: base?.id ?? sessionIdFromCorrelation(input.correlation_id),
    correlation_id: input.correlation_id,
    revision: 0,
    agent,
    repo,
    goal,
    campaign: input.campaign !== undefined ? input.campaign : (base?.campaign ?? null),
    started_at: startedAt,
    finished_at: finishedAt,
    last_heartbeat_at: input.provenance.observed_at,
    status: input.status,
    needs_reconciliation: input.status === "UNKNOWN" ? true : false,
    refs: mergeRefs(base?.refs, input.refs),
    summary: input.summary,
    evidence: input.evidence ?? base?.evidence ?? [],
    blockers: input.blockers ?? base?.blockers ?? [],
    residual_work: input.residual_work ?? base?.residual_work ?? [],
    context_consulted: mergeContext(base?.context_consulted, input.context_consulted),
    actor: input.actor,
    founder_approval: approval,
    source: input.provenance.source,
    observed_at: input.provenance.observed_at,
    freshness_status: input.provenance.freshness_status,
    ...(input.provenance.confidence !== undefined
      ? { confidence: input.provenance.confidence }
      : base?.confidence !== undefined
        ? { confidence: base.confidence }
        : {}),
  };
  const action: RevisionAction = "reported";
  const note = stripped
    ? "agent-attributed founder_approval dropped; record stays agent-reported"
    : null;
  return {
    record: appendRevision(existing, snapshot, action, input.actor, recordedAt, note),
    approval_stripped: stripped,
  };
}

export function applyHeartbeat(
  existing: LedgerRecord,
  input: ParsedHeartbeat,
  now: Date,
): LedgerRecord {
  if (existing.head.status !== "RUNNING") {
    throw new LedgerError(
      "invalid_input",
      `heartbeat is only valid on RUNNING sessions, got ${existing.head.status}`,
    );
  }
  const recordedAt = toUtcIso(now);
  const snapshot: ExecutionSession = {
    ...existing.head,
    revision: 0,
    last_heartbeat_at: input.provenance.observed_at,
    source: input.provenance.source,
    observed_at: input.provenance.observed_at,
    freshness_status: input.provenance.freshness_status,
    actor: input.actor,
    needs_reconciliation: false,
    ...(input.provenance.confidence !== undefined
      ? { confidence: input.provenance.confidence }
      : existing.head.confidence !== undefined
        ? { confidence: existing.head.confidence }
        : {}),
  };
  return appendRevision(
    existing,
    snapshot,
    "heartbeat",
    input.actor,
    recordedAt,
    null,
  );
}

export function applyReconcile(
  existing: LedgerRecord,
  now: Date,
  idleThresholdMs: number,
): LedgerRecord | null {
  const head = existing.head;
  if (head.status !== "RUNNING") {
    return null;
  }
  const last = parseUtc(head.last_heartbeat_at ?? head.started_at);
  if (now.getTime() - last.getTime() < idleThresholdMs) {
    return null;
  }
  const recordedAt = toUtcIso(now);
  const systemActor: ActorRef = {
    kind: "system",
    id: "system:agent-activity-reconciler",
  };
  const snapshot: ExecutionSession = {
    ...head,
    revision: 0,
    status: "UNKNOWN",
    needs_reconciliation: true,
    finished_at: null,
    observed_at: recordedAt,
    freshness_status: "STALE",
    source: {
      system: "governance",
      kind: "reconciliation",
      locator: head.correlation_id,
    },
    actor: systemActor,
    blockers: uniqueStrings([
      ...head.blockers,
      "stale_running: idle threshold exceeded; needs reconciliation",
    ]),
  };
  return appendRevision(
    existing,
    snapshot,
    "reconciled",
    systemActor,
    recordedAt,
    "RUNNING idle past threshold → UNKNOWN (never DONE)",
  );
}

export function appendRevision(
  existing: LedgerRecord | undefined,
  snapshot: ExecutionSession,
  action: RevisionAction,
  actor: ActorRef,
  recordedAt: string,
  note: string | null,
): LedgerRecord {
  const revision = (existing?.head.revision ?? 0) + 1;
  const withRev: ExecutionSession = { ...snapshot, revision };
  const entry: ExecutionRevision = {
    revision,
    recorded_at: recordedAt,
    actor: { ...actor },
    action,
    snapshot: structuredClone(withRev),
    note,
  };
  return {
    correlation_id: withRev.correlation_id,
    head: structuredClone(withRev),
    revisions: [...(existing?.revisions ?? []), entry],
  };
}

function resolveFounderApproval(
  actor: ActorRef,
  claimed: FounderApproval | null,
  previous: FounderApproval | null,
): { approval: FounderApproval | null; stripped: boolean } {
  if (actor.kind === "founder") {
    if (claimed) {
      if (claimed.by !== actor.id) {
        throw new LedgerError(
          "invalid_input",
          "founder_approval.by must match the founder actor id",
        );
      }
      return { approval: claimed, stripped: false };
    }
    return { approval: previous, stripped: false };
  }
  const stripped = claimed !== null;
  return { approval: previous, stripped };
}

function resolveFinishedAt(
  status: ExecutionStatus,
  requested: string | null | undefined,
  recordedAt: string,
  base: ExecutionSession | undefined,
): string | null {
  if (status === "RUNNING") {
    return null;
  }
  if (status === "UNKNOWN") {
    return requested === undefined ? (base?.finished_at ?? null) : requested;
  }
  if (requested === null) {
    return recordedAt;
  }
  if (requested === undefined) {
    return base?.finished_at ?? recordedAt;
  }
  return requested;
}

function mergeRefs(base: VcsRefs | undefined, patch: Partial<VcsRefs> | undefined): VcsRefs {
  const start = base ?? emptyRefs();
  if (!patch) {
    return { ...start, issues: [...start.issues] };
  }
  return {
    branch: patch.branch !== undefined ? patch.branch : start.branch,
    commit: patch.commit !== undefined ? patch.commit : start.commit,
    pr: patch.pr !== undefined ? patch.pr : start.pr,
    issues: patch.issues !== undefined ? [...patch.issues] : [...start.issues],
  };
}

function mergeContext(
  base: ContextConsulted | undefined,
  patch: Partial<ContextConsulted> | undefined,
): ContextConsulted {
  const start = base ?? emptyContext();
  if (!patch) {
    return { ...start, directive_ids: [...start.directive_ids] };
  }
  return {
    context_version:
      patch.context_version !== undefined ? patch.context_version : start.context_version,
    directive_ids:
      patch.directive_ids !== undefined ? [...patch.directive_ids] : [...start.directive_ids],
  };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
