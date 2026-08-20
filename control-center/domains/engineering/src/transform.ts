import { parseCollectorSnapshot } from "./adapter.js";
import { attentionHeadline, rankAttentionCandidates } from "./attention.js";
import { ageSeconds, maxTimestamp, parseUtc, toUtcIso } from "./clock.js";
import {
  ATTENTION_ITEM_SCHEMA,
  CANONICAL_ENGINEERING_SNAPSHOT_SCHEMA,
  COMPANY_EXECUTIVE_SCHEMA,
  HYPOTHESIS_ACTIVE_WORK_WITHOUT_EVIDENCE,
  HYPOTHESIS_CODE,
  REPO_EXECUTIVE_SCHEMA,
  SOURCE_SYSTEM_GITHUB,
  SYSTEM_ACTOR_ID,
  TITLE_MAX,
} from "./constants.js";
import {
  attentionId,
  companyExecutiveId,
  isCompanyScope,
  parseRepoScope,
  repoExecutiveId,
  repoScope,
} from "./ids.js";
import { resolvePolicy } from "./policy.js";
import { buildProvenance, githubSource, isUsableFreshness } from "./provenance.js";
import type {
  Aging,
  AttentionCandidate,
  Blocker,
  BrokenCheckRef,
  CanonicalEngineeringSnapshot,
  CollectorCheckFailure,
  CollectorEngineeringSnapshot,
  CollectorIssue,
  CollectorPullRequest,
  CollectorRepoSnapshot,
  CompanyAggregates,
  CompanyEngineeringReadModel,
  LastActivity,
  LinkRef,
  OpenPrRef,
  PriorityIssueRef,
  Provenance,
  RepoAttentionSummary,
  RepoExecutiveView,
  RepoIdentityView,
  ScopedRead,
  StructuredClaim,
  TransformOptions,
} from "./types.js";

function clip(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, Math.max(0, max - 1))}…`;
}

function safeUrl(url: string | null | undefined, fallback: string): string {
  if (!url) return fallback;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return fallback;
    }
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return fallback;
  }
}

function splitFullName(fullName: string): { owner: string; name: string; full_name: string } {
  const match = /^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/.exec(fullName.trim());
  if (match?.[1] && match[2]) {
    return { owner: match[1], name: match[2], full_name: `${match[1]}/${match[2]}` };
  }
  return { owner: "unknown", name: fullName.trim(), full_name: fullName.trim() };
}

function githubRepoUrl(fullName: string): string {
  return `https://github.com/${fullName}`;
}

function resolveRepoIdentity(
  repoSnap: CollectorRepoSnapshot,
  snapshot: CollectorEngineeringSnapshot,
  index: number,
): RepoIdentityView {
  if (repoSnap.repo) {
    return {
      owner: repoSnap.repo.owner,
      name: repoSnap.repo.name,
      full_name: repoSnap.repo.full_name,
      html_url: safeUrl(repoSnap.repo.html_url, githubRepoUrl(repoSnap.repo.full_name)),
      default_branch: repoSnap.repo.default_branch,
    };
  }
  const fromError = repoSnap.errors.find((err) => err.repo)?.repo;
  const fromAllow = snapshot.allowlist[index];
  const fullName = fromError ?? fromAllow ?? "unknown/unknown";
  const parts = splitFullName(fullName);
  return {
    owner: parts.owner,
    name: parts.name,
    full_name: parts.full_name,
    html_url: githubRepoUrl(parts.full_name),
    default_branch: null,
  };
}

