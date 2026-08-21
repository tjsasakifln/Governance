import { createHash } from "node:crypto";

export const CANARY_COLLECTORS = ["warmbly", "asaas", "pncp", "infra"] as const;
export type CanaryCollector = (typeof CANARY_COLLECTORS)[number];

export const CANONICAL_FRESHNESS = ["FRESH", "STALE", "UNKNOWN", "ERROR"] as const;
export type CanonicalFreshness = (typeof CANONICAL_FRESHNESS)[number];

export const CAPABILITIES = [
  "AVAILABLE",
  "PARTIAL",
  "BLOCKED_BY_SECRET",
  "BLOCKED_UPSTREAM",
  "CONTRACT_DRIFT",
  "ERROR",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export interface CanaryError {
  readonly code: string;
  readonly message: string;
}

export interface CanaryEnvelope {
  readonly collector: CanaryCollector;
  readonly freshness_status: CanonicalFreshness;
  readonly observed_at: string;
  readonly source: {
    readonly system: string;
    readonly kind: string;
    readonly locator: string;
  };
  readonly confidence: number;
  readonly error: CanaryError | null;
  readonly payload: Record<string, unknown>;
  readonly idempotency_key: string;
}

export interface CanaryReport extends CanaryEnvelope {
  readonly capability: Capability;
}

export function stableIdempotencyKey(parts: {
  readonly collector: CanaryCollector;
  readonly kind: string;
  readonly locator: string;
  readonly observedAt: string;
}): string {
  const digest = createHash("sha256")
    .update(`${parts.collector}|${parts.kind}|${parts.locator}|${parts.observedAt}`)
    .digest("hex")
    .slice(0, 16);
  return `${parts.collector}:${parts.kind}:${digest}:${parts.observedAt}`;
}

export function buildEnvelope(input: {
  readonly collector: CanaryCollector;
  readonly freshness_status: CanonicalFreshness;
  readonly observed_at: string;
  readonly source: CanaryEnvelope["source"];
  readonly confidence: number;
  readonly error: CanaryError | null;
  readonly payload: Record<string, unknown>;
}): CanaryEnvelope {
  return {
    collector: input.collector,
    freshness_status: input.freshness_status,
    observed_at: input.observed_at,
    source: input.source,
    confidence: input.confidence,
    error: input.error,
    payload: input.payload,
    idempotency_key: stableIdempotencyKey({
      collector: input.collector,
      kind: input.source.kind,
      locator: input.source.locator,
      observedAt: input.observed_at,
    }),
  };
}

export function toCanaryReport(envelope: CanaryEnvelope, capability: Capability): CanaryReport {
  return { ...envelope, capability };
}

export function mapAsaasFreshness(status: string): CanonicalFreshness {
  if (status === "fresh") {
    return "FRESH";
  }
  if (status === "stale") {
    return "STALE";
  }
  if (status === "absent") {
    return "UNKNOWN";
  }
  if (status === "inconsistent") {
    return "ERROR";
  }
  if ((CANONICAL_FRESHNESS as readonly string[]).includes(status)) {
    return status as CanonicalFreshness;
  }
  return "ERROR";
}
