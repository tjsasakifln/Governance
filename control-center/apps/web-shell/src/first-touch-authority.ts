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
