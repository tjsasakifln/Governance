import type { PriorityHorizon } from "./taxonomy.js";
import type { RankedItem, ScoredCandidate } from "./types.js";

function formatScore(milli: number): string {
  const whole = Math.floor(milli / 1000);
  const frac = Math.abs(milli % 1000).toString().padStart(3, "0");
  return `${whole}.${frac}`;
}

/**
 * Deterministic reason string. No LLM. A reader can verify A vs B from
 * `score_breakdown` using scoreMilliFromBreakdown.
 */
export function buildReason(item: ScoredCandidate, horizon: PriorityHorizon): string {
  const b = item.breakdown;
  const parts: string[] = [];
  if (item.item_kind === "dados_stale") {
    parts.push(
      `Dados stale: freshness original ${b.source_freshness_status} reduz prioridade do sinal-fonte; este item pede atualização da evidência.`,
    );
  }
  if (item.forced_by_kill_rule) {
    parts.push("KILL-RULE: risco crítico forçado em ATENÇÃO AGORA.");
  }
  if (b.merge_count > 1) {
    parts.push(`Sinal mesclado (${b.merge_count} correlações; impacto e urgência = max).`);
  }
  if (b.freshness_demoted && item.item_kind === "work") {
    parts.push(
      `Freshness ${b.freshness_status} aplica multiplicador ${b.freshness_multiplier.toFixed(2)} (despromoção).`,
    );
  }
  parts.push(
    `Score ${formatScore(b.score_milli)} = peso_categoria ${b.category_weight} (tier ${b.category_tier}, ${b.category}) × eixo ${b.axis} (impacto ${b.impact}×${b.impact_weight_bp}/${10000} + urgência ${b.urgency}×${b.urgency_weight_bp}/${10000}) × freshness_bp ${b.freshness_bp} × confidence_bp ${b.confidence_bp} / 10000², horizonte ${horizon}.`,
  );
  const locators = item.evidence_refs
    .map((e) => `${e.source.system}:${e.source.kind}:${e.source.locator}`)
    .slice(0, 4)
    .join("; ");
  if (locators.length > 0) {
    parts.push(`Evidências: ${locators}.`);
  }
  return parts.join(" ").slice(0, 2000);
}

export function toRankedItem(
  item: ScoredCandidate,
  rank: number,
  horizon: PriorityHorizon,
): RankedItem {
  const ranked: RankedItem = {
    id: item.id,
    rank,
    title: item.title,
    reason: buildReason(item, horizon),
    evidence_refs: item.evidence_refs,
    score: item.breakdown.score,
    score_milli: item.score_milli,
    score_breakdown: item.breakdown,
    category: item.category,
    domain: item.domain,
    scope: item.scope,
    severity: item.severity,
    status: item.status,
    item_kind: item.item_kind,
    provenance: item.provenance,
    horizon,
    attention_item_ids: item.source_ids,
    forced_by_kill_rule: item.forced_by_kill_rule,
    merge_count: item.merge_count,
  };
  if (item.recommended_action !== undefined) {
    ranked.recommended_action = item.recommended_action;
  }
  return ranked;
}
