import { formatLocal } from "./datetime";
import { DESTINATIONS, type DestinationId } from "./destinations";
import type {
  AlertRanking,
  AttentionItem,
  AttentionSeverity,
  PriorityRecommendation,
  Provenance,
} from "./types";

/**
 * Turns an attention item or a ranked priority into something an operator who
 * has never read `intelligence/attention` can act on.
 *
 * Everything the engine emits about *why* an item scored where it scored —
 * `peso_categoria`, `eixo`, `freshness_bp`, `confidence_bp`, the `KILL-RULE`
 * banner — stays in {@link AlertPresentation.breakdown} and is rendered behind
 * a closed disclosure. The front of the card is composed from typed fields, so
 * it cannot leak the arithmetic by accident.
 */

/**
 * Visual band. An item that would only make the product prettier must never
 * look like an item that stops the business.
 */
export const ALERT_CLASSES = ["incidente", "acao", "ajuste"] as const;
export type AlertClass = (typeof ALERT_CLASSES)[number];

export const ALERT_CLASS_LABELS: Record<AlertClass, string> = {
  incidente: "Incidente",
  acao: "Ação",
  ajuste: "Ajuste de baixa gravidade",
};

/** Severity in Portuguese. Scoped to alert cards; not a general label catalogue. */
export const ALERT_SEVERITY_LABELS: Record<AttentionSeverity, string> = {
  critical: "Crítico",
  high: "Alto",
  medium: "Médio",
  low: "Baixo",
};

/**
 * Response target per severity, in minutes, counted from detection.
 *
 * Cockpit policy, not an upstream field: no contract carries a due date for an
 * attention item. The card says so, so nobody reads it as a promise made by
 * Warmbly, Asaas or GitHub. `null` means the item has no deadline at all.
 */
export const ALERT_SLA_MINUTES: Record<AttentionSeverity, number | null> = {
  critical: 60,
  high: 240,
  medium: 2880,
  low: null,
};

export const ALERT_SLA_LABELS: Record<AttentionSeverity, string> = {
  critical: "1 h após a detecção",
  high: "4 h após a detecção",
  medium: "2 dias após a detecção",
  low: "sem prazo definido — entra no backlog",
};

/** Cosmetic and refactor work never competes with revenue, clients or blockers. */
const SECONDARY_CATEGORIES = new Set(["estetica", "refactor"]);

const CATEGORY_IMPACT: Record<string, string> = {
  receita: "Afeta receita: dinheiro previsto pode não entrar.",
  cliente: "Afeta um cliente: a relação está em risco.",
  prazo: "Afeta prazo: um compromisso combinado pode atrasar.",
  risco_operacional: "Risco operacional: um serviço pode parar de responder.",
  blocker: "Bloqueio: há trabalho parado até isto ser tratado.",
  estetica: "Ajuste estético: nada do negócio para se ficar para depois.",
  refactor: "Dívida técnica: sem impacto imediato no negócio.",
};

const SEVERITY_IMPACT: Record<AttentionSeverity, string> = {
  critical: "Impacto crítico: exige decisão ainda hoje.",
  high: "Impacto alto: trate antes do fim do dia.",
  medium: "Impacto moderado: cabe no fluxo normal de trabalho.",
  low: "Impacto baixo: pode aguardar.",
};

export interface AlertOwner {
  /** Accountable area. There is no per-item assignee anywhere in the contracts. */
  label: string;
  destination: DestinationId;
  href: string;
}

const OWNER_BY_DOMAIN: Record<string, DestinationId> = {
  finance: "financeiro",
  commercial: "comercial",
  clients: "clientes",
  engineering: "engenharia",
  infrastructure: "infra",
  inbound: "crescimento",
  company: "hoje",
};

function destinationLabel(id: DestinationId): string {
  return DESTINATIONS.find((item) => item.id === id)?.label ?? id;
}

function destinationFromScope(scope: string): DestinationId {
  if (scope.startsWith("client:")) return "clientes";
  if (scope.startsWith("repo:")) return "engenharia";
  const direct = OWNER_BY_DOMAIN[scope];
  return direct ?? "hoje";
}

/**
 * Accountable area for an alert.
 *
 * Deliberately an area and not a person: nothing in `attention-item.v1`,
 * `priority-recommendation.v1` or the operational envelope carries an
 * assignee, and inventing one would be a fabricated field on a cockpit whose
 * whole point is provenance.
 */
export function ownerFor(scope: string, domain?: string): AlertOwner {
  const fromDomain = domain !== undefined ? OWNER_BY_DOMAIN[domain] : undefined;
  const destination = fromDomain ?? destinationFromScope(scope);
  if (destination === "hoje") {
    return { label: "Fundador (sem área dedicada)", destination: "hoje", href: "#/hoje" };
  }
  return {
    label: destinationLabel(destination),
    destination,
    href: `#/${destination}`,
  };
}

