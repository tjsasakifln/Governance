import { asArray, asRecord, nestedRecord, readBoolean, readNumber, readString } from "./json.js";
import { extractPriority, labelNames } from "./priority.js";
import { confidenceFor, observationId, provenance } from "./provenance.js";
import type {
  BranchDivergence,
  CheckFailure,
  CheckStatus,
  CollectionError,
  CollectionErrorCode,
  CommitObservation,
  FreshnessStatus,
  IssueObservation,
  PullRequestObservation,
  RepoIdentity,
  ReviewStatus,
} from "./types.js";

export type NormalizeClock = Date;

export function normalizeRepo(
  data: unknown,
  now: NormalizeClock,
  freshness_status: FreshnessStatus,
): RepoIdentity | null {
  const rec = asRecord(data);
  if (!rec) {
    return null;
  }
  const fullName = readString(rec, "full_name");
  const name = readString(rec, "name");
  const ownerRec = nestedRecord(rec, "owner");
  const owner = ownerRec ? readString(ownerRec, "login") : null;
  const defaultBranch = readString(rec, "default_branch");
  if (!fullName || !name || !owner || !defaultBranch) {
    return null;
  }
  const pushedAt = readString(rec, "pushed_at");
  const updatedAt = readString(rec, "updated_at");
  const lastActivity = latestTimestamp([pushedAt, updatedAt]);
  return {
    ...provenance(now, freshness_status, confidenceFor(freshness_status)),
    observation_id: observationId(["repo", fullName]),
    owner,
    name,
    full_name: fullName,
    default_branch: defaultBranch,
    html_url: readString(rec, "html_url") ?? `https://github.com/${fullName}`,
    pushed_at: pushedAt,
    updated_at: updatedAt,
    last_activity_at: lastActivity,
  };
}

export function normalizeCommits(
  data: unknown,
  repo: string,
  now: NormalizeClock,
  freshness_status: FreshnessStatus,
): CommitObservation[] {
  const items = asArray(data);
  const commits: CommitObservation[] = [];
  for (const item of items) {
    const rec = asRecord(item);
    if (!rec) continue;
    const sha = readString(rec, "sha");
    if (!sha) continue;
    const commit = nestedRecord(rec, "commit");
    const message = commit ? readString(commit, "message") : null;
    const committer = commit ? nestedRecord(commit, "committer") : null;
    const authorRec = nestedRecord(rec, "author");
    const committedAt =
      (committer ? readString(committer, "date") : null) ??
      (commit ? readString(nestedRecord(commit, "author") ?? {}, "date") : null);
    commits.push({
      ...provenance(now, freshness_status, confidenceFor(freshness_status)),
      observation_id: observationId(["commit", repo, sha]),
      repo,
      sha,
      message: message ?? "",
      committed_at: committedAt,
      author_login: authorRec ? readString(authorRec, "login") : null,
    });
  }
  return commits;
}

export function normalizeIssues(
  data: unknown,
  repo: string,
  now: NormalizeClock,
  freshness_status: FreshnessStatus,
): IssueObservation[] {
  const items = asArray(data);
  const issues: IssueObservation[] = [];
  for (const item of items) {
    const rec = asRecord(item);
    if (!rec) continue;
    if (rec.pull_request !== undefined && rec.pull_request !== null) {
      continue;
    }
    const number = readNumber(rec, "number");
    const title = readString(rec, "title");
    if (number === null || !title) continue;
    const labels = labelNames(rec.labels);
    issues.push({
      ...provenance(now, freshness_status, confidenceFor(freshness_status)),
      observation_id: observationId(["issue", repo, number]),
      repo,
      number,
      title,
      state: readString(rec, "state") ?? "open",
      labels,
      priority: extractPriority(labels),
      html_url: readString(rec, "html_url") ?? `https://github.com/${repo}/issues/${number}`,
      created_at: readString(rec, "created_at"),
      updated_at: readString(rec, "updated_at"),
    });
  }
  return issues;
}

export type PullNormalizeInput = {
  pull: unknown;
  reviews: unknown;
  combinedStatus: unknown;
  checkRuns: unknown;
};

