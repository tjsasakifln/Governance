import assert from "node:assert/strict";
import { test } from "node:test";
import { WORK_ORDER_STAGES, type WorkOrder, type WorkOrderEvent, type WorkOrderEventType } from "@confenge/control-center-contracts";
import {
  addBusinessDays,
  applyWorkOrderEvent,
  createWorkOrder,
  decideWorkOrder,
  projectWorkOrder,
  replayWorkOrder,
  type BusinessCalendar,
  type CreateWorkOrderCommand,
  type EventContext,
} from "../src/index.js";

const CALENDAR: BusinessCalendar = {
  version: "BR-SP-business-days.v1",
  time_zone: "America/Sao_Paulo",
  holidays: ["2026-09-07"],
};

const COMMAND: CreateWorkOrderCommand = {
  client_id: "client_sbx_001",
  account_id: "account_sbx_001",
  opportunity_id: "opp_sbx_001",
  qco_id: "qco_sbx_001",
  proposal_id: "proposal_sbx_001",
  proposal_version: "proposal.v1",
  order_id: "order_sbx_001",
  provider_refs: ["warmbly:proposal_sbx_001", "asaas:sandbox:payment_sbx_001"],
  accepted_snapshot_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  offer_id: "CFG-DIAG-EXP-v1",
  offer_version: "CFG-DIAG-EXP-v1",
  deliverable_id: "diagnostico-expansao",
  deliverable_version: "diagnostico-expansao.v1",
  scope_version: "CFG-SCOPE-DIAG-v1",
  price_version: "CFG-PRICE-DIAG-v1",
  terms_version: "CFG-TERMS-B2B-2026-08-17-v1",
  input_ids: ["brief-alinhamento"],
  business_calendar_version: CALENDAR.version,
  estimated_effort_minutes: 4800,
  financial_gate: "RECONCILED",
  readiness_state: "READY",
  synthetic: true,
};

let contextSequence = 0;
function context(at: string, reason = "SANDBOX_CANARY", kind: "human" | "agent" | "system" = "human"): EventContext {
  contextSequence += 1;
  return {
    actor: { kind, id: kind === "human" ? "delivery-owner-sbx" : `${kind}-sbx` },
    reason_code: reason,
    literal_reason_ref: `evidence:sandbox:${contextSequence}`,
    occurred_at: at,
    idempotency_key: `work-order:diag-sbx-001:event:${contextSequence}`,
    correlation_id: "corr-diag-sbx-001",
    causation_id: contextSequence === 1 ? "proposal_sbx_001" : `event-${contextSequence - 1}`,
    source_system: "governance",
    evidence_refs: [`evidence:sandbox:${contextSequence}`],
  };
}

function buildClosedCanary(): { order: WorkOrder; events: WorkOrderEvent[] } {
  contextSequence = 0;
  const created = createWorkOrder(COMMAND, context("2026-08-25T12:00:00Z"));
  let order = created.work_order;
  const events = [created.event];
  const advance = (
    type: Parameters<typeof decideWorkOrder>[1],
    data: Record<string, unknown>,
    at: string,
    calendar?: BusinessCalendar,
  ): void => {
    const result = decideWorkOrder(order, type, data, context(at), calendar);
    order = result.work_order;
    events.push(result.event);
  };
  advance("INPUT_RECEIVED", { input_id: "brief-alinhamento", evidence_ref: "extra-cli:artifact:brief-sbx" }, "2026-08-25T12:05:00Z");
  advance("OWNER_ASSIGNED", { owner: "delivery-owner-sbx" }, "2026-08-25T12:10:00Z");
  advance("PRODUCTION_STARTED", { business_days: 10 }, "2026-08-25T12:15:00Z", CALENDAR);
  advance("EFFORT_RECORDED", { effort_minutes: 120 }, "2026-08-26T12:00:00Z");
  advance("QA_SUBMITTED", {
    QA_checklist_version: "diag-qa.v1",
    artifact_refs: [{
      artifact_id: "artifact:diag-sbx:draft-1",
      sha256: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      evidence_ref: "extra-cli:artifact:diag-sbx:draft-1",
    }],
  }, "2026-09-02T12:00:00Z");
  advance("QA_FAILED", {
    nonconformity: {
      nonconformity_id: "nc-sbx-001",
      reason_code: "MISSING_SOURCE_CITATION",
      evidence_ref: "qa:sandbox:nc-sbx-001",
    },
  }, "2026-09-02T13:00:00Z");
  advance("REWORK_STARTED", { clock_reason_version: "REWORK_APPROVED.v1" }, "2026-09-02T14:00:00Z");
  advance("EFFORT_RECORDED", { effort_minutes: 60 }, "2026-09-03T12:00:00Z");
  advance("NONCONFORMITY_RESOLVED", { nonconformity_id: "nc-sbx-001" }, "2026-09-03T13:00:00Z");
  advance("QA_SUBMITTED", {
    QA_checklist_version: "diag-qa.v1",
    artifact_refs: [{
      artifact_id: "artifact:diag-sbx:final-1",
      sha256: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      evidence_ref: "extra-cli:artifact:diag-sbx:final-1",
    }],
  }, "2026-09-03T14:00:00Z");
  advance("QA_PASSED", {}, "2026-09-03T15:00:00Z");
  advance("DELIVERY_RECORDED", {
    recipient_verification_ref: "evidence:sandbox:recipient-invalid",
    clock_reason_version: "DELIVERY_RECORDED.v1",
  }, "2026-09-04T12:00:00Z");
  advance("CLIENT_ACCEPTED", {}, "2026-09-04T14:00:00Z");
  advance("WORK_ORDER_CLOSED", { outcome: "UNKNOWN", expansion_candidate: null }, "2026-09-04T15:00:00Z");
  return { order, events };
}

