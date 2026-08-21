import type { AgentLedger } from "./ledger.js";

/**
 * Synthetic UTC day used by tests, consumer, and CLI.
 * "Hoje" is this explicit window — never wall-clock, never America/Sao_Paulo.
 */
export const FIXTURE_DAY = "2026-08-20";
export const FIXTURE_FROM = "2026-08-20T00:00:00.000Z";
export const FIXTURE_TO = "2026-08-21T00:00:00.000Z";

export const PARTIAL_CORRELATION = "sess.cc-15-ledger-partial";
export const DONE_CORRELATION = "sess.cc-15-ledger-done";
export const OUTSIDE_CORRELATION = "sess.cc-15-ledger-outside";
export const STALE_CORRELATION = "sess.cc-15-ledger-stale";

export const FIXTURE_AGENT = { id: "agent:grok-4.6", provider: "xai" };
export const FIXTURE_REPO = "tjsasakifln/Governance";
export const FIXTURE_GOAL = "CAMPANHA: CONFENGE-CONTROL-CENTER-FANOUT-2026-08-20";
export const FIXTURE_CAMPAIGN = "CONFENGE-CONTROL-CENTER-FANOUT-2026-08-20";
export const FIXTURE_CONTEXT_VERSION = "control-center.context.v1-local";
export const FIXTURE_DIRECTIVE_ID = "cc:directive:ops-read-only";

export const PARTIAL_SUMMARY =
  "Shipped agent-activity ledger with start/report, audit trail, and timeline.";
export const PARTIAL_EVIDENCE = [
  "control-center/domains/agent-activity/tests/ledger.test.ts",
  "git:cc/15-agent-ledger",
];
export const PARTIAL_RESIDUAL = [
  "Wire MCP confenge.report_session_result at convergence",
  "Persist ledger rows in control-center/persistence agent-activity table (not agent_sessions)",
];
export const DONE_SUMMARY = "Collected GitHub refs for the campaign branch.";
export const DONE_EVIDENCE = ["commit:e2b0498a68092c1bdbf64aa31854d652c07afdc0"];

const AGENT_ACTOR = { kind: "agent" as const, id: "agent:grok-4.6" };

function provenance(
  kind: "start" | "report",
  locator: string,
  observedAt: string,
  confidence?: number,
) {
  return {
    source: {
      system: "agent" as const,
      kind,
      locator,
    },
    observed_at: observedAt,
    freshness_status: "FRESH" as const,
    ...(confidence !== undefined ? { confidence } : {}),
  };
}

/**
 * Seeds the in-process ledger with a known UTC day:
 * - PARTIAL session on 2026-08-20 with evidence and residual_work
 * - later DONE session on 2026-08-20 (last activity)
 * - DONE session on 2026-08-18 (outside the day window)
 *
 * Uses the shipped start/report API. Does not invent a parallel store.
 */
export function seedSyntheticDay(ledger: AgentLedger): void {
  ledger.startSession({
    correlation_id: PARTIAL_CORRELATION,
    agent: FIXTURE_AGENT,
    repo: FIXTURE_REPO,
    goal: FIXTURE_GOAL,
    campaign: FIXTURE_CAMPAIGN,
    started_at: "2026-08-20T10:00:00.000Z",
    refs: {
      branch: "cc/15-agent-ledger",
      commit: "e2b0498a68092c1bdbf64aa31854d652c07afdc0",
      pr: null,
      issues: ["Governance#control-center"],
    },
    context_consulted: {
      context_version: FIXTURE_CONTEXT_VERSION,
      directive_ids: [FIXTURE_DIRECTIVE_ID],
    },
    summary: "Starting agent-activity ledger work.",
    evidence: [],
    blockers: [],
    residual_work: [],
    actor: AGENT_ACTOR,
    ...provenance("start", PARTIAL_CORRELATION, "2026-08-20T10:00:00.000Z", 0.9),
  });

  ledger.reportResult({
    correlation_id: PARTIAL_CORRELATION,
    status: "PARTIAL",
    finished_at: "2026-08-20T12:00:00.000Z",
    summary: PARTIAL_SUMMARY,
    evidence: PARTIAL_EVIDENCE,
    blockers: [],
    residual_work: PARTIAL_RESIDUAL,
    actor: AGENT_ACTOR,
    ...provenance("report", PARTIAL_CORRELATION, "2026-08-20T12:00:00.000Z", 0.9),
  });

  ledger.startSession({
    correlation_id: DONE_CORRELATION,
    agent: FIXTURE_AGENT,
    repo: FIXTURE_REPO,
    goal: FIXTURE_GOAL,
    campaign: FIXTURE_CAMPAIGN,
    started_at: "2026-08-20T14:00:00.000Z",
    refs: {
      branch: "cc/15-agent-ledger",
      commit: "e2b0498a68092c1bdbf64aa31854d652c07afdc0",
      pr: null,
      issues: [],
    },
    context_consulted: {
      context_version: FIXTURE_CONTEXT_VERSION,
      directive_ids: [FIXTURE_DIRECTIVE_ID],
    },
    actor: AGENT_ACTOR,
    ...provenance("start", DONE_CORRELATION, "2026-08-20T14:00:00.000Z", 0.8),
  });

  ledger.reportResult({
    correlation_id: DONE_CORRELATION,
    status: "DONE",
    finished_at: "2026-08-20T15:00:00.000Z",
    summary: DONE_SUMMARY,
    evidence: DONE_EVIDENCE,
    blockers: [],
    residual_work: [],
    actor: AGENT_ACTOR,
    ...provenance("report", DONE_CORRELATION, "2026-08-20T15:00:00.000Z", 0.8),
  });

  ledger.startSession({
    correlation_id: OUTSIDE_CORRELATION,
    agent: { id: "agent:other", provider: "xai" },
    repo: FIXTURE_REPO,
    goal: "older campaign",
    campaign: "other",
    started_at: "2026-08-18T10:00:00.000Z",
    actor: { kind: "agent", id: "agent:other" },
    ...provenance("start", OUTSIDE_CORRELATION, "2026-08-18T10:00:00.000Z"),
  });

  ledger.reportResult({
    correlation_id: OUTSIDE_CORRELATION,
    status: "DONE",
    finished_at: "2026-08-18T11:00:00.000Z",
    summary: "Work from two days ago.",
    evidence: ["git:old"],
    residual_work: [],
    actor: { kind: "agent", id: "agent:other" },
    ...provenance("report", OUTSIDE_CORRELATION, "2026-08-18T11:00:00.000Z"),
  });
}

export function seedStaleRunning(ledger: AgentLedger): void {
  ledger.startSession({
    correlation_id: STALE_CORRELATION,
    agent: FIXTURE_AGENT,
    repo: FIXTURE_REPO,
    goal: FIXTURE_GOAL,
    campaign: FIXTURE_CAMPAIGN,
    started_at: "2026-08-20T08:00:00.000Z",
    summary: "Long-running collector that went silent.",
    evidence: [],
    residual_work: [],
    actor: AGENT_ACTOR,
    ...provenance("start", STALE_CORRELATION, "2026-08-20T08:00:00.000Z", 0.5),
  });
}
