/**
 * Canonical Control Center taxonomies. JSON Schema patterns MUST match these
 * string constants; contract tests assert lockstep.
 */

export const UTC_DATETIME_PATTERN =
  "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]{1,9})?Z$";

export const RESOURCE_ID_PATTERN = "^cc:[a-z][a-z0-9-]*:[A-Za-z0-9._~-]+$";

export const CURRENCY_PATTERN = "^[A-Z]{3}$";

export const CLIENT_SLUG_PATTERN = "^[a-z0-9]+(?:-[a-z0-9]+)*$";

/**
 * Minimum length of a client slug. A single character is an initial or a typo,
 * never a client identity.
 */
export const MIN_CLIENT_SLUG_LENGTH = 2;

/**
 * Slugs that are placeholders rather than identities. A record whose only
 * available identifier collapses to one of these has no identity at all: it
 * belongs in the data-quality / join queue, never in the client roll-up.
 * Fail closed — an unusable identifier is never coerced into a slug that looks
 * like a real entity (that is how `client:unknown` used to reach the surface).
 */
export const RESERVED_CLIENT_SLUGS = [
  "anonimo",
  "anonymous",
  "client",
  "cliente",
  "default",
  "desconhecido",
  "na",
  "n-a",
  "nao-identificado",
  "nao-informado",
  "no-name",
  "none",
  "null",
  "placeholder",
  "sem-identidade",
  "sem-nome",
  "tbd",
  "undefined",
  "unidentified",
  "unknown",
] as const;

export type ReservedClientSlug = (typeof RESERVED_CLIENT_SLUGS)[number];

/** Lockstep source for the JSON Schema `reserved_client_slug` pattern. */
export const RESERVED_CLIENT_SLUG_PATTERN = `^(?:${RESERVED_CLIENT_SLUGS.join("|")})$`;

/** Lockstep source for the JSON Schema `reserved_client_scope` pattern. */
export const RESERVED_CLIENT_SCOPE_PATTERN = `^client:(?:${RESERVED_CLIENT_SLUGS.join("|")})$`;

/**
 * What a client identity may be derived from.
 *
 * A client is a company / account / organization. A **deal is not a client**:
 * two deals for one company are one client, and a deal id is a deal key, not a
 * client key. There is deliberately no deal-level basis in this vocabulary, so
 * a producer cannot declare a deal id as a client identity — it has nothing
 * truthful to write in `identity_basis`.
 */
export const CLIENT_IDENTITY_BASES = [
  "client_key",
  "account_key",
  "organization_key",
  "company_name",
  "manual",
  "governance",
] as const;

export type ClientIdentityBasis = (typeof CLIENT_IDENTITY_BASES)[number];

/**
 * Source-record fields that may carry a client-level key, most specific first.
 * A deal id (`id`, `deal_id`, `opportunity_id`) is absent on purpose.
 */
export const CLIENT_KEY_FIELDS = [
  "client_id",
  "customer_id",
  "account_id",
  "organization_id",
  "org_id",
  "company_id",
] as const;

/** Source-record fields that name the company itself (not the deal). */
export const CLIENT_NAME_FIELDS = [
  "company",
  "company_name",
  "account_name",
  "organization",
  "organization_name",
] as const;

/**
 * Source kinds that describe a *deal* stream.
 *
 * A deal stream cannot identify a client on its own: it knows opportunities, not
 * companies. Publishing a ClientStatus whose provenance is one of these means
 * the producer keyed a client on a deal — the substitution that put
 * `client:<deal>` (and, when the deal had no id, `client:unknown`) on the
 * Clientes route. Resolve the account first and publish with a client-level
 * source kind.
 *
 * v1 `ClientStatus` is frozen with `additionalProperties: false`, so the
 * resolved basis cannot be carried on the resource itself (ADR-CC-001: that
 * would be a v1.1/v2 bump). It travels on the clients snapshot instead, in
 * `data_quality.resolved_identities`, and this list is what `semanticChecks`
 * enforces on the resource.
 */
export const DEAL_SOURCE_KINDS = [
  "commercial-deal",
  "crm-deal",
  "deal",
  "deal-record",
  "opportunity",
  "pipeline",
  "commercial-pipeline",
] as const;

export type DealSourceKind = (typeof DEAL_SOURCE_KINDS)[number];

