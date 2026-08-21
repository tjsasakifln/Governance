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