function repoCollectorFreshness(repoSnap: CollectorRepoSnapshot): {
  usable: boolean;
  freshness: import("./types.js").CollectorFreshness;
  observedAt: string;
  confidence: number | undefined;
} {
  if (!repoSnap.repo || repoSnap.repo_collection.ok === false) {
    const err = repoSnap.errors[0];
    const collection = repoSnap.repo_collection;
    const freshness =
      collection.ok === false
        ? collection.freshness_status
        : (err?.freshness_status ?? "failed");
    return {
      usable: false,
      freshness,
      observedAt: repoSnap.repo?.observed_at ?? err?.observed_at ?? "",
      confidence: repoSnap.repo?.confidence ?? err?.confidence,
    };
  }
  const mapped = buildProvenance({
    source: githubSource("repo", repoSnap.repo.full_name),
    observedAt: repoSnap.repo.observed_at,
    collectorFreshness: repoSnap.repo.freshness_status,
    collectorConfidence: repoSnap.repo.confidence,
    now: parseUtc(repoSnap.repo.observed_at),
    freshnessWindowSeconds: Number.MAX_SAFE_INTEGER,
  }).freshness_status;
  return {
    usable: isUsableFreshness(mapped),
    freshness: repoSnap.repo.freshness_status,
    observedAt: repoSnap.repo.observed_at,
    confidence: repoSnap.repo.confidence,
  };
}

function itemProvenance(
  item: {
    source: string;
    observed_at: string;
    freshness_status: import("./types.js").CollectorFreshness;
    confidence?: number;
  },
  source: Provenance["source"],
  now: Date,
  freshnessWindowSeconds: number,
): Provenance {
  return buildProvenance({
    source,
    observedAt: item.observed_at,
    collectorFreshness: item.freshness_status,
    collectorConfidence: item.confidence,
    now,
    freshnessWindowSeconds,
  });
}

function linkRef(
  kind: string,
  locator: string,
  htmlUrl: string,
  label: string,
): LinkRef {
  return {
    system: SOURCE_SYSTEM_GITHUB,
    kind,
    locator: locator.slice(0, 512),
    html_url: htmlUrl,
    label: clip(label, 128),
  };
}

function classifyIssuePriority(issue: CollectorIssue): "P0" | "P1" | null {
  const token = (issue.priority ?? "").trim().toLowerCase();
  if (token === "p0" || token === "critical" || token === "urgent") {
    return "P0";
  }
  if (token === "p1" || token === "high") {
    return "P1";
  }
  for (const label of issue.labels) {
    const name = label.trim().toLowerCase();
    if (
      name === "p0" ||
      name === "priority:p0" ||
      name === "priority-p0" ||
      name === "critical" ||
      name === "urgent"
    ) {
      return "P0";
    }
    if (name === "p1" || name === "priority:p1" || name === "priority-p1" || name === "high") {
      return "P1";
    }
  }
  return null;
}

function isFailingCheckStatus(status: string): boolean {
  const normalized = status.trim().toLowerCase();
  return (
    normalized === "failure" ||
    normalized === "error" ||
    normalized === "cancelled" ||
    normalized === "timed_out" ||
    normalized === "action_required"
  );
}

function daysLabel(age: number): string {
  const days = Math.floor(age / 86400);
  if (days <= 0) {
    const hours = Math.max(1, Math.floor(age / 3600));
    return `${hours}h`;
  }
  return `${days}d`;
}

function lastActivityOf(
  repoSnap: CollectorRepoSnapshot,
  now: Date,
): LastActivity | null {
  const candidates: Array<{ at: string; source_kind: LastActivity["source_kind"] }> = [];
  const identity = repoSnap.repo;
  if (identity?.last_activity_at) {
    candidates.push({ at: identity.last_activity_at, source_kind: "repo" });
  }
  if (identity?.pushed_at) {
    candidates.push({ at: identity.pushed_at, source_kind: "repo" });
  }
  for (const commit of repoSnap.recent_commits) {
    if (commit.committed_at) {
      candidates.push({ at: commit.committed_at, source_kind: "commit" });
    }
  }
  for (const pr of repoSnap.open_pull_requests) {
    candidates.push({ at: pr.updated_at ?? pr.created_at, source_kind: "pull_request" });
  }
  for (const issue of repoSnap.open_issues) {
    const at = issue.updated_at ?? issue.created_at;
    if (at) {
      candidates.push({ at, source_kind: "issue" });
    }
  }
  const latest = maxTimestamp(candidates.map((item) => item.at));
  if (!latest) {
    return null;
  }
  const source = candidates.find((item) => {
    const iso = new Date(item.at).toISOString();
    return iso === latest || item.at === latest;
  });
  const age = ageSeconds(latest, now);
  if (age === null) {
    return null;
  }
  return {
    at: latest,
    age_seconds: age,
    source_kind: source?.source_kind ?? "repo",
  };
}

