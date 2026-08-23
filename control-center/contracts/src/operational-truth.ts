import type { FreshnessStatus } from "./taxonomy.js";
import type { SourceRef, UtcDateTime } from "./types.js";

/**
 * One vocabulary for the evidential meaning of an operational value.
 *
 * This is deliberately not a severity scale. A confirmed non-zero count can
 * carry HEALTHY evidence while the business value itself still demands work.
 * Likewise ZERO is a measured value, never a synonym for ABSENT or UNKNOWN.
 */
export const OPERATIONAL_TRUTH_STATES = [
  "ZERO",
  "ABSENT",
  "UNKNOWN",
  "STALE",
  "ERROR",
  "HEALTHY",
] as const;
export type OperationalTruthState = (typeof OPERATIONAL_TRUTH_STATES)[number];

export const OPERATIONAL_TRUTH_REASONS = [
  "confirmed_zero",
  "source_absent",
  "recency_unknown",
  "partial_payload",
  "observation_stale",
  "collection_error",
  "fresh_observation",
] as const;
export type OperationalTruthReason = (typeof OPERATIONAL_TRUTH_REASONS)[number];

export interface OperationalTruth {
  state: OperationalTruthState;
  as_of: UtcDateTime;
  source: SourceRef;
  confidence: number;
  reason: OperationalTruthReason;
}

export interface OperationalTruthInput {
  as_of: UtcDateTime;
  /** Evaluation clock used to reject observations that claim to come from the future. */
  evaluated_at?: UtcDateTime;
  source: SourceRef;
  confidence: number;
  freshness_status: FreshnessStatus;
  presence?: "present" | "absent";
  /** Set only when the producer actually observed the scalar. */
  value?: number;
  /** False means a bounded response is incomplete, not empty. */
  complete?: boolean;
}

/** Fail-closed precedence. Transport uncertainty is never hidden by absence or a scalar value. */
export function operationalTruth(input: OperationalTruthInput): OperationalTruth {
  let state: OperationalTruthState;
  let reason: OperationalTruthReason;
  if (input.freshness_status === "ERROR") {
    state = "ERROR";
    reason = "collection_error";
  } else if (input.freshness_status === "STALE") {
    state = "STALE";
    reason = "observation_stale";
  } else if (
    input.evaluated_at !== undefined &&
    (!validUtcInstant(input.as_of) || !validUtcInstant(input.evaluated_at) || Date.parse(input.as_of) > Date.parse(input.evaluated_at))
  ) {
    state = "UNKNOWN";
    reason = "recency_unknown";
  } else if (input.freshness_status === "UNKNOWN" || input.confidence <= 0) {
    state = "UNKNOWN";
    reason = "recency_unknown";
  } else if (input.presence === "absent") {
    state = "ABSENT";
    reason = "source_absent";
  } else if (input.complete === false) {
    state = "UNKNOWN";
    reason = "partial_payload";
  } else if (input.value === 0) {
    state = "ZERO";
    reason = "confirmed_zero";
  } else {
    state = "HEALTHY";
    reason = "fresh_observation";
  }
  return {
    state,
    as_of: input.as_of,
    source: input.source,
    confidence: input.confidence,
    reason,
  };
}

function validUtcInstant(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)) return false;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return false;
  const inputSecond = value.replace(/\.\d{1,9}Z$/, "Z");
  const parsedSecond = new Date(parsed).toISOString().replace(/\.\d{3}Z$/, "Z");
  return inputSecond === parsedSecond;
}
