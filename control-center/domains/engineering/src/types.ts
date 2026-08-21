import type {
  ATTENTION_SEVERITIES,
  ATTENTION_STATUSES,
  BLOCKER_KINDS,
  CANONICAL_FRESHNESS,
  CLAIM_KINDS,
  COLLECTOR_FRESHNESS,
  HEALTH_STATUSES,
} from "./constants.js";
import type { EngineeringPolicy } from "./policy.js";

export type CollectorFreshness = (typeof COLLECTOR_FRESHNESS)[number];
export type CanonicalFreshness = (typeof CANONICAL_FRESHNESS)[number];
export type HealthStatus = (typeof HEALTH_STATUSES)[number];
export type ClaimKind = (typeof CLAIM_KINDS)[number];
export type AttentionSeverity = (typeof ATTENTION_SEVERITIES)[number];
export type AttentionStatus = (typeof ATTENTION_STATUSES)[number];
export type BlockerKind = (typeof BLOCKER_KINDS)[number];

export type UtcDateTime = string;
export type ResourceId = string;
export type Scope = string;

export type SourceRef = {
  system: string;
  kind: string;
  locator: string;
  label?: string;
};

export type Provenance = {
  source: SourceRef;
  observed_at: UtcDateTime;
  freshness_status: CanonicalFreshness;
  confidence: number;
  freshness_window_seconds?: number;
};

export type LinkRef = {
  system: string;
  kind: string;
  locator: string;
  html_url: string;
  label: string;
};

export type CollectorProvenance = {
  source: string;
  observed_at: string;
  freshness_status: CollectorFreshness;
  confidence?: number;
};

export type CollectorRepoIdentity = CollectorProvenance & {
  observation_id: string;
  owner: string;
  name: string;
  full_name: string;
  default_branch: string;
  html_url: string;
  pushed_at: string | null;
  updated_at: string | null;
  last_activity_at: string | null;
};

export type CollectorCommit = CollectorProvenance & {
  observation_id: string;
  repo: string;
  sha: string;
  message: string;
  committed_at: string | null;
  author_login: string | null;
};

export type CollectorIssue = CollectorProvenance & {
  observation_id: string;
  repo: string;
  number: number;
  title: string;
  state: string;
  labels: string[];
  priority: string | null;
  html_url: string;
  created_at: string | null;
  updated_at: string | null;
};

export type CollectorPullRequest = CollectorProvenance & {
  observation_id: string;
  repo: string;
  number: number;
  title: string;
  draft: boolean;
  created_at: string;
  age_seconds: number;
  review_status: string;
  check_status: string;
  html_url: string;
  updated_at: string | null;
  head_sha: string | null;
  head_ref: string | null;
  base_ref: string | null;
};

export type CollectorCheckFailure = CollectorProvenance & {
  observation_id: string;
  repo: string;
  kind: "check_run" | "workflow_run";
  remote_id: number;
  name: string;
  conclusion: string | null;
  html_url: string | null;
  started_at: string | null;
  completed_at: string | null;
  head_sha: string | null;
};

export type CollectorSupportedDivergence = CollectorProvenance & {
  observation_id: string;
  repo: string;
  base: string;
  head: string;
  support: "supported";
  ahead_by: number;
  behind_by: number;
  status: string;
};

export type CollectorUnsupportedDivergence = CollectorProvenance & {
  observation_id: string;
  repo: string;
  base: string | null;
  head: string | null;
  support: "unsupported" | "unavailable";
  ahead_by: null;
  behind_by: null;
  status: "unsupported" | "unavailable";
  reason: string;
};

export type CollectorDivergence =
  | CollectorSupportedDivergence
  | CollectorUnsupportedDivergence;

export type CollectorError = CollectorProvenance & {
  observation_id: string;
  repo: string | null;
  resource: string;
  code: string;
  message: string;
  http_status: number | null;
};

export type CollectorOkCollection = {
  ok: true;
  freshness_status: "fresh" | "not_modified";
};

export type CollectorFailedCollection = {
  ok: false;
  freshness_status: "failed" | "stale";
  error_observation_id: string;
};

export type CollectorSkippedCollection = {
  skipped: true;
};

export type CollectorRepoCollection =
  | CollectorOkCollection
  | CollectorFailedCollection;

export type CollectorIssuesCollection =
  | CollectorOkCollection
  | CollectorFailedCollection
  | CollectorSkippedCollection;

export type CollectorRepoSnapshot = {
  repo: CollectorRepoIdentity | null;
  repo_collection: CollectorRepoCollection;
  issues_collection: CollectorIssuesCollection;
  recent_commits: CollectorCommit[];
  open_issues: CollectorIssue[];
  open_pull_requests: CollectorPullRequest[];
  check_failures: CollectorCheckFailure[];
  workflow_failures: CollectorCheckFailure[];
  divergence: CollectorDivergence;
  errors: CollectorError[];
};

export type CollectorEngineeringSnapshot = CollectorProvenance & {
  schema: typeof import("./constants.js").COLLECTOR_ENGINEERING_SNAPSHOT_SCHEMA;
  snapshot_id: string;
  collected_at: string;
  allowlist: string[];
  repos: CollectorRepoSnapshot[];
  errors: CollectorError[];
};

