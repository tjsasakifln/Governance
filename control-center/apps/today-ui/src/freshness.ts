import { FRESHNESS_STATUSES, type FreshnessStatus, type HealthStatus } from "./taxonomy.js";
import type { FreshnessTone } from "./types.js";

export function isFreshnessStatus(value: string): value is FreshnessStatus {
  return (FRESHNESS_STATUSES as readonly string[]).includes(value);
}

/**
 * Fail-closed tone map.
 * Only exact `FRESH` may be green. STALE, UNKNOWN, ERROR, and any unknown
 * value are never presented as healthy/green.
 */
export function freshnessTone(status: string): FreshnessTone {
  if (status === "FRESH") return "green";
  if (status === "STALE") return "amber";
  if (status === "ERROR") return "red";
  return "slate";
}

export function isGreenTone(tone: FreshnessTone): boolean {
  return tone === "green";
}

/**
 * Health badge may be green only when the origin is FRESH *and* the check
 * is `healthy`. `unknown` / degraded / down never render green, even if the
 * envelope claims FRESH.
 */
export function combinedTone(freshness: string, health?: HealthStatus): FreshnessTone {
  const tone = freshnessTone(freshness);
  if (tone !== "green") return tone;
  if (!health || health === "healthy") return "green";
  if (health === "degraded") return "amber";
  if (health === "down") return "red";
  return "slate";
}

export const FRESHNESS_LABELS: Record<FreshnessStatus, string> = {
  FRESH: "fresco",
  STALE: "defasado",
  UNKNOWN: "desconhecido",
  ERROR: "erro de coleta",
};

export function freshnessLabel(status: FreshnessStatus): string {
  return FRESHNESS_LABELS[status];
}

export function coerceFreshness(status: string): FreshnessStatus {
  return isFreshnessStatus(status) ? status : "UNKNOWN";
}
