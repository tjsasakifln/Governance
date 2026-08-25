#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import type { WorkOrderArtifactRef, WorkOrderEvent, WorkOrderEventType } from "@confenge/control-center-contracts";
import {
  createWorkOrder,
  decideWorkOrder,
  deriveWorkOrderId,
  projectWorkOrder,
  replayWorkOrder,
  type BusinessCalendar,
  type CreateWorkOrderCommand,
  type EventContext,
} from "./index.js";

interface CanaryInput {
  handoff: Record<string, unknown>;
  admission: Record<string, unknown>;
  readiness: Record<string, unknown>;
  capacity_calendar: BusinessCalendar;
  bad_artifact: Record<string, unknown>;
  artifact: Record<string, unknown>;
  failed_qa: Record<string, unknown>;
  times: Record<string, string>;
}

function row(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function text(value: Record<string, unknown>, key: string): string {
  const item = value[key];
  if (typeof item !== "string" || item.trim() === "") throw new Error(`${key} is required`);
  return item;
}

function positiveInteger(value: Record<string, unknown>, key: string): number {
  const item = value[key];
  if (!Number.isInteger(item) || Number(item) <= 0) throw new Error(`${key} must be a positive integer`);
  return Number(item);
}

function stringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every((item) => typeof item === "string" && item.trim() !== "")) {
    throw new Error(`${label} must contain non-empty strings`);
  }
  return [...new Set(value)];
}

function artifactRef(value: Record<string, unknown>, suffix: string): WorkOrderArtifactRef {
  const sha256 = text(value, "artifact_ref");
  if (!/^sha256:[a-f0-9]{64}$/.test(sha256)) throw new Error("artifact_ref must be a canonical sha256 reference");
  return {
    artifact_id: `artifact:cfg-diag-exp:${suffix}`,
    sha256,
    evidence_ref: sha256,
  };
}

function command(input: CanaryInput): CreateWorkOrderCommand {
  const handoff = input.handoff;
  const admission = input.admission;
  const readiness = input.readiness;
  const gate = row(handoff.financial_gate, "financial_gate");
  if (gate.state !== "SYNTHETIC_VALID" || handoff.synthetic !== true || gate.synthetic !== true || gate.received_revenue !== false) {
    throw new Error("the canary requires a synthetic, non-revenue reconciled gate");
  }
  const requiredInputs = row(readiness, "readiness").inputs_required;
  if (!Array.isArray(requiredInputs) || requiredInputs.length === 0) throw new Error("readiness inputs are required");
  const inputIds = requiredInputs.map((item) => text(row(item, "readiness input"), "input_id"));
  const effort = row(readiness.estimated_effort, "estimated_effort");
  const providerRefs = stringList(handoff.evidence_refs, "handoff.evidence_refs");
  providerRefs.push(text(handoff, "onboarding_ref"));
  return {
    client_id: text(handoff, "client_ref"),
    account_id: text(handoff, "account_id"),
    opportunity_id: text(handoff, "opportunity_id"),
    qco_id: text(handoff, "qco_id"),
    proposal_id: text(handoff, "proposal_id"),
    proposal_version: String(positiveInteger(handoff, "proposal_version")),
    order_id: text(gate, "source_event_id"),
    provider_refs: [...new Set(providerRefs)],
    accepted_snapshot_hash: text(handoff, "accepted_snapshot_hash"),
    offer_id: text(handoff, "offer_id"),
    offer_version: text(handoff, "offer_version"),
    deliverable_id: text(handoff, "deliverable_id"),
    deliverable_version: text(handoff, "deliverable_version"),
    scope_version: text(handoff, "scope_version"),
    price_version: text(handoff, "price_version"),
    terms_version: text(handoff, "terms_version"),
    input_ids: inputIds,
    business_calendar_version: text(admission, "calendar_version"),
    estimated_effort_minutes: null,
    estimated_capacity_units: positiveInteger(effort, "amount"),
    capacity_commitment_id: text(admission, "capacity_hold_id"),
    responsible_owner: text(row(readiness.responsible_owner, "responsible_owner"), "owner_id"),
    financial_gate: "RECONCILED",
    readiness_state: "READY",
    synthetic: true,
  };
}

function context(
  input: CanaryInput,
  key: string,
  occurredAt: string,
  causationId: string | null,
  actorId = "operator:delivery-synthetic",
): EventContext {
  const evidenceRef = `evidence:sandbox:${key}`;
  return {
    actor: { kind: actorId.startsWith("system:") ? "system" : "human", id: actorId },
    reason_code: "SANDBOX_CANARY",
    literal_reason_ref: evidenceRef,
    occurred_at: occurredAt,
    idempotency_key: `delivery-canary:${key}`,
    correlation_id: text(input.handoff, "correlation_id"),
    causation_id: causationId,
    source_system: "governance",
    evidence_refs: [evidenceRef],
  };
}

