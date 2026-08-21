import { availabilityFromEnvelope, freshnessForAvailability } from "./availability.ts";
import {
  PROJECTOR_VERSION,
  asArray,
  asRecord,
  capList,
  integerOrUndefined,
  type CollectorEnvelope,
  type ProjectedSnapshot,
} from "./types.ts";

function moneyFromBucket(value: unknown): { amount_cents: number; currency: string } | undefined {
  const rec = asRecord(value);
  if (!rec) return undefined;
  if (typeof rec.amount_cents === "number" && Number.isInteger(rec.amount_cents)) {
    return { amount_cents: rec.amount_cents, currency: typeof rec.currency === "string" ? rec.currency : "BRL" };
  }
  if (typeof rec.cents === "number" && Number.isInteger(rec.cents)) {
    return { amount_cents: rec.cents, currency: typeof rec.currency === "string" ? rec.currency : "BRL" };
  }
  return undefined;
}

export function projectFinance(envelope: CollectorEnvelope): ProjectedSnapshot {
  const availability = availabilityFromEnvelope(envelope);
  const freshness = freshnessForAvailability(availability, envelope.freshness_status);
  const payload = asRecord(envelope.payload) ?? {};
  const inner = asRecord(payload.snapshot) ?? payload;
  const buckets = asRecord(inner.buckets) ?? inner;
  const contracted = moneyFromBucket(inner.contracted ?? buckets.contracted);
  const billed = moneyFromBucket(inner.billed ?? buckets.billed);
  const paid = moneyFromBucket(inner.paid ?? buckets.paid);
  const received = moneyFromBucket(inner.effectively_received ?? inner.received ?? buckets.received);
  const overdue = moneyFromBucket(inner.overdue ?? inner.receivables_overdue);
  const receivable = moneyFromBucket(inner.receivable ?? inner.receivables_open);
  const entities = asRecord(inner.entities) ?? {};
  const charges = capList(
    asArray(entities.charges).map((item) => {
      const row = asRecord(item) ?? {};
      const amount = moneyFromBucket(row.amount);
      const dates = asRecord(row.dates) ?? {};
      return {
        provider_id: row.provider_id ?? row.id,
        lifecycle: row.lifecycle ?? row.provider_status,
        due_at: dates.due_at,
        paid_at: dates.paid_at,
        received_at: dates.received_at,
        ...(amount ? { amount } : {}),
      };
    }),
  );

  const body: Record<string, unknown> = {
    schema_version: "control-center.finance-snapshot.v1",
    projector_version: PROJECTOR_VERSION,
    availability,
    read_model_only: true,
    provider_mutations: "forbidden",
    real_money_mutation_approved: false,
    operations: {
      charges,
      customers: capList(asArray(entities.customers).map((item) => {
        const row = asRecord(item) ?? {};
        return { provider_id: row.provider_id ?? row.id, lifecycle: row.lifecycle };
      })),
      stages_are_distinct: ["contracted", "billed", "paid", "effectively_received"],
      asaas_confirmed_is_paid_never_received: true,
    },
  };
  if (contracted) body.contracted = contracted;
  if (billed) body.billed = billed;
  if (paid) body.paid = paid;
  if (received) body.effectively_received = received;
  if (overdue) {
    body.overdue = overdue;
    body.receivables_overdue = overdue;
  }
  if (receivable) {
    body.receivable = receivable;
    body.receivables_open = receivable;
  }

  return {
    projector_version: PROJECTOR_VERSION,
    snapshot_kind: "finance",
    scope: "finance",
    payload: body,
    freshness_status: freshness,
    availability,
    confidence: envelope.confidence,
    observed_at: envelope.observed_at,
    source: envelope.source,
  };
}

export { integerOrUndefined };
