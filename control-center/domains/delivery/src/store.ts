import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type pg from "pg";
import {
  validate,
  type WorkOrder,
  type WorkOrderEvent,
} from "@confenge/control-center-contracts";
import { withTransaction } from "@confenge/control-center-persistence";
import { applyWorkOrderEvent, replayWorkOrder } from "./aggregate.js";
import { invariant, WorkOrderError } from "./errors.js";

export type WorkOrderHoldReason =
  | "MISSING_ORDER"
  | "VERSION_CONFLICT"
  | "IDEMPOTENCY_CONFLICT"
  | "ACTIVE_IDENTITY_CONFLICT"
  | "TEMPORAL_CONFLICT"
  | "PROJECTION_CONFLICT";

export type AppendWorkOrderResult =
  | { status: "APPENDED"; work_order: WorkOrder }
  | { status: "DUPLICATE"; work_order: WorkOrder }
  | { status: "HELD"; hold_id: string; reason: WorkOrderHoldReason; current_version: number | null };

export interface WorkOrderHold {
  hold_id: string;
  work_order_id: string;
  reason: WorkOrderHoldReason;
  current_version: number | null;
  idempotency_key: string;
  event: WorkOrderEvent;
  projection: WorkOrder;
  held_at: string;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function assertContracts(event: WorkOrderEvent, projection: WorkOrder): void {
  const eventResult = validate("WorkOrderEvent", event);
  const orderResult = validate("WorkOrder", projection);
  if (!eventResult.ok || !orderResult.ok) {
    throw new WorkOrderError(
      "INVALID_EVENT",
      [...eventResult.errors, ...orderResult.errors].map((item) => `${item.path} ${item.message}`).join("; "),
    );
  }
  invariant(event.work_order_id === projection.work_order_id, "INVALID_EVENT", "event/projection Work Order mismatch");
  invariant(event.event_version === projection.version, "INVALID_EVENT", "event/projection version mismatch");
  invariant(event.event_id === projection.last_event_id, "INVALID_EVENT", "projection does not point to the event");
  invariant(event.event_version === event.expected_version + 1, "INVALID_EVENT", "event version must follow expected version");
}

function mapOrder(value: unknown): WorkOrder {
  const result = validate("WorkOrder", value);
  if (!result.ok) {
    throw new WorkOrderError("INVALID_EVENT", `stored Work Order is invalid: ${JSON.stringify(result.errors)}`);
  }
  return value as WorkOrder;
}

function mapEvent(value: unknown): WorkOrderEvent {
  const result = validate("WorkOrderEvent", value);
  if (!result.ok) {
    throw new WorkOrderError("INVALID_EVENT", `stored Work Order event is invalid: ${JSON.stringify(result.errors)}`);
  }
  return value as WorkOrderEvent;
}

async function hold(
  tx: pg.PoolClient,
  reason: WorkOrderHoldReason,
  currentVersion: number | null,
  event: WorkOrderEvent,
  projection: WorkOrder,
): Promise<AppendWorkOrderResult> {
  const holdId = `cc:work-order-hold:${hash(`${event.event_id}|${reason}|${String(currentVersion)}`)}`;
  await tx.query(
    `INSERT INTO control_center.work_order_event_holds (
       hold_id, work_order_id, reason, current_version, idempotency_key, event_json, projection_json
     ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)
     ON CONFLICT (hold_id) DO NOTHING`,
    [holdId, event.work_order_id, reason, currentVersion, event.idempotency_key, JSON.stringify(event), JSON.stringify(projection)],
  );
  return { status: "HELD", hold_id: holdId, reason, current_version: currentVersion };
}

function immutableIdentityMatches(current: WorkOrder, next: WorkOrder): boolean {
  return current.proposal_id === next.proposal_id &&
    current.proposal_version === next.proposal_version &&
    current.accepted_snapshot_hash === next.accepted_snapshot_hash &&
    current.opportunity_id === next.opportunity_id &&
    current.qco_id === next.qco_id &&
    current.order_id === next.order_id &&
    current.offer_id === next.offer_id &&
    current.offer_version === next.offer_version &&
    current.deliverable_id === next.deliverable_id &&
    current.deliverable_version === next.deliverable_version &&
    current.client_id === next.client_id &&
    current.account_id === next.account_id &&
    isDeepStrictEqual(current.provider_refs, next.provider_refs) &&
    current.scope_version === next.scope_version &&
    current.price_version === next.price_version &&
    current.terms_version === next.terms_version &&
    current.business_calendar_version === next.business_calendar_version &&
    current.estimated_effort_minutes === next.estimated_effort_minutes &&
    current.created_at === next.created_at &&
    current.synthetic === next.synthetic &&
    isDeepStrictEqual(
      current.inputs_required.map((item) => item.input_id),
      next.inputs_required.map((item) => item.input_id),
    );
}

function activeIdentity(order: WorkOrder): string {
  return [
    order.proposal_id,
    order.accepted_snapshot_hash,
    order.deliverable_id,
    order.deliverable_version,
  ].join("|");
}

export async function appendWorkOrderEvent(
  pool: pg.Pool,
  event: WorkOrderEvent,
  projection: WorkOrder,
): Promise<AppendWorkOrderResult> {
  assertContracts(event, projection);
  return withTransaction(pool, async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [event.work_order_id]);
    // Different caller-provided work_order_ids for the same accepted identity must
    // serialize before the partial unique index is reached.
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`work-order-identity:${activeIdentity(projection)}`]);

    const duplicate = await tx.query(
      `SELECT event_json FROM control_center.work_order_events WHERE idempotency_key = $1`,
      [event.idempotency_key],
    );
    if (duplicate.rowCount === 1) {
      const prior = mapEvent(duplicate.rows[0]?.event_json);
      if (!isDeepStrictEqual(prior, event)) {
        const currentRow = await tx.query(
          `SELECT current_version FROM control_center.work_orders WHERE work_order_id = $1`,
          [event.work_order_id],
        );
        const currentVersion = currentRow.rowCount === 1 ? Number(currentRow.rows[0]?.current_version) : null;
        return hold(tx, "IDEMPOTENCY_CONFLICT", currentVersion, event, projection);
      }
      const currentRow = await tx.query(
        `SELECT projection_json FROM control_center.work_orders WHERE work_order_id = $1`,
        [event.work_order_id],
      );
      invariant(currentRow.rowCount === 1, "INVALID_EVENT", "event exists without its projection");
      return { status: "DUPLICATE", work_order: mapOrder(currentRow.rows[0]?.projection_json) };
    }

    const currentResult = await tx.query(
      `SELECT current_version, projection_json
       FROM control_center.work_orders
       WHERE work_order_id = $1
       FOR UPDATE`,
      [event.work_order_id],
    );

    if (currentResult.rowCount === 0) {
      if (event.expected_version !== 0 || event.event_type !== "WORK_ORDER_CREATED") {
        return hold(tx, "MISSING_ORDER", null, event, projection);
      }
      const derived = applyWorkOrderEvent(null, event);
      if (!isDeepStrictEqual(derived, projection)) {
        return hold(tx, "PROJECTION_CONFLICT", null, event, projection);
      }
      const identityCollision = await tx.query(
        `SELECT work_order_id, current_version
         FROM control_center.work_orders
         WHERE proposal_id = $1
           AND accepted_snapshot_hash = $2
           AND deliverable_id = $3
           AND deliverable_version = $4
           AND current_stage NOT IN ('CLOSED', 'CANCELLED')
         LIMIT 1`,
        [projection.proposal_id, projection.accepted_snapshot_hash, projection.deliverable_id, projection.deliverable_version],
      );
      if (identityCollision.rowCount === 1) {
        return hold(tx, "ACTIVE_IDENTITY_CONFLICT", Number(identityCollision.rows[0]?.current_version), event, projection);
      }
      await tx.query(
        `INSERT INTO control_center.work_orders (
           work_order_id, proposal_id, accepted_snapshot_hash, deliverable_id, deliverable_version,
           current_version, current_stage, last_event_id, synthetic, projection_json, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12)`,
        [
          projection.work_order_id,
          projection.proposal_id,
          projection.accepted_snapshot_hash,
          projection.deliverable_id,
          projection.deliverable_version,
          projection.version,
          projection.current_stage,
          projection.last_event_id,
          projection.synthetic,
          JSON.stringify(projection),
          projection.created_at,
          event.occurred_at,
        ],
      );
    } else {
      const currentVersion = Number(currentResult.rows[0]?.current_version);
      if (currentVersion !== event.expected_version) {
        return hold(tx, "VERSION_CONFLICT", currentVersion, event, projection);
      }
      const current = mapOrder(currentResult.rows[0]?.projection_json);
      if (new Date(event.occurred_at).getTime() < new Date(current.provenance.observed_at).getTime()) {
        return hold(tx, "TEMPORAL_CONFLICT", currentVersion, event, projection);
      }
      if (!immutableIdentityMatches(current, projection)) {
        return hold(tx, "PROJECTION_CONFLICT", currentVersion, event, projection);
      }
      const derived = applyWorkOrderEvent(current, event);
      if (!isDeepStrictEqual(derived, projection)) {
        return hold(tx, "PROJECTION_CONFLICT", currentVersion, event, projection);
      }
      await tx.query(
        `UPDATE control_center.work_orders
         SET current_version = $2,
             current_stage = $3,
             last_event_id = $4,
             projection_json = $5::jsonb,
             updated_at = $6
         WHERE work_order_id = $1`,
        [event.work_order_id, projection.version, projection.current_stage, projection.last_event_id, JSON.stringify(projection), event.occurred_at],
      );
    }

    await tx.query(
      `INSERT INTO control_center.work_order_events (
         event_id, work_order_id, event_version, expected_version, event_type, occurred_at,
         actor_kind, actor_id, reason_code, literal_reason_ref, idempotency_key,
         correlation_id, causation_id, source_system, event_json
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)`,
      [
        event.event_id,
        event.work_order_id,
        event.event_version,
        event.expected_version,
        event.event_type,
        event.occurred_at,
        event.actor.kind,
        event.actor.id,
        event.reason_code,
        event.literal_reason_ref,
        event.idempotency_key,
        event.correlation_id,
        event.causation_id,
        event.source_system,
        JSON.stringify(event),
      ],
    );
    return { status: "APPENDED", work_order: projection };
  });
}

