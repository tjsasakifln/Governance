import {
  FRESHNESS_STATUSES,
  FRESHNESS_WINDOW_SECONDS,
  type FreshnessStatus,
} from "./contracts.ts";

export function isFreshnessStatus(value: unknown): value is FreshnessStatus {
  return (
    typeof value === "string" &&
    (FRESHNESS_STATUSES as readonly string[]).includes(value)
  );
}

export function parseFreshness(value: unknown): FreshnessStatus {
  if (isFreshnessStatus(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return "UNKNOWN";
  }
  const key = value.trim().toUpperCase();
  if (isFreshnessStatus(key)) {
    return key;
  }
  // Persistence workstream uses lowercase / `expired`. Map locally; do not
  // rewrite persistence. `expired` is recency-failure → STALE, not a new enum.
  if (key === "EXPIRED") {
    return "STALE";
  }
  return "UNKNOWN";
}

export function clampConfidence(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

export function classifyFreshness(
  observedAt: Date | null,
  now: Date,
  declared: FreshnessStatus,
  windowSeconds: number = FRESHNESS_WINDOW_SECONDS,
): FreshnessStatus {
  if (declared === "ERROR" || declared === "UNKNOWN") {
    return declared;
  }
  if (!observedAt) {
    return "UNKNOWN";
  }
  const ageMs = now.getTime() - observedAt.getTime();
  if (!Number.isFinite(ageMs)) {
    return "UNKNOWN";
  }
  if (ageMs > windowSeconds * 1000) {
    return "STALE";
  }
  return declared;
}

export function rollupFreshness(statuses: FreshnessStatus[]): FreshnessStatus {
  if (statuses.length === 0) {
    return "UNKNOWN";
  }
  if (statuses.includes("ERROR")) {
    return "ERROR";
  }
  const hasFresh = statuses.includes("FRESH");
  const hasStale = statuses.includes("STALE");
  const hasUnknown = statuses.includes("UNKNOWN");
  if (hasUnknown && !hasFresh && !hasStale) {
    return "UNKNOWN";
  }
  if (hasStale) {
    return "STALE";
  }
  if (hasFresh) {
    return "FRESH";
  }
  return "UNKNOWN";
}