export function alertClassOf(severity: AttentionSeverity, category?: string): AlertClass {
  if (category !== undefined && SECONDARY_CATEGORIES.has(category)) return "ajuste";
  if (severity === "critical" || severity === "high") return "incidente";
  if (severity === "low") return "ajuste";
  return "acao";
}

export function impactSentence(severity: AttentionSeverity, category?: string): string {
  if (category !== undefined) {
    const known = CATEGORY_IMPACT[category];
    if (known !== undefined) return known;
  }
  return SEVERITY_IMPACT[severity];
}

function minutesBetween(fromIso: string, toIso: string): number | null {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.round((to - from) / 60_000);
}

/** "há 12 min" / "há 3 h" / "há 2 d". Negative deltas read as "agora". */
export function ageLabel(detectedAt: string, now: string): string {
  const minutes = minutesBetween(detectedAt, now);
  if (minutes === null) return "idade desconhecida";
  if (minutes < 0) return "agora";
  return `há ${humanDuration(minutes)}`;
}

function humanDuration(minutes: number): string {
  const abs = Math.abs(minutes);
  if (abs < 1) return "menos de 1 min";
  if (abs < 60) return `${abs} min`;
  if (abs < 2880) {
    const hours = Math.floor(abs / 60);
    return `${hours} h`;
  }
  return `${Math.floor(abs / 1440)} d`;
}

export interface AlertDeadline {
  label: string;
  overdue: boolean;
  /** Absent when the severity carries no deadline at all. */
  due_at?: string;
}

export function deadlineFor(
  severity: AttentionSeverity,
  detectedAt: string,
  now: string,
): AlertDeadline {
  const minutes = ALERT_SLA_MINUTES[severity];
  if (minutes === null) {
    return { label: `Sem prazo — entra no backlog (política do cockpit)`, overdue: false };
  }
  const detected = Date.parse(detectedAt);
  if (Number.isNaN(detected)) {
    return { label: `Prazo indeterminado (SLA ${ALERT_SEVERITY_LABELS[severity]}: ${ALERT_SLA_LABELS[severity]})`, overdue: false };
  }
  const due = new Date(detected + minutes * 60_000).toISOString();
  const remaining = minutesBetween(now, due);
  const overdue = remaining !== null && remaining < 0;
  const suffix = overdue
    ? `vencido ${remaining === null ? "" : `há ${humanDuration(remaining)}`}`.trim()
    : `faltam ${remaining === null ? "?" : humanDuration(remaining)}`;
  return {
    label: `até ${formatLocal(due)} — ${suffix} (SLA ${ALERT_SEVERITY_LABELS[severity]}: ${ALERT_SLA_LABELS[severity]}, política do cockpit)`,
    overdue,
    due_at: due,
  };
}

/**
 * Acknowledging writes `ACKNOWLEDGE_EXCEPTION` to the Control Center operator
 * ledger and nothing else: it does not mutate Warmbly, Asaas or GitHub, it
 * does not transition `AttentionItem.status` (nothing in the backend does),
 * and the engine keeps ranking `acknowledged` items — `eligible_statuses` is
 * `["open", "acknowledged"]`. The copy on the card says exactly this, so an
 * operator never mistakes it for resolution.
 */
export interface AlertAcknowledge {
  action_type: "ACKNOWLEDGE_EXCEPTION";
  target_canonical_id: string;
  target_source_id: string;
  /** What the write actually does, in one sentence. */
  effect: string;
}

export const ACKNOWLEDGE_EFFECT =
  "Registra o reconhecimento no ledger do Control Center, com o seu identificador. Não resolve o incidente, não altera o sistema de origem e o item continua no ranking.";

export interface AlertPresentation {
  id: string;
  severity: AttentionSeverity;
  severity_label: string;
  klass: AlertClass;
  klass_label: string;
  /** Plain-language consequence. Never the score. */
  impact: string;
  /** The item's own prose, when it has any that is not the scoring formula. */
  description: string;
  origin: string;
  origin_locator: string;
  owner: AlertOwner;
  /** Why the owner is an area and not a person. */
  owner_note: string;
  age_label: string;
  detected_at: string;
  deadline: AlertDeadline;
  /** "O que fazer agora". */
  next_step: string;
  next_step_label: string;
  next_step_href: string;
  acknowledge: AlertAcknowledge | null;
  /** The engine prose with the arithmetic. Disclosure only. */
  breakdown: string;
  evidence: string[];
  forced_by_kill_rule: boolean;
  merge_count: number | null;
}

const OWNER_NOTE =
  "Área responsável. Nenhum contrato do Control Center carrega responsável nominal; reconhecer registra o seu identificador no ledger.";

/**
 * Splits the engine's `reason` into the half an operator can read and the half
 * that is arithmetic.
 *
 * Mirrors `splitReason` in `intelligence/attention/src/explain.ts`, which owns
 * the format. The shell cannot import that package (server-side, `node:crypto`),
 * so the pattern is duplicated and pinned on both sides: the engine test
 * `explain-parts.test.ts` proves the producer still emits it, and the golden
 * `/v1/today` payload in `tests/fixtures/` proves this consumer still splits
 * real output.
 */
