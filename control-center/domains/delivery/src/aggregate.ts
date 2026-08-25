import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  validate,
  type ActorRef,
  type Provenance,
  type WorkOrder,
  type WorkOrderArtifactRef,
  type WorkOrderBlocker,
  type WorkOrderChangeRequest,
  type WorkOrderEvent,
  type WorkOrderEventType,
  type WorkOrderInput,
  type WorkOrderNonconformity,
  type WorkOrderStage,
} from "@confenge/control-center-contracts";
import { addBusinessDays, type BusinessCalendar } from "./clock.js";
import { invariant, WorkOrderError } from "./errors.js";

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const TERMINAL_STAGES = new Set<WorkOrderStage>(["CLOSED", "CANCELLED"]);

export interface EventContext {
  actor: ActorRef;
  reason_code: string;
  literal_reason_ref: string;
  occurred_at: string;
  idempotency_key: string;
  correlation_id: string;
  causation_id: string | null;
  source_system: string;
  evidence_refs: string[];
}

export interface CreateWorkOrderCommand {
  work_order_id?: string;
  client_id: string;
  account_id: string;
  opportunity_id: string;
  qco_id: string;
  proposal_id: string;
  proposal_version: string;
  order_id: string;
  provider_refs: string[];
  accepted_snapshot_hash: string;
  offer_id: string;
  offer_version: string;
  deliverable_id: string;
  deliverable_version: string;
  scope_version: string;
  price_version: string;
  terms_version: string;
  input_ids: string[];
  business_calendar_version: string;
  estimated_effort_minutes: number | null;
  responsible_owner?: string | null;
  financial_gate: "RECONCILED" | "UNKNOWN" | "HELD";
  readiness_state: "READY" | "BLOCKED" | "UNKNOWN";
  synthetic: boolean;
}

export interface WorkOrderDecision {
  event: WorkOrderEvent;
  work_order: WorkOrder;
}

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function eventId(idempotencyKey: string): string {
  return `cc:work-order-event:${fingerprint(idempotencyKey)}`;
}

function orderId(command: CreateWorkOrderCommand): string {
  const identity = [
    command.proposal_id,
    command.accepted_snapshot_hash,
    command.deliverable_id,
    command.deliverable_version,
  ].join("|");
  return `cc:work-order:${fingerprint(identity)}`;
}

function assertUtc(value: string, label: string): void {
  invariant(value.endsWith("Z") && Number.isFinite(new Date(value).getTime()), "INVALID_COMMAND", `${label} must be UTC RFC3339`);
}

function assertContext(context: EventContext): void {
  assertUtc(context.occurred_at, "occurred_at");
  invariant(/^[A-Z][A-Z0-9_]{1,127}$/.test(context.reason_code), "INVALID_COMMAND", "reason_code must be versioned uppercase vocabulary");
  invariant(context.literal_reason_ref.trim() !== "", "MISSING_EVIDENCE", "literal_reason_ref is required");
  invariant(context.idempotency_key.length >= 8, "INVALID_COMMAND", "idempotency_key must have at least 8 characters");
  invariant(context.correlation_id.trim() !== "", "INVALID_COMMAND", "correlation_id is required");
  invariant(context.evidence_refs.length > 0, "MISSING_EVIDENCE", "at least one evidence_ref is required");
  invariant(new Set(context.evidence_refs).size === context.evidence_refs.length, "INVALID_COMMAND", "evidence_refs must be unique");
}

function assertContract(type: "WorkOrder" | "WorkOrderEvent", value: unknown): void {
  const result = validate(type, value);
  if (!result.ok) {
    throw new WorkOrderError(
      type === "WorkOrder" ? "INVALID_COMMAND" : "INVALID_EVENT",
      `${type} contract rejected: ${result.errors.map((error) => `${error.path} ${error.message}`).join("; ")}`,
    );
  }
}

function provenance(context: EventContext): Provenance {
  return {
    source: {
      system: context.source_system,
      kind: "work-order-event",
      locator: context.correlation_id,
    },
    observed_at: context.occurred_at,
    freshness_status: "FRESH",
    confidence: 1,
  };
}

function cloneOrder(order: WorkOrder): WorkOrder {
  return structuredClone(order);
}

