import assert from "node:assert/strict";
import { test } from "node:test";
import { projectWorkOrder } from "../src/index.js";

function state() {
  return {
    schema_version: "confenge.work_order.v1",
    work_order_id: "wo-synthetic",
    client_ref: "client-synthetic-redacted-001",
    deliverable_id: "CFG-DIAG-EXP-v1",
    deliverable_version: "v1",
    current_stage: "CLOSED",
    responsible_owner: "owner:delivery-synthetic",
    clock_state: "STOPPED",
    due_at: "2026-08-27T12:03:00.000Z",
    readiness_state: "DELIVERY_VALIDATED",
    blockers: [],
    qa_state: "PASSED",
    artifact_refs: ["artifact:diag-expansion-sandbox-v2"],
    acceptance_state: "ACCEPTED_SANDBOX",
    last_event_id: "woevt-last",
    correlation_id: "corr-confenge-diag-canary-001",
    proposal_id: "proposal-diag-synthetic-001",
    proposal_version: 1,
  };
}

test("projection copies workflow truth and exposes the six operator answers", () => {
  const source = state();
  const projected = projectWorkOrder(source, "2026-08-25T13:00:00.000Z");
  assert.equal(projected.work_order_id, source.work_order_id);
  assert.deepEqual(projected.deliverable, { id: "CFG-DIAG-EXP-v1", version: "v1" });
  assert.equal(projected.owner, source.responsible_owner);
  assert.equal(projected.stage, source.current_stage);
  assert.equal(projected.due_at, source.due_at);
  assert.equal(projected.blocker, null);
  assert.equal(projected.qa_state, "PASSED");
  assert.equal(projected.artifact_count, 1);
  assert.equal(projected.acceptance, "ACCEPTED_SANDBOX");
  assert.equal(projected.source.last_event_id, source.last_event_id);
});

test("Control Center never derives stage locally", () => {
  const source = state();
  source.current_stage = "UNKNOWN";
  const projected = projectWorkOrder(source, "2026-08-25T13:00:00.000Z");
  assert.equal(projected.stage, "UNKNOWN");
  assert.equal("transition" in projected, false);
  assert.equal("set_stage" in projected, false);
});

test("projection fails closed when source truth is incomplete", () => {
  const source = state();
  delete (source as Partial<ReturnType<typeof state>>).current_stage;
  assert.throws(
    () => projectWorkOrder(source, "2026-08-25T13:00:00.000Z"),
    /missing truth fields: current_stage/,
  );
});
