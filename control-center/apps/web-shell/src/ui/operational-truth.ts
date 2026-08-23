import {
  OPERATIONAL_TRUTH_REASONS,
  type OperationalTruth,
  type OperationalTruthState,
} from "@confenge/control-center-contracts/operational-truth";
import { escapeHtml } from "../escape";
import { formatLocal } from "../datetime";
import { technicalDetails } from "./labels";

interface TruthCopy {
  label: string;
  impact: string;
  next: string;
  tone: "ok" | "empty" | "stale" | "error";
}

export const TRUTH_COPY: Record<OperationalTruthState, TruthCopy> = {
  ZERO: {
    label: "zero confirmado",
    impact: "A origem mediu zero neste recorte; isto não é falta de dados.",
    next: "Nenhuma ocorrência para tratar agora. Mantenha a coleta ativa.",
    tone: "ok",
  },
  ABSENT: {
    label: "dado ausente",
    impact: "A origem não entregou este recorte; não é possível concluir que não há trabalho.",
    next: "Verifique a configuração/coleta e tente novamente antes de decidir.",
    tone: "empty",
  },
  UNKNOWN: {
    label: "desconhecido",
    impact: "A leitura existe, mas não permite uma conclusão confiável.",
    next: "Atualize a leitura ou complete o payload antes de agir.",
    tone: "stale",
  },
  STALE: {
    label: "dado defasado",
    impact: "O estado pode ter mudado desde a última observação.",
    next: "Recolha novamente e confirme o estado atual antes de escrever.",
    tone: "stale",
  },
  ERROR: {
    label: "erro de coleta",
    impact: "A última tentativa falhou; números exibidos não são base segura para decisão.",
    next: "Corrija a coleta e repita. Não interprete erro como fila vazia.",
    tone: "error",
  },
  HEALTHY: {
    label: "evidência confiável",
    impact: "A leitura é recente e confiável; o valor pode ser usado na triagem.",
    next: "Trate as ocorrências listadas conforme prioridade.",
    tone: "ok",
  },
};

const STATES = new Set<OperationalTruthState>(["ZERO", "ABSENT", "UNKNOWN", "STALE", "ERROR", "HEALTHY"]);
const REASONS = new Set<string>(OPERATIONAL_TRUTH_REASONS);

export function parseOperationalTruth(value: unknown): OperationalTruth | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const source = row.source && typeof row.source === "object" && !Array.isArray(row.source)
    ? row.source as Record<string, unknown>
    : null;
  if (
    typeof row.state !== "string" || !STATES.has(row.state as OperationalTruthState) ||
    typeof row.as_of !== "string" || typeof row.reason !== "string" || !REASONS.has(row.reason) ||
    typeof row.confidence !== "number" || !Number.isFinite(row.confidence) ||
    row.confidence < 0 || row.confidence > 1 || !source ||
    typeof source.system !== "string" || typeof source.kind !== "string" || typeof source.locator !== "string"
  ) return null;
  return {
    state: row.state as OperationalTruthState,
    as_of: row.as_of,
    confidence: row.confidence,
    reason: row.reason as OperationalTruth["reason"],
    source: { system: source.system, kind: source.kind, locator: source.locator },
  };
}

export function operationalTruthBlock(truth: OperationalTruth | null | undefined): string {
  if (!truth) return "";
  const copy = TRUTH_COPY[truth.state];
  return `<article class="banner ${copy.tone}" data-operational-truth="${escapeHtml(truth.state)}" role="status">
    <h3>${escapeHtml(copy.label)}</h3>
    <p><strong>Impacto:</strong> ${escapeHtml(copy.impact)}</p>
    <p><strong>Próxima ação:</strong> ${escapeHtml(copy.next)}</p>
    <p class="prov-inline">Origem: ${escapeHtml(truth.source.system)} · referente a <time datetime="${escapeHtml(truth.as_of)}">${escapeHtml(formatLocal(truth.as_of))}</time> · confiança ${escapeHtml(String(truth.confidence).replace(".", ","))}</p>
    ${technicalDetails([
      { term: "truth_state", value: truth.state },
      { term: "reason", value: truth.reason },
      { term: "as_of", value: truth.as_of },
      { term: "source", value: `${truth.source.system}:${truth.source.kind}:${truth.source.locator}` },
      { term: "confidence", value: String(truth.confidence) },
    ], "operational-truth")}
  </article>`;
}