function record(value: unknown, label: string): Record<string, unknown> {
  invariant(value !== null && typeof value === "object" && !Array.isArray(value), "INVALID_EVENT", `${label} must be an object`);
  return value as Record<string, unknown>;
}

function text(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  invariant(typeof value === "string" && value.trim() !== "", "INVALID_EVENT", `${key} is required`);
  return value;
}

function positiveInteger(data: Record<string, unknown>, key: string): number {
  const value = data[key];
  invariant(Number.isInteger(value) && Number(value) > 0, "INVALID_EVENT", `${key} must be a positive integer`);
  return Number(value);
}

function nullableText(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  invariant(value === null || (typeof value === "string" && value.trim() !== ""), "INVALID_EVENT", `${key} must be a non-empty string or null`);
  return value as string | null;
}

function parseArtifact(value: unknown): WorkOrderArtifactRef {
  const row = record(value, "artifact");
  const sha256 = text(row, "sha256");
  invariant(SHA256_PATTERN.test(sha256), "INVALID_EVENT", "artifact sha256 is invalid");
  return {
    artifact_id: text(row, "artifact_id"),
    sha256,
    evidence_ref: text(row, "evidence_ref"),
  };
}

function parseNonconformity(value: unknown): WorkOrderNonconformity {
  const row = record(value, "nonconformity");
  return {
    nonconformity_id: text(row, "nonconformity_id"),
    status: "OPEN",
    reason_code: text(row, "reason_code"),
    evidence_ref: text(row, "evidence_ref"),
  };
}

function allInputsComplete(order: WorkOrder, completingId?: string): boolean {
  return order.inputs_required.every((input) =>
    input.input_id === completingId ? true : input.status === "RECEIVED" || input.status === "WAIVED",
  );
}

function expectedTransition(
  order: WorkOrder,
  type: WorkOrderEventType,
  data: Record<string, unknown>,
): WorkOrderEvent["transition"] {
  let to: WorkOrderStage | null = null;
  switch (type) {
    case "INPUT_RECEIVED":
    case "INPUT_WAIVED":
      if (order.current_stage === "AWAITING_INPUTS" && allInputsComplete(order, text(data, "input_id"))) {
        to = "READY";
      }
      break;
    case "PRODUCTION_STARTED": to = "IN_PROGRESS"; break;
    case "WORK_BLOCKED": to = "BLOCKED"; break;
    case "WORK_RESUMED": to = "IN_PROGRESS"; break;
    case "QA_SUBMITTED": to = "QA"; break;
    case "QA_PASSED": to = "READY_TO_DELIVER"; break;
    case "QA_FAILED": to = "REWORK_REQUIRED"; break;
    case "DELIVERY_RECORDED": to = "DELIVERED"; break;
    case "CLIENT_ACCEPTED": to = "ACCEPTED"; break;
    case "CLIENT_REWORK_REQUESTED": to = "REWORK_REQUIRED"; break;
    case "REWORK_STARTED": to = "IN_PROGRESS"; break;
    case "WORK_ORDER_CANCELLED": to = "CANCELLED"; break;
    case "WORK_ORDER_CLOSED": to = "CLOSED"; break;
    case "WORK_ORDER_CREATED":
    case "OWNER_ASSIGNED":
    case "EFFORT_RECORDED":
    case "NONCONFORMITY_OPENED":
    case "NONCONFORMITY_RESOLVED":
    case "CHANGE_REQUEST_OPENED":
    case "CHANGE_REQUEST_ACCEPTED":
    case "CHANGE_REQUEST_REJECTED":
    case "CLOCK_PAUSED_CLIENT":
    case "CLOCK_PAUSED_INTERNAL":
    case "CLOCK_PAUSED_FORCE_MAJEURE":
    case "CLOCK_RESUMED":
      break;
  }
  return to === null ? null : { from_stage: order.current_stage, to_stage: to };
}

function requireStage(order: WorkOrder, expected: WorkOrderStage | readonly WorkOrderStage[], type: WorkOrderEventType): void {
  const allowed = Array.isArray(expected) ? expected : [expected];
  invariant(allowed.includes(order.current_stage), "ILLEGAL_TRANSITION", `${type} is illegal from ${order.current_stage}`);
}

