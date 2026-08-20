import { severityAtLeast } from "./score.js";
import type { ScoringConfig } from "./types.js";
import type { MergedSignal } from "./merge.js";

/**
 * Kill rules force critical operational risks / blockers into ATENÇÃO AGORA
 * even when the rest of the bag is low-value work (estética/refactor) that
 * would otherwise fill the list by count.
 */
export function isKillRule(signal: MergedSignal, config: ScoringConfig): boolean {
  if (signal.item_kind === "dados_stale") {
    return false;
  }
  if (!config.kill_rule.categories.includes(signal.category)) {
    return false;
  }
  if (!severityAtLeast(signal.severity, config.kill_rule.min_severity)) {
    return false;
  }
  if (signal.impact < config.kill_rule.min_impact) {
    return false;
  }
  return true;
}
