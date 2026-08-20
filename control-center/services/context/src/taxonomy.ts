/**
 * Canonical Control Center taxonomies, duplicated in lockstep with
 * control-center/contracts (cc/01). This package must not import that
 * worktree; exclusive path is this service.
 */

export const UTC_DATETIME_PATTERN =
  "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]{1,9})?Z$";

export const RESOURCE_ID_PATTERN = "^cc:[a-z][a-z0-9-]*:[A-Za-z0-9._~-]+$";

export const CLIENT_SLUG_PATTERN = "^[a-z0-9]+(?:-[a-z0-9]+)*$";

export const REPO_NAME_PATTERN = "^[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)?$";

export const SCOPE_LITERALS = [
  "company",
  "commercial",
  "finance",
  "clients",
  "infrastructure",
  "inbound",
] as const;

export type ScopeLiteral = (typeof SCOPE_LITERALS)[number];

export const DOMAIN_LITERALS = [
  "commercial",
  "finance",
  "clients",
  "infrastructure",
  "inbound",
] as const;

export type DomainLiteral = (typeof DOMAIN_LITERALS)[number];

export const SCOPE_CORE =
  "(?:company|commercial|finance|clients|infrastructure|inbound|repo:[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)?|client:[a-z0-9]+(?:-[a-z0-9]+)*|(?!company:|commercial:|finance:|clients:|infrastructure:|inbound:|repo:|client:)[a-z][a-z0-9-]*:[A-Za-z0-9._:~-]+)";

export const SCOPE_PATTERN = `^${SCOPE_CORE}$`;

export const FRESHNESS_STATUSES = ["FRESH", "STALE", "UNKNOWN", "ERROR"] as const;
export type FreshnessStatus = (typeof FRESHNESS_STATUSES)[number];

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

export const ACTOR_KINDS = ["human", "agent", "system"] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

export const SOURCE_SYSTEM_PATTERN = "^[a-z][a-z0-9-]*$";
export const SOURCE_KIND_PATTERN = "^[a-z][a-z0-9._-]*$";
export const ACTOR_ID_PATTERN = "^[A-Za-z0-9._:-]+$";
export const ID_TYPE_PATTERN = "^[a-z][a-z0-9-]*$";

export const CREATE_STATUSES = ["draft", "active"] as const;
export type CreateStatus = (typeof CREATE_STATUSES)[number];
