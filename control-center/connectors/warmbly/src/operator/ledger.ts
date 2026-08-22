/**
 * Operator-action audit record.
 *
 * Every call through the channel produces exactly one entry — executed,
 * refused, challenged, or unknown. There is no path that returns without
 * recording, so an operator action is reconstructible after the fact from
 * actor, action, target, upstream status and timestamp alone. When the record
 * itself cannot be persisted, the entry still goes to a durable WAL line
 * (`writeOperatorLedgerWal`) before the failure surfaces.
 *
 * The shape carries the same provenance keys as the rest of the Control Center
 * (`source` / `observed_at` / `freshness_status` / `confidence`) so it lands in
 * the agent-activity ledger without reshaping — see `agent-activity-sink.ts`.
 */

import { writeSync } from "node:fs";
import type { CircuitState } from "../http/circuit-breaker.ts";
import { createStderrLogger, type Logger } from "../http/redaction.ts";
import type { OperatorActionName, OperatorTargetKind } from "./actions.ts";
import type { OperatorActor } from "./identity.ts";

export const OPERATOR_LEDGER_SCHEMA = "control-center.warmbly-operator-action.v1" as const;

export const OPERATOR_LEDGER_SOURCE_SYSTEM = "control-center" as const;
export const OPERATOR_LEDGER_SOURCE_KIND = "warmbly-operator-action" as const;

/**
 * `unknown` is not a refusal. It is the honest answer when the POST was already
 * written to the wire and the answer never arrived: Warmbly may have applied
 * the action. Recording such a call as `refused` would tell the operator the
 * kill switch is still engaged while outbound is in fact sending.
 */
export const OPERATOR_OUTCOMES = ["executed", "refused", "challenged", "unknown"] as const;
export type OperatorOutcome = (typeof OPERATOR_OUTCOMES)[number];

/**
 * Carried in `refusal_code` when `outcome === "unknown"`. Deliberately not a
 * member of OPERATOR_REFUSAL_CODES: nothing was refused.
 */
export const OPERATOR_UNKNOWN_CODE = "transport_unknown" as const;
export type OperatorUnknownCode = typeof OPERATOR_UNKNOWN_CODE;

/** Read this before retrying an `unknown` — it is the only source of truth. */
export const OPERATOR_DISPATCH_STATUS_PATH = "/v1/confenge/dispatch/status" as const;

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
  /** Minted by the channel. Never caller-supplied: it keys this record. */
  correlation_id: string;
  /**
   * The caller's own reference, echoed verbatim for their correlation. It keys
   * nothing: a replay cannot collide with, or rewrite, an existing entry.
   */
  client_reference: string | null;
  /** Requested action name verbatim — kept even when it is not on the allowlist. */
  requested_action: string;
  action: OperatorActionName | null;
  outcome: OperatorOutcome;
  refusal_code: OperatorRefusalCode | OperatorUnknownCode | null;
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
 * Fan-out that keeps the in-process record authoritative.
 *
 * `onSinkError` is required, not optional: a mirror that fails silently is how
 * an executed resume ends up with no visible timeline row and no error. Pass
 * `defaultOperatorSinkErrorHandler()` unless you have something better.
 *
 * `primary.record` is guarded too. When the authoritative store throws, the
 * sinks are still offered the entry — some record is better than none — and the
 * primary failure is then rethrown so the caller can never mistake it for a
 * durable write.
 */
export function createFanOutOperatorActionLedger(
  primary: OperatorActionLedger,
  sinks: readonly OperatorActionLedger[],
  onSinkError: (err: unknown, entry: OperatorActionLedgerEntry) => void,
): OperatorActionLedger {
  return {
    record(entry) {
      let primaryError: unknown;
      let primaryFailed = false;
      try {
        primary.record(entry);
      } catch (err) {
        primaryFailed = true;
        primaryError = err;
        onSinkError(err, entry);
      }
      for (const sink of sinks) {
        try {
          sink.record(entry);
        } catch (err) {
          onSinkError(err, entry);
        }
      }
      if (primaryFailed) {
        throw primaryError;
      }
    },
    list() {
      return primary.list();
    },
  };
}

/**
 * Default mirror-failure handler: error level, full entry serialized. The entry
 * carries no secret (no token, no Remote-Email), so serializing it whole is
 * what makes the lost row recoverable from the log.
 */
export function defaultOperatorSinkErrorHandler(
  logger: Logger = createStderrLogger(),
): (err: unknown, entry: OperatorActionLedgerEntry) => void {
  return (err, entry) => {
    logger({
      level: "error",
      msg: "warmbly.operator.ledger_sink_failed",
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      correlation_id: entry.correlation_id,
      outcome: entry.outcome,
      entry: JSON.stringify(entry),
    });
  };
}

export const OPERATOR_LEDGER_WAL_MARKER = "cc.warmbly.operator-action.wal" as const;

/** One self-contained JSON line: the entry that could not be persisted. */
export function operatorLedgerWalLine(entry: OperatorActionLedgerEntry, err: unknown): string {
  return `${JSON.stringify({
    wal: OPERATOR_LEDGER_WAL_MARKER,
    error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    entry,
  })}\n`;
}

/**
 * Durable last resort when the ledger itself fails after the write already
 * happened. Written synchronously to fd 2 so it survives a process that is
 * about to die with the exception we are re-throwing.
 */
export function writeOperatorLedgerWal(entry: OperatorActionLedgerEntry, err: unknown): void {
  const line = operatorLedgerWalLine(entry, err);
  try {
    writeSync(2, line);
  } catch {
    // Nothing left to fall back to; never mask the original failure.
  }
}

export function operatorLedgerId(correlationId: string): string {
  const slug = correlationId.replace(/[^A-Za-z0-9._~-]+/g, "-").slice(0, 96);
  return `cc:warmbly-operator-action:${slug}`;
}