export const SCORE_SENTENCE_RE = /Score -?\d+\.\d{3} = peso_categoria /;

export function splitEngineReason(reason: string): { plain: string; technical: string } {
  const match = SCORE_SENTENCE_RE.exec(reason);
  if (!match) return { plain: reason.trim(), technical: "" };
  return { plain: reason.slice(0, match.index).trim(), technical: reason.slice(match.index).trim() };
}

function originOf(provenance: Provenance): string {
  const label = provenance.source.label;
  if (label !== undefined && label.length > 0) return label;
  return `${provenance.source.system} · ${provenance.source.kind}`;
}

function nextStepFor(recommended: string | undefined, owner: AlertOwner): string {
  if (recommended !== undefined && recommended.trim().length > 0) return recommended.trim();
  return `Abrir ${owner.label} e conferir a origem do sinal antes de agir.`;
}

function acknowledgeFor(id: string, provenance: Provenance): AlertAcknowledge | null {
  const locator = provenance.source.locator;
  if (id.length === 0 || locator.length === 0) return null;
  return {
    action_type: "ACKNOWLEDGE_EXCEPTION",
    target_canonical_id: id,
    target_source_id: locator,
    effect: ACKNOWLEDGE_EFFECT,
  };
}

function presentation(input: {
  id: string;
  severity: AttentionSeverity;
  scope: string;
  provenance: Provenance;
  detected_at: string;
  now: string;
  prose: string;
  recommended_action?: string;
  ranking?: AlertRanking;
}): AlertPresentation {
  const ranking = input.ranking;
  const category = ranking?.category;
  const owner = ownerFor(input.scope, ranking?.domain);
  // Prose that carries the scoring sentence is engine output end to end — its
  // "plain" half is `KILL-RULE: ...`, `Dados stale: freshness original ...`,
  // `Sinal mesclado (...)`. That is engine vocabulary, not operator language,
  // so the whole string goes behind the disclosure and the front of the card
  // is rebuilt from typed fields instead.
  const split = splitEngineReason(input.prose);
  const proseIsEngineOutput = split.technical.length > 0;
  const description = proseIsEngineOutput ? "" : split.plain;
  const breakdownParts = [
    proseIsEngineOutput ? input.prose.trim() : "",
    ranking !== undefined ? ranking.reason.trim() : "",
  ].filter((part) => part.length > 0);
  const breakdown = [...new Set(breakdownParts)].join(" ");
  const klass = alertClassOf(input.severity, category);
  return {
    id: input.id,
    severity: input.severity,
    severity_label: ALERT_SEVERITY_LABELS[input.severity],
    klass,
    klass_label: ALERT_CLASS_LABELS[klass],
    impact: impactSentence(input.severity, category),
    description,
    origin: originOf(input.provenance),
    origin_locator: input.provenance.source.locator,
    owner,
    owner_note: OWNER_NOTE,
    age_label: ageLabel(input.detected_at, input.now),
    detected_at: input.detected_at,
    deadline: deadlineFor(input.severity, input.detected_at, input.now),
    next_step: nextStepFor(input.recommended_action, owner),
    next_step_label: `Abrir ${owner.label}`,
    next_step_href: owner.href,
    acknowledge: acknowledgeFor(input.id, input.provenance),
    breakdown,
    evidence: ranking?.evidence ?? [],
    forced_by_kill_rule: ranking?.forced_by_kill_rule === true,
    merge_count: ranking?.merge_count ?? null,
  };
}

export function attentionAlert(item: AttentionItem, now: string): AlertPresentation {
  return presentation({
    id: item.id,
    severity: item.severity,
    scope: item.scope,
    provenance: item.provenance,
    detected_at: item.detected_at,
    now,
    prose: item.summary,
    ...(item.recommended_action !== undefined
      ? { recommended_action: item.recommended_action }
      : {}),
    ...(item.ranking !== undefined ? { ranking: item.ranking } : {}),
  });
}

/**
 * A priority has no severity of its own on `priority-recommendation.v1`. When
 * the payload came from the attention engine the ranked item does carry one;
 * otherwise the rank stands in, and rank 1 is not treated as critical by
 * default — inflating severity would defeat criterion 5.
 */
export function priorityAlert(item: PriorityRecommendation, now: string): AlertPresentation {
  const severity: AttentionSeverity =
    item.ranking?.severity ?? (item.rank === 1 ? "high" : "medium");
  return presentation({
    id: item.id,
    severity,
    scope: item.scope,
    provenance: item.provenance,
    detected_at: item.provenance.observed_at,
    now,
    prose: item.rationale,
    ...(item.recommended_action !== undefined
      ? { recommended_action: item.recommended_action }
      : {}),
    ...(item.ranking !== undefined ? { ranking: item.ranking } : {}),
  });
}
