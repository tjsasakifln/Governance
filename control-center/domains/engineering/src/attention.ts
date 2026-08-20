import type { AttentionCandidate, AttentionSeverity, BlockerKind } from "./types.js";

const SEVERITY_RANK: Record<AttentionSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const REASON_RANK: Record<BlockerKind, number> = {
  p0_issue: 0,
  ci_red: 1,
  p1_issue: 2,
  stale_pr: 3,
  unknown_quiet: 4,
};

export function rankAttentionCandidates(
  items: readonly AttentionCandidate[],
): AttentionCandidate[] {
  return [...items].sort((a, b) => {
    const severity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (severity !== 0) return severity;
    const reason = REASON_RANK[a.reason_code] - REASON_RANK[b.reason_code];
    if (reason !== 0) return reason;
    const repo = a.repo.localeCompare(b.repo);
    if (repo !== 0) return repo;
    return a.id.localeCompare(b.id);
  });
}

export function attentionHeadline(item: AttentionCandidate): string {
  if (item.claim_kind === "hypothesis") {
    return `${item.repo}: hypothesis — ${item.title}`;
  }
  return `${item.repo}: ${item.title}`;
}

export function listAttentionCandidates(
  items: readonly AttentionCandidate[],
  scope?: string,
): AttentionCandidate[] {
  const ranked = rankAttentionCandidates(items);
  if (!scope || scope === "company" || scope === "infrastructure") {
    return ranked;
  }
  const wanted = scope.startsWith("repo:") ? scope.slice("repo:".length) : scope;
  return ranked.filter(
    (item) => item.scope === scope || item.repo === wanted || item.repo.endsWith(`/${wanted}`),
  );
}