function ensureUnique<T>(items: T[], key: (item: T) => string, label: string): void {
  invariant(new Set(items.map(key)).size === items.length, "INVALID_EVENT", `${label} contains duplicate ids`);
}

function requireClockAuthority(order: WorkOrder, event: WorkOrderEvent, data: Record<string, unknown>): void {
  invariant(event.actor.kind === "human", "MISSING_AUTHORITY", "clock decisions require a human actor");
  if (event.actor.id === order.responsible_owner) return;
  invariant(data.authority_role === "SUPERVISOR", "MISSING_AUTHORITY", "clock decision requires the responsible owner or supervisor");
  text(data, "authority_ref");
}

function assertInitialSnapshot(event: WorkOrderEvent, snapshot: WorkOrder): void {
  invariant(event.data.financial_gate === "RECONCILED", "MISSING_AUTHORITY", "creation event requires a reconciled financial gate");
  invariant(event.data.readiness_state === "READY", "MISSING_AUTHORITY", "creation event requires READY delivery readiness");
  invariant(snapshot.created_at === event.occurred_at, "INVALID_EVENT", "creation snapshot timestamp must match its event");
  invariant(snapshot.current_stage === "AWAITING_INPUTS", "INVALID_EVENT", "creation snapshot must start at AWAITING_INPUTS");
  invariant(snapshot.clock_state === "NOT_STARTED" && snapshot.clock_reason_version === null, "INVALID_EVENT", "creation snapshot clock must be NOT_STARTED");
  invariant(snapshot.started_at === null && snapshot.due_at === null && snapshot.delivered_at === null, "INVALID_EVENT", "creation snapshot cannot contain lifecycle timestamps");
  invariant(snapshot.inputs_required.length > 0, "MISSING_AUTHORITY", "creation snapshot requires at least one input");
  invariant(
    snapshot.inputs_required.every((input) => input.status === "REQUIRED" && input.evidence_ref === null && input.verified_at === null && input.verified_by === null),
    "INVALID_EVENT",
    "creation snapshot inputs must be unresolved",
  );
  invariant(snapshot.inputs_received.length === 0, "INVALID_EVENT", "creation snapshot cannot contain received inputs");
  invariant(snapshot.blockers.length === 0, "INVALID_EVENT", "creation snapshot cannot contain blockers");
  invariant(snapshot.actual_effort_minutes === 0, "INVALID_EVENT", "creation snapshot cannot contain actual effort");
  invariant(snapshot.QA_state === "NOT_STARTED" && snapshot.QA_checklist_version === null, "INVALID_EVENT", "creation snapshot QA must be NOT_STARTED");
  invariant(snapshot.delivery_artifact_refs.length === 0, "INVALID_EVENT", "creation snapshot cannot contain artifacts");
  invariant(snapshot.client_acceptance_state === "PENDING", "INVALID_EVENT", "creation snapshot acceptance must be PENDING");
  invariant(snapshot.nonconformities.length === 0 && snapshot.change_requests.length === 0, "INVALID_EVENT", "creation snapshot cannot contain review records");
  invariant(snapshot.outcome === "UNKNOWN" && snapshot.expansion_candidate === null, "INVALID_EVENT", "creation snapshot cannot contain an outcome");
  invariant(
    isDeepStrictEqual(snapshot.provenance, {
      source: { system: event.source_system, kind: "work-order-event", locator: event.correlation_id },
      observed_at: event.occurred_at,
      freshness_status: "FRESH",
      confidence: 1,
    }),
    "INVALID_EVENT",
    "creation snapshot provenance must match its event",
  );
}

