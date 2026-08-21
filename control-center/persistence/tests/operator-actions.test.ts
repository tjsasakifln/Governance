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
