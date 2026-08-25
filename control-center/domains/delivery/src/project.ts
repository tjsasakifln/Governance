import type { WorkOrder } from "@confenge/control-center-contracts";

export interface WorkOrderProjection {
  schema_version: "control-center.work-order-projection.v1";
  work_order_id: string;
  stage: WorkOrder["current_stage"];
  clock_state: WorkOrder["clock_state"];
  responsible_owner: string | null;
  due_at: string | null;
  sla_status: "NOT_STARTED" | "ON_TRACK" | "DUE" | "OVERDUE" | "PAUSED" | "STOPPED";
  delay_classification: "NONE" | "CLIENT" | "INTERNAL" | "FORCE_MAJEURE" | "UNKNOWN";
  open_blocker_count: number;
  QA_state: WorkOrder["QA_state"];
  acceptance_state: WorkOrder["client_acceptance_state"];
  actual_effort_minutes: number;
  capacity_consumed: boolean;
  synthetic: boolean;
  version: number;
  source: {
    system: "governance-delivery-os";
    locator: string;
    event_id: string;
  };
  observed_at: string;
  freshness_status: "FRESH" | "STALE";
}

const CAPACITY_STAGES = new Set<WorkOrder["current_stage"]>([
  "IN_PROGRESS",
  "BLOCKED",
  "QA",
  "READY_TO_DELIVER",
  "REWORK_REQUIRED",
]);

function classifySla(
  order: WorkOrder,
  observedAt: string,
): Pick<WorkOrderProjection, "sla_status" | "delay_classification"> {
  if (order.clock_state === "NOT_STARTED" || order.due_at === null) {
    return { sla_status: "NOT_STARTED", delay_classification: "NONE" };
  }
  if (order.clock_state === "PAUSED_CLIENT") {
    return { sla_status: "PAUSED", delay_classification: "CLIENT" };
  }
  if (order.clock_state === "PAUSED_INTERNAL") {
    return { sla_status: "PAUSED", delay_classification: "INTERNAL" };
  }
  if (order.clock_state === "PAUSED_FORCE_MAJEURE") {
    return { sla_status: "PAUSED", delay_classification: "FORCE_MAJEURE" };
  }
  const dueMs = new Date(order.due_at).getTime();
  const comparisonAt = order.delivered_at ?? observedAt;
  const observedMs = new Date(comparisonAt).getTime();
  if (!Number.isFinite(dueMs) || !Number.isFinite(observedMs)) {
    return { sla_status: order.clock_state === "STOPPED" ? "STOPPED" : "OVERDUE", delay_classification: "UNKNOWN" };
  }
  if (observedMs > dueMs) {
    return { sla_status: "OVERDUE", delay_classification: "INTERNAL" };
  }
  if (order.clock_state === "STOPPED") {
    return { sla_status: "STOPPED", delay_classification: "NONE" };
  }
  if (dueMs - observedMs <= 24 * 60 * 60 * 1000) {
    return { sla_status: "DUE", delay_classification: "NONE" };
  }
  return { sla_status: "ON_TRACK", delay_classification: "NONE" };
}

export function projectWorkOrder(
  order: WorkOrder,
  observedAt = order.provenance.observed_at,
  staleAfterSeconds = 900,
): WorkOrderProjection {
  const observedMs = new Date(observedAt).getTime();
  const sourceMs = new Date(order.provenance.observed_at).getTime();
  const stale = staleAfterSeconds < 0 ||
    !Number.isFinite(observedMs) ||
    !Number.isFinite(sourceMs) ||
    observedMs < sourceMs ||
    observedMs - sourceMs > staleAfterSeconds * 1000;
  const sla = classifySla(order, observedAt);
  return {
    schema_version: "control-center.work-order-projection.v1",
    work_order_id: order.work_order_id,
    stage: order.current_stage,
    clock_state: order.clock_state,
    responsible_owner: order.responsible_owner,
    due_at: order.due_at,
    ...sla,
    open_blocker_count: order.blockers.filter((item) => item.resolved_at === null).length,
    QA_state: order.QA_state,
    acceptance_state: order.client_acceptance_state,
    actual_effort_minutes: order.actual_effort_minutes,
    capacity_consumed: CAPACITY_STAGES.has(order.current_stage),
    synthetic: order.synthetic,
    version: order.version,
    source: {
      system: "governance-delivery-os",
      locator: order.work_order_id,
      event_id: order.last_event_id,
    },
    observed_at: order.provenance.observed_at,
    freshness_status: stale ? "STALE" : "FRESH",
  };
}
