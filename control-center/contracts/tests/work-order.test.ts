import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { validate } from "../src/index.js";
import { packageRoot } from "../src/paths.js";

function readJson(relative: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(packageRoot(), relative), "utf8")) as Record<string, unknown>;
}

test("Work Order schema requires the complete v1 execution authority", () => {
  const schema = readJson("schemas/work-order.v1.schema.json") as { required: string[] };
  for (const field of [
    "work_order_id", "client_id", "account_id", "opportunity_id", "qco_id", "proposal_id",
    "proposal_version", "order_id", "provider_refs", "accepted_snapshot_hash", "offer_id",
    "offer_version", "deliverable_id", "deliverable_version", "scope_version", "price_version",
    "terms_version", "inputs_required", "inputs_received", "created_at", "started_at", "due_at",
    "business_calendar_version", "clock_state", "clock_reason_version", "blockers", "current_stage",
    "responsible_owner", "estimated_effort_minutes", "estimated_capacity_units",
    "capacity_commitment_id", "actual_effort_minutes", "QA_state",
    "QA_checklist_version", "delivery_artifact_refs", "delivered_at", "client_acceptance_state",
    "nonconformities", "change_requests", "outcome", "expansion_candidate", "version", "last_event_id",
  ]) {
    assert.ok(schema.required.includes(field), `missing required Work Order field ${field}`);
  }
});

test("Work Order and event ids are bound to their canonical resource types", () => {
  const order = readJson("fixtures/valid/work-order.json");
  order.work_order_id = "cc:client-status:not-a-work-order";
  assert.equal(validate("WorkOrder", order).ok, false);
  const event = readJson("fixtures/valid/work-order-event.json");
  event.event_id = "cc:audit-event:not-a-work-order-event";
  assert.equal(validate("WorkOrderEvent", event).ok, false);
});

test("event contract requires actor, version, reason, idempotency, causation and evidence", () => {
  const schema = readJson("schemas/work-order-event.v1.schema.json") as { required: string[] };
  for (const field of [
    "event_id", "event_version", "work_order_id", "expected_version", "event_type", "actor",
    "reason_code", "literal_reason_ref", "occurred_at", "idempotency_key", "correlation_id",
    "causation_id", "source_system", "evidence_refs", "transition", "data",
  ]) {
    assert.ok(schema.required.includes(field), `missing required event field ${field}`);
  }
});

test("event data recursively rejects secret-like property names", () => {
  const event = readJson("fixtures/valid/work-order-event.json");
  event.data = { api_key: "must-never-enter-the-event-log" };
  const result = validate("WorkOrderEvent", event);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.keyword === "secret_key"));
});
