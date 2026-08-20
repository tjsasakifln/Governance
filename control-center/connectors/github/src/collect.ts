import { attachObservations } from "./adapter.js";
import { comparePath, GithubReadClient, type GithubGetResult } from "./client.js";
import {
  collectionError,
  normalizeCheckRuns,
  normalizeCommits,
  normalizeCompare,
  normalizeIssues,
  normalizePullRequest,
  normalizeRepo,
  normalizeWorkflowRuns,
  unsupportedDivergence,
} from "./normalize.js";
import { confidenceFor, parseRepoFullName, provenance, snapshotId } from "./provenance.js";
import {
  ENGINEERING_SNAPSHOT_SCHEMA,
  type CollectConfig,
  type CollectResult,
  type CollectionError,
  type EngineeringSnapshot,
  type FreshnessStatus,
  type PullRequestObservation,
  type RepoSnapshot,
  type ResourceCollectionStatus,
} from "./types.js";

export async function collect(config: CollectConfig): Promise<CollectResult> {
  const now = config.now();
  const allowlist = config.repos;
  const client = new GithubReadClient({
    apiBase: config.apiBase,
    token: config.token,
    transport: config.transport,
    etagStore: config.etagStore,
    logger: config.logger,
    now: config.now,
    allowlist,
  });

  config.logger("collect_start", {
    allowlist,
    api_base: config.apiBase,
    repo_count: allowlist.length,
  });

  const snapshotErrors: CollectionError[] = [];
  const repos: RepoSnapshot[] = [];

  for (const fullName of allowlist) {
    const parsed = parseRepoFullName(fullName);
    if (!parsed) {
      snapshotErrors.push(
        collectionError({
          now,
          repo: fullName,
          resource: "allowlist",
          code: "invalid_config",
          message: "Allowlisted repo failed re-parse.",
          http_status: null,
        }),
      );
      continue;
    }
    const repoSnap = await collectRepo(client, config, parsed, now);
    repos.push(repoSnap);
    if (client.isStopped()) {
      const remaining = allowlist.slice(allowlist.indexOf(fullName) + 1);
      for (const skipped of remaining) {
        snapshotErrors.push(
          collectionError({
            now,
            repo: skipped,
            resource: "collect",
            code: "skipped_rate_limit",
            message: "Repo skipped after GitHub rate-limit stop.",
            http_status: null,
            freshness_status: "stale",
          }),
        );
      }
      break;
    }
  }

  const snapshot = buildSnapshot(allowlist, repos, snapshotErrors, now);
  config.logger("collect_end", {
    snapshot_id: snapshot.snapshot_id,
    freshness_status: snapshot.freshness_status,
    repo_count: snapshot.repos.length,
    error_count: snapshot.errors.length + snapshot.repos.reduce((n, r) => n + r.errors.length, 0),
  });
  return attachObservations(snapshot);
}