export function createWorkOrder(command: CreateWorkOrderCommand, context: EventContext): WorkOrderDecision {
  assertContext(context);
  invariant(command.financial_gate === "RECONCILED", "MISSING_AUTHORITY", "financial gate must be RECONCILED");
  invariant(command.readiness_state === "READY", "MISSING_AUTHORITY", "delivery readiness must be READY");
  invariant(SHA256_PATTERN.test(command.accepted_snapshot_hash), "MISSING_AUTHORITY", "accepted snapshot hash is required");
  invariant(command.input_ids.length > 0, "MISSING_AUTHORITY", "at least one required input is required");
  invariant(new Set(command.input_ids).size === command.input_ids.length, "INVALID_COMMAND", "input_ids must be unique");
  invariant(command.business_calendar_version.trim() !== "", "MISSING_AUTHORITY", "business calendar version is required");
  if (command.estimated_effort_minutes !== null) {
    invariant(Number.isInteger(command.estimated_effort_minutes) && command.estimated_effort_minutes >= 0, "INVALID_COMMAND", "estimated effort must be non-negative integer minutes");
  }
  const workOrderId = command.work_order_id ?? orderId(command);
  const firstEventId = eventId(context.idempotency_key);
  const inputs: WorkOrderInput[] = command.input_ids.map((inputId) => ({
    input_id: inputId,
    status: "REQUIRED",
    evidence_ref: null,
    verified_at: null,
    verified_by: null,
  }));
  const workOrder: WorkOrder = {
    schema_version: "confenge.work_order.v1",
    work_order_id: workOrderId,
    client_id: command.client_id,
    account_id: command.account_id,
    opportunity_id: command.opportunity_id,
    qco_id: command.qco_id,
    proposal_id: command.proposal_id,
    proposal_version: command.proposal_version,
    order_id: command.order_id,
    provider_refs: [...command.provider_refs],
    accepted_snapshot_hash: command.accepted_snapshot_hash,
    offer_id: command.offer_id,
    offer_version: command.offer_version,
    deliverable_id: command.deliverable_id,
    deliverable_version: command.deliverable_version,
    scope_version: command.scope_version,
    price_version: command.price_version,
    terms_version: command.terms_version,
    inputs_required: inputs,
    inputs_received: [],
    created_at: context.occurred_at,
    started_at: null,
    due_at: null,
    business_calendar_version: command.business_calendar_version,
    clock_state: "NOT_STARTED",
    clock_reason_version: null,
    blockers: [],
    current_stage: "AWAITING_INPUTS",
    responsible_owner: command.responsible_owner ?? null,
    estimated_effort_minutes: command.estimated_effort_minutes,
    actual_effort_minutes: 0,
    QA_state: "NOT_STARTED",
    QA_checklist_version: null,
    delivery_artifact_refs: [],
    delivered_at: null,
    client_acceptance_state: "PENDING",
    nonconformities: [],
    change_requests: [],
    outcome: "UNKNOWN",
    expansion_candidate: null,
    version: 1,
    last_event_id: firstEventId,
    synthetic: command.synthetic,
    provenance: provenance(context),
  };
  assertContract("WorkOrder", workOrder);
  const event: WorkOrderEvent = {
    schema_version: "confenge.work_order_event.v1",
    event_id: firstEventId,
    event_version: 1,
    work_order_id: workOrderId,
    expected_version: 0,
    event_type: "WORK_ORDER_CREATED",
    actor: context.actor,
    reason_code: context.reason_code,
    literal_reason_ref: context.literal_reason_ref,
    occurred_at: context.occurred_at,
    idempotency_key: context.idempotency_key,
    correlation_id: context.correlation_id,
    causation_id: context.causation_id,
    source_system: context.source_system,
    evidence_refs: [...context.evidence_refs],
    transition: null,
    data: {
      financial_gate: command.financial_gate,
      readiness_state: command.readiness_state,
      work_order_snapshot: workOrder,
    },
  };
  assertContract("WorkOrderEvent", event);
  return { event, work_order: workOrder };
}

function normalizeDecisionData(
  order: WorkOrder,
  type: WorkOrderEventType,
  raw: Record<string, unknown>,
  context: EventContext,
  calendar?: BusinessCalendar,
): Record<string, unknown> {
  const data = structuredClone(raw);
  if (type === "PRODUCTION_STARTED") {
    invariant(calendar !== undefined, "MISSING_AUTHORITY", "a versioned business calendar is required to start production");
    invariant(calendar.version === order.business_calendar_version, "MISSING_AUTHORITY", "calendar version differs from the accepted Work Order");
    const businessDays = positiveInteger(data, "business_days");
    data.due_at = addBusinessDays(context.occurred_at, businessDays, calendar);
    data.business_calendar_version = calendar.version;
  }
  return data;
}

