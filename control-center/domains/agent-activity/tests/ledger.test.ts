import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  createAgentLedger,
  DEFAULT_IDLE_THRESHOLD_SECONDS,
  DONE_CORRELATION,
  FIXTURE_AGENT,
  FIXTURE_CAMPAIGN,
  FIXTURE_CONTEXT_VERSION,
  FIXTURE_DAY,
  FIXTURE_DIRECTIVE_ID,
  FIXTURE_GOAL,
  FIXTURE_REPO,
  LedgerError,
  OUTSIDE_CORRELATION,
  PARTIAL_CORRELATION,
  PARTIAL_EVIDENCE,
  PARTIAL_RESIDUAL,
  PARTIAL_SUMMARY,
  SCHEMA_VERSION,
  STALE_CORRELATION,
  frozenClock,
  mcpOutcomeToStatus,
  seedStaleRunning,
  seedSyntheticDay,
  sessionIdFromCorrelation,
  statusToMcpOutcome,
} from "../src/index.js";

const DAY_CLOCK = frozenClock(new Date("2026-08-20T16:00:00.000Z"));

function agentProvenance(kind: "start" | "report", locator: string, at: string, confidence?: number) {
  return {
    source: { system: "agent", kind, locator },
    observed_at: at,
    freshness_status: "FRESH" as const,
    ...(confidence !== undefined ? { confidence } : {}),
  };
}

test("reported session round-trips the execution model and provenance", () => {
  const ledger = createAgentLedger({ now: DAY_CLOCK });
  const started = ledger.startSession({
    correlation_id: "sess.round-trip",
    agent: { id: "agent:grok-4.6", provider: "xai" },
    repo: "tjsasakifln/Governance",
    goal: "Build the agent-activity ledger",
    campaign: "CONFENGE-CONTROL-CENTER-FANOUT-2026-08-20",
    started_at: "2026-08-20T10:00:00.000Z",
    refs: {
      branch: "cc/15-agent-ledger",
      commit: "e2b0498a68092c1bdbf64aa31854d652c07afdc0",
      pr: "Governance#15",
      issues: ["Governance#control-center"],
    },
    summary: "Starting the ledger.",
    evidence: [],
    blockers: [],
    residual_work: [],
    context_consulted: {
      context_version: "control-center.context.v1-local",
      directive_ids: ["cc:directive:ops-read-only"],
    },
    actor: { kind: "agent", id: "agent:grok-4.6" },
    ...agentProvenance("start", "sess.round-trip", "2026-08-20T10:00:00.000Z", 0.91),
  });

  const reported = ledger.reportResult({
    correlation_id: "sess.round-trip",
    status: "PARTIAL",
    finished_at: "2026-08-20T12:30:00.000Z",
    summary: "Ledger core is in; MCP wiring remains.",
    evidence: ["tests/ledger.test.ts", "git:cc/15-agent-ledger"],
    blockers: ["MCP server lives in another workstream"],
    residual_work: ["converge confenge.report_session_result"],
    context_consulted: {
      context_version: "control-center.context.v1-local",
      directive_ids: ["cc:directive:ops-read-only"],
    },
    refs: {
      branch: "cc/15-agent-ledger",
      commit: "e2b0498a68092c1bdbf64aa31854d652c07afdc0",
      pr: "Governance#15",
      issues: ["Governance#control-center"],
    },
    actor: { kind: "agent", id: "agent:grok-4.6" },
    ...agentProvenance("report", "sess.round-trip", "2026-08-20T12:30:00.000Z", 0.91),
  });

  assert.equal(started.status, "RUNNING");
  assert.equal(started.finished_at, null);
  assert.equal(reported.schema_version, SCHEMA_VERSION);
  assert.equal(reported.id, sessionIdFromCorrelation("sess.round-trip"));
  assert.equal(reported.correlation_id, "sess.round-trip");
  assert.equal(reported.agent.id, "agent:grok-4.6");
  assert.equal(reported.agent.provider, "xai");
  assert.equal(reported.repo, "tjsasakifln/Governance");
  assert.equal(reported.goal, "Build the agent-activity ledger");
  assert.equal(reported.campaign, "CONFENGE-CONTROL-CENTER-FANOUT-2026-08-20");
  assert.equal(reported.started_at, "2026-08-20T10:00:00.000Z");
  assert.equal(reported.finished_at, "2026-08-20T12:30:00.000Z");
  assert.equal(reported.status, "PARTIAL");
  assert.equal(reported.refs.branch, "cc/15-agent-ledger");
  assert.equal(reported.refs.commit, "e2b0498a68092c1bdbf64aa31854d652c07afdc0");
  assert.equal(reported.refs.pr, "Governance#15");
  assert.deepEqual(reported.refs.issues, ["Governance#control-center"]);
  assert.equal(reported.summary, "Ledger core is in; MCP wiring remains.");
  assert.deepEqual(reported.evidence, ["tests/ledger.test.ts", "git:cc/15-agent-ledger"]);
  assert.deepEqual(reported.blockers, ["MCP server lives in another workstream"]);
  assert.deepEqual(reported.residual_work, ["converge confenge.report_session_result"]);
  assert.equal(reported.context_consulted.context_version, "control-center.context.v1-local");
  assert.deepEqual(reported.context_consulted.directive_ids, ["cc:directive:ops-read-only"]);
  assert.equal(reported.source.system, "agent");
  assert.equal(reported.observed_at, "2026-08-20T12:30:00.000Z");
  assert.equal(reported.freshness_status, "FRESH");
  assert.equal(reported.confidence, 0.91);
  assert.match(reported.started_at, /Z$/);
  assert.match(reported.finished_at ?? "", /Z$/);
  assert.match(reported.observed_at, /Z$/);
});

