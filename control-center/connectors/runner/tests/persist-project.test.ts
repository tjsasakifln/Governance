import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { migrateUp } from "../../../persistence/src/index.ts";
import { startIsolatedTestPostgres, type TestPostgres } from "../../../persistence/tests/helpers/postgres.ts";
import { persistSourceResult } from "../src/persist.ts";

let ctx: TestPostgres;

before(async () => {
  ctx = await startIsolatedTestPostgres();
  await migrateUp(ctx.pool);
});

after(async () => {
  await ctx.stop();
});

test("collector envelope projects to commercial snapshot_kind consumed by latest view", async () => {
  const observedAt = "2026-08-21T15:00:00.000Z";
  const result = await persistSourceResult(ctx.persistence, {
    collector: "warmbly",
    freshness_status: "FRESH",
    observed_at: observedAt,
    source: { system: "warmbly", kind: "collector-runner", locator: "warmbly" },
    confidence: 0.8,
    payload: {
      counts: { deals_open: 2, inbound_now: 1, tasks_overdue: 1, inbox_unread: 0 },
      attention: [],
      operations: { deals: [{ id: "d1", name: "Acme", status: "open", created_at: observedAt, updated_at: observedAt }] },
    },
  });
  assert.equal(result.status, "DONE");
  assert.ok(result.projected >= 1);
  const latest = await ctx.pool.query<{ snapshot_type: string; snapshot_json: Record<string, unknown> }>(
    `SELECT snapshot_type, snapshot_json FROM control_center.v_latest_operational_snapshots WHERE snapshot_type = 'commercial'`,
  );
  assert.equal(latest.rowCount, 1);
  const payload = latest.rows[0]?.snapshot_json ?? {};
  assert.equal(payload.schema_version, "control-center.commercial-snapshot.v1");
  assert.equal((payload.funnel as { opportunities?: number }).opportunities, 2);
  const replay = await persistSourceResult(ctx.persistence, {
    collector: "warmbly",
    freshness_status: "FRESH",
    observed_at: observedAt,
    source: { system: "warmbly", kind: "collector-runner", locator: "warmbly" },
    confidence: 0.8,
    payload: {
      counts: { deals_open: 2, inbound_now: 1, tasks_overdue: 1, inbox_unread: 0 },
      attention: [],
    },
  });
  assert.equal(replay.status, "DONE");
});

test("oversized Warmbly observation still persists a commercial snapshot", async () => {
  const observedAt = "2026-08-21T16:00:00.000Z";
  const intelExceptions = Array.from({ length: 400 }, (_, i) => ({
    id: `ex-${i}`,
    code: "orphan_chain",
    reason: "lead without deal ".repeat(40),
    next_action: "review",
    status: "open",
  }));
  const result = await persistSourceResult(ctx.persistence, {
    collector: "warmbly",
    freshness_status: "FRESH",
    observed_at: observedAt,
    source: { system: "warmbly", kind: "collector-runner", locator: "warmbly-large" },
    confidence: 0.8,
    payload: {
      counts: { deals_open: 1, inbound_now: 0 },
      operations: { intel_exceptions: intelExceptions, deals: [{ id: "d-large", name: "Acme", status: "open" }] },
      confenge_today: { lanes: { blob: "n".repeat(200_000) }, actions: intelExceptions },
    },
  });
  assert.equal(result.status, "DONE");
  assert.equal(result.errorCode, null);
  const latest = await ctx.pool.query<{ snapshot_type: string }>(
    `SELECT snapshot_type FROM control_center.v_latest_operational_snapshots
     WHERE snapshot_type = 'commercial' AND source_locator = 'warmbly-large'`,
  );
  assert.equal(latest.rowCount, 1);
  const observation = await ctx.pool.query<{ payload: { _persist_truncation?: { reason?: string } } }>(
    `SELECT payload FROM control_center.source_observations
     WHERE observation_kind = 'warmbly-collect' AND source_locator = 'warmbly-large'
     ORDER BY observed_at DESC LIMIT 1`,
  );
  assert.equal(observation.rowCount, 1);
  assert.equal(observation.rows[0]?.payload._persist_truncation?.reason, "payload_exceeds_persist_limit");
});