async function collectRepo(
  client: GithubReadClient,
  config: CollectConfig,
  repo: { owner: string; name: string; full_name: string },
  now: Date,
): Promise<RepoSnapshot> {
  const errors: CollectionError[] = [];
  const prefix = `/repos/${repo.owner}/${repo.name}`;

  const repoResult = await client.get(prefix);
  const repoFreshness = freshnessOf(repoResult);
  const repoIdentity = repoResult.kind === "ok" ? normalizeRepo(repoResult.data, now, repoFreshness) : null;

  if (repoResult.kind === "error" || !repoIdentity) {
    const err = toError(repoResult, now, repo.full_name, "repo");
    errors.push(err);
    return {
      repo: null,
      repo_collection: { ok: false, freshness_status: "failed", error_observation_id: err.observation_id },
      issues_collection: {
        ok: false,
        freshness_status: "failed",
        error_observation_id: err.observation_id,
      },
      recent_commits: [],
      open_issues: [],
      open_pull_requests: [],
      check_failures: [],
      workflow_failures: [],
      divergence: unsupportedDivergence(
        repo.full_name,
        null,
        null,
        now,
        "repo_unavailable",
        "unavailable",
      ),
      errors,
    };
  }

  const getCache = new Map<string, Promise<GithubGetResult | null>>();
  const get = (path: string, query?: Record<string, string>): Promise<GithubGetResult | null> => {
    const key = query ? `${path}?${new URLSearchParams(query).toString()}` : path;
    const existing = getCache.get(key);
    if (existing) {
      return existing;
    }
    const pending = maybeGet(client, path, query);
    getCache.set(key, pending);
    return pending;
  };

  const defaultBranch = repoIdentity.default_branch;
  const commitsResult = await get(
    `${prefix}/commits`,
    { sha: defaultBranch, per_page: String(config.recentCommitLimit) },
  );
  const recent_commits =
    commitsResult?.kind === "ok"
      ? normalizeCommits(commitsResult.data, repo.full_name, now, freshnessOf(commitsResult))
      : [];
  if (commitsResult?.kind === "error") {
    errors.push(toError(commitsResult, now, repo.full_name, "commits"));
  } else if (commitsResult === null) {
    errors.push(skippedRateLimit(now, repo.full_name, "commits"));
  }

  const issuesResult = await get(`${prefix}/issues`, {
    state: "open",
    per_page: "100",
  });
  let issues_collection: RepoSnapshot["issues_collection"];
  let open_issues: RepoSnapshot["open_issues"] = [];
  if (issuesResult === null) {
    const err = skippedRateLimit(now, repo.full_name, "issues");
    errors.push(err);
    issues_collection = {
      ok: false,
      freshness_status: "stale",
      error_observation_id: err.observation_id,
    };
  } else if (issuesResult.kind === "error") {
    const err = toError(issuesResult, now, repo.full_name, "issues");
    errors.push(err);
    issues_collection = {
      ok: false,
      freshness_status: "failed",
      error_observation_id: err.observation_id,
    };
  } else {
    open_issues = normalizeIssues(
      issuesResult.data,
      repo.full_name,
      now,
      freshnessOf(issuesResult),
    );
    issues_collection = {
      ok: true,
      freshness_status: freshnessOf(issuesResult) === "not_modified" ? "not_modified" : "fresh",
    };
  }

  const pullsResult = await get(`${prefix}/pulls`, {
    state: "open",
    per_page: "100",
  });
  const open_pull_requests: PullRequestObservation[] = [];
  if (pullsResult?.kind === "error") {
    errors.push(toError(pullsResult, now, repo.full_name, "pulls"));
  } else if (pullsResult === null) {
    errors.push(skippedRateLimit(now, repo.full_name, "pulls"));
  } else {
    const pullItems = Array.isArray(pullsResult.data) ? pullsResult.data : [];
    for (const pull of pullItems) {
      const rec = pull as { number?: unknown; head?: { sha?: unknown; ref?: unknown }; base?: { ref?: unknown } };
      const number = typeof rec.number === "number" ? rec.number : null;
      const headSha = typeof rec.head?.sha === "string" ? rec.head.sha : null;
      const reviewsResult =
        number === null ? null : await get(`${prefix}/pulls/${number}/reviews`);
      const checksResult =
        headSha === null
          ? null
          : await get(`${prefix}/commits/${headSha}/check-runs`, {
              per_page: "50",
            });
      const statusResult =
        headSha === null ? null : await get(`${prefix}/commits/${headSha}/status`);
      if (reviewsResult?.kind === "error") {
        errors.push(toError(reviewsResult, now, repo.full_name, `pulls/${number}/reviews`));
      }
      if (checksResult?.kind === "error") {
        errors.push(toError(checksResult, now, repo.full_name, `commits/${headSha}/check-runs`));
      }
      if (statusResult?.kind === "error") {
        errors.push(toError(statusResult, now, repo.full_name, `commits/${headSha}/status`));
      }
      const normalized = normalizePullRequest(
        {
          pull,
          reviews: reviewsResult?.kind === "ok" ? reviewsResult.data : [],
          combinedStatus: statusResult?.kind === "ok" ? statusResult.data : null,
          checkRuns: checksResult?.kind === "ok" ? checksResult.data : null,
        },
        repo.full_name,
        now,
        freshnessOf(pullsResult),
      );
      if (normalized) {
        open_pull_requests.push(normalized);
      }
    }
  }

  const headShas = new Set<string>();
  if (recent_commits[0]?.sha) {
    headShas.add(recent_commits[0].sha);
  }
  for (const pull of open_pull_requests) {
    if (pull.head_sha) {
      headShas.add(pull.head_sha);
    }
  }

  const check_failures = [];
  const seenChecks = new Set<string>();
  for (const sha of headShas) {
    const checksResult = await get(`${prefix}/commits/${sha}/check-runs`, {
      per_page: "50",
    });
    if (checksResult?.kind === "error") {
      errors.push(toError(checksResult, now, repo.full_name, `commits/${sha}/check-runs`));
      continue;
    }
    if (checksResult === null) {
      errors.push(skippedRateLimit(now, repo.full_name, `commits/${sha}/check-runs`));
      continue;
    }
    for (const failure of normalizeCheckRuns(
      checksResult.data,
      repo.full_name,
      now,
      freshnessOf(checksResult),
    )) {
      if (!seenChecks.has(failure.observation_id)) {
        seenChecks.add(failure.observation_id);
        check_failures.push(failure);
      }
    }
  }

  const workflowsResult = await get(`${prefix}/actions/runs`, {
    status: "completed",
    per_page: "30",
  });
  const workflow_failures =
    workflowsResult?.kind === "ok"
      ? normalizeWorkflowRuns(
          workflowsResult.data,
          repo.full_name,
          now,
          freshnessOf(workflowsResult),
        )
      : [];
  if (workflowsResult?.kind === "error") {
    errors.push(toError(workflowsResult, now, repo.full_name, "actions/runs"));
  } else if (workflowsResult === null) {
    errors.push(skippedRateLimit(now, repo.full_name, "actions/runs"));
  }

  const compareTarget = resolveCompareTarget(config, repo.full_name, defaultBranch, open_pull_requests);
  let divergence = unsupportedDivergence(
    repo.full_name,
    compareTarget?.base ?? defaultBranch,
    compareTarget?.head ?? null,
    now,
    compareTarget ? "compare_not_attempted" : "no_relevant_compare_ref",
  );
  if (compareTarget) {
    const compareResult = await get(
      comparePath(repo.owner, repo.name, compareTarget.base, compareTarget.head),
    );
    if (compareResult === null) {
      errors.push(skippedRateLimit(now, repo.full_name, "compare"));
      divergence = unsupportedDivergence(
        repo.full_name,
        compareTarget.base,
        compareTarget.head,
        now,
        "rate_limited",
        "unavailable",
      );
    } else if (compareResult.kind === "error" && compareResult.status === 404) {
      divergence = unsupportedDivergence(
        repo.full_name,
        compareTarget.base,
        compareTarget.head,
        now,
        "compare_not_found",
        "unsupported",
      );
    } else if (compareResult.kind === "error") {
      errors.push(toError(compareResult, now, repo.full_name, "compare"));
      divergence = unsupportedDivergence(
        repo.full_name,
        compareTarget.base,
        compareTarget.head,
        now,
        compareResult.code,
        "unavailable",
      );
    } else {
      divergence = normalizeCompare(
        compareResult.data,
        repo.full_name,
        compareTarget.base,
        compareTarget.head,
        now,
        freshnessOf(compareResult),
      );
    }
  }

  const repo_collection: ResourceCollectionStatus = {
    ok: true,
    freshness_status: repoFreshness === "not_modified" ? "not_modified" : "fresh",
  };

  return {
    repo: repoIdentity,
    repo_collection,
    issues_collection,
    recent_commits,
    open_issues,
    open_pull_requests,
    check_failures,
    workflow_failures,
    divergence,
    errors,
  };
}

