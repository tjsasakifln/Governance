import type { AttackId } from "./attacks.js";
import type { QaRuntimePort } from "./adapters.js";

/**
 * Snapshot of evaluator payloads collected from the integrated runtime.
 * Keys match the 14 named attacks. Values are the same shapes FixturePort
 * would load — sourced from Postgres / MCP / production HTTP, not from
 * fixtures/attacks.
 */
export type LiveSnapshot = {
  readonly as_of: string;
  readonly freshness: unknown;
  readonly ledger: unknown;
  readonly directives: unknown;
  readonly scopes: unknown;
  readonly events: unknown;
  readonly operations: unknown;
  readonly surfaces: unknown;
  readonly instants: unknown;
  readonly health: unknown;
  readonly sessions: unknown;
  readonly auth: unknown;
  readonly aggregates: unknown;
};

export const LIVE_SNAPSHOT_SCHEMA = "control-center.qa-live-snapshot.v1" as const;

export function emptyLiveSnapshot(asOf: string): LiveSnapshot {
  return {
    as_of: asOf,
    freshness: { as_of: asOf, records: [] },
    ledger: { lines: [], reported_totals: {} },
    directives: { directives: [] },
    scopes: { granted_scopes: [], resources: [] },
    events: { events: [] },
    operations: { operations: [], collectors: [], finance_snapshots: [] },
    surfaces: { surfaces: {} },
    instants: { instants: [] },
    health: { overall_status: "unknown", checks: [], required_sources: [], collector_runs: [] },
    sessions: { as_of: asOf, sessions: [] },
    auth: {},
    aggregates: { records: [] },
  };
}

export class LiveRuntimePort implements QaRuntimePort {
  constructor(private readonly snapshot: LiveSnapshot) {}

  loadFreshness(_asOf: string): unknown {
    return this.snapshot.freshness;
  }
  loadLedger(): unknown {
    return this.snapshot.ledger;
  }
  loadDirectives(): unknown {
    return this.snapshot.directives;
  }
  loadAgentContext(): unknown {
    return this.snapshot.scopes;
  }
  loadEvents(): unknown {
    return this.snapshot.events;
  }
  loadAttemptedOperations(): unknown {
    return this.snapshot.operations;
  }
  loadSurfaces(): unknown {
    return this.snapshot.surfaces;
  }
  loadInstants(): unknown {
    return this.snapshot.instants;
  }
  loadHealth(): unknown {
    return this.snapshot.health;
  }
  loadSessions(): unknown {
    return this.snapshot.sessions;
  }
  loadAuthAttempt(): unknown {
    return this.snapshot.auth;
  }
  loadAggregates(): unknown {
    return this.snapshot.aggregates;
  }
}

export function payloadForAttack(snapshot: LiveSnapshot, attackId: AttackId): unknown {
  switch (attackId) {
    case "stale data mostrado como saudável":
      return snapshot.freshness;
    case "double counting financeiro":
      return snapshot.ledger;
    case "hypothesis promovida a fact":
    case "agent sobrescrevendo founder decision":
    case "conflicting directives/supersession":
      return snapshot.directives;
    case "scope leakage entre cliente/repos":
      return snapshot.scopes;
    case "duplicated collector event":
      return snapshot.events;
    case "provider mutation acidental":
      return snapshot.operations;
    case "secret/PII leakage":
      return snapshot.surfaces;
    case "timezone boundary":
      return snapshot.instants;
    case "partial outage":
      return snapshot.health;
    case "stale RUNNING agent session":
      return snapshot.sessions;
    case "auth bypass assumptions":
      return snapshot.auth;
    case "missing provenance":
      return snapshot.aggregates;
    default: {
      const _never: never = attackId;
      return _never;
    }
  }
}
