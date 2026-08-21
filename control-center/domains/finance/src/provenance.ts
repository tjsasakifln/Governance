import { ageSeconds, toUtcIso } from "./dates.js";
import type {
  FinanceEvent,
  FreshnessStatus,
  IncompleteReason,
  MoneyFigure,
  SourceRef,
} from "./types.js";

export const AGGREGATOR_SOURCE: SourceRef = {
  system: "collector",
  kind: "finance-read-model",
  locator: "aggregate",
};

export function freshnessOf(
  observedAt: string,
  asOf: string,
  windowSeconds: number,
): FreshnessStatus {
  const age = ageSeconds(observedAt, asOf);
  if (age <= windowSeconds) {
    return "FRESH";
  }
  return "STALE";
}

export function minConfidence(values: readonly number[], fallback = 0): number {
  if (values.length === 0) {
    return fallback;
  }
  let min = 1;
  for (const value of values) {
    if (value < min) {
      min = value;
    }
  }
  return min;
}

export function latestObservedAt(events: readonly FinanceEvent[], fallback: string): string {
  if (events.length === 0) {
    return fallback;
  }
  let latest = events[0]?.observed_at ?? fallback;
  for (const event of events) {
    if (event.observed_at > latest) {
      latest = event.observed_at;
    }
  }
  return latest;
}

export function sourceFromEvents(events: readonly FinanceEvent[]): SourceRef {
  if (events.length === 0) {
    return AGGREGATOR_SOURCE;
  }
  const first = events[0];
  if (!first) {
    return AGGREGATOR_SOURCE;
  }
  const system = first.source.system;
  const same = events.every((event) => event.source.system === system);
  if (same) {
    return {
      system,
      kind: "finance-observation",
      locator: first.source.locator,
    };
  }
  return AGGREGATOR_SOURCE;
}

export function figure(
  amountCents: number,
  currency: string,
  asOf: string,
  windowSeconds: number,
  contributors: readonly FinanceEvent[],
  extraReasons: readonly IncompleteReason[] = [],
  generatedAt?: string,
): MoneyFigure {
  const observedAt = contributors.length > 0
    ? latestObservedAt(contributors, asOf)
    : (generatedAt ?? asOf);
  const reasons = [...extraReasons];
  const incomplete = reasons.length > 0;
  const confidence = contributors.length > 0
    ? minConfidence(contributors.map((event) => event.confidence), 0)
    : incomplete
      ? 0
      : 1;
  const freshness = contributors.length > 0
    ? freshnessOf(observedAt, asOf, windowSeconds)
    : "FRESH";
  return {
    amount_cents: amountCents,
    currency,
    source: sourceFromEvents(contributors),
    observed_at: observedAt,
    freshness_status: freshness,
    confidence,
    incomplete,
    incomplete_reasons: reasons,
  };
}

export function snapshotId(seed: string, asOf: string): string {
  const slug = seed.replace(/[^A-Za-z0-9._~-]/g, "-").slice(0, 64);
  const day = toUtcIso(new Date(asOf)).slice(0, 10);
  return `cc:finance-snapshot:${slug || "default"}-${day}`;
}
