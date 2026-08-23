import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { migrateUp } from "../src/index.js";
import { startIsolatedTestPostgres, type TestPostgres } from "./helpers/postgres.js";

let ctx: TestPostgres;

before(async () => {
  ctx = await startIsolatedTestPostgres();
  await migrateUp(ctx.pool);
});

after(async () => {
  await ctx.stop();
});

test("operator action is append-only, idempotent, and refuses forbidden types at the database", async () => {
  const source = { system: "control-center", kind: "operator-action", locator: "ex-1" };
  const observedAt = new Date("2026-08-21T12:00:00.000Z");
  const first = await ctx.persistence.recordOperatorAction({
    actionType: "MARK_REVIEWED",
    targetCanonicalId: "cc:attention-item:ex-1",
    targetSourceId: "ex-1",
    actorId: "human:founder",
    occurredAt: observedAt,
    correlationId: "corr-1",
    idempotencyKey: "mark-ex-1",
    scope: "commercial",
    source,
    observedAt,
    freshnessStatus: "FRESH",
    confidence: 1,
    note: "reviewed",
  });
  assert.equal(first.inserted, true);
  assert.match(first.action.id, /^cc:operator-action:/);
  const replay = await ctx.persistence.recordOperatorAction({
    actionType: "MARK_REVIEWED",
    targetCanonicalId: "cc:attention-item:ex-1",
    targetSourceId: "ex-1",
    actorId: "human:founder",
    occurredAt: observedAt,
    correlationId: "corr-1",
    idempotencyKey: "mark-ex-1",
    scope: "commercial",
    source,
    observedAt,
    freshnessStatus: "FRESH",
    confidence: 1,
    note: "reviewed",
  });
  assert.equal(replay.inserted, false);
  assert.equal(replay.action.resultingStatus, "duplicate");
  await assert.rejects(
    ctx.pool.query(`UPDATE control_center.operator_actions SET note = 'x' WHERE id = $1`, [first.action.id]),
  );
  await assert.rejects(
    ctx.pool.query(
      `INSERT INTO control_center.operator_actions (
         id, action_type, target_canonical_id, target_source_id, actor_kind, actor_id,
         occurred_at, correlation_id, idempotency_key, scope, resulting_status,
         source_system, source_kind, source_locator, observed_at, freshness_status, confidence
       ) VALUES (
         'cc:operator-action:forbidden', 'SEND_EMAIL', 'x', 'x', 'human', 'human:founder',
         now(), 'c', 'k-forbidden', 'commercial', 'accepted',
         'control-center', 'operator-action', 'x', now(), 'FRESH', 1
       )`,
    ),
  );
});

test("same idempotency key with a conflicting payload fails closed at PostgreSQL", async () => {
  const source = { system: "control-center", kind: "operator-action", locator: "ex-conflict" };
  const observedAt = new Date("2026-08-21T12:00:00.000Z");
  await ctx.persistence.recordOperatorAction({
    actionType: "MARK_REVIEWED",
    targetCanonicalId: "cc:attention-item:ex-conflict",
    targetSourceId: "ex-conflict",
    actorId: "human:founder",
    occurredAt: observedAt,
    correlationId: "corr-conflict",
    idempotencyKey: "conflict-payload",
    scope: "commercial",
    source,
    observedAt,
    freshnessStatus: "FRESH",
    confidence: 1,
    note: "first",
  });
  await assert.rejects(
    ctx.persistence.recordOperatorAction({
      actionType: "ACKNOWLEDGE_EXCEPTION",
      targetCanonicalId: "cc:attention-item:other",
      targetSourceId: "other",
      actorId: "human:founder",
      occurredAt: observedAt,
      correlationId: "corr-conflict",
      idempotencyKey: "conflict-payload",
      scope: "commercial",
      source,
      observedAt,
      freshnessStatus: "FRESH",
      confidence: 1,
      note: "second",
    }),
    /conflicting payload/,
  );
  const counted = await ctx.pool.query(
    `SELECT count(*)::int AS n FROM control_center.operator_actions WHERE idempotency_key = $1`,
    ["conflict-payload"],
  );
  assert.equal(counted.rows[0]?.n, 1);
});

test("a reused key cannot silently replace only the operator note", async () => {
  const source = { system: "control-center", kind: "operator-action", locator: "ex-note" };
  const observedAt = new Date("2026-08-21T12:00:00.000Z");
  const common = {
    actionType: "MARK_TRIAGED" as const,
    targetCanonicalId: "cc:attention-item:ex-note",
    targetSourceId: "ex-note",
    actorId: "human:founder",
    occurredAt: observedAt,
    correlationId: "corr-note",
    idempotencyKey: "conflict-note",
    scope: "commercial" as const,
    source,
    observedAt,
    freshnessStatus: "FRESH" as const,
    confidence: 1,
  };
  await ctx.persistence.recordOperatorAction({ ...common, note: "primeira decisão" });
  await assert.rejects(
    ctx.persistence.recordOperatorAction({ ...common, note: "decisão alterada" }),
    /conflicting payload/,
  );
});

test("daily triage and exception workflow actions are allowed but remain append-only local receipts", async () => {
  const observedAt = new Date("2026-08-22T12:00:00.000Z");
  for (const actionType of ["ASSIGN_TRIAGE", "MARK_TRIAGED", "START_EXCEPTION_WORK"] as const) {
    const result = await ctx.persistence.recordOperatorAction({
      actionType,
      targetCanonicalId: `cc:attention-item:${actionType.toLowerCase()}`,
      targetSourceId: actionType.toLowerCase(),
      actorId: "human:founder",
      occurredAt: observedAt,
      correlationId: `corr-${actionType}`,
      idempotencyKey: `workflow-${actionType}`,
      scope: "commercial",
      source: { system: "control-center", kind: "operator-action", locator: actionType },
      observedAt,
      freshnessStatus: "FRESH",
      confidence: 1,
      note: "fixture sandbox",
    });
    assert.equal(result.inserted, true);
    assert.equal(result.action.actionType, actionType);
  }
});
