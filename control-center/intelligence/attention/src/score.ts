import { categoryTier } from "./default-config.js";
import { ConfigError } from "./errors.js";
import {
  SCORE_SCALE,
  SEVERITY_RANK,
  WEIGHT_DENOM,
  type AttentionSeverity,
} from "./taxonomy.js";
import type { ScoreBreakdown, ScoredCandidate, ScoringConfig } from "./types.js";

/**
 * Integer millipoint score. Reconstructible from the emitted breakdown:
 *
 *   axis = impact_weight_bp * impact + urgency_weight_bp * urgency
 *   raw  = floor(category_weight * axis / WEIGHT_DENOM)
 *   score_milli = floor(raw * SCORE_SCALE * freshness_bp * confidence_bp / WEIGHT_DENOM²)
 *
 * Display score = score_milli / SCORE_SCALE.
 *
 * Urgency cannot erase impact: impact_weight_bp > urgency_weight_bp is a
 * config invariant. Cross-category, category_tier (primary=2, secondary=1)
 * is compared before score, so estética/refactor never outrank
 * receita/cliente/prazo/risco_operacional/blocker.
 */
export function scoreMilliFromBreakdown(b: ScoreBreakdown): number {
  const axis = b.impact_weight_bp * b.impact + b.urgency_weight_bp * b.urgency;
  const raw = Math.floor((b.category_weight * axis) / WEIGHT_DENOM);
  return Math.floor(
    (raw * SCORE_SCALE * b.freshness_bp * b.confidence_bp) /
      (WEIGHT_DENOM * WEIGHT_DENOM),
  );
}

export function buildBreakdown(
  candidate: {
    category: ScoreBreakdown["category"];
    impact: number;
    urgency: number;
    provenance: { freshness_status: ScoreBreakdown["freshness_status"]; confidence: number };
    merge_count: number;
    source_freshness_status: ScoreBreakdown["source_freshness_status"];
  },
  config: ScoringConfig,
  forced_by_kill_rule: boolean,
): ScoreBreakdown {
  const category_weight = config.category_weights[candidate.category];
  const freshness_bp = config.freshness_bp[candidate.provenance.freshness_status];
  const confidence_bp = Math.round(candidate.provenance.confidence * WEIGHT_DENOM);
  const axis = config.impact_weight_bp * candidate.impact + config.urgency_weight_bp * candidate.urgency;
  const raw = Math.floor((category_weight * axis) / WEIGHT_DENOM);
  const freshness_demoted = candidate.provenance.freshness_status !== "FRESH";
  const breakdown: ScoreBreakdown = {
    category: candidate.category,
    category_weight,
    category_tier: categoryTier(candidate.category),
    impact: candidate.impact,
    urgency: candidate.urgency,
    impact_weight: config.impact_weight_bp / WEIGHT_DENOM,
    urgency_weight: config.urgency_weight_bp / WEIGHT_DENOM,
    impact_weight_bp: config.impact_weight_bp,
    urgency_weight_bp: config.urgency_weight_bp,
    axis,
    raw,
    freshness_status: candidate.provenance.freshness_status,
    freshness_multiplier: freshness_bp / WEIGHT_DENOM,
    freshness_bp,
    confidence: candidate.provenance.confidence,
    confidence_bp,
    score_milli: 0,
    score: 0,
    kill_rule_applied: forced_by_kill_rule,
    merge_count: candidate.merge_count,
    freshness_demoted,
    source_freshness_status: candidate.source_freshness_status,
  };
  breakdown.score_milli = scoreMilliFromBreakdown(breakdown);
  breakdown.score = breakdown.score_milli / SCORE_SCALE;
  return breakdown;
}

/**
 * Total order: more important first (negative means `a` ranks above `b`).
 * Never returns 0 for distinct ids — the last key is id ascending.
 */
export function compareAttention(a: ScoredCandidate, b: ScoredCandidate): number {
  if (a.forced_by_kill_rule !== b.forced_by_kill_rule) {
    return a.forced_by_kill_rule ? -1 : 1;
  }
  if (a.breakdown.category_tier !== b.breakdown.category_tier) {
    return b.breakdown.category_tier - a.breakdown.category_tier;
  }
  if (a.score_milli !== b.score_milli) {
    return b.score_milli - a.score_milli;
  }
  if (a.breakdown.category_weight !== b.breakdown.category_weight) {
    return b.breakdown.category_weight - a.breakdown.category_weight;
  }
  if (a.impact !== b.impact) {
    return b.impact - a.impact;
  }
  if (a.urgency !== b.urgency) {
    return b.urgency - a.urgency;
  }
  if (a.id < b.id) {
    return -1;
  }
  if (a.id > b.id) {
    return 1;
  }
  return 0;
}

export function sortCandidates(items: ScoredCandidate[]): ScoredCandidate[] {
  return [...items].sort(compareAttention);
}

export function severityAtLeast(actual: AttentionSeverity, min: AttentionSeverity): boolean {
  return SEVERITY_RANK[actual] <= SEVERITY_RANK[min];
}

export function assertImpactDominatesUrgency(config: ScoringConfig): void {
  if (config.impact_weight_bp <= config.urgency_weight_bp) {
    throw new ConfigError("impact weight must dominate urgency weight");
  }
}

/**
 * Why A beat B, using only emitted breakdown fields (no hidden state).
 */
export function explainPair(a: ScoredCandidate, b: ScoredCandidate): string {
  if (a.forced_by_kill_rule && !b.forced_by_kill_rule) {
    return `${a.id} vence ${b.id}: kill-rule (risco crítico) tem precedência sobre trabalho sem kill-rule.`;
  }
  if (a.breakdown.category_tier !== b.breakdown.category_tier) {
    return `${a.id} vence ${b.id}: categoria ${a.category} (tier ${a.breakdown.category_tier}) outrank ${b.category} (tier ${b.breakdown.category_tier}).`;
  }
  if (a.score_milli !== b.score_milli) {
    return `${a.id} vence ${b.id}: score_milli ${a.score_milli} > ${b.score_milli} (A: peso ${a.breakdown.category_weight} × raw ${a.breakdown.raw} × freshness_bp ${a.breakdown.freshness_bp} × confidence_bp ${a.breakdown.confidence_bp}; B: peso ${b.breakdown.category_weight} × raw ${b.breakdown.raw} × freshness_bp ${b.breakdown.freshness_bp} × confidence_bp ${b.breakdown.confidence_bp}).`;
  }
  if (a.breakdown.category_weight !== b.breakdown.category_weight) {
    return `${a.id} vence ${b.id}: empate de score, peso de categoria ${a.breakdown.category_weight} > ${b.breakdown.category_weight}.`;
  }
  if (a.impact !== b.impact) {
    return `${a.id} vence ${b.id}: empate de score/peso, impacto ${a.impact} > ${b.impact}.`;
  }
  if (a.urgency !== b.urgency) {
    return `${a.id} vence ${b.id}: empate até impacto, urgência ${a.urgency} > ${b.urgency}.`;
  }
  return `${a.id} vence ${b.id}: empate total, desempate lexicográfico de id.`;
}
