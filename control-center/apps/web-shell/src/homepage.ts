import type { AttentionItem, AttentionSeverity, PriorityRecommendation } from "./types";

/** Homepage consumes ranks 1–3. Duplicated from contracts v1; do not import the other workstream. */
export const HOMEPAGE_PRIORITY_LIMIT = 3;

const SEVERITY_RANK: Record<AttentionSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const HOMEPAGE_STATUSES = new Set(["open", "acknowledged"]);

export function selectHomepageAttention(items: readonly AttentionItem[]): AttentionItem[] {
  return items
    .filter((item) => item.homepage_eligible && HOMEPAGE_STATUSES.has(item.status))
    .slice()
    .sort((a, b) => {
      const severity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
      if (severity !== 0) return severity;
      if (a.detected_at === b.detected_at) return a.id.localeCompare(b.id);
      return a.detected_at < b.detected_at ? 1 : -1;
    });
}

export function selectHomepagePriorities(
  recommendations: readonly PriorityRecommendation[],
): PriorityRecommendation[] {
  return recommendations
    .filter((item) => item.rank >= 1 && item.rank <= HOMEPAGE_PRIORITY_LIMIT)
    .slice()
    .sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id))
    .slice(0, HOMEPAGE_PRIORITY_LIMIT);
}

export interface HojeModel {
  attention: AttentionItem[];
  priorities: PriorityRecommendation[];
}

/**
 * Hoje is an attention cockpit: exceptions first, then at most three
 * current priorities. Not a chat thread and not a KPI wall.
 */
export function selectHojeModel(input: {
  attention: readonly AttentionItem[];
  priorities: readonly PriorityRecommendation[];
}): HojeModel {
  return {
    attention: selectHomepageAttention(input.attention),
    priorities: selectHomepagePriorities(input.priorities),
  };
}

export function hasOpenHighSeverity(items: readonly AttentionItem[]): boolean {
  return items.some(
    (item) =>
      item.homepage_eligible &&
      item.status === "open" &&
      (item.severity === "high" || item.severity === "critical"),
  );
}
