import type {
  ActorKind,
  AttentionSeverity,
  AttentionStatus,
  FreshnessStatus,
  ItemKind,
  OverrideAction,
  PriorityHorizon,
  SignalCategory,
  SignalDomain,
} from "./taxonomy.js";

/** UTC RFC3339 with mandatory Z. */
export type UtcDateTime = string;

/** Stable Control Center ID: `cc:<type-kebab>:<ulid-or-slug>`. */
export type ResourceId = string;

export type Scope = string;

export interface SourceRef {
  system: string;
  kind: string;
  locator: string;
  label?: string;
}

export interface ActorRef {
  kind: ActorKind;
  id: string;
  display_name?: string;
}

export interface Money {
  amount_cents: number;
  currency: string;
}

/**
 * Provenance of aggregated information.
 * `freshness_status` is recency; `confidence` is trust. They are not aliases.
 */
export interface Provenance {
  source: SourceRef;
  observed_at: UtcDateTime;
  freshness_status: FreshnessStatus;
  confidence: number;
  freshness_window_seconds?: number;
}

export interface EvidenceRef {
  source: SourceRef;
  note?: string;
}

export interface AttentionSignal {
  id: ResourceId;
  title: string;
  summary: string;
  category: SignalCategory;
  domain: SignalDomain;
  scope: Scope;
  impact: number;
  urgency: number;
  severity: AttentionSeverity;
  status: AttentionStatus;
  correlation_key: string;
  evidence_refs: EvidenceRef[];
  provenance: Provenance;
  money?: Money;
  recommended_action?: string;
  related_ids?: ResourceId[];
}

export interface ScoringConfig {
  category_weights: Record<SignalCategory, number>;
  impact_weight_bp: number;
  urgency_weight_bp: number;
  freshness_bp: Record<FreshnessStatus, number>;
  kill_rule: {
    categories: SignalCategory[];
    min_severity: AttentionSeverity;
    min_impact: number;
  };
  today_limit: number;
  atencao_agora_limit: number;
  eligible_statuses: AttentionStatus[];
}

/** Patch accepted on the request body; merged onto DEFAULT_SCORING_CONFIG. */
export interface ScoringConfigPatch {
  category_weights?: Partial<Record<SignalCategory, number>>;
  impact_weight_bp?: number;
  urgency_weight_bp?: number;
  freshness_bp?: Partial<Record<FreshnessStatus, number>>;
  kill_rule?: {
    categories?: SignalCategory[];
    min_severity?: AttentionSeverity;
    min_impact?: number;
  };
  today_limit?: number;
  atencao_agora_limit?: number;
  eligible_statuses?: AttentionStatus[];
}

export interface FounderOverride {
  actor: ActorRef;
  at: UtcDateTime;
  action: OverrideAction;
  target_ids: ResourceId[];
}

export interface RankInput {
  signals: AttentionSignal[];
  config: ScoringConfig;
  clock_now: UtcDateTime;
  override: FounderOverride | null;
}

export interface ScoreBreakdown {
  category: SignalCategory;
  category_weight: number;
  category_tier: number;
  impact: number;
  urgency: number;
  impact_weight: number;
  urgency_weight: number;
  impact_weight_bp: number;
  urgency_weight_bp: number;
  axis: number;
  raw: number;
  freshness_status: FreshnessStatus;
  freshness_multiplier: number;
  freshness_bp: number;
  confidence: number;
  confidence_bp: number;
  score_milli: number;
  score: number;
  kill_rule_applied: boolean;
  merge_count: number;
  freshness_demoted: boolean;
}

export interface ScoredCandidate {
  id: ResourceId;
  title: string;
  summary: string;
  category: SignalCategory;
  domain: SignalDomain;
  scope: Scope;
  impact: number;
  urgency: number;
  severity: AttentionSeverity;
  status: AttentionStatus;
  item_kind: ItemKind;
  correlation_key: string;
  evidence_refs: EvidenceRef[];
  provenance: Provenance;
  recommended_action?: string;
  related_ids: ResourceId[];
  source_ids: ResourceId[];
  money?: Money;
  merge_count: number;
  forced_by_kill_rule: boolean;
  score_milli: number;
  breakdown: ScoreBreakdown;
}

export interface RankedItem {
  id: ResourceId;
  rank: number;
  title: string;
  reason: string;
  evidence_refs: EvidenceRef[];
  score: number;
  score_milli: number;
  score_breakdown: ScoreBreakdown;
  category: SignalCategory;
  domain: SignalDomain;
  scope: Scope;
  severity: AttentionSeverity;
  status: AttentionStatus;
  item_kind: ItemKind;
  provenance: Provenance;
  horizon: PriorityHorizon;
  attention_item_ids: ResourceId[];
  forced_by_kill_rule: boolean;
  merge_count: number;
  recommended_action?: string;
}

export interface RankingSnapshot {
  now: ResourceId[];
  today: ResourceId[];
}

export interface OverrideAudit {
  schema_version: "control-center.audit-event.v1";
  id: ResourceId;
  at: UtcDateTime;
  actor: ActorRef;
  action: "founder_override";
  resource_type: "PriorityRecommendation";
  resource_id: null;
  scope: Scope | null;
  outcome: "success";
  detail: {
    override_action: OverrideAction;
    target_ids: ResourceId[];
    previous_ranking: RankingSnapshot;
    resulting_ranking: RankingSnapshot;
  };
}

export interface EngineProvenance extends Provenance {
  source: SourceRef;
}

export interface RankOutput {
  schema_version: "control-center.attention-engine.v1";
  generated_at: UtcDateTime;
  provenance: EngineProvenance;
  config_fingerprint: string;
  attention_now: RankedItem[];
  today: RankedItem[];
  audit: OverrideAudit[];
}

export interface PriorityRecommendationView {
  schema_version: "control-center.priority-recommendation.v1";
  id: ResourceId;
  scope: Scope;
  rank: number;
  title: string;
  rationale: string;
  provenance: Provenance;
  generated_at: UtcDateTime;
  horizon: PriorityHorizon;
  attention_item_ids: ResourceId[];
}

export interface UnknownRankRequest {
  signals: unknown;
  config?: unknown;
  override?: unknown;
  now?: unknown;
}
