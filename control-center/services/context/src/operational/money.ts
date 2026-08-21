import type { FreshnessStatus } from "../types.ts";
import type { EvidencedMoney, SourceRef } from "./types.ts";

const CURRENCY_RE = /^[A-Z]{3}$/;

export interface ProvenanceSeed {
  source: SourceRef;
  observed_at: string;
  freshness_status: FreshnessStatus;
  confidence: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function integerCents(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  const rec = asRecord(value);
  if (rec && typeof rec.amount_cents === "number" && Number.isInteger(rec.amount_cents)) {
    return rec.amount_cents;
  }
  return undefined;
}

function currencyOf(value: unknown, fallback?: string): string | undefined {
  const rec = asRecord(value);
  if (rec && typeof rec.currency === "string" && CURRENCY_RE.test(rec.currency)) {
    return rec.currency;
  }
  if (fallback && CURRENCY_RE.test(fallback)) {
    return fallback;
  }
  return undefined;
}

function sourceOf(value: unknown, fallback: SourceRef): SourceRef {
  const rec = asRecord(value);
  const source = rec ? asRecord(rec.source) : null;
  if (
    source &&
    typeof source.system === "string" &&
    typeof source.kind === "string" &&
    typeof source.locator === "string"
  ) {
    const out: SourceRef = {
      system: source.system,
      kind: source.kind,
      locator: source.locator,
    };
    if (typeof source.label === "string") {
      out.label = source.label;
    }
    return out;
  }
  return fallback;
}

function observedOf(value: unknown, fallback: string): string {
  const rec = asRecord(value);
  if (rec && typeof rec.observed_at === "string") {
    return rec.observed_at;
  }
  return fallback;
}

function freshnessOf(value: unknown, fallback: FreshnessStatus): FreshnessStatus {
  const rec = asRecord(value);
  const status = rec?.freshness_status;
  if (status === "FRESH" || status === "STALE" || status === "UNKNOWN" || status === "ERROR") {
    return status;
  }
  return fallback;
}

function confidenceOf(value: unknown, fallback: number): number {
  const rec = asRecord(value);
  if (typeof rec?.confidence === "number" && rec.confidence >= 0 && rec.confidence <= 1) {
    return rec.confidence;
  }
  return fallback;
}

export function evidencedMoney(value: unknown, seed: ProvenanceSeed): EvidencedMoney | undefined {
  const cents = integerCents(value);
  if (cents === undefined) {
    return undefined;
  }
  const currency = currencyOf(value, "BRL");
  if (!currency) {
    return undefined;
  }
  return {
    amount_cents: cents,
    currency,
    source: sourceOf(value, seed.source),
    observed_at: observedOf(value, seed.observed_at),
    freshness_status: freshnessOf(value, seed.freshness_status),
    confidence: confidenceOf(value, seed.confidence),
  };
}

/**
 * Keep contracted / billed / paid / effectively_received as distinct stages.
 * Asaas CONFIRMED is paid, never effectively received. Absence is omitted,
 * never replaced with an optimistic zero.
 */
export function financeStages(
  payload: Record<string, unknown>,
  seed: ProvenanceSeed,
): Record<string, EvidencedMoney> {
  const confirmed =
    integerCents(payload.confirmed_cents) ??
    integerCents(payload.asaas_confirmed_cents) ??
    integerCents(asRecord(payload.asaas_status_counts)?.CONFIRMED);

  const receivedListed =
    integerCents(payload.received_cents) ?? integerCents(payload.effectively_received);
  const paidListed = integerCents(payload.paid);

  let paidCents = paidListed;
  let receivedCents = receivedListed;

  if (confirmed !== undefined && confirmed > 0) {
    if (paidCents === undefined && receivedCents !== undefined) {
      paidCents = receivedCents + confirmed;
    } else if (paidCents === undefined) {
      paidCents = confirmed;
    }
    if (receivedCents !== undefined && paidCents !== undefined && receivedCents >= paidCents) {
      receivedCents = receivedCents - confirmed;
    }
    if (receivedCents !== undefined && paidCents !== undefined && receivedCents === paidCents) {
      receivedCents = receivedCents - confirmed;
    }
  }

  const out: Record<string, EvidencedMoney> = {};
  const contracted = evidencedMoney(payload.contracted, { ...seed, source: { ...seed.source, locator: `${seed.source.locator}/contracted` } });
  const billed = evidencedMoney(payload.billed, { ...seed, source: { ...seed.source, locator: `${seed.source.locator}/billed` } });
  if (contracted) {
    out.contracted = contracted;
  }
  if (billed) {
    out.billed = billed;
  }
  if (paidCents !== undefined) {
    const paid = evidencedMoney(
      { ...(asRecord(payload.paid) ?? {}), amount_cents: paidCents },
      { ...seed, source: { ...seed.source, locator: `${seed.source.locator}/paid` } },
    );
    if (paid) {
      out.paid = paid;
    }
  }
  if (receivedCents !== undefined) {
    const received = evidencedMoney(
      { ...(asRecord(payload.effectively_received) ?? {}), amount_cents: receivedCents },
      { ...seed, source: { ...seed.source, locator: `${seed.source.locator}/received` } },
    );
    if (received) {
      out.effectively_received = received;
    }
  }
  const overdue = evidencedMoney(payload.overdue, { ...seed, source: { ...seed.source, locator: `${seed.source.locator}/overdue` } });
  const receivable = evidencedMoney(payload.receivable, { ...seed, source: { ...seed.source, locator: `${seed.source.locator}/receivable` } });
  const refunds = evidencedMoney(payload.refunds, { ...seed, source: { ...seed.source, locator: `${seed.source.locator}/refunds` } });
  const chargebacks = evidencedMoney(payload.chargebacks, { ...seed, source: { ...seed.source, locator: `${seed.source.locator}/chargebacks` } });
  if (overdue) {
    out.overdue = overdue;
  }
  if (receivable) {
    out.receivable = receivable;
  }
  if (refunds) {
    out.refunds = refunds;
  }
  if (chargebacks) {
    out.chargebacks = chargebacks;
  }
  return out;
}

export function reliableWeightedPipeline(payload: Record<string, unknown>, seed: ProvenanceSeed): EvidencedMoney | undefined {
  const weighted = asRecord(payload.pipeline_weighted);
  if (!weighted) {
    return undefined;
  }
  if (weighted.probability_reliable !== true) {
    return undefined;
  }
  return evidencedMoney(weighted, seed);
}
