import type { FreshnessStatus } from "./taxonomy.js";

/**
 * Local adapters for later convergence. Sibling packages are NOT imported.
 *
 * Vocab (documented, not unified in this campaign):
 * - contracts (cc-01): FRESH | STALE | UNKNOWN | ERROR
 * - persistence (cc-02): fresh | stale | unknown | expired
 * - this engine: contracts-shaped uppercase enum
 *
 * Mapping `ERROR` ↔ `expired` is an explicit divergence to resolve at
 * convergence; do not silently coerce in consumers.
 */
export const CONTRACTS_FRESHNESS = ["FRESH", "STALE", "UNKNOWN", "ERROR"] as const;

export const PERSISTENCE_FRESHNESS = ["fresh", "stale", "unknown", "expired"] as const;

export type PersistenceFreshness = (typeof PERSISTENCE_FRESHNESS)[number];

export function toPersistenceFreshness(status: FreshnessStatus): PersistenceFreshness {
  switch (status) {
    case "FRESH":
      return "fresh";
    case "STALE":
      return "stale";
    case "UNKNOWN":
      return "unknown";
    case "ERROR":
      return "expired";
  }
}

export function fromPersistenceFreshness(status: PersistenceFreshness): FreshnessStatus {
  switch (status) {
    case "fresh":
      return "FRESH";
    case "stale":
      return "STALE";
    case "unknown":
      return "UNKNOWN";
    case "expired":
      return "ERROR";
  }
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
