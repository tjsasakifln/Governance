/**
 * Local Control Center taxonomies for the attention engine.
 *
 * This package MUST NOT import sibling worktrees (`control-center/contracts`
 * or `control-center/persistence`). Vocab here mirrors contracts v1 where
 * possible and documents persistence divergence in `adapters.ts`.
 */

export const UTC_DATETIME_PATTERN =
  "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]{1,9})?Z$";

export const UTC_DATETIME_RE = new RegExp(UTC_DATETIME_PATTERN);

export const RESOURCE_ID_PATTERN = "^cc:[a-z][a-z0-9-]*:[A-Za-z0-9._~-]+$";

export const RESOURCE_ID_RE = new RegExp(RESOURCE_ID_PATTERN);

export const CURRENCY_PATTERN = "^[A-Z]{3}$";

export const CURRENCY_RE = new RegExp(CURRENCY_PATTERN);

export const SCOPE_PATTERN =
  "^(company|commercial|finance|clients|infrastructure|inbound|repo:[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)?|client:[a-z0-9]+(?:-[a-z0-9]+)*|[a-z][a-z0-9-]*:[A-Za-z0-9._:~-]+)$";

export const SCOPE_RE = new RegExp(SCOPE_PATTERN);

export const SOURCE_SYSTEM_PATTERN = "^[a-z][a-z0-9-]*$";

export const SOURCE_SYSTEM_RE = new RegExp(SOURCE_SYSTEM_PATTERN);

export const SOURCE_KIND_PATTERN = "^[a-z][a-z0-9._-]*$";

export const SOURCE_KIND_RE = new RegExp(SOURCE_KIND_PATTERN);

export const ACTOR_ID_PATTERN = "^[A-Za-z0-9._:@-]+$";

export const ACTOR_ID_RE = new RegExp(ACTOR_ID_PATTERN);

/** Contracts v1 recency enum. Persistence uses lowercase + `expired` instead of `ERROR`. */
export const FRESHNESS_STATUSES = ["FRESH", "STALE", "UNKNOWN", "ERROR"] as const;
export type FreshnessStatus = (typeof FRESHNESS_STATUSES)[number];

export const ATTENTION_SEVERITIES = ["critical", "high", "medium", "low"] as const;
export type AttentionSeverity = (typeof ATTENTION_SEVERITIES)[number];

export const ATTENTION_STATUSES = [
  "open",
  "acknowledged",
  "resolved",
  "dismissed",
] as const;
export type AttentionStatus = (typeof ATTENTION_STATUSES)[number];

export const PRIORITY_HORIZONS = ["now", "today", "this_week"] as const;
export type PriorityHorizon = (typeof PRIORITY_HORIZONS)[number];

export const ACTOR_KINDS = ["human", "agent", "system"] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

export const SIGNAL_CATEGORIES = [
  "receita",
  "cliente",
  "prazo",
  "risco_operacional",
  "blocker",
  "estetica",
  "refactor",
] as const;
export type SignalCategory = (typeof SIGNAL_CATEGORIES)[number];

/**
 * Diversity domain. Distinct from category: category is *why it matters*,
 * domain is *which operational surface*. Today-3 avoids three items of the
 * same domain when other domains have eligible items.
 */
export const SIGNAL_DOMAINS = [
  "finance",
  "commercial",
  "clients",
  "infrastructure",
  "engineering",
  "inbound",
  "company",
] as const;
export type SignalDomain = (typeof SIGNAL_DOMAINS)[number];

export const ITEM_KINDS = ["work", "dados_stale"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const OVERRIDE_ACTIONS = ["pin", "reorder", "dismiss"] as const;
export type OverrideAction = (typeof OVERRIDE_ACTIONS)[number];

export const PRIMARY_CATEGORIES: readonly SignalCategory[] = [
  "receita",
  "cliente",
  "prazo",
  "risco_operacional",
  "blocker",
];

export const SECONDARY_CATEGORIES: readonly SignalCategory[] = ["estetica", "refactor"];

/** Homepage / "se eu só puder fazer 3 coisas hoje". Mirrors contracts HOMEPAGE_PRIORITY_LIMIT. */
export const HOMEPAGE_PRIORITY_LIMIT = 3;

export const SCHEMA_VERSIONS = {
  AttentionEngineOutput: "control-center.attention-engine.v1",
  AttentionItem: "control-center.attention-item.v1",
  PriorityRecommendation: "control-center.priority-recommendation.v1",
  AuditEvent: "control-center.audit-event.v1",
} as const;

export const WEIGHT_DENOM = 10_000;
export const SCORE_SCALE = 1_000;

export const SEVERITY_RANK: Record<AttentionSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export const FRESHNESS_RANK: Record<FreshnessStatus, number> = {
  ERROR: 0,
  STALE: 1,
  UNKNOWN: 2,
  FRESH: 3,
};

export const FORBIDDEN_SECRET_KEY_RE =
  /^(secret|token|password|authorization|api[_-]?key|cookie|credential|private[_-]?key)$/i;
