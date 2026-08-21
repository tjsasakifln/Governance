/**
 * Public ontology is control-center/contracts. Context keeps domain literals
 * and create-status locally; those are service-specific, not a second freshness enum.
 */
export {
  ACTOR_KINDS,
  CLIENT_SLUG_PATTERN,
  CONFIDENCE_MAX,
  CONFIDENCE_MIN,
  DIRECTIVE_KINDS,
  DIRECTIVE_STATUSES,
  FRESHNESS_STATUSES,
  REPO_NAME_PATTERN,
  RESOURCE_ID_PATTERN,
  SCOPE_CORE,
  SCOPE_LITERALS,
  SCOPE_PATTERN,
  UTC_DATETIME_PATTERN,
} from "@confenge/control-center-contracts";
export type {
  ActorKind,
  DirectiveKind,
  DirectiveStatus,
  FreshnessStatus,
  ScopeLiteral,
} from "@confenge/control-center-contracts";

export const DOMAIN_LITERALS = [
  "commercial",
  "finance",
  "clients",
  "infrastructure",
  "inbound",
] as const;

export type DomainLiteral = (typeof DOMAIN_LITERALS)[number];

export const SOURCE_SYSTEM_PATTERN = "^[a-z][a-z0-9-]*$";
export const SOURCE_KIND_PATTERN = "^[a-z][a-z0-9._-]*$";
export const ACTOR_ID_PATTERN = "^[A-Za-z0-9._:-]+$";
export const ID_TYPE_PATTERN = "^[a-z][a-z0-9-]*$";

export const CREATE_STATUSES = ["draft", "active"] as const;
export type CreateStatus = (typeof CREATE_STATUSES)[number];
