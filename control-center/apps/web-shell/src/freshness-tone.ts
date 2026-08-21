import type { FreshnessStatus, HealthStatus } from "./types";

export type FreshnessTone = "green" | "amber" | "slate" | "red";

/**
 * STALE / UNKNOWN / ERROR are never the healthy green tone.
 * Color is paired with a text label elsewhere; this only maps recency.
 */
export function freshnessTone(status: FreshnessStatus): FreshnessTone {
  switch (status) {
    case "FRESH":
      return "green";
    case "STALE":
      return "amber";
    case "UNKNOWN":
      return "slate";
    case "ERROR":
      return "red";
  }
}

export function healthTone(status: HealthStatus): FreshnessTone {
  switch (status) {
    case "healthy":
      return "green";
    case "degraded":
      return "amber";
    case "unknown":
      return "slate";
    case "down":
      return "red";
  }
}

export function combinedTone(freshness: FreshnessStatus, health?: HealthStatus): FreshnessTone {
  const fresh = freshnessTone(freshness);
  if (!health) return fresh;
  const rank: Record<FreshnessTone, number> = { green: 0, amber: 1, slate: 2, red: 3 };
  const other = healthTone(health);
  return rank[other] > rank[fresh] ? other : fresh;
}

export function isHealthyGreen(status: FreshnessStatus): boolean {
  return status === "FRESH";
}

export function neverGreenStatuses(): readonly FreshnessStatus[] {
  return ["STALE", "UNKNOWN", "ERROR"];
}