async function maybeGet(
  client: GithubReadClient,
  path: string,
  query?: Record<string, string>,
): Promise<GithubGetResult | null> {
  if (client.isStopped()) {
    return null;
  }
  return client.get(path, query);
}

function freshnessOf(result: GithubGetResult): FreshnessStatus {
  if (result.kind === "ok") {
    return result.freshness_status;
  }
  if (result.code === "rate_limit" || result.code === "skipped_rate_limit") {
    return "stale";
  }
  return "failed";
}

function toError(
  result: GithubGetResult,
  now: Date,
  repo: string,
  resource: string,
): CollectionError {
  if (result.kind === "ok") {
    return collectionError({
      now,
      repo,
      resource,
      code: "http_error",
      message: "Unexpected ok result mapped to error.",
      http_status: result.status,
    });
  }
  return collectionError({
    now,
    repo,
    resource,
    code: result.code,
    message: result.message,
    http_status: result.status === 0 ? null : result.status,
    freshness_status: result.rateLimit.rateLimited ? "stale" : "failed",
  });
}

function skippedRateLimit(now: Date, repo: string, resource: string): CollectionError {
  return collectionError({
    now,
    repo,
    resource,
    code: "skipped_rate_limit",
    message: "Resource skipped after GitHub rate-limit stop.",
    http_status: null,
    freshness_status: "stale",
  });
}

