import {
  type CanonicalFreshness,
  type CollectorFreshness,
  type Provenance,
  type SourceRef,
} from "./types.js";
import { ageSeconds, parseUtc, toUtcIso } from "./clock.js";
import { SOURCE_SYSTEM_GITHUB } from "./constants.js";

export function mapCollectorFreshness(status: CollectorFreshness): CanonicalFreshness {
  switch (status) {
    case "fresh":
    case "not_modified":
      return "FRESH";
    case "stale":
      return "STALE";
    case "failed":
      return "ERROR";
    case "unsupported":
      return "UNKNOWN";
  }
}

export function applyFreshnessWindow(
  status: CanonicalFreshness,
  observedAt: string,
  now: Date,
  windowSeconds: number,
): CanonicalFreshness {
  if (status === "ERROR" || status === "UNKNOWN") {
    return status;
  }
  const age = ageSeconds(observedAt, now);
  if (age !== null && age > windowSeconds) {
    return "STALE";
  }
  return status;
}

export function confidenceFor(
  status: CanonicalFreshness,
  collectorConfidence: number | undefined,
): number {
  if (
    typeof collectorConfidence === "number" &&
    collectorConfidence >= 0 &&
    collectorConfidence <= 1
  ) {
    return collectorConfidence;
  }
  switch (status) {
    case "FRESH":
      return 1;
    case "STALE":
      return 0.4;
    case "UNKNOWN":
      return 0.2;
    case "ERROR":
      return 0;
  }
}

export function githubSource(
  kind: string,
  locator: string,
  label?: string,
): SourceRef {
  const ref: SourceRef = {
    system: SOURCE_SYSTEM_GITHUB,
    kind,
    locator: locator.slice(0, 512),
  };
  if (label && label.trim().length > 0) {
    ref.label = label.trim().slice(0, 128);
  }
  return ref;
}

export function buildProvenance(input: {
  source: SourceRef;
  observedAt: string;
  collectorFreshness: CollectorFreshness;
  collectorConfidence: number | undefined;
  now: Date;
  freshnessWindowSeconds: number;
}): Provenance {
  parseUtc(input.observedAt);
  const mapped = applyFreshnessWindow(
    mapCollectorFreshness(input.collectorFreshness),
    input.observedAt,
    input.now,
    input.freshnessWindowSeconds,
  );
  return {
    source: input.source,
    observed_at: toUtcIso(parseUtc(input.observedAt)),
    freshness_status: mapped,
    confidence: confidenceFor(mapped, input.collectorConfidence),
    freshness_window_seconds: input.freshnessWindowSeconds,
  };
}

export function isUsableFreshness(status: CanonicalFreshness): boolean {
  return status === "FRESH" || status === "STALE";
}
