/**
 * Convergence adapters — contracts only. This package copies shapes locally
 * and does not import sibling workstreams.
 *
 * | Later workstream | Expected swap |
 * | --- | --- |
 * | `control-center/contracts` | Replace local types with the published JSON Schema / TS package. Field names already match v1 (`source`, `observed_at`, `freshness_status`, `confidence`). |
 * | `control-center/intelligence/attention` | `RankOutput.today` → `HojePayload.recommended_actions`. `FounderOverride` (`pin` \| `reorder` \| `dismiss`) → `HojePayload.founder_override`. This UI does not re-rank. |
 * | `control-center/domains/agent-activity` | `TimelineItem` → `HojePayload.agent_activity`. Actor kind `founder` maps to contracts `human` at convergence. |
 * | Context HTTP | `GET` scoped recorte → `HojePayload`. Keep provenance on every aggregated row. |
 * | Directives UI | Shortcut `decision` / `nota` becomes a draft directive (`kind` ∈ decision, directive, fact, constraint, priority, risk, hypothesis). This wave records local intent only (`recordIntent`); no POST, no Warmbly/Asaas/GitHub write. |
 *
 * This homepage is a consumer of those recortes. It is not the ranking
 * engine, not the ledger, and not the directives store.
 */

export const CONVERGENCE_PORTS = [
  "contracts",
  "attention-engine",
  "agent-ledger",
  "context-http",
  "directives-ui",
] as const;

export type ConvergencePort = (typeof CONVERGENCE_PORTS)[number];
