import { fingerprintConfig } from "./default-config.js";
import { diverseTopN } from "./diversity.js";
import { toRankedItem } from "./explain.js";
import { appendDadosStale } from "./freshness.js";
import { isKillRule } from "./kill-rules.js";
import { mergeSignals, type MergedSignal } from "./merge.js";
import { applyOverride } from "./override.js";
import { buildBreakdown, sortCandidates } from "./score.js";
import { SCHEMA_VERSIONS } from "./taxonomy.js";
import type {
  PriorityRecommendationView,
  RankInput,
  RankOutput,
  RankedItem,
  ScoredCandidate,
  ScoringConfig,
} from "./types.js";
import { parseRankRequest } from "./validate.js";

function toCandidate(merged: MergedSignal, config: ScoringConfig): ScoredCandidate {
  const forced = isKillRule(merged, config);
  const breakdown = buildBreakdown(
    {
      category: merged.category,
      impact: merged.impact,
      urgency: merged.urgency,
      provenance: merged.provenance,
      merge_count: merged.merge_count,
      source_freshness_status: merged.source_freshness_status,
    },
    config,
    forced,
  );
  const candidate: ScoredCandidate = {
    id: merged.id,
    title: merged.title,
    summary: merged.summary,
    category: merged.category,
    domain: merged.domain,
    scope: merged.scope,
    impact: merged.impact,
    urgency: merged.urgency,
    severity: merged.severity,
    status: merged.status,
    item_kind: merged.item_kind,
    correlation_key: merged.correlation_key,
    evidence_refs: merged.evidence_refs,
    provenance: merged.provenance,
    related_ids: merged.related_ids ?? [],
    source_ids: merged.source_ids,
    merge_count: merged.merge_count,
    forced_by_kill_rule: forced,
    score_milli: breakdown.score_milli,
    breakdown,
  };
  if (merged.recommended_action !== undefined) {
    candidate.recommended_action = merged.recommended_action;
  }
  if (merged.money !== undefined) {
    candidate.money = merged.money;
  }
  return candidate;
}

function engineProvenance(generated_at: string): RankOutput["provenance"] {
  return {
    source: {
      system: "governance",
      kind: "attention-engine",
      locator: "control-center/intelligence/attention",
      label: "attention-engine",
    },
    observed_at: generated_at,
    freshness_status: "FRESH",
    confidence: 1,
  };
}

/**
 * Pure ranking pipeline. Injected clock via `clock_now`. No I/O, no LLM.
 *
 * normalize → merge → dados-stale → score → kill-rule flag → total-order
 * → ATENÇÃO AGORA (top limit, kill-rules already first) → diversity today-N
 * → founder override + audit → explain.
 */
export function rankAttention(input: RankInput): RankOutput {
  const generated_at = input.clock_now;
  const config = input.config;
  const eligible = input.signals.filter((s) => config.eligible_statuses.includes(s.status));
  const merged = mergeSignals(eligible);
  const withStale = appendDadosStale(merged, generated_at);
  const scored = withStale.map((m) => toCandidate(m, config));
  const ordered = sortCandidates(scored);
  const nowList = ordered.slice(0, config.atencao_agora_limit);
  const todayList = diverseTopN(ordered, config.today_limit);
  const applied = applyOverride(nowList, todayList, ordered, input.override, config);
  const attention_now = applied.now.map((item, i) => toRankedItem(item, i + 1, "now"));
  const today = applied.today.map((item, i) => toRankedItem(item, i + 1, "today"));
  return {
    schema_version: SCHEMA_VERSIONS.AttentionEngineOutput,
    generated_at,
    provenance: engineProvenance(generated_at),
    config_fingerprint: fingerprintConfig(config),
    attention_now,
    today,
    audit: applied.audit,
  };
}

/**
 * Runtime-validated entry. This is the shipped ranker surface used by the
 * CLI and by tests — not a copy, not a mock.
 */
export function rankFromUnknown(value: unknown): RankOutput {
  const input = parseRankRequest(value);
  return rankAttention(input);
}

export function asPriorityRecommendations(
  output: RankOutput,
  horizon: "now" | "today",
): PriorityRecommendationView[] {
  const items: RankedItem[] = horizon === "now" ? output.attention_now : output.today;
  return items.map((item) => ({
    schema_version: SCHEMA_VERSIONS.PriorityRecommendation,
    id: `cc:priority-recommendation:${horizon}-${item.rank}-${item.id.split(":").slice(2).join("-")}`.slice(0, 128),
    scope: item.scope,
    rank: item.rank,
    title: item.title,
    rationale: item.reason,
    provenance: item.provenance,
    generated_at: output.generated_at,
    horizon,
    attention_item_ids: item.attention_item_ids,
  }));
}
