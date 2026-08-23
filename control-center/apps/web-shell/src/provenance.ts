import { formatLocal, formatUtc, isUtcDateTime } from "./datetime";
import {
  FRESHNESS_STATUSES,
  type FreshnessStatus,
  type Provenance,
} from "./types";
import { ownMapValue } from "./own-map";

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

const SOURCE_SYSTEM_LABELS: Record<string, string> = {
  asaas: "Asaas",
  collector: "Coletor operacional",
  "control-center": "Control Center",
  context: "Serviço de contexto",
  github: "GitHub",
  governance: "Governance",
  infrastructure: "Infraestrutura",
  warmbly: "Warmbly",
};

const SOURCE_KIND_LABELS: Record<string, string> = {
  collector: "coleta",
  commercial: "operação comercial",
  "crm-read-model": "leitura comercial",
  "directive-store": "registro de diretivas",
  "health-probe": "sonda de saúde",
  http: "leitura HTTP",
  "inbound-queue": "fila de mensagens recebidas",
  "receivable-read": "leitura de recebíveis",
  report: "relatório operacional",
  "repo-read": "leitura do repositório",
  snapshot: "instantâneo operacional",
};

export function sourceSystemLabel(system: string): string {
  return ownMapValue(SOURCE_SYSTEM_LABELS, system) ?? "Sistema de origem";
}

export function sourceKindLabel(kind: string): string {
  return ownMapValue(SOURCE_KIND_LABELS, kind) ?? "leitura operacional";
}

export function sourcePresentationLabel(source: Provenance["source"]): string {
  if (source.label) return source.label;
  return `${sourceSystemLabel(source.system)} · ${sourceKindLabel(source.kind)}`;
}

export function freshnessLabel(status: FreshnessStatus): string {
  return ownMapValue(FRESHNESS_LABELS, status) ?? "atualização não reconhecida";
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
  const sourceLabel = sourcePresentationLabel(provenance.source);
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
