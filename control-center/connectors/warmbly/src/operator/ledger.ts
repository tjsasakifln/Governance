/**
 * Operator-action audit record.
 *
 * Every call through the channel produces exactly one entry — executed,
 * refused, or challenged. There is no path that returns without recording, so
 * an operator action is reconstructible after the fact from actor, action,
 * target, upstream status and timestamp alone.
 *
 * The shape carries the same provenance keys as the rest of the Control Center
 * (`source` / `observed_at` / `freshness_status` / `confidence`) so it lands in
 * the agent-activity ledger without reshaping — see `agent-activity-sink.ts`.
 */

import type { CircuitState } from "../http/circuit-breaker.ts";
import type { OperatorActionName, OperatorTargetKind } from "./actions.ts";
import type { OperatorActor } from "./identity.ts";

export const OPERATOR_LEDGER_SCHEMA = "control-center.warmbly-operator-action.v1" as const;

export const OPERATOR_LEDGER_SOURCE_SYSTEM = "control-center" as const;
export const OPERATOR_LEDGER_SOURCE_KIND = "warmbly-operator-action" as const;

export const OPERATOR_OUTCOMES = ["executed", "refused", "challenged"] as const;
export type OperatorOutcome = (typeof OPERATOR_OUTCOMES)[number];

export const OPERATOR_REFUSAL_CODES = [
  "missing_actor",
  "unknown_action",
  "invalid_target",
  "invalid_reason",
  "confirmation_required",
  "confirmation_invalid",
  "confirmation_not_applicable",
  "forbidden_path",
  "circuit_open",
  "upstream_error",
  "transport_error",
] as const;
export type OperatorRefusalCode = (typeof OPERATOR_REFUSAL_CODES)[number];

export interface OperatorLedgerTarget {
  kind: OperatorTargetKind | "unknown";
  id: string;
}

export interface OperatorLedgerUpstream {
  method: "POST" | null;
  path: string | null;
  status: number | null;
}

export interface OperatorLedgerConfirmation {
  required: boolean;
  satisfied: boolean;
  token_id: string | null;
}

export interface OperatorActionLedgerEntry {
  schema_version: typeof OPERATOR_LEDGER_SCHEMA;
  id: string;
  correlation_id: string;
  /** Requested action name verbatim — kept even when it is not on the allowlist. */
  requested_action: string;
  action: OperatorActionName | null;
  outcome: OperatorOutcome;
  refusal_code: OperatorRefusalCode | null;
  refusal_reason: string | null;
  actor: OperatorActor | null;
  target: OperatorLedgerTarget;
  upstream: OperatorLedgerUpstream;
  confirmation: OperatorLedgerConfirmation;
  circuit_state: CircuitState;
  reason: string | null;
  recorded_at: string;
  source: {
    system: typeof OPERATOR_LEDGER_SOURCE_SYSTEM;
    kind: typeof OPERATOR_LEDGER_SOURCE_KIND;
    locator: string;
  };
  observed_at: string;
  freshness_status: "FRESH";
  confidence: number;
}

/** Persistence port. The in-process store is the default; sinks fan out. */
export interface OperatorActionLedger {
  record(entry: OperatorActionLedgerEntry): void;
  list(): OperatorActionLedgerEntry[];
}

export function createMemoryOperatorActionLedger(): OperatorActionLedger {
  const entries: OperatorActionLedgerEntry[] = [];
  return {
    record(entry) {
      entries.push(structuredClone(entry));
    },
    list() {
      return entries.map((entry) => structuredClone(entry));
    },
  };
}

/**
 * Fan-out that keeps the in-process record authoritative. A failing downstream
 * sink must never swallow the audit trail, so sink errors are captured and
 * surfaced on the in-memory entry list rather than thrown at the operator.
 */
export function createFanOutOperatorActionLedger(
  primary: OperatorActionLedger,
  sinks: readonly OperatorActionLedger[],
  onSinkError?: (err: unknown, entry: OperatorActionLedgerEntry) => void,
): OperatorActionLedger {
  return {
    record(entry) {
      primary.record(entry);
      for (const sink of sinks) {
        try {
          sink.record(entry);
        } catch (err) {
          onSinkError?.(err, entry);
        }
      }
    },
    list() {
      return primary.list();
    },
  };
}

export function operatorLedgerId(correlationId: string): string {
  const slug = correlationId.replace(/[^A-Za-z0-9._~-]+/g, "-").slice(0, 96);
  return `cc:warmbly-operator-action:${slug}`;
}