function blockerToAttention(
  blocker: Blocker,
  repoFullName: string,
  extra: string,
  detectedAt: string,
): AttentionCandidate {
  const severity =
    blocker.kind === "p0_issue"
      ? "critical"
      : blocker.kind === "ci_red" || blocker.kind === "p1_issue"
        ? "high"
        : "medium";
  const recommended =
    blocker.kind === "stale_pr"
      ? "Review or close the stale pull request."
      : blocker.kind === "ci_red"
        ? "Inspect the failing check and restore a green pipeline."
        : blocker.kind === "p0_issue"
          ? "Triage the P0 issue now."
          : blocker.kind === "p1_issue"
            ? "Triage the P1 issue today."
            : "Restore GitHub collector visibility for this repository; do not treat silence as a fact.";
  return {
    schema_version: ATTENTION_ITEM_SCHEMA,
    id: attentionId(blocker.kind, repoFullName, extra),
    scope: repoScope(repoFullName),
    repo: repoFullName,
    severity,
    status: "open",
    title: clip(blocker.title, TITLE_MAX),
    summary: clip(blocker.reason, 2000),
    reason_code: blocker.kind,
    claim_kind: blocker.claim_kind,
    reference: blocker.reference,
    provenance: blocker.provenance,
    detected_at: detectedAt,
    homepage_eligible: true,
    recommended_action: recommended,
  };
}

function unknownRepoView(input: {
  identity: RepoIdentityView;
  snapshot: CollectorEngineeringSnapshot;
  repoSnap: CollectorRepoSnapshot;
  now: Date;
  generatedAt: string;
  freshnessWindowSeconds: number;
  collectorFreshness: import("./types.js").CollectorFreshness;
  observedAt: string;
  confidence: number | undefined;
}): RepoExecutiveView {
  const observedAt = input.observedAt || input.snapshot.observed_at;
  const provenance = buildProvenance({
    source: githubSource("repo", input.identity.full_name, input.identity.full_name),
    observedAt,
    collectorFreshness: input.collectorFreshness,
    collectorConfidence: input.confidence,
    now: input.now,
    freshnessWindowSeconds: input.freshnessWindowSeconds,
  });
  const reference = linkRef(
    "repo",
    input.identity.full_name,
    input.identity.html_url,
    input.identity.full_name,
  );
  const title = HYPOTHESIS_ACTIVE_WORK_WITHOUT_EVIDENCE;
  const reason = `Collector observation for ${input.identity.full_name} is unusable (${provenance.freshness_status}). ${HYPOTHESIS_ACTIVE_WORK_WITHOUT_EVIDENCE} — hypothesis only, not a fact.`;
  const blocker: Blocker = {
    kind: "unknown_quiet",
    claim_kind: "hypothesis",
    title,
    reason,
    reference,
    provenance,
  };
  const claim: StructuredClaim = {
    kind: "hypothesis",
    code: HYPOTHESIS_CODE,
    title,
    body: reason,
    scope: repoScope(input.identity.full_name),
    status: "active",
    effective_from: input.generatedAt,
    expires_at: null,
    supersedes: null,
    created_by: { kind: "system", id: SYSTEM_ACTOR_ID },
  };
  const aging: Aging = {
    last_activity_age_seconds: null,
    oldest_open_pr_age_seconds: null,
    stale_pr_count: 0,
    oldest_p0_p1_age_seconds: null,
  };
  const attention = [
    blockerToAttention(blocker, input.identity.full_name, "repo", input.generatedAt),
  ];
  return {
    schema_version: REPO_EXECUTIVE_SCHEMA,
    id: repoExecutiveId(input.identity.full_name),
    scope: repoScope(input.identity.full_name),
    generated_at: input.generatedAt,
    provenance,
    repo: input.identity,
    health: "unknown",
    blockers: [blocker],
    open_prs: [],
    broken_checks: [],
    p0_p1_issues: [],
    last_activity: null,
    aging,
    claims: [claim],
    attention,
  };
}