export type OpenPrRef = {
  number: number;
  title: string;
  html_url: string;
  draft: boolean;
  created_at: UtcDateTime;
  updated_at: UtcDateTime | null;
  age_seconds: number;
  stale: boolean;
  review_status: string;
  check_status: string;
  head_ref: string | null;
  base_ref: string | null;
  provenance: Provenance;
};

export type BrokenCheckRef = {
  name: string;
  kind: "check_run" | "workflow_run" | "pull_request_check";
  conclusion: string | null;
  html_url: string;
  remote_id: number | null;
  head_sha: string | null;
  provenance: Provenance;
};

export type PriorityIssueRef = {
  number: number;
  title: string;
  html_url: string;
  priority: "P0" | "P1";
  labels: string[];
  created_at: UtcDateTime | null;
  updated_at: UtcDateTime | null;
  age_seconds: number | null;
  provenance: Provenance;
};

export type LastActivity = {
  at: UtcDateTime;
  age_seconds: number;
  source_kind: "repo" | "commit" | "pull_request" | "issue";
};

export type Aging = {
  last_activity_age_seconds: number | null;
  oldest_open_pr_age_seconds: number | null;
  stale_pr_count: number;
  oldest_p0_p1_age_seconds: number | null;
};

export type Blocker = {
  kind: BlockerKind;
  claim_kind: Extract<ClaimKind, "fact" | "hypothesis">;
  title: string;
  reason: string;
  reference: LinkRef;
  provenance: Provenance;
};

export type StructuredClaim = {
  kind: Extract<ClaimKind, "fact" | "hypothesis">;
  code: string;
  title: string;
  body: string;
  scope: Scope;
  status: "active";
  effective_from: UtcDateTime;
  expires_at: null;
  supersedes: null;
  created_by: { kind: "system"; id: string };
};

export type AttentionCandidate = {
  schema_version: typeof import("./constants.js").ATTENTION_ITEM_SCHEMA;
  id: ResourceId;
  scope: Scope;
  repo: string;
  severity: AttentionSeverity;
  status: AttentionStatus;
  title: string;
  summary: string;
  reason_code: BlockerKind;
  claim_kind: Extract<ClaimKind, "fact" | "hypothesis">;
  reference: LinkRef;
  provenance: Provenance;
  detected_at: UtcDateTime;
  homepage_eligible: boolean;
  recommended_action: string;
};

export type RepoIdentityView = {
  owner: string;
  name: string;
  full_name: string;
  html_url: string;
  default_branch: string | null;
};

export type RepoExecutiveView = {
  schema_version: typeof import("./constants.js").REPO_EXECUTIVE_SCHEMA;
  id: ResourceId;
  scope: Scope;
  generated_at: UtcDateTime;
  provenance: Provenance;
  repo: RepoIdentityView;
  health: HealthStatus;
  blockers: Blocker[];
  open_prs: OpenPrRef[];
  broken_checks: BrokenCheckRef[];
  p0_p1_issues: PriorityIssueRef[];
  last_activity: LastActivity | null;
  aging: Aging;
  claims: StructuredClaim[];
  attention: AttentionCandidate[];
};

export type RepoAttentionSummary = {
  full_name: string;
  scope: Scope;
  health: HealthStatus;
  reasons: string[];
  claim_kind: Extract<ClaimKind, "fact" | "hypothesis">;
};

export type CompanyAggregates = {
  repo_count: number;
  healthy_count: number;
  degraded_count: number;
  unknown_count: number;
  open_pr_count: number;
  stale_pr_count: number;
  failing_check_count: number;
  p0_issue_count: number;
  p1_issue_count: number;
  fact_blocked_repo_count: number;
  hypothesis_repo_count: number;
};

export type CanonicalEngineeringSnapshot = {
  schema_version: typeof import("./constants.js").CANONICAL_ENGINEERING_SNAPSHOT_SCHEMA;
  id: ResourceId;
  scope: Scope;
  generated_at: UtcDateTime;
  provenance: Provenance;
  open_pr_count: number;
  failing_check_count: number;
  open_incident_count: number;
  repo_scopes: Scope[];
  attention_item_ids: ResourceId[];
};

export type CompanyEngineeringReadModel = {
  schema_version: typeof import("./constants.js").COMPANY_EXECUTIVE_SCHEMA;
  id: ResourceId;
  scope: "company";
  generated_at: UtcDateTime;
  provenance: Provenance;
  repos: RepoExecutiveView[];
  aggregates: CompanyAggregates;
  blocked_repos: RepoAttentionSummary[];
  hypothesis_repos: RepoAttentionSummary[];
  attention: AttentionCandidate[];
  attention_headlines: string[];
  canonical: CanonicalEngineeringSnapshot;
};

export type TransformOptions = {
  now?: Date;
  policy?: Partial<EngineeringPolicy>;
};

export type ScopedRead =
  | { kind: "company"; value: CompanyEngineeringReadModel }
  | { kind: "repo"; value: RepoExecutiveView }
  | { kind: "empty"; scope: string };
