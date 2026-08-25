import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import EmbeddedPostgres from "embedded-postgres";
import type pg from "pg";
import { createPool, migrateUp } from "@confenge/control-center-persistence";
import {
  appendWorkOrderEvent,
  createWorkOrder,
  decideWorkOrder,
  getWorkOrder,
  listWorkOrderEvents,
  listWorkOrderHolds,
  rebuildWorkOrderProjection,
  type CreateWorkOrderCommand,
  type EventContext,
} from "../src/index.js";

let pool: pg.Pool;
let embedded: EmbeddedPostgres | null = null;
let databaseDirectory: string | null = null;

before(async () => {
  const configured = process.env.CONTROL_CENTER_TEST_DATABASE_URL;
  if (configured) {
    pool = createPool(configured);
  } else {
    const port = 26000 + Math.floor(Math.random() * 5000);
    const password = randomBytes(24).toString("hex");
    databaseDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "cc-delivery-pg-"));
    embedded = new EmbeddedPostgres({
      databaseDir: databaseDirectory,
      user: "cc_delivery_test",
      password,
      port,
      persistent: false,
      authMethod: "scram-sha-256",
      initdbFlags: ["--encoding=UTF8", "--locale=C"],
      onLog: () => undefined,
      onError: () => undefined,
    });
    await embedded.initialise();
    await embedded.start();
    await embedded.createDatabase("cc_delivery_test");
    pool = createPool(`postgres://cc_delivery_test:${password}@127.0.0.1:${port}/cc_delivery_test`);
  }
  await migrateUp(pool);
});

after(async () => {
  if (pool) await pool.end();
  if (embedded) await embedded.stop();
  if (databaseDirectory) fs.rmSync(databaseDirectory, { recursive: true, force: true });
});

const command: CreateWorkOrderCommand = {
  client_id: "client_store_sbx",
  account_id: "account_store_sbx",
  opportunity_id: "opp_store_sbx",
  qco_id: "qco_store_sbx",
  proposal_id: "proposal_store_sbx",
  proposal_version: "proposal.v1",
  order_id: "order_store_sbx",
  provider_refs: ["warmbly:proposal_store_sbx"],
  accepted_snapshot_hash: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  offer_id: "CFG-DIAG-EXP-v1",
  offer_version: "CFG-DIAG-EXP-v1",
  deliverable_id: "diagnostico-expansao",
  deliverable_version: "diagnostico-expansao.v1",
  scope_version: "CFG-SCOPE-DIAG-v1",
  price_version: "CFG-PRICE-DIAG-v1",
  terms_version: "CFG-TERMS-B2B-2026-08-17-v1",
  input_ids: ["brief"],
  business_calendar_version: "BR-SP-business-days.v1",
  estimated_effort_minutes: 4800,
  estimated_capacity_units: 1,
  capacity_commitment_id: "hold_store_sbx_001",
  financial_gate: "RECONCILED",
  readiness_state: "READY",
  synthetic: true,
};

function context(index: number): EventContext {
  return {
    actor: { kind: "human", id: "delivery-owner-sbx" },
    reason_code: "SANDBOX_PERSISTENCE",
    literal_reason_ref: `evidence:sandbox:store-${index}`,
    occurred_at: `2026-08-25T12:${String(index).padStart(2, "0")}:00Z`,
    idempotency_key: `store-work-order-event-${index}`,
    correlation_id: "corr-store-work-order",
    causation_id: index === 0 ? "proposal_store_sbx" : `event-${index - 1}`,
    source_system: "governance",
    evidence_refs: [`evidence:sandbox:store-${index}`],
  };
}

test("PostgreSQL appends, deduplicates, holds out-of-order/conflicting writes and rebuilds projection", async () => {
  const created = createWorkOrder(command, context(0));
  assert.equal((await appendWorkOrderEvent(pool, created.event, created.work_order)).status, "APPENDED");

  const input = decideWorkOrder(created.work_order, "INPUT_RECEIVED", {
    input_id: "brief", evidence_ref: "extra-cli:artifact:brief-store",
  }, context(1));
  const owner = decideWorkOrder(input.work_order, "OWNER_ASSIGNED", { owner: "delivery-owner-sbx" }, context(2));

  const held = await appendWorkOrderEvent(pool, owner.event, owner.work_order);
  assert.deepEqual(held, {
    status: "HELD",
    hold_id: held.status === "HELD" ? held.hold_id : "",
    reason: "VERSION_CONFLICT",
    current_version: 1,
  });

  assert.equal((await appendWorkOrderEvent(pool, input.event, input.work_order)).status, "APPENDED");
  assert.equal((await appendWorkOrderEvent(pool, owner.event, owner.work_order)).status, "APPENDED");
  const duplicate = await appendWorkOrderEvent(pool, input.event, input.work_order);
  assert.equal(duplicate.status, "DUPLICATE");
  if (duplicate.status === "DUPLICATE") assert.equal(duplicate.work_order.version, 3);

  const conflicting = structuredClone(owner.event);
  conflicting.reason_code = "CONFLICTING_REPLAY";
  const conflict = await appendWorkOrderEvent(pool, conflicting, owner.work_order);
  assert.equal(conflict.status, "HELD");
  if (conflict.status === "HELD") assert.equal(conflict.reason, "IDEMPOTENCY_CONFLICT");

  const events = await listWorkOrderEvents(pool, created.work_order.work_order_id);
  assert.deepEqual(events.map((event) => event.event_version), [1, 2, 3]);
  const holds = await listWorkOrderHolds(pool, created.work_order.work_order_id);
  assert.deepEqual(holds.map((item) => item.reason), ["VERSION_CONFLICT", "IDEMPOTENCY_CONFLICT"]);
  const rebuilt = await rebuildWorkOrderProjection(pool, created.work_order.work_order_id);
  assert.deepEqual(rebuilt, owner.work_order);
  assert.deepEqual(await getWorkOrder(pool, created.work_order.work_order_id), owner.work_order);

  await assert.rejects(
    pool.query(`UPDATE control_center.work_order_events SET reason_code = 'TAMPERED' WHERE event_id = $1`, [created.event.event_id]),
  );
  await assert.rejects(
    pool.query(`DELETE FROM control_center.work_order_event_holds WHERE work_order_id = $1`, [created.work_order.work_order_id]),
  );
  await assert.rejects(
    pool.query(
      `UPDATE control_center.work_orders
       SET projection_json = jsonb_set(projection_json, '{accepted_snapshot_hash}', '"sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"')
       WHERE work_order_id = $1`,
      [created.work_order.work_order_id],
    ),
    /immutable/i,
  );
});