function run(input: CanaryInput): Record<string, unknown> {
  const createCommand = command(input);
  const created = createWorkOrder(
    createCommand,
    context(input, "create", text(input.handoff, "occurred_at"), text(input.handoff, "event_id"), "system:delivery-handoff"),
  );
  const events: WorkOrderEvent[] = [created.event];
  let order = created.work_order;
  const advance = (
    type: Exclude<WorkOrderEventType, "WORK_ORDER_CREATED">,
    data: Record<string, unknown>,
    at: string,
    key: string,
    calendar?: BusinessCalendar,
    actor?: string,
  ): void => {
    const decision = decideWorkOrder(order, type, data, context(input, key, at, order.last_event_id, actor), calendar);
    order = decision.work_order;
    events.push(decision.event);
  };

  advance("OWNER_ASSIGNED", { owner: createCommand.responsible_owner }, text(input.times, "owner_assigned_at"), "owner-assigned");
  createCommand.input_ids.forEach((inputId, index) => {
    const at = new Date(new Date(text(input.times, "owner_assigned_at")).getTime() + (index + 1) * 60_000).toISOString();
    advance("INPUT_RECEIVED", { input_id: inputId, evidence_ref: `fixture:input:${inputId}:synthetic-redacted` }, at, `input-${index + 1}`);
  });
  advance("PRODUCTION_STARTED", {
    business_days: positiveInteger(row(input.readiness.estimated_effort, "estimated_effort"), "lead_time_business_days"),
    capacity_commitment_id: createCommand.capacity_commitment_id,
    capacity_state: "COMMITTED",
    capacity_evidence_ref: `capacity:commit:${createCommand.capacity_commitment_id}`,
  }, text(input.times, "work_started_at"), "production-started", input.capacity_calendar);
  advance("EFFORT_RECORDED", { effort_minutes: 60 }, text(input.times, "bad_artifact_at"), "effort-initial");
  advance("QA_SUBMITTED", {
    QA_checklist_version: text(row(input.readiness.qa, "qa"), "version"),
    artifact_refs: [artifactRef(input.bad_artifact, "bad")],
  }, text(input.times, "bad_artifact_at"), "qa-submit-bad");
  const failedChecks = stringList(input.failed_qa.failed_checks, "failed_qa.failed_checks");
  advance("QA_FAILED", {
    nonconformity: {
      nonconformity_id: "nc:cfg-diag-exp:synthetic-qa",
      reason_code: failedChecks.join("_").slice(0, 120),
      evidence_ref: "evidence:sandbox:qa-failed",
    },
  }, "2026-08-25T12:17:00Z", "qa-failed", undefined, "actor:synthetic-qa");
  advance("REWORK_STARTED", { clock_reason_version: "SANDBOX_REWORK.v1" }, "2026-08-25T12:18:00Z", "rework-started");
  advance("EFFORT_RECORDED", { effort_minutes: 60 }, "2026-08-25T12:19:00Z", "effort-rework");
  advance("NONCONFORMITY_RESOLVED", { nonconformity_id: "nc:cfg-diag-exp:synthetic-qa" }, "2026-08-25T12:19:30Z", "nonconformity-resolved", undefined, "actor:synthetic-qa");
  advance("QA_SUBMITTED", {
    QA_checklist_version: text(row(input.readiness.qa, "qa"), "version"),
    artifact_refs: [artifactRef(input.artifact, "final")],
  }, "2026-08-25T12:20:00Z", "qa-submit-final");
  advance("QA_PASSED", {}, text(input.times, "qa_passed_at"), "qa-passed", undefined, "actor:synthetic-qa");
  advance("DELIVERY_RECORDED", {
    recipient_verification_ref: "fixture:recipient:explicit-sandbox",
    clock_reason_version: "SANDBOX_DELIVERY.v1",
  }, text(input.times, "delivered_at"), "delivery-recorded");
  advance("CLIENT_ACCEPTED", {}, text(input.times, "accepted_at"), "client-accepted", undefined, "actor:synthetic-client");
  advance("WORK_ORDER_CLOSED", { outcome: "UNKNOWN", expansion_candidate: null }, text(input.times, "closed_at"), "closed");

  const replayed = replayWorkOrder([...events, ...events, ...events]);
  if (!isDeepStrictEqual(replayed, order)) throw new Error("canonical Work Order replay diverged");
  return {
    work_order: order,
    events,
    projection: projectWorkOrder(order, text(input.times, "projected_at")),
    replay_converged: true,
    duplicate_business_mutations: 0,
    work_order_count: 1,
    qa_negative_path: input.failed_qa.qa_state,
    delivery_state: order.synthetic && order.current_stage === "CLOSED" ? "SANDBOX" : "UNKNOWN",
    acceptance_state: order.client_acceptance_state === "ACCEPTED" && order.synthetic ? "ACCEPTED_SANDBOX" : order.client_acceptance_state,
  };
}

const mode = process.argv[2];
const path = process.argv[3];
if ((mode !== "derive" && mode !== "run") || path === undefined) {
  process.stderr.write("usage: tsx canary-cli.ts <derive|run> <input.json>\n");
  process.exit(2);
}
const parsed = row(JSON.parse(readFileSync(path, "utf8")), "canary input") as unknown as CanaryInput;
const output: unknown = mode === "derive" ? { work_order_id: deriveWorkOrderId(command(parsed)) } : run(parsed);
process.stdout.write(`${JSON.stringify(output)}\n`);
