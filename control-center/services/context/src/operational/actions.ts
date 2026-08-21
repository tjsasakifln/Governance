import {
  FORBIDDEN_OPERATOR_ACTION_TYPES,
  OPERATOR_ACTION_TYPES,
  type Persistence,
} from "@confenge/control-center-persistence";
import { assertFounder } from "../actor.ts";
import { forbidden, invalid } from "../errors.ts";
import type { ActorRef } from "../types.ts";

export const ALLOWED_OPERATOR_ACTIONS = OPERATOR_ACTION_TYPES;
export const FORBIDDEN_OPERATOR_ACTIONS = FORBIDDEN_OPERATOR_ACTION_TYPES;

export interface OperatorActionRecord {
  id: string;
  action_type: string;
  target_canonical_id: string;
  target_source_id: string;
  actor: { kind: "human"; id: string };
  occurred_at: string;
  correlation_id: string;
  idempotency_key: string;
  resulting_status: "accepted" | "rejected" | "duplicate";
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  evidence_ref: string | null;
  note: string | null;
  scope: string;
}

export interface OperatorActionService {
  submit(actor: ActorRef, body: unknown): Promise<OperatorActionRecord>;
  list(actor: ActorRef, scope: string): Promise<OperatorActionRecord[]>;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function createMemoryOperatorActionService(founderActorId: string): OperatorActionService {
  const items: OperatorActionRecord[] = [];
  return {
    async submit(actor, body) {
      assertFounder(actor, founderActorId);
      const rec = asRecord(body);
      const actionType = str(rec.action_type ?? rec.actionType).toUpperCase();
      if ((FORBIDDEN_OPERATOR_ACTIONS as readonly string[]).includes(actionType)) {
        throw forbidden("operator_action_forbidden", `${actionType} is not permitted through the Control Center`);
      }
      if (!(ALLOWED_OPERATOR_ACTIONS as readonly string[]).includes(actionType)) {
        throw invalid(`unknown operator action type: ${actionType || "empty"}`);
      }
      const idempotencyKey = str(rec.idempotency_key ?? rec.idempotencyKey);
      if (!idempotencyKey) {
        throw invalid("idempotency_key is required");
      }
      const existing = items.find((row) => row.idempotency_key === idempotencyKey);
      if (existing) {
        return { ...existing, resulting_status: "duplicate" };
      }
      const now = new Date().toISOString();
      const recorded: OperatorActionRecord = {
        id: `cc:operator-action:${idempotencyKey.replace(/[^A-Za-z0-9._~-]+/g, "-").slice(0, 64)}`,
        action_type: actionType,
        target_canonical_id: str(rec.target_canonical_id ?? rec.targetCanonicalId),
        target_source_id: str(rec.target_source_id ?? rec.targetSourceId),
        actor: { kind: "human", id: actor.id },
        occurred_at: str(rec.occurred_at) || now,
        correlation_id: str(rec.correlation_id ?? rec.correlationId) || idempotencyKey,
        idempotency_key: idempotencyKey,
        resulting_status: "accepted",
        before: asRecord(rec.before),
        after: asRecord(rec.after),
        evidence_ref: str(rec.evidence_ref ?? rec.evidenceRef) || null,
        note: str(rec.note) || null,
        scope: str(rec.scope) || "commercial",
      };
      if (!recorded.target_canonical_id || !recorded.target_source_id) {
        throw invalid("target_canonical_id and target_source_id are required");
      }
      items.push(recorded);
      return recorded;
    },
    async list(actor, scope) {
      assertFounder(actor, founderActorId);
      return items.filter((row) => row.scope === scope);
    },
  };
}

export function createPostgresOperatorActionService(
  persistence: Persistence,
  founderActorId: string,
): OperatorActionService {
  const memory = createMemoryOperatorActionService(founderActorId);
  return {
    async submit(actor, body) {
      const preview = await memory.submit(actor, body);
      if (preview.resulting_status === "duplicate") {
        return preview;
      }
      const recorded = await persistence.recordOperatorAction({
        actionType: preview.action_type as (typeof ALLOWED_OPERATOR_ACTIONS)[number],
        targetCanonicalId: preview.target_canonical_id,
        targetSourceId: preview.target_source_id,
        actorId: actor.id,
        occurredAt: new Date(preview.occurred_at),
        correlationId: preview.correlation_id,
        idempotencyKey: preview.idempotency_key,
        scope: preview.scope,
        resultingStatus: "accepted",
        beforeJson: preview.before,
        afterJson: preview.after,
        evidenceRef: preview.evidence_ref,
        note: preview.note,
        source: { system: "control-center", kind: "operator-action", locator: preview.target_canonical_id },
        observedAt: new Date(preview.occurred_at),
        freshnessStatus: "FRESH",
        confidence: 1,
      });
      return {
        ...preview,
        id: recorded.action.id,
        resulting_status: recorded.inserted ? "accepted" : "duplicate",
      };
    },
    async list(actor, scope) {
      assertFounder(actor, founderActorId);
      const rows = await persistence.listOperatorActionsByScope(scope);
      return rows.map((row) => ({
        id: row.id,
        action_type: row.actionType,
        target_canonical_id: row.targetCanonicalId,
        target_source_id: row.targetSourceId,
        actor: { kind: "human" as const, id: row.actorId },
        occurred_at: row.occurredAt.toISOString(),
        correlation_id: row.correlationId,
        idempotency_key: row.idempotencyKey,
        resulting_status: row.resultingStatus,
        before: row.beforeJson,
        after: row.afterJson,
        evidence_ref: row.evidenceRef,
        note: row.note,
        scope: row.scope,
      }));
    },
  };
}
