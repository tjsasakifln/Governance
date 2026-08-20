/**
 * Canonical Control Center taxonomies. JSON Schema patterns MUST match these
 * string constants; contract tests assert lockstep.
 */

export const UTC_DATETIME_PATTERN =
  "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]{1,9})?Z$";

export const RESOURCE_ID_PATTERN = "^cc:[a-z][a-z0-9-]*:[A-Za-z0-9._~-]+$";

export const CURRENCY_PATTERN = "^[A-Z]{3}$";

export const CLIENT_SLUG_PATTERN = "^[a-z0-9]+(?:-[a-z0-9]+)*$";

export const REPO_NAME_PATTERN = "^[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)?$";

/**
 * v1 well-known literal scopes. These never take a colon.
 * Adding a new literal (e.g. `hr`) is an additive schema revision, not a
 * silent change to this frozen list.
 */
export const SCOPE_LITERALS = [
  "company",
  "commercial",
  "finance",
  "clients",
  "infrastructure",
  "inbound",
] as const;

export type ScopeLiteral = (typeof SCOPE_LITERALS)[number];

/**
 * v1 parameterized prefixes. `repo:<name>` and `client:<slug>` are required.
 * Future prefixes of the form `<prefix>:<id>` are a non-breaking extension:
 * consumers MUST treat unknown prefix:id scopes as opaque, MUST NOT grant
 * them by default, and MUST NOT fail schema validation of the string.
 */
export const SCOPE_PREFIXES = ["repo", "client"] as const;

export type ScopePrefix = (typeof SCOPE_PREFIXES)[number];

/**
 * Full scope pattern:
 * - the six literals
 * - repo:<name> (short name or owner/name)
 * - client:<kebab-slug>
 * - future namespaced `<prefix>:<id>` (lowercase prefix)
 */
export const SCOPE_PATTERN =
  "^(company|commercial|finance|clients|infrastructure|inbound|repo:[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)?|client:[a-z0-9]+(?:-[a-z0-9]+)*|[a-z][a-z0-9-]*:[A-Za-z0-9._:~-]+)$";

export const FRESHNESS_STATUSES = ["FRESH", "STALE", "UNKNOWN", "ERROR"] as const;
export type FreshnessStatus = (typeof FRESHNESS_STATUSES)[number];

/**
 * Confidence is a closed unit interval, independent of freshness.
 * Freshness answers "how recent is this observation?".
 * Confidence answers "how much should a consumer trust it?".
 * A FRESH observation MAY have low confidence; an ERROR observation MAY
 * still carry last-known data with residual confidence.
 */
export const CONFIDENCE_MIN = 0;
export const CONFIDENCE_MAX = 1;

export const DIRECTIVE_KINDS = [
  "decision",
  "directive",
  "fact",
  "constraint",
  "priority",
  "risk",
  "hypothesis",
] as const;
export type DirectiveKind = (typeof DIRECTIVE_KINDS)[number];

export const DIRECTIVE_STATUSES = [
  "draft",
  "active",
  "superseded",
  "revoked",
  "expired",
] as const;
export type DirectiveStatus = (typeof DIRECTIVE_STATUSES)[number];

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

export const AGENT_SESSION_STATUSES = ["open", "closed", "denied"] as const;
export type AgentSessionStatus = (typeof AGENT_SESSION_STATUSES)[number];

export const CLIENT_LIFECYCLES = [
  "lead",
  "active",
  "paused",
  "churn_risk",
  "churned",
  "unknown",
] as const;
export type ClientLifecycle = (typeof CLIENT_LIFECYCLES)[number];

export const HEALTH_STATUSES = ["healthy", "degraded", "down", "unknown"] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export const COLLECTOR_RUN_STATUSES = [
  "started",
  "succeeded",
  "failed",
  "skipped",
] as const;
export type CollectorRunStatus = (typeof COLLECTOR_RUN_STATUSES)[number];

export const AUDIT_OUTCOMES = ["success", "denied", "error"] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

export const ACTOR_KINDS = ["human", "agent", "system"] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

export const RESOURCE_TYPE_NAMES = [
  "Directive",
  "OperationalSnapshot",
  "SourceObservation",
  "AttentionItem",
  "PriorityRecommendation",
  "AgentSession",
  "ClientStatus",
  "CommercialSnapshot",
  "FinanceSnapshot",
  "EngineeringSnapshot",
  "ServiceHealth",
  "CollectorRun",
  "AuditEvent",
] as const;
export type ResourceTypeName = (typeof RESOURCE_TYPE_NAMES)[number];

export const SCHEMA_VERSIONS = {
  Directive: "control-center.directive.v1",
  OperationalSnapshot: "control-center.operational-snapshot.v1",
  SourceObservation: "control-center.source-observation.v1",
  AttentionItem: "control-center.attention-item.v1",
  PriorityRecommendation: "control-center.priority-recommendation.v1",
  AgentSession: "control-center.agent-session.v1",
  ClientStatus: "control-center.client-status.v1",
  CommercialSnapshot: "control-center.commercial-snapshot.v1",
  FinanceSnapshot: "control-center.finance-snapshot.v1",
  EngineeringSnapshot: "control-center.engineering-snapshot.v1",
  ServiceHealth: "control-center.service-health.v1",
  CollectorRun: "control-center.collector-run.v1",
  AuditEvent: "control-center.audit-event.v1",
  AgentContext: "control-center.agent-context.v1",
} as const;

export const ID_TYPE_BY_RESOURCE: Record<ResourceTypeName, string> = {
  Directive: "directive",
  OperationalSnapshot: "operational-snapshot",
  SourceObservation: "source-observation",
  AttentionItem: "attention-item",
  PriorityRecommendation: "priority-recommendation",
  AgentSession: "agent-session",
  ClientStatus: "client-status",
  CommercialSnapshot: "commercial-snapshot",
  FinanceSnapshot: "finance-snapshot",
  EngineeringSnapshot: "engineering-snapshot",
  ServiceHealth: "service-health",
  CollectorRun: "collector-run",
  AuditEvent: "audit-event",
};

/** Keys that MUST never appear in payloads, audit detail, or logs. */
export const FORBIDDEN_SECRET_KEY_PATTERN =
  "^(?![Ss]ecret|[Tt]oken|[Pp]assword|[Aa]uthorization|[Aa]pi[_-]?[Kk]ey|[Cc]ookie|[Cc]redential|[Pp]rivate[_-]?[Kk]ey).+";

export const FORBIDDEN_SECRET_KEY_REGEX =
  /^(secret|token|password|authorization|api[_-]?key|cookie|credential|private[_-]?key)$/i;

export const WELL_KNOWN_SOURCE_SYSTEMS = [
  "governance",
  "warmbly",
  "github",
  "asaas",
  "web-cfg",
  "extra-cli",
  "manual",
  "collector",
  "unknown",
] as const;

export const SOURCE_SYSTEM_PATTERN = "^[a-z][a-z0-9-]*$";

export const HOMEPAGE_PRIORITY_LIMIT = 3;