function mapOpenPr(
  pr: CollectorPullRequest,
  now: Date,
  staleAfter: number,
  freshnessWindowSeconds: number,
): OpenPrRef {
  const age = pr.age_seconds >= 0 ? pr.age_seconds : (ageSeconds(pr.created_at, now) ?? 0);
  const htmlUrl = safeUrl(pr.html_url, githubRepoUrl(pr.repo) + `/pull/${pr.number}`);
  return {
    number: pr.number,
    title: clip(pr.title, TITLE_MAX),
    html_url: htmlUrl,
    draft: pr.draft,
    created_at: pr.created_at,
    updated_at: pr.updated_at,
    age_seconds: age,
    stale: age >= staleAfter,
    review_status: pr.review_status,
    check_status: pr.check_status,
    head_ref: pr.head_ref,
    base_ref: pr.base_ref,
    provenance: itemProvenance(
      pr,
      githubSource("pull_request", `${pr.repo}/pull/${pr.number}`, `#${pr.number}`),
      now,
      freshnessWindowSeconds,
    ),
  };
}

function mapCheck(
  check: CollectorCheckFailure,
  now: Date,
  freshnessWindowSeconds: number,
): BrokenCheckRef {
  const fallback = `${githubRepoUrl(check.repo)}/actions`;
  return {
    name: clip(check.name, TITLE_MAX),
    kind: check.kind,
    conclusion: check.conclusion,
    html_url: safeUrl(check.html_url, fallback),
    remote_id: check.remote_id,
    head_sha: check.head_sha,
    provenance: itemProvenance(
      check,
      githubSource(check.kind, `${check.repo}/checks/${check.remote_id}`, check.name),
      now,
      freshnessWindowSeconds,
    ),
  };
}

function mapPriorityIssue(
  issue: CollectorIssue,
  priority: "P0" | "P1",
  now: Date,
  freshnessWindowSeconds: number,
): PriorityIssueRef {
  const htmlUrl = safeUrl(issue.html_url, `${githubRepoUrl(issue.repo)}/issues/${issue.number}`);
  return {
    number: issue.number,
    title: clip(issue.title, TITLE_MAX),
    html_url: htmlUrl,
    priority,
    labels: [...issue.labels],
    created_at: issue.created_at,
    updated_at: issue.updated_at,
    age_seconds: ageSeconds(issue.created_at, now),
    provenance: itemProvenance(
      issue,
      githubSource("issue", `${issue.repo}/issues/${issue.number}`, `#${issue.number}`),
      now,
      freshnessWindowSeconds,
    ),
  };
}