test("synthetic canary crosses every delivery gate, including rework, without mutating the accepted snapshot", () => {
  const { order, events } = buildClosedCanary();
  assert.equal(order.synthetic, true);
  assert.equal(order.current_stage, "CLOSED");
  assert.equal(order.client_acceptance_state, "ACCEPTED");
  assert.equal(order.actual_effort_minutes, 180);
  assert.equal(order.nonconformities[0]?.status, "RESOLVED");
  assert.equal(order.accepted_snapshot_hash, COMMAND.accepted_snapshot_hash);
  assert.equal(order.due_at, "2026-09-09T12:15:00.000Z");
  assert.ok(events.some((event) => event.event_type === "QA_FAILED"));
  assert.ok(events.some((event) => event.event_type === "REWORK_STARTED"));
  const projection = projectWorkOrder(order, order.provenance.observed_at);
  assert.equal(projection.stage, "CLOSED");
  assert.equal(projection.capacity_consumed, false);
  assert.equal(projection.sla_status, "STOPPED");
  assert.equal(projection.delay_classification, "NONE");
  assert.equal(projection.source.event_id, order.last_event_id);
});

test("replay is idempotent three times and reproduces the due date exactly", () => {
  const { order, events } = buildClosedCanary();
  const replayed = replayWorkOrder([...events, ...events, ...events]);
  assert.deepEqual(replayed, order);
  assert.equal(replayed.due_at, order.due_at);
});

test("out-of-order and conflicting replays fail closed instead of being sorted", () => {
  const { events } = buildClosedCanary();
  const outOfOrder = [events[0], events[2], events[1]].filter((event): event is WorkOrderEvent => event !== undefined);
  assert.throws(() => replayWorkOrder(outOfOrder), /expected version|VERSION_CONFLICT|version/i);
  const conflict = structuredClone(events[0]);
  assert.ok(conflict);
  conflict.reason_code = "CONFLICTING_REPLAY";
  assert.throws(() => replayWorkOrder([events[0]!, conflict]), /idempotency/i);
});

test("the event applier rejects forged creation snapshots, temporal regressions and terminal mutations", () => {
  contextSequence = 0;
  const created = createWorkOrder(COMMAND, context("2026-08-25T12:00:00Z"));

  const forged = structuredClone(created.event);
  const forgedSnapshot = forged.data.work_order_snapshot as WorkOrder;
  forgedSnapshot.created_at = "2026-08-25T11:59:00Z";
  assert.throws(() => applyWorkOrderEvent(null, forged), /timestamp must match/i);

  const ready = decideWorkOrder(created.work_order, "INPUT_RECEIVED", {
    input_id: "brief-alinhamento",
    evidence_ref: "evidence:sandbox:input",
  }, context("2026-08-25T12:01:00Z"));
  const regressed = structuredClone(ready.event);
  regressed.occurred_at = "2026-08-25T11:59:00Z";
  assert.throws(() => applyWorkOrderEvent(created.work_order, regressed), /precedes/i);

  const { order, events } = buildClosedCanary();
  const terminalMutation = structuredClone(events.at(-1)!);
  terminalMutation.event_id = "cc:work-order-event:terminal-mutation";
  terminalMutation.event_version = order.version + 1;
  terminalMutation.expected_version = order.version;
  terminalMutation.event_type = "OWNER_ASSIGNED";
  terminalMutation.idempotency_key = "terminal-mutation-event";
  terminalMutation.transition = null;
  terminalMutation.data = { owner: "new-owner" };
  assert.throws(() => applyWorkOrderEvent(order, terminalMutation), /terminal/i);
});

