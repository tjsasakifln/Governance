import { FinanceDeniedError } from "./errors.js";
import { parseManualAdjustmentInput } from "./validate.js";
import type {
  AdjustmentResult,
  AuditRecord,
  FinanceEvent,
  FinanceObservationPort,
  ManualAdjustmentInput,
  ManualAdjustmentRecord,
} from "./types.js";

let seq = 0;

function nextId(prefix: string): string {
  seq += 1;
  const stamp = Date.now().toString(36);
  return `cc:${prefix}:${stamp}${seq.toString(36)}`;
}

export function adjustmentToEvent(
  input: ManualAdjustmentInput,
  eventId: string,
): FinanceEvent {
  const event: FinanceEvent = {
    id: eventId,
    idempotency_key: input.idempotency_key,
    kind: "manual_adjustment",
    occurred_at: input.effective_at,
    amount_cents: input.amount_cents,
    currency: input.currency,
    client_id: input.client_id,
    obligation_id: input.obligation_id,
    billing_mode: input.billing_mode ?? "UNKNOWN",
    settlement_proven: input.target === "recebida",
    source: input.source,
    observed_at: input.observed_at,
    freshness_status: input.freshness_status,
    confidence: input.confidence,
    adjustment_target: input.target,
    notes: input.reason,
  };
  if (input.billing_cycle !== undefined) {
    event.billing_cycle = input.billing_cycle;
  }
  if (input.offer_code !== undefined) {
    event.offer_code = input.offer_code;
  }
  return event;
}

function auditSuccess(
  record: ManualAdjustmentRecord,
  input: ManualAdjustmentInput,
): AuditRecord {
  return {
    id: nextId("audit-event"),
    at: record.created_at,
    actor: input.created_by,
    action: "manual_adjustment_appended",
    resource_type: "ManualAdjustment",
    resource_id: record.id,
    scope: "finance",
    outcome: "success",
    detail: {
      target: input.target,
      amount_cents: input.amount_cents,
      currency: input.currency,
      reason: input.reason,
      idempotency_key: input.idempotency_key,
      provider_mutation: "forbidden",
    },
  };
}

function auditDenied(input: ManualAdjustmentInput, code: string, at: string): AuditRecord {
  return {
    id: nextId("audit-event"),
    at,
    actor: input.created_by,
    action: "manual_adjustment_denied",
    resource_type: "ManualAdjustment",
    resource_id: null,
    scope: "finance",
    outcome: "denied",
    detail: {
      target: input.target,
      amount_cents: input.amount_cents,
      currency: input.currency,
      reason: input.reason,
      idempotency_key: input.idempotency_key,
      provider_mutation: "forbidden",
      denied_code: code,
    },
  };
}

export class MemoryFinanceLedger implements FinanceObservationPort {
  private readonly events: FinanceEvent[] = [];
  private readonly adjustmentsByKey = new Map<string, ManualAdjustmentRecord>();
  readonly audits: AuditRecord[] = [];

  constructor(initial: readonly FinanceEvent[] = []) {
    for (const event of initial) {
      this.ingest(event);
    }
  }

  ingest(event: FinanceEvent): boolean {
    if (this.events.some((existing) => existing.idempotency_key === event.idempotency_key)) {
      return false;
    }
    this.events.push(event);
    return true;
  }

  getAdjustment(idempotencyKey: string): ManualAdjustmentRecord | undefined {
    return this.adjustmentsByKey.get(idempotencyKey);
  }

  putAdjustment(record: ManualAdjustmentRecord): void {
    this.adjustmentsByKey.set(record.event.idempotency_key, record);
  }

  async listEvents(): Promise<FinanceEvent[]> {
    return [...this.events];
  }

  async appendAdjustment(raw: ManualAdjustmentInput): Promise<AdjustmentResult> {
    return appendManualAdjustment(this, raw);
  }
}

export function appendManualAdjustment(
  ledger: MemoryFinanceLedger,
  raw: unknown,
): AdjustmentResult {
  const input = parseManualAdjustmentInput(raw);
  if (input.source.system !== "manual") {
    const denied = auditDenied(input, "FINANCE_ADJUSTMENT_SOURCE", new Date().toISOString());
    ledger.audits.push(denied);
    throw new FinanceDeniedError(
      "FINANCE_ADJUSTMENT_SOURCE",
      "manual adjustments must use source.system=manual",
    );
  }

  const prior = ledger.getAdjustment(input.idempotency_key);
  if (prior) {
    return {
      record: prior,
      audit: auditSuccess(prior, input),
      duplicate: true,
    };
  }

  const createdAt = new Date().toISOString();
  const recordId = nextId("manual-adjustment");
  const event = adjustmentToEvent(input, recordId);
  const inserted = ledger.ingest(event);
  if (!inserted) {
    const existing = ledger.getAdjustment(input.idempotency_key);
    if (existing) {
      return { record: existing, audit: auditSuccess(existing, input), duplicate: true };
    }
  }
  const record: ManualAdjustmentRecord = {
    id: recordId,
    event,
    created_by: input.created_by,
    reason: input.reason,
    created_at: createdAt,
  };
  ledger.putAdjustment(record);
  const audit = auditSuccess(record, input);
  ledger.audits.push(audit);
  return { record, audit, duplicate: false };
}

export function createMemoryLedger(initial: readonly FinanceEvent[] = []): MemoryFinanceLedger {
  return new MemoryFinanceLedger(initial);
}