test("ingest without source, observed_at, or freshness_status is rejected", () => {
  const ledger = createAgentLedger({ now: DAY_CLOCK });
  const base = {
    correlation_id: "sess.missing-prov",
    agent: { id: "agent:grok-4.6", provider: "xai" },
    repo: FIXTURE_REPO,
    goal: FIXTURE_GOAL,
    actor: { kind: "agent", id: "agent:grok-4.6" },
  };

  const missingSource = () =>
    ledger.startSession({
      ...base,
      observed_at: "2026-08-20T10:00:00.000Z",
      freshness_status: "FRESH",
    });
  const missingObserved = () =>
    ledger.startSession({
      ...base,
      source: { system: "agent", kind: "start", locator: "sess.missing-prov" },
      freshness_status: "FRESH",
    });
  const missingFreshness = () =>
    ledger.startSession({
      ...base,
      source: { system: "agent", kind: "start", locator: "sess.missing-prov" },
      observed_at: "2026-08-20T10:00:00.000Z",
    });

  for (const fn of [missingSource, missingObserved, missingFreshness]) {
    assert.throws(fn, (error: unknown) => {
      assert.ok(error instanceof LedgerError);
      assert.equal(error.code, "missing_provenance");
      return true;
    });
  }
});

test("second report on the same correlation appends a revision; prior revision remains", () => {
  const ledger = createAgentLedger({ now: DAY_CLOCK });
  ledger.startSession({
    correlation_id: "sess.audit",
    agent: FIXTURE_AGENT,
    repo: FIXTURE_REPO,
    goal: FIXTURE_GOAL,
    started_at: "2026-08-20T10:00:00.000Z",
    actor: { kind: "agent", id: "agent:grok-4.6" },
    ...agentProvenance("start", "sess.audit", "2026-08-20T10:00:00.000Z"),
  });
  ledger.reportResult({
    correlation_id: "sess.audit",
    status: "PARTIAL",
    summary: "first cut",
    evidence: ["rev-1"],
    residual_work: ["more tests"],
    actor: { kind: "agent", id: "agent:grok-4.6" },
    ...agentProvenance("report", "sess.audit", "2026-08-20T11:00:00.000Z"),
  });
  const second = ledger.reportResult({
    correlation_id: "sess.audit",
    status: "DONE",
    summary: "tests landed",
    evidence: ["rev-1", "rev-2"],
    residual_work: [],
    actor: { kind: "agent", id: "agent:grok-4.6" },
    ...agentProvenance("report", "sess.audit", "2026-08-20T12:00:00.000Z"),
  });

  const revisions = ledger.listRevisions("sess.audit");
  assert.equal(revisions.length, 3);
  assert.equal(revisions[0]?.action, "started");
  assert.equal(revisions[0]?.snapshot.status, "RUNNING");
  assert.equal(revisions[1]?.action, "reported");
  assert.equal(revisions[1]?.snapshot.status, "PARTIAL");
  assert.deepEqual(revisions[1]?.snapshot.evidence, ["rev-1"]);
  assert.equal(revisions[2]?.snapshot.status, "DONE");
  assert.equal(second.status, "DONE");
  assert.equal(second.revision, 3);
  assert.notEqual(revisions[1]?.snapshot.summary, second.summary);
  const record = ledger.getSession("sess.audit");
  assert.ok(record);
  assert.equal(record.revisions.length, 3);
  assert.equal(record.head.revision, 3);
});

