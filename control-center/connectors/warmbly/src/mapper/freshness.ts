import type { FreshnessStatus, Provenance } from "../contracts/snapshot.ts";
import { SNAPSHOT_SOURCE } from "../contracts/snapshot.ts";

export function toUtcIso(date: Date): string {
  return date.toISOString();
}

export function parseUtc(value: string | undefined | null): Date | undefined {
  if (!value) {
    return undefined;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return undefined;
  }
  return d;
}

export function provenance(
  observedAt: Date,
  freshness: FreshnessStatus,
  confidence?: number,
): Provenance {
  const p: Provenance = {
    source: SNAPSHOT_SOURCE,
    observed_at: toUtcIso(observedAt),
    freshness_status: freshness,
  };
  if (confidence !== undefined && Number.isFinite(confidence)) {
    p.confidence = clampConfidence(confidence);
  }
  return p;
}

export function clampConfidence(value: number): number {
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return value > 1 && value <= 100 ? value / 100 : 1;
  }
  return value;
}

export function mapConfidence(raw: number | string | undefined): number | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (typeof raw === "number") {
    return clampConfidence(raw);
  }
  const key = raw.trim().toUpperCase();
  switch (key) {
    case "HIGH":
      return 0.9;
    case "MEDIUM":
      return 0.6;
    case "LOW":
      return 0.3;
    case "UNKNOWN":
      return undefined;
    default: {
      const n = Number(raw);
      return Number.isFinite(n) ? clampConfidence(n) : undefined;
    }
  }
}

export function rollupFreshness(statuses: FreshnessStatus[]): FreshnessStatus {
  if (statuses.includes("ERROR")) {
    return "ERROR";
  }
  if (statuses.includes("UNKNOWN") && !statuses.includes("FRESH") && !statuses.includes("STALE")) {
    return "UNKNOWN";
  }
  if (statuses.includes("STALE")) {
    return "STALE";
  }
  if (statuses.includes("FRESH")) {
    return "FRESH";
  }
  return "UNKNOWN";
}
