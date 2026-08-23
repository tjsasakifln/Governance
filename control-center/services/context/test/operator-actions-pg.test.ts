import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { migrateUp, type Persistence } from "@confenge/control-center-persistence";
import { startIsolatedTestPostgres, type TestPostgres } from "../../../persistence/tests/helpers/postgres.ts";
import { createPostgresOperatorActionService } from "../src/operational/actions.ts";
import { AGENT, FOUNDER } from "./helpers.ts";

let ctx: TestPostgres;

const body = {
  action_type: "ACKNOWLEDGE_EXCEPTION",
  target_canonical_id: "cc:attention-item:ex-1",
  target_source_id: "ex-1",
  idempotency_key: "ack-ex-1",
  correlation_id: "ack-ex-1",
  scope: "commercial",
  note: "founder validation",
};

function wrapFailFirst(inner: Persistence, remaining: { n: number }): Persistence {
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === "recordOperatorAction") {
        return async (input: Parameters<Persistence["recordOperatorAction"]>[0]) => {
          if (remaining.n > 0) {
            remaining.n -= 1;
            throw new Error("injected ECONNRESET");
          }
          return target.recordOperatorAction(input);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

async function countActions(): Promise<number> {
  const result = await ctx.pool.query(`SELECT count(*)::int AS n FROM control_center.operator_actions`);
  return Number(result.rows[0]?.n ?? 0);
}

before(async () => {
  ctx = await startIsolatedTestPostgres();
  await migrateUp(ctx.pool);
});

after(async () => {
  await ctx.stop();
});

test("transient DB failure does not mark the key durable; retry persists one row", async () => {
  const remaining = { n: 1 };
  const service = createPostgresOperatorActionService(wrapFailFirst(ctx.persistence, remaining), FOUNDER.id);
  const firstKey = { ...body, idempotency_key: "retry-after-fail", correlation_id: "retry-after-fail" };
  await assert.rejects(() => service.submit(FOUNDER, firstKey), /ECONNRESET/);
  assert.equal(await countActions(), 0);
  const accepted = await service.submit(FOUNDER, firstKey);
  assert.equal(accepted.resulting_status, "accepted");
  assert.equal(await countActions(), 1);
  const replay = await service.submit(FOUNDER, firstKey);
  assert.equal(replay.resulting_status, "duplicate");
  assert.equal(await countActions(), 1);
});

test("concurrent identical submissions produce exactly one durable action", async () => {
  const service = createPostgresOperatorActionService(ctx.persistence, FOUNDER.id);
  const payload = { ...body, idempotency_key: "concurrent-dup", correlation_id: "concurrent-dup" };
  const results = await Promise.all([service.submit(FOUNDER, payload), service.submit(FOUNDER, payload)]);
  const accepted = results.filter((row) => row.resulting_status === "accepted");
  const duplicates = results.filter((row) => row.resulting_status === "duplicate");
  assert.equal(accepted.length, 1);
  assert.equal(duplicates.length, 1);
  const counted = await ctx.pool.query(
    `SELECT count(*)::int AS n FROM control_center.operator_actions WHERE idempotency_key = $1`,
    ["concurrent-dup"],
  );
  assert.equal(counted.rows[0]?.n, 1);
});

test("process restart still knows the idempotency key", async () => {
  const first = createPostgresOperatorActionService(ctx.persistence, FOUNDER.id);
  const payload = { ...body, idempotency_key: "restart-dup", correlation_id: "restart-dup" };
  const accepted = await first.submit(FOUNDER, payload);
  assert.equal(accepted.resulting_status, "accepted");
  const restarted = createPostgresOperatorActionService(ctx.persistence, FOUNDER.id);
  const replay = await restarted.submit(FOUNDER, payload);
  assert.equal(replay.resulting_status, "duplicate");
  const counted = await ctx.pool.query(
    `SELECT count(*)::int AS n FROM control_center.operator_actions WHERE idempotency_key = $1`,
    ["restart-dup"],
  );
  assert.equal(counted.rows[0]?.n, 1);
});

test("same idempotency key with conflicting payload fails closed", async () => {
  const service = createPostgresOperatorActionService(ctx.persistence, FOUNDER.id);
  const payload = { ...body, idempotency_key: "conflict-key", correlation_id: "conflict-key" };
  await service.submit(FOUNDER, payload);
  await assert.rejects(
    () =>
      service.submit(FOUNDER, {
        ...payload,
        action_type: "MARK_REVIEWED",
        target_canonical_id: "cc:attention-item:other",
        target_source_id: "other",
      }),
    /conflicting payload/,
  );
  const counted = await ctx.pool.query(
    `SELECT count(*)::int AS n FROM control_center.operator_actions WHERE idempotency_key = $1`,
    ["conflict-key"],
  );
  assert.equal(counted.rows[0]?.n, 1);
});

test("same idempotency key with a changed note fails closed after persistence", async () => {
  const service = createPostgresOperatorActionService(ctx.persistence, FOUNDER.id);
  const payload = {
    ...body,
    idempotency_key: "conflict-note-pg",
    correlation_id: "conflict-note-pg",
    note: "primeira decisão",
  };
  await service.submit(FOUNDER, payload);
  await assert.rejects(
    () => service.submit(FOUNDER, { ...payload, note: "decisão alterada" }),
    /conflicting payload/,
  );
});

test("agent and unknown actors cannot impersonate the founder", async () => {
  const service = createPostgresOperatorActionService(ctx.persistence, FOUNDER.id);
  await assert.rejects(
    () => service.submit(AGENT, { ...body, idempotency_key: "agent-impersonate" }),
    /founder|agent/i,
  );
  await assert.rejects(
    () =>
      service.submit(
        { kind: "human", id: "human:stranger" },
        { ...body, idempotency_key: "stranger" },
      ),
    /founder identity/,
  );
  const counted = await ctx.pool.query(
    `SELECT count(*)::int AS n FROM control_center.operator_actions WHERE idempotency_key = ANY($1)`,
    [["agent-impersonate", "stranger"]],
  );
  assert.equal(counted.rows[0]?.n, 0);
});