test("Control Center marks future-dated source observations stale", () => {
  contextSequence = 0;
  const created = createWorkOrder(COMMAND, context("2026-08-25T12:00:00Z"));
  assert.equal(projectWorkOrder(created.work_order, "2026-08-25T11:59:59Z").freshness_status, "STALE");
});

test("financial, readiness, owner, input, QA and human delivery guards are fail-closed", () => {
  contextSequence = 0;
  assert.throws(
    () => createWorkOrder({ ...COMMAND, financial_gate: "UNKNOWN" }, context("2026-08-25T12:00:00Z")),
    /financial gate/i,
  );
  const created = createWorkOrder(COMMAND, context("2026-08-25T12:01:00Z"));
  assert.throws(
    () => decideWorkOrder(created.work_order, "PRODUCTION_STARTED", { business_days: 10 }, context("2026-08-25T12:02:00Z"), CALENDAR),
    /illegal|READY/i,
  );
  const ready = decideWorkOrder(created.work_order, "INPUT_WAIVED", {
    input_id: "brief-alinhamento",
    evidence_ref: "evidence:sandbox:waiver",
  }, context("2026-08-25T12:03:00Z")).work_order;
  assert.throws(
    () => decideWorkOrder(ready, "PRODUCTION_STARTED", { business_days: 10 }, context("2026-08-25T12:04:00Z"), CALENDAR),
    /owner/i,
  );
  const started = decideWorkOrder(
    decideWorkOrder(ready, "OWNER_ASSIGNED", { owner: "delivery-owner-sbx" }, context("2026-08-25T12:05:00Z")).work_order,
    "PRODUCTION_STARTED",
    { business_days: 10 },
    context("2026-08-25T12:06:00Z"),
    CALENDAR,
  ).work_order;
  assert.throws(
    () => decideWorkOrder(started, "QA_SUBMITTED", {
      QA_checklist_version: "diag-qa.v1",
      artifact_refs: [{
        artifact_id: "artifact:no-effort",
        sha256: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        evidence_ref: "extra-cli:artifact:no-effort",
      }],
    }, context("2026-08-25T12:07:00Z")),
    /effort/i,
  );
});

test("every stage-changing event rejects every illegal source stage", () => {
  contextSequence = 0;
  const base = createWorkOrder(COMMAND, context("2026-08-25T12:00:00Z")).work_order;
  const cases: Array<{
    type: Exclude<WorkOrderEventType, "WORK_ORDER_CREATED">;
    allowed: WorkOrder["current_stage"];
    data: Record<string, unknown>;
    calendar?: BusinessCalendar;
  }> = [
    { type: "INPUT_RECEIVED", allowed: "AWAITING_INPUTS", data: { input_id: "brief-alinhamento", evidence_ref: "evidence:input" } },
    { type: "INPUT_WAIVED", allowed: "AWAITING_INPUTS", data: { input_id: "brief-alinhamento", evidence_ref: "evidence:waiver" } },
    { type: "PRODUCTION_STARTED", allowed: "READY", data: { business_days: 2 }, calendar: CALENDAR },
    { type: "WORK_BLOCKED", allowed: "IN_PROGRESS", data: { blocker_id: "blocker-1", blocker_reason_code: "INPUT_DELAY.v1", owner: null, evidence_ref: "evidence:blocker" } },
    { type: "WORK_RESUMED", allowed: "BLOCKED", data: { blocker_id: "blocker-1" } },
    { type: "QA_SUBMITTED", allowed: "IN_PROGRESS", data: { QA_checklist_version: "qa.v1", artifact_refs: [] } },
    { type: "QA_PASSED", allowed: "QA", data: {} },
    { type: "QA_FAILED", allowed: "QA", data: { nonconformity: { nonconformity_id: "nc-1", reason_code: "QA_FAILED.v1", evidence_ref: "evidence:nc" } } },
    { type: "DELIVERY_RECORDED", allowed: "READY_TO_DELIVER", data: { recipient_verification_ref: "evidence:recipient", clock_reason_version: "DELIVERED.v1" } },
    { type: "CLIENT_ACCEPTED", allowed: "DELIVERED", data: {} },
    { type: "CLIENT_REWORK_REQUESTED", allowed: "DELIVERED", data: { nonconformity: { nonconformity_id: "nc-2", reason_code: "CLIENT_REWORK.v1", evidence_ref: "evidence:rework" } } },
    { type: "REWORK_STARTED", allowed: "REWORK_REQUIRED", data: { clock_reason_version: "REWORK.v1" } },
    { type: "WORK_ORDER_CLOSED", allowed: "ACCEPTED", data: { outcome: "UNKNOWN", expansion_candidate: null } },
  ];
  for (const item of cases) {
    for (const stage of WORK_ORDER_STAGES) {
      if (stage === item.allowed) continue;
      const order = structuredClone(base);
      order.current_stage = stage;
      assert.throws(
        () => decideWorkOrder(order, item.type, item.data, context("2026-08-25T13:00:00Z"), item.calendar),
        Error,
        `${item.type} must reject ${stage}`,
      );
    }
  }
});