export function normalizePullRequest(
  input: PullNormalizeInput,
  repo: string,
  now: NormalizeClock,
  freshness_status: FreshnessStatus,
): PullRequestObservation | null {
  const rec = asRecord(input.pull);
  if (!rec) return null;
  const number = readNumber(rec, "number");
  const title = readString(rec, "title");
  const createdAt = readString(rec, "created_at");
  if (number === null || !title || !createdAt) return null;
  const createdMs = Date.parse(createdAt);
  const ageSeconds = Number.isFinite(createdMs)
    ? Math.max(0, Math.floor((now.getTime() - createdMs) / 1000))
    : 0;
  const head = nestedRecord(rec, "head");
  const base = nestedRecord(rec, "base");
  const requestedReviewers = asArray(rec.requested_reviewers);
  return {
    ...provenance(now, freshness_status, confidenceFor(freshness_status)),
    observation_id: observationId(["pr", repo, number]),
    repo,
    number,
    title,
    draft: readBoolean(rec, "draft") ?? false,
    created_at: createdAt,
    age_seconds: ageSeconds,
    review_status: rollupReviews(input.reviews, requestedReviewers.length > 0),
    check_status: rollupCheckStatus(input.combinedStatus, input.checkRuns),
    html_url: readString(rec, "html_url") ?? `https://github.com/${repo}/pull/${number}`,
    updated_at: readString(rec, "updated_at"),
    head_sha: head ? readString(head, "sha") : null,
    head_ref: head ? readString(head, "ref") : null,
    base_ref: base ? readString(base, "ref") : null,
  };
}

export function normalizeCheckRuns(
  data: unknown,
  repo: string,
  now: NormalizeClock,
  freshness_status: FreshnessStatus,
): CheckFailure[] {
  const rec = asRecord(data);
  const runs = rec ? asArray(rec.check_runs) : asArray(data);
  const failures: CheckFailure[] = [];
  for (const item of runs) {
    const run = asRecord(item);
    if (!run) continue;
    const conclusion = readString(run, "conclusion");
    if (!isFailureConclusion(conclusion)) continue;
    const id = readNumber(run, "id");
    const name = readString(run, "name");
    if (id === null || !name) continue;
    failures.push({
      ...provenance(now, freshness_status, confidenceFor(freshness_status)),
      observation_id: observationId(["check_run", repo, id]),
      repo,
      kind: "check_run",
      remote_id: id,
      name,
      conclusion,
      html_url: readString(run, "html_url"),
      started_at: readString(run, "started_at"),
      completed_at: readString(run, "completed_at"),
      head_sha: readString(run, "head_sha"),
    });
  }
  return failures;
}

export function normalizeWorkflowRuns(
  data: unknown,
  repo: string,
  now: NormalizeClock,
  freshness_status: FreshnessStatus,
): CheckFailure[] {
  const rec = asRecord(data);
  const runs = rec ? asArray(rec.workflow_runs) : asArray(data);
  const failures: CheckFailure[] = [];
  for (const item of runs) {
    const run = asRecord(item);
    if (!run) continue;
    const conclusion = readString(run, "conclusion");
    if (!isFailureConclusion(conclusion)) continue;
    const id = readNumber(run, "id");
    const name = readString(run, "name");
    if (id === null || !name) continue;
    failures.push({
      ...provenance(now, freshness_status, confidenceFor(freshness_status)),
      observation_id: observationId(["workflow_run", repo, id]),
      repo,
      kind: "workflow_run",
      remote_id: id,
      name,
      conclusion,
      html_url: readString(run, "html_url"),
      started_at: readString(run, "run_started_at") ?? readString(run, "created_at"),
      completed_at: readString(run, "updated_at"),
      head_sha: readString(run, "head_sha"),
    });
  }
  return failures;
}

export function normalizeCompare(
  data: unknown,
  repo: string,
  base: string,
  head: string,
  now: NormalizeClock,
  freshness_status: FreshnessStatus,
): BranchDivergence {
  const rec = asRecord(data);
  const ahead = rec ? readNumber(rec, "ahead_by") : null;
  const behind = rec ? readNumber(rec, "behind_by") : null;
  const status = rec ? readString(rec, "status") : null;
  if (ahead === null || behind === null || !status) {
    return unsupportedDivergence(
      repo,
      base,
      head,
      now,
      "compare_payload_incomplete",
      "unsupported",
    );
  }
  return {
    ...provenance(now, freshness_status, confidenceFor(freshness_status)),
    observation_id: observationId(["compare", repo, `${base}...${head}`]),
    repo,
    base,
    head,
    support: "supported",
    ahead_by: ahead,
    behind_by: behind,
    status,
  };
}