test("agent cannot stamp founder approval; founder write is distinguishable", () => {
  const ledger = createAgentLedger({ now: DAY_CLOCK });
  const forged = ledger.reportResult({
    correlation_id: "sess.approval",
    status: "DONE",
    agent: FIXTURE_AGENT,
    repo: FIXTURE_REPO,
    goal: FIXTURE_GOAL,
    campaign: FIXTURE_CAMPAIGN,
    started_at: "2026-08-20T09:00:00.000Z",
    finished_at: "2026-08-20T09:30:00.000Z",
    summary: "agent claims founder sign-off",
    evidence: ["claim"],
    residual_work: [],
    actor: { kind: "agent", id: "agent:grok-4.6" },
    founder_approval: {
      approved: true,
      by: "human:founder",
      at: "2026-08-20T09:30:00.000Z",
    },
    ...agentProvenance("report", "sess.approval", "2026-08-20T09:30:00.000Z"),
  });

  assert.equal(forged.actor.kind, "agent");
  assert.equal(forged.founder_approval, null);
  const afterForge = ledger.getSession("sess.approval");
  assert.ok(afterForge);
  assert.equal(afterForge.head.founder_approval, null);
  assert.equal(afterForge.revisions[0]?.note?.includes("founder_approval dropped"), true);

  const founder = ledger.reportResult({
    correlation_id: "sess.approval",
    status: "DONE",
    summary: "founder reviewed the leftover and accepted the result",
    evidence: ["claim", "founder-review"],
    residual_work: [],
    actor: { kind: "founder", id: "human:founder" },
    founder_approval: {
      approved: true,
      by: "human:founder",
      at: "2026-08-20T16:00:00.000Z",
    },
    source: {
      system: "manual",
      kind: "report",
      locator: "sess.approval",
    },
    observed_at: "2026-08-20T16:00:00.000Z",
    freshness_status: "FRESH",
    confidence: 1,
  });

  assert.equal(founder.actor.kind, "founder");
  assert.equal(founder.actor.id, "human:founder");
  assert.deepEqual(founder.founder_approval, {
    approved: true,
    by: "human:founder",
    at: "2026-08-20T16:00:00.000Z",
  });
  assert.notEqual(founder.actor.kind, forged.actor.kind);

  const overwriteAttempt = ledger.reportResult({
    correlation_id: "sess.approval",
    status: "DONE",
    summary: "agent tries to overwrite approval",
    evidence: ["forged-again"],
    residual_work: [],
    actor: { kind: "agent", id: "agent:grok-4.6" },
    founder_approval: {
      approved: true,
      by: "agent:grok-4.6",
      at: "2026-08-20T16:05:00.000Z",
    },
    ...agentProvenance("report", "sess.approval", "2026-08-20T16:05:00.000Z"),
  });
  assert.equal(overwriteAttempt.actor.kind, "agent");
  assert.deepEqual(overwriteAttempt.founder_approval, {
    approved: true,
    by: "human:founder",
    at: "2026-08-20T16:00:00.000Z",
  });
});

test("stale RUNNING reconciles to UNKNOWN with needs-reconciliation and never DONE", () => {
  assert.equal(DEFAULT_IDLE_THRESHOLD_SECONDS, 7200);
  const now = frozenClock(new Date("2026-08-20T16:00:00.000Z"));
  const ledger = createAgentLedger({ now, idleThresholdSeconds: DEFAULT_IDLE_THRESHOLD_SECONDS });
  seedStaleRunning(ledger);

  const before = ledger.getSession(STALE_CORRELATION);
  assert.ok(before);
  assert.equal(before.head.status, "UNKNOWN");
  assert.equal(before.head.needs_reconciliation, true);
  assert.notEqual(before.head.status, "DONE");
  assert.equal(before.head.finished_at, null);
  assert.equal(before.head.freshness_status, "STALE");
  assert.ok(
    before.head.blockers.some((item) => item.includes("needs reconciliation")),
  );
  const reconciledRev = before.revisions.find((row) => row.action === "reconciled");
  assert.ok(reconciledRev);
  assert.equal(reconciledRev.snapshot.status, "UNKNOWN");
  assert.notEqual(reconciledRev.snapshot.status, "DONE");
  assert.equal(reconciledRev.actor.kind, "system");

  const still = ledger.reconcileStale();
  assert.ok(still.every((session) => session.status === "UNKNOWN"));
  assert.ok(still.every((session) => session.status !== "DONE"));
  assert.ok(still.every((session) => session.needs_reconciliation));
});

