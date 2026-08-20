import { diverseTopN } from "./diversity.js";
import type {
  FounderOverride,
  OverrideAudit,
  RankingSnapshot,
  ResourceId,
  ScoredCandidate,
  ScoringConfig,
} from "./types.js";

export interface OverrideResult {
  now: ScoredCandidate[];
  today: ScoredCandidate[];
  audit: OverrideAudit[];
}

function snapshotOf(now: ScoredCandidate[], today: ScoredCandidate[]): RankingSnapshot {
  return {
    now: now.map((i) => i.id),
    today: today.map((i) => i.id),
  };
}

function indexById(items: ScoredCandidate[]): Map<string, ScoredCandidate> {
  const map = new Map<string, ScoredCandidate>();
  for (const item of items) {
    map.set(item.id, item);
  }
  return map;
}

function resolveTargets(
  target_ids: ResourceId[],
  byId: Map<string, ScoredCandidate>,
): ScoredCandidate[] {
  const out: ScoredCandidate[] = [];
  const seen = new Set<string>();
  for (const id of target_ids) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    const item = byId.get(id);
    if (item) {
      out.push(item);
    }
  }
  return out;
}

function fillToday(
  pinned: ScoredCandidate[],
  pool: ScoredCandidate[],
  limit: number,
): ScoredCandidate[] {
  const pinnedIds = new Set(pinned.map((p) => p.id));
  const rest = pool.filter((p) => !pinnedIds.has(p.id));
  const remainingSlots = Math.max(0, limit - pinned.length);
  const filled = remainingSlots > 0 ? diverseTopN(rest, remainingSlots) : [];
  return [...pinned, ...filled].slice(0, limit);
}

function applyPin(
  now: ScoredCandidate[],
  pool: ScoredCandidate[],
  targets: ScoredCandidate[],
  config: ScoringConfig,
): { now: ScoredCandidate[]; today: ScoredCandidate[] } {
  const pinnedIds = new Set(targets.map((t) => t.id));
  const nowRest = now.filter((i) => !pinnedIds.has(i.id));
  const nextNow = [...targets, ...nowRest].slice(0, config.atencao_agora_limit);
  const nextToday = fillToday(targets.slice(0, config.today_limit), pool, config.today_limit);
  return { now: nextNow, today: nextToday };
}

function applyReorder(
  now: ScoredCandidate[],
  pool: ScoredCandidate[],
  targets: ScoredCandidate[],
  config: ScoringConfig,
): { now: ScoredCandidate[]; today: ScoredCandidate[] } {
  const nextToday = fillToday(targets.slice(0, config.today_limit), pool, config.today_limit);
  const todayIds = new Set(nextToday.map((t) => t.id));
  const nowRest = now.filter((i) => !todayIds.has(i.id));
  const nextNow = [...nextToday, ...nowRest].slice(0, config.atencao_agora_limit);
  return { now: nextNow, today: nextToday };
}

function applyDismiss(
  now: ScoredCandidate[],
  pool: ScoredCandidate[],
  targets: ScoredCandidate[],
  config: ScoringConfig,
): { now: ScoredCandidate[]; today: ScoredCandidate[] } {
  const dismissed = new Set(targets.map((t) => t.id));
  const nextPool = pool.filter((i) => !dismissed.has(i.id));
  const nextNow = now.filter((i) => !dismissed.has(i.id)).slice(0, config.atencao_agora_limit);
  const nextToday = diverseTopN(nextPool, config.today_limit);
  return { now: nextNow, today: nextToday };
}

/**
 * Founder override is an input record plus an audit event, not a hidden
 * branch. Kill-rule items remain in ATENÇÃO AGORA unless explicitly dismissed.
 * Audit always names actor, time, target ids, and the ranking before/after.
 */
export function applyOverride(
  now: ScoredCandidate[],
  today: ScoredCandidate[],
  pool: ScoredCandidate[],
  override: FounderOverride | null,
  config: ScoringConfig,
): OverrideResult {
  if (!override) {
    return { now, today, audit: [] };
  }
  const byId = indexById(pool);
  const targets = resolveTargets(override.target_ids, byId);
  const previous = snapshotOf(now, today);
  let next: { now: ScoredCandidate[]; today: ScoredCandidate[] };
  if (override.action === "pin") {
    next = applyPin(now, pool, targets, config);
  } else if (override.action === "reorder") {
    next = applyReorder(now, pool, targets, config);
  } else {
    next = applyDismiss(now, pool, targets, config);
  }
  const stamp = override.at.replace(/[^A-Za-z0-9._~-]/g, "");
  const audit: OverrideAudit = {
    schema_version: "control-center.audit-event.v1",
    id: `cc:audit-event:founder-override-${stamp}`,
    at: override.at,
    actor: override.actor,
    action: "founder_override",
    resource_type: "PriorityRecommendation",
    resource_id: null,
    scope: null,
    outcome: "success",
    detail: {
      override_action: override.action,
      target_ids: [...override.target_ids],
      previous_ranking: previous,
      resulting_ranking: snapshotOf(next.now, next.today),
    },
  };
  return { now: next.now, today: next.today, audit: [audit] };
}
