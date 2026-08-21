import { FRESHNESS_STATUSES, type FreshnessStatus } from "@confenge/control-center-contracts/taxonomy";

/**
 * Persistence v1 uses the same FRESH|STALE|UNKNOWN|ERROR tokens as contracts.
 * Identity mapping — no expired-as-freshness, no lowercase aliases.
 */
export const CONTRACTS_FRESHNESS = FRESHNESS_STATUSES;

export const PERSISTENCE_FRESHNESS = FRESHNESS_STATUSES;

export type PersistenceFreshness = FreshnessStatus;

export function toPersistenceFreshness(status: FreshnessStatus): PersistenceFreshness {
  return status;
}

export function fromPersistenceFreshness(status: PersistenceFreshness): FreshnessStatus {
  return status;
}

/**
 * Expected consumption at convergence (this package does not import them):
 *
 * Homepage: `attention_now` for exceptions; `today` (length ≤ 3) for
 * "as 3 coisas mais importantes agora". Horizons `now` | `today` | `this_week`.
 *
 * MCP / context service: agents query by scope; pass only the ranked items
 * whose `scope` is in the granted set. Never dump the whole company memory.
 *
 * Persistence: store engine output as derived attention_items /
 * priority recommendations. Engine remains pure — no SQL here.
 */
export const CONVERGENCE_CONTRACT = {
  homepage: {
    exceptions_field: "attention_now",
    today_field: "today",
    today_limit: 3,
    horizons: ["now", "today", "this_week"],
  },
  mcp: {
    filter_by: "scope",
    include_reason_and_breakdown: true,
  },
  persistence: {
    freshness_adapter: "toPersistenceFreshness",
    no_schema_in_this_package: true,
  },
} as const;