function resolveCompareTarget(
  config: CollectConfig,
  fullName: string,
  defaultBranch: string,
  pulls: PullRequestObservation[],
): { base: string; head: string } | null {
  const configured = config.compareHeads?.[fullName] ?? config.compareHeads?.[fullName.toLowerCase()];
  if (configured) {
    return { base: configured.base ?? defaultBranch, head: configured.head };
  }
  const first = [...pulls].sort((a, b) => a.number - b.number)[0];
  if (first?.head_ref) {
    return { base: first.base_ref ?? defaultBranch, head: first.head_ref };
  }
  return null;
}

function buildSnapshot(
  allowlist: string[],
  repos: RepoSnapshot[],
  snapshotErrors: CollectionError[],
  now: Date,
): EngineeringSnapshot {
  const allErrors = [
    ...snapshotErrors,
    ...repos.flatMap((repo) => repo.errors),
  ];
  const hasFailed = allErrors.some((error) => error.freshness_status === "failed");
  const hasStale = allErrors.some((error) => error.freshness_status === "stale");
  const freshness: FreshnessStatus = hasFailed ? "failed" : hasStale ? "stale" : "fresh";
  const observed = provenance(now, freshness, confidenceFor(freshness));
  return {
    schema: ENGINEERING_SNAPSHOT_SCHEMA,
    snapshot_id: snapshotId(allowlist),
    collected_at: observed.observed_at,
    allowlist,
    repos,
    errors: snapshotErrors,
    ...observed,
  };
}

export function failedCollect(input: {
  now: Date;
  allowlist: string[];
  code: CollectionError["code"];
  message: string;
}): CollectResult {
  const error = collectionError({
    now: input.now,
    repo: null,
    resource: "auth",
    code: input.code,
    message: input.message,
    http_status: null,
  });
  const observed = provenance(input.now, "failed", 0);
  const snapshot: EngineeringSnapshot = {
    schema: ENGINEERING_SNAPSHOT_SCHEMA,
    snapshot_id: snapshotId(input.allowlist),
    collected_at: observed.observed_at,
    allowlist: input.allowlist,
    repos: [],
    errors: [error],
    ...observed,
  };
  return attachObservations(snapshot);
}
