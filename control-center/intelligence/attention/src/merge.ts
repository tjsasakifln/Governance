import { FRESHNESS_RANK, SEVERITY_RANK } from "./taxonomy.js";
import type { AttentionSignal, EvidenceRef, Provenance, SourceRef } from "./types.js";

export interface MergedSignal extends AttentionSignal {
  source_ids: string[];
  merge_count: number;
}

function evidenceKey(ref: EvidenceRef): string {
  return `${ref.source.system}|${ref.source.kind}|${ref.source.locator}|${ref.note ?? ""}`;
}

function mergeEvidence(items: AttentionSignal[]): EvidenceRef[] {
  const seen = new Set<string>();
  const out: EvidenceRef[] = [];
  const sorted = [...items].sort((a, b) => a.id.localeCompare(b.id));
  for (const item of sorted) {
    for (const ref of item.evidence_refs) {
      const key = evidenceKey(ref);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      out.push(ref);
    }
  }
  return out;
}

function mergeRelated(items: AttentionSignal[]): string[] {
  const set = new Set<string>();
  for (const item of items) {
    for (const id of item.related_ids ?? []) {
      set.add(id);
    }
  }
  return [...set].sort();
}

function worstFreshness(items: AttentionSignal[]): Provenance["freshness_status"] {
  let worst = items[0]?.provenance.freshness_status ?? "UNKNOWN";
  for (const item of items) {
    if (FRESHNESS_RANK[item.provenance.freshness_status] < FRESHNESS_RANK[worst]) {
      worst = item.provenance.freshness_status;
    }
  }
  return worst;
}

function latestObserved(items: AttentionSignal[]): string {
  let latest = items[0]?.provenance.observed_at ?? "";
  for (const item of items) {
    if (item.provenance.observed_at > latest) {
      latest = item.provenance.observed_at;
    }
  }
  return latest;
}

function pickCanonical(items: AttentionSignal[]): AttentionSignal {
  const ranked = [...items].sort((a, b) => {
    if (a.impact !== b.impact) {
      return b.impact - a.impact;
    }
    if (a.urgency !== b.urgency) {
      return b.urgency - a.urgency;
    }
    return a.id.localeCompare(b.id);
  });
  const first = ranked[0];
  if (!first) {
    throw new Error("merge group must be non-empty");
  }
  return first;
}

function mergeSource(items: AttentionSignal[]): SourceRef {
  const systems = new Set(items.map((i) => i.provenance.source.system));
  const canonical = pickCanonical(items);
  if (systems.size === 1) {
    return { ...canonical.provenance.source };
  }
  const locators = [...items]
    .map((i) => i.provenance.source.locator)
    .sort()
    .join(",");
  return {
    system: "governance",
    kind: "merged-signal",
    locator: locators.slice(0, 512),
    label: "merged",
  };
}

function mergeOne(items: AttentionSignal[]): MergedSignal {
  const canonical = pickCanonical(items);
  const ids = [...items].map((i) => i.id).sort();
  const maxImpact = Math.max(...items.map((i) => i.impact));
  const maxUrgency = Math.max(...items.map((i) => i.urgency));
  let worstSeverity = canonical.severity;
  for (const item of items) {
    if (SEVERITY_RANK[item.severity] < SEVERITY_RANK[worstSeverity]) {
      worstSeverity = item.severity;
    }
  }
  const minConfidence = Math.min(...items.map((i) => i.provenance.confidence));
  const provenance: Provenance = {
    source: mergeSource(items),
    observed_at: latestObserved(items),
    freshness_status: worstFreshness(items),
    confidence: minConfidence,
  };
  const window = items
    .map((i) => i.provenance.freshness_window_seconds)
    .find((w) => w !== undefined);
  if (window !== undefined) {
    provenance.freshness_window_seconds = window;
  }
  const merged: MergedSignal = {
    id: ids[0] ?? canonical.id,
    title: canonical.title,
    summary: canonical.summary,
    category: canonical.category,
    domain: canonical.domain,
    scope: canonical.scope,
    impact: maxImpact,
    urgency: maxUrgency,
    severity: worstSeverity,
    status: canonical.status,
    correlation_key: canonical.correlation_key,
    evidence_refs: mergeEvidence(items),
    provenance,
    related_ids: mergeRelated(items),
    source_ids: ids,
    merge_count: items.length,
  };
  if (canonical.recommended_action !== undefined) {
    merged.recommended_action = canonical.recommended_action;
  }
  if (canonical.money !== undefined) {
    merged.money = canonical.money;
  } else {
    const withMoney = items.find((i) => i.money !== undefined);
    if (withMoney?.money !== undefined) {
      merged.money = withMoney.money;
    }
  }
  return merged;
}

/**
 * Correlated signals (same correlation_key) merge to one item and do not
 * compete as separate ranked rows. Groups of size 1 pass through unchanged.
 * Group order and member order do not affect the merged result.
 */
export function mergeSignals(signals: AttentionSignal[]): MergedSignal[] {
  const groups = new Map<string, AttentionSignal[]>();
  const order: string[] = [];
  for (const signal of signals) {
    const existing = groups.get(signal.correlation_key);
    if (existing) {
      existing.push(signal);
    } else {
      groups.set(signal.correlation_key, [signal]);
      order.push(signal.correlation_key);
    }
  }
  const merged = order.map((key) => {
    const group = groups.get(key);
    if (!group || group.length === 0) {
      throw new Error(`empty merge group for ${key}`);
    }
    return mergeOne(group);
  });
  merged.sort((a, b) => a.id.localeCompare(b.id));
  return merged;
}
