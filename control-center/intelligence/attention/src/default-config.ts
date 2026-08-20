import { createHash } from "node:crypto";
import {
  HOMEPAGE_PRIORITY_LIMIT,
  SIGNAL_CATEGORIES,
  WEIGHT_DENOM,
  type SignalCategory,
} from "./taxonomy.js";
import { ConfigError } from "./errors.js";
import type { ScoringConfig, ScoringConfigPatch } from "./types.js";

/**
 * Default scoring config (data, not code branches).
 *
 * Impact weight (0.70) > urgency weight (0.30): urgency cannot erase impact
 * inside a tier. Category tiers (primary 2, secondary 1) encode
 * receita/cliente/prazo/risco_operacional/blocker > estética/refactor.
 */
export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  category_weights: {
    receita: 100,
    cliente: 90,
    prazo: 80,
    risco_operacional: 85,
    blocker: 95,
    estetica: 10,
    refactor: 15,
  },
  impact_weight_bp: 7_000,
  urgency_weight_bp: 3_000,
  freshness_bp: {
    FRESH: 10_000,
    UNKNOWN: 5_500,
    STALE: 4_500,
    ERROR: 3_500,
  },
  kill_rule: {
    categories: ["risco_operacional", "blocker"],
    min_severity: "critical",
    min_impact: 0,
  },
  today_limit: HOMEPAGE_PRIORITY_LIMIT,
  atencao_agora_limit: 10,
  eligible_statuses: ["open", "acknowledged"],
};

export function categoryTier(category: SignalCategory): number {
  return category === "estetica" || category === "refactor" ? 1 : 2;
}

export function fingerprintConfig(config: ScoringConfig): string {
  const canonical = canonicalize(config);
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }
  const rec = value as Record<string, unknown>;
  const keys = Object.keys(rec).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalize(rec[k])}`);
  return `{${parts.join(",")}}`;
}

export function mergeScoringConfig(partial: ScoringConfigPatch | undefined): ScoringConfig {
  if (!partial) {
    return { ...DEFAULT_SCORING_CONFIG, category_weights: { ...DEFAULT_SCORING_CONFIG.category_weights }, freshness_bp: { ...DEFAULT_SCORING_CONFIG.freshness_bp }, kill_rule: { ...DEFAULT_SCORING_CONFIG.kill_rule, categories: [...DEFAULT_SCORING_CONFIG.kill_rule.categories] }, eligible_statuses: [...DEFAULT_SCORING_CONFIG.eligible_statuses] };
  }
  const weights = {
    ...DEFAULT_SCORING_CONFIG.category_weights,
    ...(partial.category_weights ?? {}),
  };
  const freshness = {
    ...DEFAULT_SCORING_CONFIG.freshness_bp,
    ...(partial.freshness_bp ?? {}),
  };
  const kill = {
    ...DEFAULT_SCORING_CONFIG.kill_rule,
    categories: partial.kill_rule?.categories
      ? [...partial.kill_rule.categories]
      : [...DEFAULT_SCORING_CONFIG.kill_rule.categories],
    min_severity: partial.kill_rule?.min_severity ?? DEFAULT_SCORING_CONFIG.kill_rule.min_severity,
    min_impact: partial.kill_rule?.min_impact ?? DEFAULT_SCORING_CONFIG.kill_rule.min_impact,
  };
  const merged: ScoringConfig = {
    category_weights: weights,
    impact_weight_bp: partial.impact_weight_bp ?? DEFAULT_SCORING_CONFIG.impact_weight_bp,
    urgency_weight_bp: partial.urgency_weight_bp ?? DEFAULT_SCORING_CONFIG.urgency_weight_bp,
    freshness_bp: freshness,
    kill_rule: kill,
    today_limit: partial.today_limit ?? DEFAULT_SCORING_CONFIG.today_limit,
    atencao_agora_limit:
      partial.atencao_agora_limit ?? DEFAULT_SCORING_CONFIG.atencao_agora_limit,
    eligible_statuses: partial.eligible_statuses
      ? [...partial.eligible_statuses]
      : [...DEFAULT_SCORING_CONFIG.eligible_statuses],
  };
  assertValidConfig(merged);
  return merged;
}

export function assertValidConfig(config: ScoringConfig): void {
  if (config.impact_weight_bp + config.urgency_weight_bp !== WEIGHT_DENOM) {
    throw new ConfigError(
      `impact_weight_bp + urgency_weight_bp must equal ${WEIGHT_DENOM}`,
    );
  }
  if (config.impact_weight_bp <= config.urgency_weight_bp) {
    throw new ConfigError("impact_weight_bp must be greater than urgency_weight_bp so urgency cannot erase impact");
  }
  if (config.today_limit < 1 || config.today_limit > 3) {
    throw new ConfigError("today_limit must be in 1..3 (homepage top-N)");
  }
  if (config.atencao_agora_limit < 1 || config.atencao_agora_limit > 99) {
    throw new ConfigError("atencao_agora_limit must be in 1..99");
  }
  for (const cat of SIGNAL_CATEGORIES) {
    const w = config.category_weights[cat];
    if (!Number.isInteger(w) || w < 0 || w > 10_000) {
      throw new ConfigError(`category_weights.${cat} must be an integer 0..10000`);
    }
  }
  for (const bp of Object.values(config.freshness_bp)) {
    if (!Number.isInteger(bp) || bp < 0 || bp > WEIGHT_DENOM) {
      throw new ConfigError("freshness_bp values must be integers 0..10000");
    }
  }
}
