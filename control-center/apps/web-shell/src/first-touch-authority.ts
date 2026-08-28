/** Thresholds from cfg-first-touch-routing.v2.json. Test-facing; keep out of the app graph. */
export const FIRST_WINDOW_V2 = {
  currentMaxSeconds: 86400,
  degradedMaxSeconds: 259200,
  frozenMaxSeconds: 604800,
} as const;
export function classifySourceHealth(ageSeconds: number | null, freshness: string | null) {
  if (freshness === "ERROR") return "UNKNOWN";
  if (ageSeconds !== null && ageSeconds >= 0) {
    if (ageSeconds <= FIRST_WINDOW_V2.currentMaxSeconds) return "FRESH";
    if (ageSeconds <= FIRST_WINDOW_V2.degradedMaxSeconds) return "DEGRADED";
    return "STALE";
  }
  if (freshness === "FRESH" || freshness === "STALE" || freshness === "DEGRADED") return freshness;
  return "UNKNOWN";
}
export function classifyCommercialAuthority(ageSeconds: number | null) {
  if (ageSeconds === null || ageSeconds < 0) return "UNKNOWN";
  if (ageSeconds <= FIRST_WINDOW_V2.currentMaxSeconds) return "CURRENT";
  if (ageSeconds <= FIRST_WINDOW_V2.degradedMaxSeconds) return "DEGRADED";
  if (ageSeconds <= FIRST_WINDOW_V2.frozenMaxSeconds) return "FROZEN_FOR_NEW_ADMISSION";
  return "EXPIRED";
}

/* ------------------------------------------------------------------ *
 * CFG-FIRST-TOUCH-ROUTING-v3 / COMMERCIAL_AUTHORITY/2.0.
 *
 * Qualification is evidence, not recency: a company is qualified while a
 * public engineering contracting act naming it as CONTRACTED SUPPLIER falls
 * inside a rolling three-year window. The v2 age bands above are kept for the
 * published v2 readback and are not the commercial gate any more.
 * ------------------------------------------------------------------ */

export const FIRST_TOUCH_ROUTING_V3 = "CFG-FIRST-TOUCH-ROUTING-v3" as const;
export const COMMERCIAL_AUTHORITY_CONTRACT_V2 = "COMMERCIAL_AUTHORITY/2.0" as const;
export const COMMERCIAL_AUTHORITY_POLICY_V2 = "COMMERCIAL_AUTHORITY_POLICY/2.0" as const;
export const QUALIFICATION_WINDOW_YEARS = 3;

/** Deterministic precedence over v_contracts_canonical_v2. data_fim is excluded. */
export const QUALIFYING_DATE_PRECEDENCE = [
  "data_assinatura",
  "data_inicio",
  "data_publicacao",
  "data_publicacao_fonte",
] as const;

export type CommercialQualificationState = "QUALIFIED" | "EXPIRED" | "REVOKED" | "UNKNOWN";

/** The blocker v3 retires. Source health may never produce one. */
export const RETIRED_FRESHNESS_BLOCKER = "source_health_not_fresh_strict_fallback" as const;
export const COMMERCIAL_AUTHORITY_MISSING = "commercial_authority_missing" as const;

/** The founder readback lives in the app module; re-exported here for tests. */
export {
  ACQUISITION_PLAN_CONDITION,
  ACQUISITION_PLAN_FRESH,
  ACQUISITION_PLAN_UNKNOWN,
  FORBIDDEN_SOURCE_HEALTH_READBACKS,
  acquisitionPlanCondition,
  sourceHealthBlocksOutbound,
} from "./acquisition-plan";

/** Go's AddDate normalization: 2024-02-29 + 3y is 2027-03-01, never 02-28. */
export function addYearsForward(day: Date, years: number): Date {
  const year = day.getUTCFullYear() + years;
  const month = day.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const dayOfMonth = day.getUTCDate();
  if (dayOfMonth <= lastDay) return new Date(Date.UTC(year, month, dayOfMonth));
  return new Date(Date.UTC(year, month + 1, dayOfMonth - lastDay));
}

/** Derived expiry of one qualifying fact. No grace period is ever added. */
export function qualifiedUntilFor(contractDate: Date): Date {
  return addYearsForward(contractDate, QUALIFICATION_WINDOW_YEARS);
}

/** Normalize a reported state. Absence stays UNKNOWN; nothing is inferred. */
export function normalizeCommercialQualification(raw: string | null): CommercialQualificationState {
  if (raw === "QUALIFIED" || raw === "EXPIRED" || raw === "REVOKED") return raw;
  return "UNKNOWN";
}
