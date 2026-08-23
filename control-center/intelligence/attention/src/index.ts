export { rankAttention, rankFromUnknown, asPriorityRecommendations } from "./rank.js";
export { DEFAULT_SCORING_CONFIG, mergeScoringConfig, fingerprintConfig, categoryTier } from "./default-config.js";
export { parseRankRequest, parseSignal } from "./validate.js";
export { scoreMilliFromBreakdown, compareAttention, sortCandidates, explainPair, buildBreakdown } from "./score.js";
export { mergeSignals } from "./merge.js";
export { isKillRule } from "./kill-rules.js";
export { diverseTopN } from "./diversity.js";
export { synthesizeDadosStale, appendDadosStale, isDadosStaleTitle } from "./freshness.js";
export { applyOverride } from "./override.js";
export {
  buildReason,
  buildReasonParts,
  buildPlainNotes,
  buildScoreFormula,
  buildEvidenceSentence,
  joinReasonParts,
  splitReason,
  toRankedItem,
  REASON_MAX_LENGTH,
  SCORE_SENTENCE_RE,
} from "./explain.js";
export type { ReasonParts } from "./explain.js";
export {
  toPersistenceFreshness,
  fromPersistenceFreshness,
  CONVERGENCE_CONTRACT,
} from "./adapters.js";
export { frozenClock, systemClock, toUtcDateTime } from "./clock.js";
export { ValidationError, ConfigError } from "./errors.js";
export { HOMEPAGE_PRIORITY_LIMIT, SCHEMA_VERSIONS, WEIGHT_DENOM, SCORE_SCALE } from "./taxonomy.js";
export type {
  AttentionSignal,
  RankInput,
  RankOutput,
  RankedItem,
  ScoringConfig,
  ScoringConfigPatch,
  FounderOverride,
  ScoreBreakdown,
  ScoredCandidate,
  Provenance,
  PriorityRecommendationView,
} from "./types.js";
export type {
  SignalCategory,
  SignalDomain,
  FreshnessStatus,
  PriorityHorizon,
} from "./taxonomy.js";