test("timeline for a UTC day answers what agents did, with evidence and leftover work", () => {
  const ledger = createAgentLedger({ now: DAY_CLOCK });
  seedSyntheticDay(ledger);

  const items = ledger.timeline({ date: FIXTURE_DAY });
  const ids = items.map((item) => item.correlation_id);
  assert.ok(ids.includes(PARTIAL_CORRELATION));
  assert.ok(ids.includes(DONE_CORRELATION));
  assert.ok(!ids.includes(OUTSIDE_CORRELATION));

  const partial = items.find((item) => item.correlation_id === PARTIAL_CORRELATION);
  assert.ok(partial);
  assert.equal(partial.status, "PARTIAL");
  assert.equal(partial.summary, PARTIAL_SUMMARY);
  assert.deepEqual(partial.evidence, PARTIAL_EVIDENCE);
  assert.ok(partial.evidence.length > 0);
  assert.deepEqual(partial.residual_work, PARTIAL_RESIDUAL);
  assert.ok(partial.residual_work.length > 0);
  assert.equal(partial.agent.id, FIXTURE_AGENT.id);
  assert.equal(partial.agent.provider, FIXTURE_AGENT.provider);
  assert.equal(partial.repo, FIXTURE_REPO);
  assert.equal(partial.goal, FIXTURE_GOAL);
  assert.equal(partial.campaign, FIXTURE_CAMPAIGN);
  assert.equal(partial.context_consulted.context_version, FIXTURE_CONTEXT_VERSION);
  assert.deepEqual(partial.context_consulted.directive_ids, [FIXTURE_DIRECTIVE_ID]);
  assert.ok(partial.source);
  assert.ok(partial.observed_at.endsWith("Z"));
  assert.equal(partial.freshness_status, "FRESH");
  assert.equal(partial.confidence, 0.9);

  const done = items.find((item) => item.correlation_id === DONE_CORRELATION);
  assert.ok(done);
  assert.equal(done.status, "DONE");
  assert.deepEqual(done.residual_work, []);
  assert.ok(Array.isArray(done.evidence));

  const last = ledger.lastActivity({ date: FIXTURE_DAY });
  assert.ok(last);
  assert.equal(last.correlation_id, DONE_CORRELATION);
  assert.notEqual(last.correlation_id, PARTIAL_CORRELATION);
  assert.notEqual(last.correlation_id, OUTSIDE_CORRELATION);
  assert.equal(last.observed_at, "2026-08-20T15:00:00.000Z");
});

test("MCP outcome mapping is local and does not invent RUNNING/UNKNOWN outcomes", () => {
  assert.equal(mcpOutcomeToStatus("completed"), "DONE");
  assert.equal(mcpOutcomeToStatus("partial"), "PARTIAL");
  assert.equal(mcpOutcomeToStatus("failed"), "FAILED");
  assert.equal(mcpOutcomeToStatus("blocked"), "BLOCKED");
  assert.equal(statusToMcpOutcome("DONE"), "completed");
  assert.equal(statusToMcpOutcome("RUNNING"), null);
  assert.equal(statusToMcpOutcome("UNKNOWN"), null);
});

test("sensitive keys are rejected and never logged as success", () => {
  const ledger = createAgentLedger({ now: DAY_CLOCK });
  assert.throws(
    () =>
      ledger.startSession({
        correlation_id: "sess.secret",
        agent: FIXTURE_AGENT,
        repo: FIXTURE_REPO,
        goal: FIXTURE_GOAL,
        actor: { kind: "agent", id: "agent:grok-4.6" },
        password: "not-a-real-secret",
        source: { system: "agent", kind: "start", locator: "sess.secret" },
        observed_at: "2026-08-20T10:00:00.000Z",
        freshness_status: "FRESH",
      }),
    (error: unknown) => {
      assert.ok(error instanceof LedgerError);
      assert.equal(error.code, "sensitive_field");
      return true;
    },
  );
});

test("README documents ledger vs AgentSession, idle threshold, and MCP mapping", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  assert.match(readme, /execution ledger/i);
  assert.match(readme, /control-center\.agent-session\.v1/);
  assert.match(readme, /AGENT_ACTIVITY_IDLE_THRESHOLD_SECONDS/);
  assert.match(readme, /7200/);
  assert.match(readme, /confenge\.report_session_result/);
  assert.match(readme, /completed.*DONE|DONE.*completed/s);
  assert.match(readme, /npm test/);
  assert.match(readme, /consumer/);
});

test("package files stay under the owned path", () => {
  const pkg = readFileSync(new URL("../package.json", import.meta.url), "utf8");
  assert.match(pkg, /@confenge\/control-center-agent-activity/);
  assert.match(pkg, /agent execution ledger/);
});