test("one active Work Order identity cannot be duplicated", async () => {
  const other = createWorkOrder({ ...command, work_order_id: "cc:work-order:duplicate-active" }, {
    ...context(8),
    idempotency_key: "store-work-order-duplicate-active",
  });
  const result = await appendWorkOrderEvent(pool, other.event, other.work_order);
  assert.equal(result.status, "HELD");
  if (result.status === "HELD") assert.equal(result.reason, "ACTIVE_IDENTITY_CONFLICT");
});

test("concurrent duplicate identities serialize into one append and one hold", async () => {
  const concurrentCommand = {
    ...command,
    proposal_id: "proposal_concurrent_sbx",
    order_id: "order_concurrent_sbx",
    accepted_snapshot_hash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  };
  const left = createWorkOrder({ ...concurrentCommand, work_order_id: "cc:work-order:concurrent-left" }, {
    ...context(9), idempotency_key: "store-concurrent-left",
  });
  const right = createWorkOrder({ ...concurrentCommand, work_order_id: "cc:work-order:concurrent-right" }, {
    ...context(10), idempotency_key: "store-concurrent-right",
  });
  const results = await Promise.all([
    appendWorkOrderEvent(pool, left.event, left.work_order),
    appendWorkOrderEvent(pool, right.event, right.work_order),
  ]);
  assert.deepEqual(results.map((item) => item.status).sort(), ["APPENDED", "HELD"]);
  const held = results.find((item) => item.status === "HELD");
  assert.equal(held?.status === "HELD" ? held.reason : null, "ACTIVE_IDENTITY_CONFLICT");
});

test("persistence holds a contract-valid projection that was not derived from its event", async () => {
  const projectionCommand = {
    ...command,
    proposal_id: "proposal_projection_sbx",
    order_id: "order_projection_sbx",
    accepted_snapshot_hash: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
  };
  const created = createWorkOrder(projectionCommand, {
    ...context(11), idempotency_key: "store-projection-create",
  });
  const tampered = structuredClone(created.work_order);
  tampered.responsible_owner = "owner-not-in-event";
  const result = await appendWorkOrderEvent(pool, created.event, tampered);
  assert.equal(result.status, "HELD");
  if (result.status === "HELD") assert.equal(result.reason, "PROJECTION_CONFLICT");
  assert.equal(await getWorkOrder(pool, created.work_order.work_order_id), null);
});

test("persistence retains a same-version event whose timestamp regresses", async () => {
  const temporalCommand = {
    ...command,
    proposal_id: "proposal_temporal_sbx",
    order_id: "order_temporal_sbx",
    accepted_snapshot_hash: "sha256:abababababababababababababababababababababababababababababababab",
  };
  const created = createWorkOrder(temporalCommand, {
    ...context(12),
    occurred_at: "2026-08-25T12:30:00Z",
    idempotency_key: "store-temporal-create",
  });
  assert.equal((await appendWorkOrderEvent(pool, created.event, created.work_order)).status, "APPENDED");

  const owner = decideWorkOrder(created.work_order, "OWNER_ASSIGNED", { owner: "delivery-owner-sbx" }, {
    ...context(13),
    occurred_at: "2026-08-25T12:31:00Z",
    idempotency_key: "store-temporal-owner",
  });
  const regressedEvent = structuredClone(owner.event);
  regressedEvent.occurred_at = "2026-08-25T12:29:00Z";
  const regressedProjection = structuredClone(owner.work_order);
  regressedProjection.provenance.observed_at = regressedEvent.occurred_at;
  const result = await appendWorkOrderEvent(pool, regressedEvent, regressedProjection);
  assert.equal(result.status, "HELD");
  if (result.status === "HELD") assert.equal(result.reason, "TEMPORAL_CONFLICT");
  assert.deepEqual(await getWorkOrder(pool, created.work_order.work_order_id), created.work_order);
});
