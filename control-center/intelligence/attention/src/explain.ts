import type { PriorityHorizon } from "./taxonomy.js";
import type { RankedItem, ScoreBreakdown, ScoredCandidate } from "./types.js";

function formatScore(milli: number): string {
  const whole = Math.floor(milli / 1000);
  const frac = Math.abs(milli % 1000).toString().padStart(3, "0");
  return `${whole}.${frac}`;
}

/**
 * Cap of the serialized `reason`. Mirrors `attention_entry.reason.maxLength`
 * in `contracts/schemas/operational-envelope.v1.schema.json`.
 */
export const REASON_MAX_LENGTH = 2000;

/**
 * Start of the arithmetic sentence emitted by {@link buildScoreFormula}.
 *
 * Published so a consumer can quarantine the internal arithmetic
 * (`peso_categoria`, `freshness_bp`, `confidence_bp`, `eixo`) without
 * re-deriving the wire format by guesswork. `splitReason` is the supported
 * way to use it.
 */
export const SCORE_SENTENCE_RE = /Score -?\d+\.\d{3} = peso_categoria /;

/**
 * `reason`, decomposed.
 *
 * The engine has always emitted one string that mixes an operator-readable
 * note with the scoring arithmetic and the evidence locators. A cockpit needs
 * the three apart: the first can front a card, the last two belong behind
 * "Como foi priorizado". Splitting here keeps one producer of the format.
 */
export interface ReasonParts {
  /** Sentences a non-technical operator can read. May be empty. */
  plain: string[];
  /** The scoring arithmetic. Internal; never the front of a card. */
  formula: string;
  /** Evidence locators, or null when the item carries no evidence ref. */
  evidence: string | null;
}

/** Sentences that qualify the signal without quoting the arithmetic. */
export function buildPlainNotes(item: ScoredCandidate): string[] {
  const b = item.breakdown;
  const parts: string[] = [];
  if (item.item_kind === "dados_stale") {
    parts.push(
      `Dados stale: freshness original ${b.source_freshness_status} reduz prioridade do sinal-fonte; este item pede atualização da evidência.`,
    );
  }
  if (item.forced_by_kill_rule) {
    parts.push("KILL-RULE: risco crítico forçado em ATENÇÃO AGORA.");
  }
  if (b.merge_count > 1) {
    parts.push(`Sinal mesclado (${b.merge_count} correlações; impacto e urgência = max).`);
  }
  if (b.freshness_demoted && item.item_kind === "work") {
    parts.push(
      `Freshness ${b.freshness_status} aplica multiplicador ${b.freshness_multiplier.toFixed(2)} (despromoção).`,
    );
  }
  return parts;
}

/**
 * The arithmetic sentence. A reader can verify A vs B from `score_breakdown`
 * using scoreMilliFromBreakdown.
 */
export function buildScoreFormula(b: ScoreBreakdown, horizon: PriorityHorizon): string {
  return `Score ${formatScore(b.score_milli)} = peso_categoria ${b.category_weight} (tier ${b.category_tier}, ${b.category}) × eixo ${b.axis} (impacto ${b.impact}×${b.impact_weight_bp}/${10000} + urgência ${b.urgency}×${b.urgency_weight_bp}/${10000}) × freshness_bp ${b.freshness_bp} × confidence_bp ${b.confidence_bp} / 10000², horizonte ${horizon}.`;
}

/** Up to four evidence locators, `system:kind:locator`. */
export function buildEvidenceSentence(item: ScoredCandidate): string | null {
  const locators = item.evidence_refs
    .map((e) => `${e.source.system}:${e.source.kind}:${e.source.locator}`)
    .slice(0, 4)
    .join("; ");
  return locators.length > 0 ? `Evidências: ${locators}.` : null;
}

export function buildReasonParts(item: ScoredCandidate, horizon: PriorityHorizon): ReasonParts {
  return {
    plain: buildPlainNotes(item),
    formula: buildScoreFormula(item.breakdown, horizon),
    evidence: buildEvidenceSentence(item),
  };
}

/** Serializes {@link ReasonParts} exactly the way the wire carries it. */
export function joinReasonParts(parts: ReasonParts): string {
  const sentences = [...parts.plain, parts.formula];
  if (parts.evidence !== null) {
    sentences.push(parts.evidence);
  }
  return sentences.join(" ").slice(0, REASON_MAX_LENGTH);
}

/**
 * Inverse of {@link joinReasonParts} for a consumer that only has the string.
 *
 * `technical` starts at the arithmetic sentence and runs to the end, so it
 * carries the formula and the evidence locators together. When the string
 * carries no formula — a hand-written rationale, a fixture — everything is
 * plain and `technical` is empty.
 */
export function splitReason(reason: string): { plain: string; technical: string } {
  const match = SCORE_SENTENCE_RE.exec(reason);
  if (!match) {
    return { plain: reason.trim(), technical: "" };
  }
  return {
    plain: reason.slice(0, match.index).trim(),
    technical: reason.slice(match.index).trim(),
  };
}

/**
 * Deterministic reason string. No LLM. A reader can verify A vs B from
 * `score_breakdown` using scoreMilliFromBreakdown.
 */
export function buildReason(item: ScoredCandidate, horizon: PriorityHorizon): string {
  return joinReasonParts(buildReasonParts(item, horizon));
}

export function toRankedItem(
  item: ScoredCandidate,
  rank: number,
  horizon: PriorityHorizon,
): RankedItem {
  const ranked: RankedItem = {
    id: item.id,
    rank,
    title: item.title,
    reason: buildReason(item, horizon),
    evidence_refs: item.evidence_refs,
    score: item.breakdown.score,
    score_milli: item.score_milli,
    score_breakdown: item.breakdown,
    category: item.category,
    domain: item.domain,
    scope: item.scope,
    severity: item.severity,
    status: item.status,
    item_kind: item.item_kind,
    provenance: item.provenance,
    horizon,
    attention_item_ids: item.source_ids,
    forced_by_kill_rule: item.forced_by_kill_rule,
    merge_count: item.merge_count,
  };
  if (item.recommended_action !== undefined) {
    ranked.recommended_action = item.recommended_action;
  }
  return ranked;
}