/** Basis implied by each key field, so the producer never has to guess. */
export const CLIENT_KEY_FIELD_BASIS: Record<(typeof CLIENT_KEY_FIELDS)[number], ClientIdentityBasis> = {
  client_id: "client_key",
  customer_id: "client_key",
  account_id: "account_key",
  organization_id: "organization_key",
  org_id: "organization_key",
  company_id: "organization_key",
};

/**
 * Why a record failed the minimum-identity rule. These codes are the vocabulary
 * of the data-quality queue; they are not free text.
 */
export const CLIENT_IDENTITY_REASON_CODES = [
  "missing_client_key",
  "unusable_client_key",
  "reserved_placeholder_slug",
  "missing_display_name",
  "placeholder_display_name",
] as const;

export type ClientIdentityReasonCode = (typeof CLIENT_IDENTITY_REASON_CODES)[number];

/**
 * The correction that clears each reason code. One string per code: the
 * operator fixes a missing account link differently from a placeholder name,
 * and a queue that says the same sentence five times is not actionable.
 */
export const CLIENT_IDENTITY_REQUIRED_ACTIONS: Record<ClientIdentityReasonCode, string> = {
  missing_client_key:
    "Vincular o registro a uma conta/empresa na origem (client_id, account_id ou organization_id) e reprocessar. Um id de negócio não identifica um cliente.",
  unusable_client_key:
    "Corrigir a chave de cliente na origem: o valor atual não produz um identificador utilizável. Depois reprocessar.",
  reserved_placeholder_slug:
    "Substituir o identificador placeholder por uma chave real de cliente na origem e reprocessar.",
  missing_display_name:
    "Informar a razão social ou o nome da empresa no cadastro da conta na origem e reprocessar.",
  placeholder_display_name:
    "Substituir o nome placeholder pelo nome real da empresa no cadastro da conta na origem e reprocessar.",
};

/** Umbrella action, for surfaces that summarize the whole queue. */
export const CLIENT_IDENTITY_REQUIRED_ACTION =
  "Corrigir o registro na origem: vincular a uma conta/empresa e informar o nome do cliente, depois reprocessar. Enquanto faltar identidade o registro fica na fila de qualidade de dados e não conta como cliente.";

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
 * Unanchored scope alternative used by SCOPE_PATTERN and CSV query params.
 * Catch-all prefix:id excludes well-known literals and repo/client so those
 * stay on their dedicated grammars.
 */
/**
 * `client:` alternative for SCOPE_CORE. The negative lookahead keeps reserved
 * placeholder slugs out of every scope in the ontology, not just ClientStatus:
 * `client:unknown` must not be addressable as an AttentionItem scope, a
 * Directive scope, or an agent grant either. `(?:,|$)` makes the lookahead
 * correct both anchored and inside the comma-separated query grammar.
 */
export const CLIENT_SCOPE_CORE = `client:(?!(?:${RESERVED_CLIENT_SLUGS.join("|")})(?:,|$))[a-z0-9]+(?:-[a-z0-9]+)*`;

export const SCOPE_CORE =
  `(?:company|commercial|finance|clients|infrastructure|inbound|repo:[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)?|${CLIENT_SCOPE_CORE}|(?!company:|commercial:|finance:|clients:|infrastructure:|inbound:|repo:|client:)[a-z][a-z0-9-]*:[A-Za-z0-9._:~-]+)`;

/**
 * Full scope pattern:
 * - the six literals
 * - repo:<name> (short name or owner/name)
 * - client:<kebab-slug>
 * - future namespaced `<prefix>:<id>` (lowercase prefix, not a reserved name)
 */
export const SCOPE_PATTERN = `^${SCOPE_CORE}$`;

/** Comma-separated scopes for HTTP query parameters. */
export const SCOPE_CSV_PATTERN = `^${SCOPE_CORE}(?:,${SCOPE_CORE})*$`;

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

/**
 * Execution-ledger statuses for AgentActivity. Distinct from AgentSession
 * (`open|closed|denied`), which is a scoped context-consult grant.
 */
export const AGENT_ACTIVITY_STATUSES = [
  "running",
  "done",
  "partial",
  "blocked",
  "failed",
] as const;
export type AgentActivityStatus = (typeof AGENT_ACTIVITY_STATUSES)[number];

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
  "AgentActivity",
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
  AgentActivity: "control-center.agent-activity.v1",
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
  AgentActivity: "agent-activity",
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