function buildUsableRepo(input: {
  identity: RepoIdentityView;
  repoSnap: CollectorRepoSnapshot;
  now: Date;
  generatedAt: string;
  staleAfter: number;
  freshnessWindowSeconds: number;
  collectorFreshness: import("./types.js").CollectorFreshness;
  observedAt: string;
  confidence: number | undefined;
}): RepoExecutiveView {
  const provenance = buildProvenance({
    source: githubSource("repo", input.identity.full_name, input.identity.full_name),
    observedAt: input.observedAt,
    collectorFreshness: input.collectorFreshness,
    collectorConfidence: input.confidence,
    now: input.now,
    freshnessWindowSeconds: input.freshnessWindowSeconds,
  });

  const openPrs = input.repoSnap.open_pull_requests
    .map((pr) => mapOpenPr(pr, input.now, input.staleAfter, input.freshnessWindowSeconds))
    .sort((a, b) => a.number - b.number);

  const fromFailures = [
    ...input.repoSnap.check_failures,
    ...input.repoSnap.workflow_failures,
  ].map((check) => mapCheck(check, input.now, input.freshnessWindowSeconds));

  const brokenByUrl = new Set(fromFailures.map((item) => item.html_url));
  const fromPrs: BrokenCheckRef[] = [];
  if (fromFailures.length === 0) {
    for (const pr of openPrs) {
      if (!isFailingCheckStatus(pr.check_status)) continue;
      if (brokenByUrl.has(pr.html_url)) continue;
      fromPrs.push({
        name: `pr-${pr.number}-checks`,
        kind: "pull_request_check",
        conclusion: pr.check_status,
        html_url: pr.html_url,
        remote_id: pr.number,
        head_sha: null,
        provenance: pr.provenance,
      });
    }
  }
  const brokenChecks = [...fromFailures, ...fromPrs].sort((a, b) => a.name.localeCompare(b.name));

  const p0p1 = input.repoSnap.open_issues
    .map((issue) => {
      const priority = classifyIssuePriority(issue);
      if (!priority) return null;
      return mapPriorityIssue(issue, priority, input.now, input.freshnessWindowSeconds);
    })
    .filter((item): item is PriorityIssueRef => item !== null)
    .sort((a, b) => a.number - b.number);

  const lastActivity = lastActivityOf(input.repoSnap, input.now);
  const stalePrs = openPrs.filter((pr) => pr.stale);
  const oldestPrAge =
    openPrs.length === 0
      ? null
      : Math.max(...openPrs.map((pr) => pr.age_seconds));
  const oldestIssueAgeValues = p0p1
    .map((issue) => issue.age_seconds)
    .filter((age): age is number => age !== null);
  const aging: Aging = {
    last_activity_age_seconds: lastActivity?.age_seconds ?? null,
    oldest_open_pr_age_seconds: oldestPrAge,
    stale_pr_count: stalePrs.length,
    oldest_p0_p1_age_seconds:
      oldestIssueAgeValues.length === 0 ? null : Math.max(...oldestIssueAgeValues),
  };

  const blockers: Blocker[] = [];
  const attention: AttentionCandidate[] = [];

  for (const check of brokenChecks) {
    const blocker: Blocker = {
      kind: "ci_red",
      claim_kind: "fact",
      title: `CI red: ${check.name}`,
      reason: `Broken check '${check.name}' on ${input.identity.full_name} (conclusion ${check.conclusion ?? "failure"}).`,
      reference: linkRef(
        check.kind,
        `${input.identity.full_name}/checks/${check.remote_id ?? check.name}`,
        check.html_url,
        check.name,
      ),
      provenance: check.provenance,
    };
    blockers.push(blocker);
    attention.push(
      blockerToAttention(
        blocker,
        input.identity.full_name,
        String(check.remote_id ?? check.name),
        input.generatedAt,
      ),
    );
  }

  for (const issue of p0p1) {
    const kind = issue.priority === "P0" ? "p0_issue" : "p1_issue";
    const blocker: Blocker = {
      kind,
      claim_kind: "fact",
      title: `${issue.priority} issue #${issue.number}`,
      reason: `${issue.priority} issue #${issue.number} on ${input.identity.full_name}: ${issue.title}`,
      reference: linkRef(
        "issue",
        `${input.identity.full_name}/issues/${issue.number}`,
        issue.html_url,
        `#${issue.number}`,
      ),
      provenance: issue.provenance,
    };
    blockers.push(blocker);
    attention.push(
      blockerToAttention(blocker, input.identity.full_name, String(issue.number), input.generatedAt),
    );
  }

  for (const pr of stalePrs) {
    const blocker: Blocker = {
      kind: "stale_pr",
      claim_kind: "fact",
      title: `Stale PR #${pr.number}`,
      reason: `Open PR #${pr.number} on ${input.identity.full_name} is stale (${daysLabel(pr.age_seconds)}).`,
      reference: linkRef(
        "pull_request",
        `${input.identity.full_name}/pull/${pr.number}`,
        pr.html_url,
        `#${pr.number}`,
      ),
      provenance: pr.provenance,
    };
    blockers.push(blocker);
    attention.push(
      blockerToAttention(blocker, input.identity.full_name, String(pr.number), input.generatedAt),
    );
  }

  const hasFactBlocker = blockers.some((item) => item.claim_kind === "fact");
  const health = hasFactBlocker ? "degraded" : "healthy";

  return {
    schema_version: REPO_EXECUTIVE_SCHEMA,
    id: repoExecutiveId(input.identity.full_name),
    scope: repoScope(input.identity.full_name),
    generated_at: input.generatedAt,
    provenance,
    repo: input.identity,
    health,
    blockers,
    open_prs: openPrs,
    broken_checks: brokenChecks,
    p0_p1_issues: p0p1,
    last_activity: lastActivity,
    aging,
    claims: [],
    attention: rankAttentionCandidates(attention),
  };
}

