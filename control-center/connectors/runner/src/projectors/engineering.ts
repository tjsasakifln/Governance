import { availabilityFromEnvelope, freshnessForAvailability } from "./availability.ts";
import {
  CONFENGE_OPERATIONAL_REPOS,
  PROJECTOR_VERSION,
  asArray,
  asRecord,
  capList,
  type CollectorEnvelope,
  type ProjectedSnapshot,
} from "./types.ts";

function repoFullName(row: Record<string, unknown>): string | undefined {
  const repo = asRecord(row.repo) ?? row;
  if (typeof repo.full_name === "string") return repo.full_name;
  if (typeof row.repo === "string") return row.repo;
  const owner = typeof repo.owner === "string" ? repo.owner : undefined;
  const name = typeof repo.name === "string" ? repo.name : undefined;
  if (owner && name) return `${owner}/${name}`;
  return undefined;
}

export function projectEngineering(envelope: CollectorEnvelope): ProjectedSnapshot[] {
  const availability = availabilityFromEnvelope(envelope);
  const freshness = freshnessForAvailability(availability, envelope.freshness_status);
  const payload = asRecord(envelope.payload) ?? {};
  const snapshot = asRecord(payload.snapshot) ?? payload;
  const repos = asArray(snapshot.repos);
  const allowlist = Array.isArray(snapshot.allowlist)
    ? snapshot.allowlist.map(String)
    : [...CONFENGE_OPERATIONAL_REPOS];

  const repoViews = repos.map((item) => {
    const row = asRecord(item) ?? {};
    const identity = asRecord(row.repo) ?? {};
    const fullName = repoFullName(row) ?? "unknown";
    const prs = asArray(row.open_pull_requests);
    const failures = [...asArray(row.check_failures), ...asArray(row.workflow_failures)];
    const openPrs = prs.map((pr) => asRecord(pr) ?? {});
    const failing = failures.length;
    const draft = openPrs.filter((pr) => pr.draft === true).length;
    const ready = openPrs.filter((pr) => pr.draft !== true).length;
    const sha = typeof identity.sha === "string" ? identity.sha : typeof identity.default_branch === "string" ? identity.default_branch : null;
    return {
      repository: fullName,
      default_branch: identity.default_branch ?? "main",
      main_sha: sha,
      open_pr_count: openPrs.length,
      draft_pr_count: draft,
      ready_pr_count: ready,
      failing_check_count: failing,
      ci: { status: failing > 0 ? "failing" : openPrs.length > 0 ? "pending_or_unknown" : "unknown" },
      open_incident_count: 0,
      pull_requests: capList(
        openPrs.map((pr) => ({
          number: pr.number,
          title: pr.title,
          draft: pr.draft === true,
          html_url: pr.html_url,
          review_status: pr.review_status,
          check_status: pr.check_status,
          age_seconds: pr.age_seconds,
        })),
      ),
      failing_checks: capList(
        failures.map((fail) => {
          const rec = asRecord(fail) ?? {};
          return { name: rec.name, conclusion: rec.conclusion, html_url: rec.html_url, repo: rec.repo };
        }),
      ),
      last_activity_at: identity.last_activity_at ?? identity.pushed_at ?? identity.updated_at ?? null,
    };
  });

  const company: Record<string, unknown> = {
    schema_version: "control-center.engineering-snapshot.v1",
    projector_version: PROJECTOR_VERSION,
    availability,
    allowlist,
    recommended_allowlist: [...CONFENGE_OPERATIONAL_REPOS],
    repo_scopes: repoViews.map((row) => `repo:${row.repository}`),
    open_pr_count: repoViews.reduce((sum, row) => sum + row.open_pr_count, 0),
    failing_check_count: repoViews.reduce((sum, row) => sum + row.failing_check_count, 0),
    open_incident_count: 0,
    repos: repoViews,
    evidence_vs_hypothesis: "GitHub collector observations are evidence. Active work without checks remains hypothesis.",
  };

  const out: ProjectedSnapshot[] = [
    {
      projector_version: PROJECTOR_VERSION,
      snapshot_kind: "engineering",
      scope: "company",
      payload: company,
      freshness_status: freshness,
      availability,
      confidence: envelope.confidence,
      observed_at: envelope.observed_at,
      source: envelope.source,
    },
  ];

  for (const repo of repoViews) {
    out.push({
      projector_version: PROJECTOR_VERSION,
      snapshot_kind: "engineering",
      scope: `repo:${repo.repository}`,
      payload: {
        schema_version: "control-center.engineering-snapshot.v1",
        projector_version: PROJECTOR_VERSION,
        availability,
        repository: repo.repository,
        default_branch: repo.default_branch,
        open_pr_count: repo.open_pr_count,
        failing_check_count: repo.failing_check_count,
        open_incident_count: 0,
        ci: repo.ci,
        repos: [repo],
      },
      freshness_status: freshness,
      availability,
      confidence: envelope.confidence,
      observed_at: envelope.observed_at,
      source: { ...envelope.source, locator: repo.repository, label: repo.repository },
    });
  }

  return out;
}
