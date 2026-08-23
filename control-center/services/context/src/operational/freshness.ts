import type { FreshnessStatus } from "../types.ts";

const RANK: Record<FreshnessStatus, number> = {
  ERROR: 0,
  STALE: 1,
  UNKNOWN: 2,
  FRESH: 3,
};

/** Worst-of roll-up. ERROR is never rewritten as UNKNOWN. */
export function worstFreshness(statuses: readonly FreshnessStatus[]): FreshnessStatus {
  if (statuses.length === 0) {
    return "UNKNOWN";
  }
  let worst: FreshnessStatus = "FRESH";
  for (const status of statuses) {
    if (RANK[status] < RANK[worst]) {
      worst = status;
    }
  }
  return worst;
}

export function looksHealthy(freshness: FreshnessStatus, presence: "present" | "absent"): boolean {
  return presence === "present" && freshness === "FRESH";
}

/**
 * Confidence is trust, freshness is recency, and "healthy" claims both. A
 * confidence of zero means no evidence was gathered at all — not configured,
 * blocked, or failed — so it can no more support a healthy conclusion than a
 * stale observation can. Callers that have a confidence pass it; callers that
 * only know recency keep the two-argument form.
 */
export function demoteHealthStatus(
  freshness: FreshnessStatus,
  status: string | undefined,
  confidence?: number,
): string | undefined {
  if (status === undefined) {
    return undefined;
  }
  const evidenced = confidence === undefined || confidence > 0;
  if (freshness === "FRESH" && evidenced) {
    return status;
  }
  if (status === "healthy") {
    return freshness === "ERROR" ? "down" : "unknown";
  }
  return status;
}

export function minConfidence(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((min, n) => (n < min ? n : min), 1);
}