function buildRepoExecutive(
  repoSnap: CollectorRepoSnapshot,
  snapshot: CollectorEngineeringSnapshot,
  now: Date,
  policy: { prStaleAfterSeconds: number; freshnessWindowSeconds: number },
  generatedAt: string,
  index: number,
): RepoExecutiveView {
  const identity = resolveRepoIdentity(repoSnap, snapshot, index);
  const usability = repoCollectorFreshness(repoSnap);
  const observedAt = usability.observedAt || snapshot.observed_at;
  if (!usability.usable) {
    return unknownRepoView({
      identity,
      snapshot,
      repoSnap,
      now,
      generatedAt,
      freshnessWindowSeconds: policy.freshnessWindowSeconds,
      collectorFreshness: usability.freshness,
      observedAt,
      confidence: usability.confidence,
    });
  }
  return buildUsableRepo({
    identity,
    repoSnap,
    now,
    generatedAt,
    staleAfter: policy.prStaleAfterSeconds,
    freshnessWindowSeconds: policy.freshnessWindowSeconds,
    collectorFreshness: usability.freshness,
    observedAt,
    confidence: usability.confidence,
  });
}

function summarizeRepo(
  repo: RepoExecutiveView,
  claimKind: "fact" | "hypothesis",
): RepoAttentionSummary {
  const reasons = repo.blockers
    .filter((blocker) => blocker.claim_kind === claimKind)
    .map((blocker) => blocker.kind);
  return {
    full_name: repo.repo.full_name,
    scope: repo.scope,
    health: repo.health,
    reasons,
    claim_kind: claimKind,
  };
}

function aggregatesOf(repos: readonly RepoExecutiveView[]): CompanyAggregates {
  return {
    repo_count: repos.length,
    healthy_count: repos.filter((repo) => repo.health === "healthy").length,
    degraded_count: repos.filter((repo) => repo.health === "degraded").length,
    unknown_count: repos.filter((repo) => repo.health === "unknown").length,
    open_pr_count: repos.reduce((sum, repo) => sum + repo.open_prs.length, 0),
    stale_pr_count: repos.reduce((sum, repo) => sum + repo.aging.stale_pr_count, 0),
    failing_check_count: repos.reduce((sum, repo) => sum + repo.broken_checks.length, 0),
    p0_issue_count: repos.reduce(
      (sum, repo) => sum + repo.p0_p1_issues.filter((issue) => issue.priority === "P0").length,
      0,
    ),
    p1_issue_count: repos.reduce(
      (sum, repo) => sum + repo.p0_p1_issues.filter((issue) => issue.priority === "P1").length,
      0,
    ),
    fact_blocked_repo_count: repos.filter((repo) =>
      repo.blockers.some((blocker) => blocker.claim_kind === "fact"),
    ).length,
    hypothesis_repo_count: repos.filter((repo) =>
      repo.blockers.some((blocker) => blocker.claim_kind === "hypothesis"),
    ).length,
  };
}

