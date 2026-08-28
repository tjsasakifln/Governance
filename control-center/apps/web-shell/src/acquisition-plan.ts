/**
 * How a late market source reads to the founder.
 *
 * Under CFG-FIRST-TOUCH-ROUTING-v3 / COMMERCIAL_AUTHORITY/2.0, source freshness
 * is acquisition health: it says new leads may be missing, never that outbound
 * is blocked. A commercially-qualified member keeps transporting while the feed
 * catches up, so this text must stay a plan condition and never become a verdict.
 */

export type AcquisitionSourceHealth = "FRESH" | "DEGRADED" | "STALE" | "MISSING" | "UNKNOWN";

export const ACQUISITION_PLAN_CONDITION =
  "Atualização de mercado atrasada; novos leads podem não estar refletidos." as const;
export const ACQUISITION_PLAN_UNKNOWN =
  "Atualização de mercado não observada; novos leads podem não estar refletidos." as const;
export const ACQUISITION_PLAN_FRESH = "Atualização de mercado em dia." as const;

/** Wording that must never describe source health. */
export const FORBIDDEN_SOURCE_HEALTH_READBACKS = [
  "Outbound bloqueado.",
  "Outbound bloqueado",
  "OUTBOUND BLOQUEADO",
] as const;

export function acquisitionPlanCondition(sourceHealth: string | null): string {
  if (sourceHealth === "FRESH") return ACQUISITION_PLAN_FRESH;
  if (sourceHealth === "DEGRADED" || sourceHealth === "STALE" || sourceHealth === "MISSING") {
    return ACQUISITION_PLAN_CONDITION;
  }
  return ACQUISITION_PLAN_UNKNOWN;
}

/** Source health is acquisition health. It is never an outbound verdict. */
export function sourceHealthBlocksOutbound(_sourceHealth: string | null): false {
  return false;
}