test("pause/resume records distinct causes and change requests never alter scope or price", () => {
  contextSequence = 0;
  let order = createWorkOrder({ ...COMMAND, responsible_owner: "delivery-owner-sbx" }, context("2026-08-25T12:00:00Z")).work_order;
  order = decideWorkOrder(order, "INPUT_RECEIVED", {
    input_id: "brief-alinhamento", evidence_ref: "extra-cli:brief:1",
  }, context("2026-08-25T12:01:00Z")).work_order;
  order = decideWorkOrder(order, "PRODUCTION_STARTED", { business_days: 10 }, context("2026-08-25T12:02:00Z"), CALENDAR).work_order;
  order = decideWorkOrder(order, "CLOCK_PAUSED_CLIENT", {
    clock_reason_version: "CLIENT_INPUT_DELAY.v1",
  }, context("2026-08-26T12:00:00Z")).work_order;
  assert.equal(order.clock_state, "PAUSED_CLIENT");
  order = decideWorkOrder(order, "CLOCK_RESUMED", {
    clock_reason_version: "CLIENT_INPUT_RECEIVED.v1",
  }, context("2026-08-27T12:00:00Z")).work_order;
  assert.equal(order.clock_state, "RUNNING");
  assert.throws(
    () => decideWorkOrder(order, "CLOCK_PAUSED_INTERNAL", {
      clock_reason_version: "INTERNAL_DELAY.v1",
    }, {
      ...context("2026-08-27T12:30:00Z"),
      actor: { kind: "human", id: "unassigned-operator" },
    }),
    /responsible owner or supervisor/i,
  );
  const original = { hash: order.accepted_snapshot_hash, scope: order.scope_version, price: order.price_version };
  order = decideWorkOrder(order, "CHANGE_REQUEST_OPENED", {
    change_request_id: "cr-sbx-001",
    proposed_snapshot_hash: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    evidence_ref: "evidence:sandbox:cr-sbx-001",
  }, context("2026-08-27T13:00:00Z")).work_order;
  order = decideWorkOrder(order, "CHANGE_REQUEST_ACCEPTED", {
    change_request_id: "cr-sbx-001",
  }, context("2026-08-27T14:00:00Z")).work_order;
  assert.deepEqual(
    { hash: order.accepted_snapshot_hash, scope: order.scope_version, price: order.price_version },
    original,
  );
  assert.equal(order.change_requests[0]?.status, "ACCEPTED");
});

test("calendar arithmetic is host-timezone independent across weekends, holidays and DST", () => {
  assert.equal(addBusinessDays("2026-09-04T15:00:00Z", 1, CALENDAR), "2026-09-08T15:00:00.000Z");
  const newYork: BusinessCalendar = { version: "US-NY.v1", time_zone: "America/New_York", holidays: [] };
  assert.equal(addBusinessDays("2026-10-30T13:00:00Z", 1, newYork), "2026-11-02T14:00:00.000Z");
});
