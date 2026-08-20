/**
 * Local copies of Control Center v1 taxonomies.
 * Canonical JSON Schema lives in `control-center/contracts` (cc/01).
 * This package MUST NOT import that workstream until convergence.
 */

export const UTC_DATETIME_PATTERN =
  "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]{1,9})?Z$";

export const UTC_DATETIME_RE = new RegExp(UTC_DATETIME_PATTERN);

export const RESOURCE_ID_PATTERN = "^cc:[a-z][a-z0-9-]*:[A-Za-z0-9._~-]+$";

export const CURRENCY_PATTERN = "^[A-Z]{3}$";

export const CURRENCY_RE = new RegExp(CURRENCY_PATTERN);

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

export const ACTOR_KINDS = ["human", "agent", "system"] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

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

export const OVERRIDE_ACTIONS = ["pin", "reorder", "dismiss"] as const;
export type OverrideAction = (typeof OVERRIDE_ACTIONS)[number];

export const EXECUTION_STATUSES = [
  "RUNNING",
  "DONE",
  "PARTIAL",
  "BLOCKED",
  "FAILED",
  "UNKNOWN",
] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export const INCIDENT_KINDS = ["incident", "blocker", "risk"] as const;
export type IncidentKind = (typeof INCIDENT_KINDS)[number];

export const SHORTCUT_KINDS = ["decision", "nota"] as const;
export type ShortcutKind = (typeof SHORTCUT_KINDS)[number];

/** Mirrors contracts HOMEPAGE_PRIORITY_LIMIT / attention-engine today_limit. */
export const HOMEPAGE_PRIORITY_LIMIT = 3;

export const HOJE_PAYLOAD_SCHEMA = "control-center.hoje-payload.v1" as const;
export const HOJE_VIEW_SCHEMA = "control-center.hoje-view.v1" as const;

export const FORBIDDEN_SECRET_KEY_REGEX =
  /^(secret|token|password|authorization|api[_-]?key|cookie|credential|private[_-]?key)$/i;
