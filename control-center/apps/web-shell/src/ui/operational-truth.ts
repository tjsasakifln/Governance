import {
  OPERATIONAL_TRUTH_REASONS,
  type OperationalTruth,
  type OperationalTruthState,
} from "@confenge/control-center-contracts/operational-truth";
import { escapeHtml } from "../escape";
import { formatLocal, isUtcDateTime } from "../datetime";
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
const REASONS_BY_STATE: Readonly<Record<OperationalTruthState, readonly OperationalTruth["reason"][]>> = {
  ZERO: ["confirmed_zero"],
  ABSENT: ["source_absent"],
  UNKNOWN: ["recency_unknown", "partial_payload"],
  STALE: ["observation_stale"],
  ERROR: ["collection_error"],
  HEALTHY: ["fresh_observation"],
};

function ownString(row: Record<string, unknown>, key: string): string | null {
  const value = Object.prototype.hasOwnProperty.call(row, key) ? row[key] : undefined;
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function validTruthInstant(value: string, now: number): boolean {
  if (!isUtcDateTime(value)) return false;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed) || parsed > now) return false;
  const inputSecond = value.replace(/\.\d{1,9}Z$/, "Z");
  const parsedSecond = new Date(parsed).toISOString().replace(/\.\d{3}Z$/, "Z");
  return inputSecond === parsedSecond;
}

export function parseOperationalTruth(value: unknown, now = Date.now()): OperationalTruth | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const sourceValue = Object.prototype.hasOwnProperty.call(row, "source") ? row.source : null;
  const source = sourceValue && typeof sourceValue === "object" && !Array.isArray(sourceValue)
    ? sourceValue as Record<string, unknown>
    : null;
  const state = ownString(row, "state") as OperationalTruthState | null;
  const asOf = ownString(row, "as_of");
  const reason = ownString(row, "reason") as OperationalTruth["reason"] | null;
  const confidence = Object.prototype.hasOwnProperty.call(row, "confidence") ? row.confidence : undefined;
  if (
    !state || !STATES.has(state) || !asOf || !validTruthInstant(asOf, now) ||
    !reason || !REASONS.has(reason) || !REASONS_BY_STATE[state].includes(reason) ||
    typeof confidence !== "number" || !Number.isFinite(confidence) ||
    confidence < 0 || confidence > 1 ||
    (["ZERO", "ABSENT", "HEALTHY"] as const).includes(state as "ZERO" | "ABSENT" | "HEALTHY") && confidence <= 0 ||
    !source || !ownString(source, "system") || !ownString(source, "kind") || !ownString(source, "locator")
  ) return null;
  return {
    state,
    as_of: asOf,
    confidence,
    reason,
    source: {
      system: ownString(source, "system")!,
      kind: ownString(source, "kind")!,
      locator: ownString(source, "locator")!,
    },
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