export async function getWorkOrder(pool: pg.Pool, workOrderId: string): Promise<WorkOrder | null> {
  const result = await pool.query(
    `SELECT projection_json FROM control_center.work_orders WHERE work_order_id = $1`,
    [workOrderId],
  );
  return result.rowCount === 0 ? null : mapOrder(result.rows[0]?.projection_json);
}

export async function listWorkOrderEvents(pool: pg.Pool, workOrderId: string): Promise<WorkOrderEvent[]> {
  const result = await pool.query(
    `SELECT event_json FROM control_center.work_order_events WHERE work_order_id = $1 ORDER BY event_version`,
    [workOrderId],
  );
  return result.rows.map((row) => mapEvent(row.event_json));
}

export async function listWorkOrderHolds(pool: pg.Pool, workOrderId: string): Promise<WorkOrderHold[]> {
  const result = await pool.query(
    `SELECT hold_id, work_order_id, reason, current_version, idempotency_key,
            event_json, projection_json, held_at
     FROM control_center.work_order_event_holds
     WHERE work_order_id = $1
     ORDER BY held_at, hold_id`,
    [workOrderId],
  );
  return result.rows.map((row) => ({
    hold_id: String(row.hold_id),
    work_order_id: String(row.work_order_id),
    reason: row.reason as WorkOrderHoldReason,
    current_version: row.current_version === null ? null : Number(row.current_version),
    idempotency_key: String(row.idempotency_key),
    event: mapEvent(row.event_json),
    projection: mapOrder(row.projection_json),
    held_at: new Date(String(row.held_at)).toISOString(),
  }));
}

/** Rebuild the disposable projection strictly in stored event order. */
export async function rebuildWorkOrderProjection(pool: pg.Pool, workOrderId: string): Promise<WorkOrder> {
  return withTransaction(pool, async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [workOrderId]);
    const rows = await tx.query(
      `SELECT event_json FROM control_center.work_order_events WHERE work_order_id = $1 ORDER BY event_version`,
      [workOrderId],
    );
    invariant(rows.rowCount !== 0, "INVALID_EVENT", "cannot rebuild a missing Work Order stream");
    const rebuilt = replayWorkOrder(rows.rows.map((row) => mapEvent(row.event_json)));
    const updated = await tx.query(
      `UPDATE control_center.work_orders
       SET current_version = $2, current_stage = $3, last_event_id = $4,
           projection_json = $5::jsonb, updated_at = $6
       WHERE work_order_id = $1`,
      [workOrderId, rebuilt.version, rebuilt.current_stage, rebuilt.last_event_id, JSON.stringify(rebuilt), rebuilt.provenance.observed_at],
    );
    invariant(updated.rowCount === 1, "INVALID_EVENT", "projection row disappeared during rebuild");
    return rebuilt;
  });
}
