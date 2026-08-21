/**
 * Local convergence contract for the GitHub collector.
 *
 * These types live in-path because EngineeringSnapshot / SourceObservation are
 * not yet in this repository. Sibling Control Center packages must consume this
 * JSON later — do not import extra-cli SourceObservation (different concept).
 */

export const SOURCE_ID = "github" as const;

export const ENGINEERING_SNAPSHOT_SCHEMA =
  "confenge.control_center.engineering_snapshot.v1" as const;

export const SOURCE_OBSERVATION_SCHEMA =
  "confenge.control_center.source_observation.v1" as const;

export type SourceId = typeof SOURCE_ID;

export type FreshnessStatus =
  | "fresh"
  | "stale"
  | "failed"
  | "not_modified"
  | "unsupported";

export type Provenance = {
  source: SourceId;
  observed_at: string;
  freshness_status: FreshnessStatus;
  confidence?: number;
};

export type RepoRef = {
  owner: string;
  name: string;
  full_name: string;
};

export type RepoIdentity = Provenance &
  RepoRef & {
    observation_id: string;
    default_branch: string;
    html_url: string;
    pushed_at: string | null;
    updated_at: string | null;
    last_activity_at: string | null;
  };

export type CommitObservation = Provenance & {
  observation_id: string;
  repo: string;
  sha: string;
  message: string;
  committed_at: string | null;
  author_login: string | null;
};

export type IssueObservation = Provenance & {
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

export type PullRequestObservation = Provenance & {
  observation_id: string;
  repo: string;
  number: number;
  title: string;
  draft: boolean;
  created_at: string;
  age_seconds: number;
  review_status: ReviewStatus;
  check_status: CheckStatus;
  html_url: string;
  updated_at: string | null;
  head_sha: string | null;
  head_ref: string | null;
  base_ref: string | null;
};

export type ReviewStatus =
  | "APPROVED"
  | "CHANGES_REQUESTED"
  | "COMMENTED"
  | "REVIEW_REQUIRED"
  | "NONE"
  | "UNKNOWN";

export type CheckStatus = "success" | "failure" | "pending" | "error" | "unknown";

export type CheckKind = "check_run" | "workflow_run";

export type CheckFailure = Provenance & {
  observation_id: string;
  repo: string;
  kind: CheckKind;
  remote_id: number;
  name: string;
  conclusion: string | null;
  html_url: string | null;
  started_at: string | null;
  completed_at: string | null;
  head_sha: string | null;
};

export type SupportedDivergence = Provenance & {
  observation_id: string;
  repo: string;
  base: string;
  head: string;
  support: "supported";
  ahead_by: number;
  behind_by: number;
  status: string;
};

export type UnsupportedDivergence = Provenance & {
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

export type BranchDivergence = SupportedDivergence | UnsupportedDivergence;

export type CollectionErrorCode =
  | "missing_credentials"
  | "missing_installation_token"
  | "invalid_config"
  | "http_401"
  | "http_403"
  | "http_404"
  | "http_429"
  | "http_5xx"
  | "http_error"
  | "rate_limit"
  | "parse"
  | "not_modified_without_cache"
  | "skipped_rate_limit";

export type CollectionError = Provenance & {
  observation_id: string;
  repo: string | null;
  resource: string;
  code: CollectionErrorCode;
  message: string;
  http_status: number | null;
};

export type ResourceCollectionStatus =
  | {
      ok: true;
      freshness_status: Extract<FreshnessStatus, "fresh" | "not_modified">;
    }
  | {
      ok: false;
      freshness_status: Extract<FreshnessStatus, "failed" | "stale">;
      error_observation_id: string;
    };

export type RepoSnapshot = {
  repo: RepoIdentity | null;
  repo_collection: ResourceCollectionStatus;
  issues_collection: ResourceCollectionStatus;
  recent_commits: CommitObservation[];
  open_issues: IssueObservation[];
  open_pull_requests: PullRequestObservation[];
  check_failures: CheckFailure[];
  workflow_failures: CheckFailure[];
  divergence: BranchDivergence;
  errors: CollectionError[];
};

export type EngineeringSnapshot = Provenance & {
  schema: typeof ENGINEERING_SNAPSHOT_SCHEMA;
  snapshot_id: string;
  collected_at: string;
  allowlist: string[];
  repos: RepoSnapshot[];
  errors: CollectionError[];
};

export type SourceObservationKind =
  | "engineering_snapshot"
  | "repo"
  | "commit"
  | "issue"
  | "pull_request"
  | "check_failure"
  | "workflow_failure"
  | "branch_divergence"
  | "collection_error";

export type SourceObservation = Provenance & {
  schema: typeof SOURCE_OBSERVATION_SCHEMA;
  observation_id: string;
  kind: SourceObservationKind;
  subject: string;
  payload: Record<string, unknown>;
};

export type CollectResult = {
  snapshot: EngineeringSnapshot;
  observations: SourceObservation[];
};

export type HttpMethod = "GET" | "HEAD";

export type HttpRequest = {
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
};

export type HttpResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

export type HttpTransport = (req: HttpRequest) => Promise<HttpResponse>;

export type EtagRecord = {
  etag: string;
  body: string;
  status: number;
};

export type EtagStore = {
  get(url: string): EtagRecord | undefined;
  set(url: string, record: EtagRecord): void;
};

export type StructuredLogger = (
  event: string,
  fields: Record<string, unknown>,
) => void;

export type CollectConfig = {
  repos: string[];
  token: string;
  apiBase: string;
  recentCommitLimit: number;
  now: () => Date;
  transport: HttpTransport;
  etagStore: EtagStore;
  logger: StructuredLogger;
  compareHeads?: Record<string, { base?: string; head: string }>;
};
