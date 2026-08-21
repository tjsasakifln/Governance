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

export function demoteHealthStatus(
  freshness: FreshnessStatus,
  status: string | undefined,
): string | undefined {
  if (status === undefined) {
    return undefined;
  }
  if (freshness === "FRESH") {
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