function canonicalOf(
  repos: readonly RepoExecutiveView[],
  attention: readonly AttentionCandidate[],
  generatedAt: string,
  provenance: Provenance,
  aggregates: CompanyAggregates,
): CanonicalEngineeringSnapshot {
  return {
    schema_version: CANONICAL_ENGINEERING_SNAPSHOT_SCHEMA,
    id: companyExecutiveId(),
    scope: "company",
    generated_at: generatedAt,
    provenance,
    open_pr_count: aggregates.open_pr_count,
    failing_check_count: aggregates.failing_check_count,
    open_incident_count:
      aggregates.failing_check_count +
      aggregates.p0_issue_count +
      aggregates.p1_issue_count +
      aggregates.stale_pr_count,
    repo_scopes: repos.map((repo) => repo.scope).slice(0, 64),
    attention_item_ids: attention.map((item) => item.id).slice(0, 32),
  };
}

export function buildCompanyEngineeringReadModel(
  input: unknown,
  options?: TransformOptions,
): CompanyEngineeringReadModel {
  const snapshot = parseCollectorSnapshot(input);
  const policy = resolvePolicy(options?.policy);
  const now = options?.now ?? parseUtc(snapshot.observed_at);
  const generatedAt = toUtcIso(now);

  const repos = snapshot.repos
    .map((repoSnap, index) =>
      buildRepoExecutive(repoSnap, snapshot, now, policy, generatedAt, index),
    )
    .sort((a, b) => a.repo.full_name.localeCompare(b.repo.full_name));

  const attention = rankAttentionCandidates(repos.flatMap((repo) => repo.attention));
  const agg = aggregatesOf(repos);
  const companyProvenance = buildProvenance({
    source: githubSource("engineering_snapshot", snapshot.snapshot_id, "github-collector"),
    observedAt: snapshot.observed_at,
    collectorFreshness: snapshot.freshness_status,
    collectorConfidence: snapshot.confidence,
    now,
    freshnessWindowSeconds: policy.freshnessWindowSeconds,
  });

  const blocked = repos
    .filter((repo) => repo.blockers.some((blocker) => blocker.claim_kind === "fact"))
    .map((repo) => summarizeRepo(repo, "fact"));
  const hypotheses = repos
    .filter((repo) => repo.blockers.some((blocker) => blocker.claim_kind === "hypothesis"))
    .map((repo) => summarizeRepo(repo, "hypothesis"));

  return {
    schema_version: COMPANY_EXECUTIVE_SCHEMA,
    id: companyExecutiveId(),
    scope: "company",
    generated_at: generatedAt,
    provenance: companyProvenance,
    repos,
    aggregates: agg,
    blocked_repos: blocked,
    hypothesis_repos: hypotheses,
    attention,
    attention_headlines: attention.map(attentionHeadline),
    canonical: canonicalOf(repos, attention, generatedAt, companyProvenance, agg),
  };
}

export function readByScope(
  model: CompanyEngineeringReadModel,
  scope: string,
): ScopedRead {
  if (isCompanyScope(scope)) {
    return { kind: "company", value: model };
  }
  const wanted = parseRepoScope(scope) ?? scope.replace(/^repo:/, "").trim();
  const exact = model.repos.filter(
    (repo) => repo.scope === scope || repo.repo.full_name === wanted,
  );
  if (exact.length === 1 && exact[0]) {
    return { kind: "repo", value: exact[0] };
  }
  const short = model.repos.filter((repo) => repo.repo.name === wanted);
  if (short.length === 1 && short[0]) {
    return { kind: "repo", value: short[0] };
  }
  return { kind: "empty", scope };
}