export function decideWorkOrder(
  order: WorkOrder,
  type: Exclude<WorkOrderEventType, "WORK_ORDER_CREATED">,
  rawData: Record<string, unknown>,
  context: EventContext,
  calendar?: BusinessCalendar,
): WorkOrderDecision {
  assertContext(context);
  invariant(!TERMINAL_STAGES.has(order.current_stage), "ILLEGAL_TRANSITION", `Work Order is terminal: ${order.current_stage}`);
  const data = normalizeDecisionData(order, type, rawData, context, calendar);
  const event: WorkOrderEvent = {
    schema_version: "confenge.work_order_event.v1",
    event_id: eventId(context.idempotency_key),
    event_version: order.version + 1,
    work_order_id: order.work_order_id,
    expected_version: order.version,
    event_type: type,
    actor: context.actor,
    reason_code: context.reason_code,
    literal_reason_ref: context.literal_reason_ref,
    occurred_at: context.occurred_at,
    idempotency_key: context.idempotency_key,
    correlation_id: context.correlation_id,
    causation_id: context.causation_id,
    source_system: context.source_system,
    evidence_refs: [...context.evidence_refs],
    transition: expectedTransition(order, type, data),
    data,
  };
  return { event, work_order: applyWorkOrderEvent(order, event) };
}