export function unsupportedDivergence(
  repo: string,
  base: string | null,
  head: string | null,
  now: NormalizeClock,
  reason: string,
  support: "unsupported" | "unavailable" = "unsupported",
): BranchDivergence {
  const ref = base && head ? `${base}...${head}` : "none";
  return {
    ...provenance(now, "unsupported", confidenceFor("unsupported")),
    observation_id: observationId(["compare", repo, ref]),
    repo,
    base,
    head,
    support,
    ahead_by: null,
    behind_by: null,
    status: support,
    reason,
  };
}

export function collectionError(input: {
  now: Date;
  repo: string | null;
  resource: string;
  code: CollectionErrorCode;
  message: string;
  http_status: number | null;
  freshness_status?: FreshnessStatus;
}): CollectionError {
  const freshness = input.freshness_status ?? "failed";
  return {
    ...provenance(input.now, freshness, confidenceFor(freshness)),
    observation_id: observationId([
      "error",
      input.repo ?? "_",
      input.resource,
      input.code,
    ]),
    repo: input.repo,
    resource: input.resource,
    code: input.code,
    message: input.message,
    http_status: input.http_status,
  };
}

export function rollupReviews(data: unknown, hasRequestedReviewers: boolean): ReviewStatus {
  const items = asArray(data);
  const byUser = new Map<string, string>();
  for (const item of items) {
    const rec = asRecord(item);
    if (!rec) continue;
    const state = readString(rec, "state");
    if (!state || state === "PENDING") continue;
    const user = nestedRecord(rec, "user");
    const login = user ? readString(user, "login") : null;
    const key = login ?? `review-${readNumber(rec, "id") ?? byUser.size}`;
    byUser.set(key, state);
  }
  const states = [...byUser.values()];
  if (states.includes("CHANGES_REQUESTED")) return "CHANGES_REQUESTED";
  if (states.includes("APPROVED")) return "APPROVED";
  if (states.includes("COMMENTED")) return "COMMENTED";
  if (hasRequestedReviewers) return "REVIEW_REQUIRED";
  if (states.length === 0) return "NONE";
  return "UNKNOWN";
}

export function rollupCheckStatus(combinedStatus: unknown, checkRuns: unknown): CheckStatus {
  const combined = asRecord(combinedStatus);
  const combinedState = combined ? readString(combined, "state") : null;
  const rec = asRecord(checkRuns);
  const runs = rec ? asArray(rec.check_runs) : asArray(checkRuns);
  let sawFailure = false;
  let sawPending = false;
  let sawError = false;
  let sawSuccess = false;
  for (const item of runs) {
    const run = asRecord(item);
    if (!run) continue;
    const conclusion = readString(run, "conclusion");
    const status = readString(run, "status");
    if (isFailureConclusion(conclusion)) {
      sawFailure = true;
    } else if (conclusion === "success") {
      sawSuccess = true;
    } else if (status === "queued" || status === "in_progress" || conclusion === null) {
      sawPending = true;
    } else if (conclusion === "neutral" || conclusion === "skipped") {
      sawSuccess = true;
    } else {
      sawError = true;
    }
  }
  if (sawFailure || combinedState === "failure") return "failure";
  if (sawError || combinedState === "error") return "error";
  if (sawPending || combinedState === "pending") return "pending";
  if (sawSuccess || combinedState === "success") return "success";
  if (combinedState === "success") return "success";
  return "unknown";
}

export function isFailureConclusion(conclusion: string | null): boolean {
  if (!conclusion) return false;
  return (
    conclusion === "failure" ||
    conclusion === "timed_out" ||
    conclusion === "cancelled" ||
    conclusion === "canceled" ||
    conclusion === "action_required" ||
    conclusion === "startup_failure"
  );
}

function latestTimestamp(values: Array<string | null>): string | null {
  let best: string | null = null;
  let bestMs = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!value) continue;
    const ms = Date.parse(value);
    if (Number.isFinite(ms) && ms > bestMs) {
      best = value;
      bestMs = ms;
    }
  }
  return best;
}
