import {
  DEFAULT_IDLE_THRESHOLD_SECONDS,
  type AgentActivityRepository,
  type ExecutionRevision,
  type ExecutionSession,
  type LedgerRecord,
  type TimelineItem,
} from "./contract.js";
import { resolveClock, type Clock } from "./clock.js";
import { LedgerError } from "./errors.js";
import { applyHeartbeat, applyReconcile, applyReport, applyStart } from "./apply.js";
import { structuredLog } from "./log.js";
import { activityInstant, compareActivity, overlapsWindow, toTimelineItem } from "./queries.js";
import { InMemoryAgentActivityStore } from "./store.js";
import {
  parseHeartbeatInput,
  parseLastActivityQuery,
  parseReportInput,
  parseStartInput,
  parseTimelineQuery,
} from "./validate.js";

export interface CreateAgentLedgerOptions {
  now?: Date | Clock;
  store?: AgentActivityRepository;
  idleThresholdSeconds?: number;
}

export interface AgentLedger {
  startSession(raw: unknown): ExecutionSession;
  reportResult(raw: unknown): ExecutionSession;
  heartbeat(raw: unknown): ExecutionSession;
  reconcileStale(): ExecutionSession[];
  timeline(query: unknown): TimelineItem[];
  lastActivity(query?: unknown): TimelineItem | null;
  getSession(correlationId: string): LedgerRecord | undefined;
  listRevisions(correlationId: string): ExecutionRevision[];
}

/**
 * In-process execution ledger. Homepage and MCP should call these operations
 * after convergence; they must not invent a parallel activity log.
 */
export function createAgentLedger(options: CreateAgentLedgerOptions = {}): AgentLedger {
  const clock = resolveClock(options.now);
  const store = options.store ?? new InMemoryAgentActivityStore();
  const idleThresholdMs =
    (options.idleThresholdSeconds ?? readIdleThresholdSeconds()) * 1000;

  function persistReconcile(): void {
    for (const current of store.list()) {
      const updated = applyReconcile(current, clock(), idleThresholdMs);
      if (updated) {
        store.put(updated);
        structuredLog({
          event: "session_reconciled",
          correlation_id: updated.correlation_id,
          status: updated.head.status,
          action: "reconciled",
          revision: updated.head.revision,
          actor_kind: "system",
        });
      }
    }
  }

  return {
    startSession(raw: unknown): ExecutionSession {
      const input = parseStartInput(raw);
      const existing = store.get(input.correlation_id);
      const result = applyStart(existing, input, clock());
      store.put(result.record);
      structuredLog({
        event: "session_started",
        correlation_id: result.record.correlation_id,
        status: result.record.head.status,
        action: existing ? "revised" : "started",
        revision: result.record.head.revision,
        actor_kind: input.actor.kind,
        approval_stripped: result.approval_stripped,
      });
      return structuredClone(result.record.head);
    },

    reportResult(raw: unknown): ExecutionSession {
      const input = parseReportInput(raw);
      const existing = store.get(input.correlation_id);
      const result = applyReport(existing, input, clock());
      store.put(result.record);
      structuredLog({
        event: "session_reported",
        correlation_id: result.record.correlation_id,
        status: result.record.head.status,
        action: "reported",
        revision: result.record.head.revision,
        actor_kind: input.actor.kind,
        approval_stripped: result.approval_stripped,
      });
      return structuredClone(result.record.head);
    },

    heartbeat(raw: unknown): ExecutionSession {
      const input = parseHeartbeatInput(raw);
      const existing = store.get(input.correlation_id);
      if (!existing) {
        throw new LedgerError("not_found", `no session ${input.correlation_id}`);
      }
      const record = applyHeartbeat(existing, input, clock());
      store.put(record);
      structuredLog({
        event: "session_heartbeat",
        correlation_id: record.correlation_id,
        status: record.head.status,
        action: "heartbeat",
        revision: record.head.revision,
        actor_kind: input.actor.kind,
      });
      return structuredClone(record.head);
    },

    reconcileStale(): ExecutionSession[] {
      persistReconcile();
      return store
        .list()
        .filter((row) => row.head.needs_reconciliation && row.head.status === "UNKNOWN")
        .map((row) => structuredClone(row.head));
    },

    timeline(query: unknown): TimelineItem[] {
      persistReconcile();
      const window = parseTimelineQuery(query);
      return store
        .list()
        .map((row) => row.head)
        .filter((session) => overlapsWindow(session, window.from, window.to))
        .sort((a, b) => {
          const started = a.started_at.localeCompare(b.started_at);
          if (started !== 0) {
            return started;
          }
          return a.correlation_id.localeCompare(b.correlation_id);
        })
        .map((session) => toTimelineItem(session));
    },

    lastActivity(query: unknown = {}): TimelineItem | null {
      persistReconcile();
      const parsed = parseLastActivityQuery(query);
      const asOfMs = parsed.as_of ? Date.parse(parsed.as_of) : clock().getTime();
      let sessions = store.list().map((row) => row.head);
      const windowFrom = parsed.from;
      const windowTo = parsed.to;
      if (windowFrom && windowTo) {
        sessions = sessions.filter((session) => overlapsWindow(session, windowFrom, windowTo));
      }
      const eligible = sessions.filter((session) => activityInstant(session) <= asOfMs);
      if (eligible.length === 0) {
        return null;
      }
      const latest = eligible.reduce((best, current) =>
        compareActivity(current, best) > 0 ? current : best,
      );
      return toTimelineItem(latest);
    },

    getSession(correlationId: string): LedgerRecord | undefined {
      persistReconcile();
      return store.get(correlationId);
    },

    listRevisions(correlationId: string): ExecutionRevision[] {
      persistReconcile();
      const record = store.get(correlationId);
      if (!record) {
        throw new LedgerError("not_found", `no session ${correlationId}`);
      }
      return structuredClone(record.revisions);
    },
  };
}

function readIdleThresholdSeconds(): number {
  const raw = process.env.AGENT_ACTIVITY_IDLE_THRESHOLD_SECONDS;
  if (raw === undefined || raw === "") {
    return DEFAULT_IDLE_THRESHOLD_SECONDS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_IDLE_THRESHOLD_SECONDS;
  }
  return parsed;
}