export function applyWorkOrderEvent(current: WorkOrder | null, event: WorkOrderEvent): WorkOrder {
  assertContract("WorkOrderEvent", event);
  if (current === null) {
    invariant(event.event_type === "WORK_ORDER_CREATED" && event.expected_version === 0 && event.event_version === 1, "INVALID_EVENT", "first event must create version 1");
    const snapshot = record(event.data.work_order_snapshot, "work_order_snapshot") as unknown as WorkOrder;
    assertContract("WorkOrder", snapshot);
    invariant(snapshot.work_order_id === event.work_order_id, "INVALID_EVENT", "creation snapshot belongs to another Work Order");
    invariant(snapshot.version === 1 && snapshot.last_event_id === event.event_id, "INVALID_EVENT", "creation snapshot version/event mismatch");
    assertInitialSnapshot(event, snapshot);
    return cloneOrder(snapshot);
  }

  invariant(!TERMINAL_STAGES.has(current.current_stage), "ILLEGAL_TRANSITION", `Work Order is terminal: ${current.current_stage}`);
  invariant(event.event_type !== "WORK_ORDER_CREATED", "INVALID_EVENT", "Work Order can only be created once");
  invariant(event.work_order_id === current.work_order_id, "INVALID_EVENT", "event belongs to another Work Order");
  invariant(event.expected_version === current.version, "VERSION_CONFLICT", `expected version ${event.expected_version}, current ${current.version}`);
  invariant(event.event_version === current.version + 1, "VERSION_CONFLICT", "event_version must be expected_version + 1");
  invariant(
    new Date(event.occurred_at).getTime() >= new Date(current.provenance.observed_at).getTime(),
    "INVALID_EVENT",
    "event occurred_at precedes the current Work Order event",
  );
  const data = record(event.data, "data");
  const transition = expectedTransition(current, event.event_type, data);
  invariant(isDeepStrictEqual(event.transition, transition), "INVALID_EVENT", "event transition does not match its type/current stage");

  const next = cloneOrder(current);
  switch (event.event_type) {
    case "INPUT_RECEIVED":
    case "INPUT_WAIVED": { // both require human evidence; a waiver is never inferred
      requireStage(next, "AWAITING_INPUTS", event.event_type);
      if (event.event_type === "INPUT_WAIVED") {
        invariant(event.actor.kind === "human", "MISSING_AUTHORITY", "input waiver requires a human actor");
      }
      const inputId = text(data, "input_id");
      const input = next.inputs_required.find((item) => item.input_id === inputId);
      invariant(input !== undefined, "INVALID_EVENT", `unknown input ${inputId}`);
      invariant(input.status === "REQUIRED", "INVALID_EVENT", `input ${inputId} was already resolved`);
      input.status = event.event_type === "INPUT_RECEIVED" ? "RECEIVED" : "WAIVED";
      input.evidence_ref = text(data, "evidence_ref");
      input.verified_at = event.occurred_at;
      input.verified_by = event.actor;
      if (!next.inputs_received.includes(inputId)) next.inputs_received.push(inputId);
      if (transition !== null) next.current_stage = transition.to_stage;
      break;
    }
    case "OWNER_ASSIGNED":
      invariant(event.actor.kind === "human", "MISSING_AUTHORITY", "owner assignment requires a human actor");
      next.responsible_owner = text(data, "owner");
      break;
    case "PRODUCTION_STARTED":
      requireStage(next, "READY", event.event_type);
      invariant(event.actor.kind === "human", "MISSING_AUTHORITY", "production start requires a human actor");
      invariant(next.responsible_owner !== null, "MISSING_AUTHORITY", "responsible owner is required before production starts");
      invariant(allInputsComplete(next), "MISSING_AUTHORITY", "all inputs must be received or waived");
      next.current_stage = "IN_PROGRESS";
      next.started_at = event.occurred_at;
      next.due_at = text(data, "due_at");
      assertUtc(next.due_at, "due_at");
      invariant(text(data, "business_calendar_version") === next.business_calendar_version, "MISSING_AUTHORITY", "due date calendar version mismatch");
      next.clock_state = "RUNNING";
      next.clock_reason_version = null;
      break;
    case "WORK_BLOCKED": {
      requireStage(next, "IN_PROGRESS", event.event_type);
      const blocker: WorkOrderBlocker = {
        blocker_id: text(data, "blocker_id"),
        reason_code: text(data, "blocker_reason_code"),
        owner: nullableText(data, "owner"),
        evidence_ref: text(data, "evidence_ref"),
        opened_at: event.occurred_at,
        resolved_at: null,
      };
      invariant(!next.blockers.some((item) => item.blocker_id === blocker.blocker_id), "INVALID_EVENT", "blocker id already exists");
      next.blockers.push(blocker);
      next.current_stage = "BLOCKED";
      break;
    }
    case "WORK_RESUMED": {
      requireStage(next, "BLOCKED", event.event_type);
      const blocker = next.blockers.find((item) => item.blocker_id === text(data, "blocker_id"));
      invariant(blocker !== undefined && blocker.resolved_at === null, "INVALID_EVENT", "open blocker is required to resume");
      blocker.resolved_at = event.occurred_at;
      invariant(!next.blockers.some((item) => item.resolved_at === null), "MISSING_AUTHORITY", "all blockers must be resolved before resuming");
      next.current_stage = "IN_PROGRESS";
      break;
    }
    case "EFFORT_RECORDED":
      requireStage(next, ["IN_PROGRESS", "BLOCKED", "QA", "REWORK_REQUIRED"], event.event_type);
      next.actual_effort_minutes += positiveInteger(data, "effort_minutes");
      break;
    case "QA_SUBMITTED": {
      requireStage(next, "IN_PROGRESS", event.event_type);
      invariant(!next.blockers.some((item) => item.resolved_at === null), "MISSING_AUTHORITY", "open blockers prevent QA");
      invariant(next.actual_effort_minutes > 0, "MISSING_EVIDENCE", "recorded effort is required before QA");
      const artifacts = data.artifact_refs;
      invariant(Array.isArray(artifacts) && artifacts.length > 0, "MISSING_EVIDENCE", "QA requires at least one immutable artifact ref");
      next.delivery_artifact_refs = artifacts.map(parseArtifact);
      ensureUnique(next.delivery_artifact_refs, (item) => item.artifact_id, "artifact_refs");
      next.QA_checklist_version = text(data, "QA_checklist_version");
      next.QA_state = "IN_REVIEW";
      next.current_stage = "QA";
      break;
    }
    case "QA_PASSED":
      requireStage(next, "QA", event.event_type);
      invariant(event.actor.kind === "human", "MISSING_AUTHORITY", "QA approval requires a human actor");
      invariant(next.QA_checklist_version !== null && next.delivery_artifact_refs.length > 0, "MISSING_EVIDENCE", "QA checklist and artifacts are required");
      next.QA_state = "PASSED";
      next.current_stage = "READY_TO_DELIVER";
      break;
    case "QA_FAILED": {
      requireStage(next, "QA", event.event_type);
      const nonconformity = parseNonconformity(data.nonconformity);
      invariant(!next.nonconformities.some((item) => item.nonconformity_id === nonconformity.nonconformity_id), "INVALID_EVENT", "nonconformity already exists");
      next.nonconformities.push(nonconformity);
      next.QA_state = "FAILED";
      next.current_stage = "REWORK_REQUIRED";
      break;
    }
    case "DELIVERY_RECORDED":
      requireStage(next, "READY_TO_DELIVER", event.event_type);
      invariant(event.actor.kind === "human", "MISSING_AUTHORITY", "delivery requires a human actor");
      invariant(next.QA_state === "PASSED" && next.delivery_artifact_refs.length > 0, "MISSING_AUTHORITY", "passed QA and immutable artifacts are required");
      text(data, "recipient_verification_ref");
      next.delivered_at = event.occurred_at;
      next.current_stage = "DELIVERED";
      next.clock_state = "STOPPED";
      next.clock_reason_version = text(data, "clock_reason_version");
      break;
    case "CLIENT_ACCEPTED":
      requireStage(next, "DELIVERED", event.event_type);
      invariant(event.actor.kind === "human", "MISSING_AUTHORITY", "client acceptance requires a human actor with evidence");
      next.client_acceptance_state = "ACCEPTED";
      next.current_stage = "ACCEPTED";
      break;
    case "CLIENT_REWORK_REQUESTED": {
      requireStage(next, "DELIVERED", event.event_type);
      invariant(event.actor.kind === "human", "MISSING_AUTHORITY", "client rework requires a human actor with evidence");
      const nonconformity = parseNonconformity(data.nonconformity);
      invariant(!next.nonconformities.some((item) => item.nonconformity_id === nonconformity.nonconformity_id), "INVALID_EVENT", "nonconformity already exists");
      next.nonconformities.push(nonconformity);
      next.client_acceptance_state = "REWORK_REQUIRED";
      next.current_stage = "REWORK_REQUIRED";
      break;
    }
    case "REWORK_STARTED":
      requireStage(next, "REWORK_REQUIRED", event.event_type);
      invariant(next.nonconformities.some((item) => item.status === "OPEN"), "MISSING_AUTHORITY", "rework needs an open nonconformity");
      next.current_stage = "IN_PROGRESS";
      next.QA_state = "NOT_STARTED";
      next.client_acceptance_state = "PENDING";
      next.clock_state = "RUNNING";
      next.clock_reason_version = text(data, "clock_reason_version");
      break;
    case "NONCONFORMITY_OPENED": {
      const nonconformity = parseNonconformity(data.nonconformity);
      invariant(!next.nonconformities.some((item) => item.nonconformity_id === nonconformity.nonconformity_id), "INVALID_EVENT", "nonconformity already exists");
      next.nonconformities.push(nonconformity);
      break;
    }
    case "NONCONFORMITY_RESOLVED": {
      const item = next.nonconformities.find((candidate) => candidate.nonconformity_id === text(data, "nonconformity_id"));
      invariant(item !== undefined && item.status === "OPEN", "INVALID_EVENT", "open nonconformity not found");
      item.status = "RESOLVED";
      break;
    }
    case "CHANGE_REQUEST_OPENED": {
      const proposedHash = text(data, "proposed_snapshot_hash");
      invariant(SHA256_PATTERN.test(proposedHash) && proposedHash !== next.accepted_snapshot_hash, "INVALID_EVENT", "change request needs a distinct snapshot hash");
      const request: WorkOrderChangeRequest = {
        change_request_id: text(data, "change_request_id"),
        status: "PROPOSED",
        proposed_snapshot_hash: proposedHash,
        evidence_ref: text(data, "evidence_ref"),
      };
      invariant(!next.change_requests.some((item) => item.change_request_id === request.change_request_id), "INVALID_EVENT", "change request already exists");
      next.change_requests.push(request);
      break;
    }
    case "CHANGE_REQUEST_ACCEPTED":
    case "CHANGE_REQUEST_REJECTED": {
      invariant(event.actor.kind === "human", "MISSING_AUTHORITY", "change request decision requires a human actor");
      const request = next.change_requests.find((item) => item.change_request_id === text(data, "change_request_id"));
      invariant(request !== undefined && request.status === "PROPOSED", "INVALID_EVENT", "proposed change request not found");
      request.status = event.event_type === "CHANGE_REQUEST_ACCEPTED" ? "ACCEPTED" : "REJECTED";
      break;
    }
    case "CLOCK_PAUSED_CLIENT":
    case "CLOCK_PAUSED_INTERNAL":
    case "CLOCK_PAUSED_FORCE_MAJEURE":
      invariant(next.clock_state === "RUNNING", "ILLEGAL_TRANSITION", "only a running clock may be paused");
      requireClockAuthority(next, event, data);
      next.clock_state = event.event_type === "CLOCK_PAUSED_CLIENT"
        ? "PAUSED_CLIENT"
        : event.event_type === "CLOCK_PAUSED_INTERNAL"
          ? "PAUSED_INTERNAL"
          : "PAUSED_FORCE_MAJEURE";
      next.clock_reason_version = text(data, "clock_reason_version");
      break;
    case "CLOCK_RESUMED":
      invariant(next.clock_state.startsWith("PAUSED_"), "ILLEGAL_TRANSITION", "only a paused clock may resume");
      requireClockAuthority(next, event, data);
      next.clock_state = "RUNNING";
      next.clock_reason_version = text(data, "clock_reason_version");
      break;
    case "WORK_ORDER_CANCELLED":
      invariant(event.actor.kind === "human", "MISSING_AUTHORITY", "cancellation requires a human actor");
      next.current_stage = "CANCELLED";
      next.client_acceptance_state = "CANCELLED";
      next.clock_state = "STOPPED";
      next.clock_reason_version = text(data, "clock_reason_version");
      break;
    case "WORK_ORDER_CLOSED": {
      requireStage(next, "ACCEPTED", event.event_type);
      invariant(event.actor.kind === "human", "MISSING_AUTHORITY", "closeout requires a human actor");
      const outcome = text(data, "outcome");
      invariant(["UNKNOWN", "ACHIEVED", "PARTIAL", "NOT_ACHIEVED"].includes(outcome), "INVALID_EVENT", "invalid closeout outcome");
      const expansion = data.expansion_candidate;
      invariant(typeof expansion === "boolean" || expansion === null, "INVALID_EVENT", "expansion_candidate must be boolean or null");
      next.outcome = outcome as WorkOrder["outcome"];
      next.expansion_candidate = expansion;
      next.current_stage = "CLOSED";
      next.clock_state = "STOPPED";
      break;
    }
  }
  ensureUnique(next.inputs_required, (item) => item.input_id, "inputs_required");
  ensureUnique(next.blockers, (item) => item.blocker_id, "blockers");
  ensureUnique(next.nonconformities, (item) => item.nonconformity_id, "nonconformities");
  ensureUnique(next.change_requests, (item) => item.change_request_id, "change_requests");
  next.version = event.event_version;
  next.last_event_id = event.event_id;
  next.provenance = {
    source: { system: event.source_system, kind: "work-order-event", locator: event.event_id },
    observed_at: event.occurred_at,
    freshness_status: "FRESH",
    confidence: 1,
  };
  assertContract("WorkOrder", next);
  return next;
}

export function replayWorkOrder(events: readonly WorkOrderEvent[]): WorkOrder {
  invariant(events.length > 0, "INVALID_EVENT", "event stream is empty");
  let current: WorkOrder | null = null;
  const seen = new Map<string, WorkOrderEvent>();
  for (const event of events) {
    const prior = seen.get(event.idempotency_key);
    if (prior !== undefined) {
      invariant(isDeepStrictEqual(prior, event), "IDEMPOTENCY_CONFLICT", "idempotency key reused with a conflicting event");
      continue;
    }
    seen.set(event.idempotency_key, event);
    current = applyWorkOrderEvent(current, event);
  }
  invariant(current !== null, "INVALID_EVENT", "event stream did not create a Work Order");
  return current;
}
