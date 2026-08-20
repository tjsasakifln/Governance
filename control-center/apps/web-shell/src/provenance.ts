import { formatLocal, formatUtc, isUtcDateTime } from "./datetime";
import {
  FRESHNESS_STATUSES,
  type FreshnessStatus,
  type Provenance,
} from "./types";

export interface ProvenancePresentation {
  sourceSystem: string;
  sourceKind: string;
  sourceLocator: string;
  sourceLabel: string;
  observedAtUtc: string;
  observedAtLocal: string;
  freshnessStatus: FreshnessStatus;
  freshnessLabel: string;
  confidence: number;
  confidenceLabel: string;
}

const FRESHNESS_LABELS: Record<FreshnessStatus, string> = {
  FRESH: "fresco",
  STALE: "defasado",
  UNKNOWN: "desconhecido",
  ERROR: "erro de coleta",
};

export function freshnessLabel(status: FreshnessStatus): string {
  return FRESHNESS_LABELS[status];
}

export function isFreshnessStatus(value: string): value is FreshnessStatus {
  return (FRESHNESS_STATUSES as readonly string[]).includes(value);
}

/**
 * Round-trips aggregated provenance into a labeled presentation model.
 * Freshness is recency; confidence is trust. They are not aliases.
 */
export function mapProvenance(provenance: Provenance): ProvenancePresentation {
  if (!isFreshnessStatus(provenance.freshness_status)) {
    throw new Error(`Invalid freshness_status: ${provenance.freshness_status}`);
  }
  if (!isUtcDateTime(provenance.observed_at)) {
    throw new Error("observed_at must be UTC RFC3339 with Z");
  }
  if (provenance.confidence < 0 || provenance.confidence > 1) {
    throw new Error("confidence must be in [0, 1]");
  }
  const sourceLabel =
    provenance.source.label ?? `${provenance.source.system} · ${provenance.source.kind}`;
  return {
    sourceSystem: provenance.source.system,
    sourceKind: provenance.source.kind,
    sourceLocator: provenance.source.locator,
    sourceLabel,
    observedAtUtc: formatUtc(provenance.observed_at),
    observedAtLocal: formatLocal(provenance.observed_at),
    freshnessStatus: provenance.freshness_status,
    freshnessLabel: freshnessLabel(provenance.freshness_status),
    confidence: provenance.confidence,
    confidenceLabel: `confiança ${provenance.confidence.toFixed(2).replace(".", ",")}`,
  };
}

export function provenanceFromPresentation(
  presentation: ProvenancePresentation,
): Pick<Provenance, "observed_at" | "freshness_status" | "confidence"> & {
  source: { system: string; kind: string; locator: string };
} {
  return {
    source: {
      system: presentation.sourceSystem,
      kind: presentation.sourceKind,
      locator: presentation.sourceLocator,
    },
    observed_at: presentation.observedAtUtc,
    freshness_status: presentation.freshnessStatus,
    confidence: presentation.confidence,
  };
}
