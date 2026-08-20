/**
 * Local convergence contract for Governance → Control Center memory candidates.
 *
 * Sibling packages (`control-center/contracts`, persistence, MCP, UI) are not
 * in this worktree. Field names follow the contracts workstream (snake_case,
 * FRESH/STALE/UNKNOWN/ERROR, directive kinds). Persistence uses camelCase and
 * a slightly different freshness enum — a later campaign must map, not this
 * importer. Do not import sibling trees.
 */

export const CANDIDATE_SCHEMA = "control-center.governance-import-candidate.v1" as const;
export const IMPORT_RESULT_SCHEMA = "control-center.governance-import.v1" as const;

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

export const FRESHNESS_STATUSES = ["FRESH", "STALE", "UNKNOWN", "ERROR"] as const;
export type FreshnessStatus = (typeof FRESHNESS_STATUSES)[number];

export const ACTOR_KINDS = ["human", "agent", "system"] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

export const SCOPE_LITERALS = [
  "company",
  "commercial",
  "finance",
  "clients",
  "infrastructure",
  "inbound",
] as const;

export const SOURCE_SYSTEM = "governance" as const;

export const IMPORTER_ACTOR_ID = "system:governance-importer" as const;

export const UTC_DATETIME_PATTERN =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})?Z$/;

export const RESOURCE_ID_PATTERN = /^cc:[a-z][a-z0-9-]*:[A-Za-z0-9._~-]+$/;

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:~/-]+$/;

export const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

export const CONTENT_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

export type UtcDateTime = string;
export type ResourceId = string;

export type SourceRef = {
  system: typeof SOURCE_SYSTEM | string;
  kind: string;
  locator: string;
  label?: string;
};

export type ActorRef = {
  kind: ActorKind;
  id: string;
  display_name?: string;
};

export type AuditEntry = {
  at: UtcDateTime;
  actor: ActorRef;
  action: "created" | "updated" | "status_changed" | "superseded" | "revoked";
  from_status?: DirectiveStatus;
  to_status?: DirectiveStatus;
  note?: string;
};

/**
 * Directive-shaped candidate plus Git provenance.
 * Projection of source bytes — not a rewritten catalog/offer/decision.
 */
export type MemoryCandidate = {
  schema_version: typeof CANDIDATE_SCHEMA;
  id: ResourceId;
  idempotency_key: string;
  kind: DirectiveKind;
  scope: string;
  status: DirectiveStatus;
  title: string;
  body: string;
  effective_from: UtcDateTime;
  expires_at: UtcDateTime | null;
  supersedes: ResourceId[] | null;
  created_by: ActorRef;
  created_at: UtcDateTime;
  updated_at: UtcDateTime;
  audit: AuditEntry[];
  source: SourceRef;
  observed_at: UtcDateTime;
  freshness_status: FreshnessStatus;
  confidence: number;
  content_hash: string;
  source_path: string;
  commit_sha: string;
  tags?: string[];
};

export type UnclassifiableItem = {
  source_path: string;
  content_hash: string;
  commit_sha: string | null;
  reason: string;
  observed_at: UtcDateTime;
  freshness_status: FreshnessStatus;
};

export type ImportStats = {
  candidate_count: number;
  unclassifiable_count: number;
  by_kind: Record<DirectiveKind, number>;
};

export type ImportResult = {
  schema_version: typeof IMPORT_RESULT_SCHEMA;
  dry_run: boolean;
  observed_at: UtcDateTime;
  repo_root: string;
  files_scanned: number;
  candidates: MemoryCandidate[];
  unclassifiable: UnclassifiableItem[];
  stats: ImportStats;
};

export type VirtualSourceFile = {
  path: string;
  bytes: Uint8Array;
};

export type GitMetadataProvider = {
  /** Last commit that touched the path, or null if unknown. Never invent. */
  commitShaFor(sourcePath: string): string | null;
  /** HEAD of the repo, or null. Used only when the path exists in that commit. */
  headSha(): string | null;
  /** True when `git show HEAD:path` succeeds (path is in HEAD). */
  pathExistsInHead?(sourcePath: string): boolean;
};

export type PersistOutcome = {
  inserted: number;
  skipped: number;
};

/**
 * Local adapter only. Persistence/MCP/UI wiring is a later convergence campaign.
 * The default CLI never invokes this port.
 */
export type PersistPort = {
  persistCandidates(result: ImportResult): Promise<PersistOutcome>;
};
