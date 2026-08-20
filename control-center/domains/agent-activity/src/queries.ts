import type { ExecutionSession, TimelineItem } from "./contract.js";
import { parseUtc } from "./clock.js";

export function toTimelineItem(session: ExecutionSession): TimelineItem {
  const item: TimelineItem = {
    correlation_id: session.correlation_id,
    agent: { ...session.agent },
    repo: session.repo,
    goal: session.goal,
    campaign: session.campaign,
    started_at: session.started_at,
    finished_at: session.finished_at,
    status: session.status,
    needs_reconciliation: session.needs_reconciliation,
    refs: {
      branch: session.refs.branch,
      commit: session.refs.commit,
      pr: session.refs.pr,
      issues: [...session.refs.issues],
    },
    summary: session.summary,
    evidence: [...session.evidence],
    blockers: [...session.blockers],
    residual_work: [...session.residual_work],
    context_consulted: {
      context_version: session.context_consulted.context_version,
      directive_ids: [...session.context_consulted.directive_ids],
    },
    actor: { ...session.actor },
    founder_approval: session.founder_approval ? { ...session.founder_approval } : null,
    revision: session.revision,
    source: { ...session.source },
    observed_at: session.observed_at,
    freshness_status: session.freshness_status,
  };
  if (session.confidence !== undefined) {
    item.confidence = session.confidence;
  }
  return item;
}

export function overlapsWindow(session: ExecutionSession, fromIso: string, toIso: string): boolean {
  const from = parseUtc(fromIso).getTime();
  const to = parseUtc(toIso).getTime();
  const start = parseUtc(session.started_at).getTime();
  const end = parseUtc(
    session.finished_at ?? session.last_heartbeat_at ?? session.observed_at ?? session.started_at,
  ).getTime();
  return start < to && end >= from;
}

export function activityInstant(session: ExecutionSession): number {
  const iso = session.observed_at ?? session.finished_at ?? session.last_heartbeat_at ?? session.started_at;
  return parseUtc(iso).getTime();
}

export function compareActivity(a: ExecutionSession, b: ExecutionSession): number {
  const delta = activityInstant(a) - activityInstant(b);
  if (delta !== 0) {
    return delta;
  }
  return a.correlation_id.localeCompare(b.correlation_id);
}
