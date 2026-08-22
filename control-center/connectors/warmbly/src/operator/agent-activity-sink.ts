/**
 * Sink that lands every operator action in the existing agent execution ledger
 * (`control-center/domains/agent-activity`), so an operator action shows up on
 * the same timeline as everything else that acted on the estate.
 *
 * Vocabulary map (documented, not silent):
 * - identity actor kind "human" (security ForwardAuth)  -> "founder" (ledger)
 * - outcome "executed"   -> ExecutionStatus DONE
 * - outcome "challenged" -> ExecutionStatus PARTIAL (step 1 of 2 completed)
 * - outcome "refused"    -> ExecutionStatus BLOCKED
 * - outcome "unknown"    -> ExecutionStatus UNKNOWN (written, answer never came)
 *
 * Nothing sensitive crosses: the actor id is the Authelia `Remote-User` handle,
 * never `Remote-Email`, and no token or reason-with-secret shape is carried.
 */

import type { OperatorActionLedger, OperatorActionLedgerEntry } from "./ledger.ts";

export const OPERATOR_LEDGER_AGENT_ID = "cc-warmbly-operator-channel";
export const OPERATOR_LEDGER_AGENT_PROVIDER = "control-center";
export const OPERATOR_LEDGER_REPO = "confenge/warmbly";

/** Structural port so the connector does not hard-depend on the domain build. */
export interface AgentLedgerLike {
  startSession(raw: unknown): unknown;
  reportResult(raw: unknown): unknown;
}

function statusFor(entry: OperatorActionLedgerEntry): "DONE" | "PARTIAL" | "BLOCKED" | "UNKNOWN" {
  if (entry.outcome === "executed") {
    return "DONE";
  }
  if (entry.outcome === "challenged") {
    return "PARTIAL";
  }
  // Never BLOCKED: "unknown" means the request was written and Warmbly may have
  // applied it. Showing it as blocked would claim nothing happened.
  if (entry.outcome === "unknown") {
    return "UNKNOWN";
  }
  return "BLOCKED";
}

function goalFor(entry: OperatorActionLedgerEntry): string {
  return `warmbly operator action ${entry.requested_action} on ${entry.target.kind}:${entry.target.id}`;
}

function summaryFor(entry: OperatorActionLedgerEntry): string {
  const status = entry.upstream.status === null ? "no-upstream-call" : `HTTP ${entry.upstream.status}`;
  const refusal = entry.refusal_code ? ` refusal=${entry.refusal_code}` : "";
  return `${entry.outcome} ${entry.requested_action} (${status})${refusal}`;
}

function evidenceFor(entry: OperatorActionLedgerEntry): string[] {
  const evidence = [
    `action=${entry.requested_action}`,
    `outcome=${entry.outcome}`,
    `target=${entry.target.kind}:${entry.target.id}`,
    `upstream=${entry.upstream.method ?? "none"} ${entry.upstream.path ?? "none"} ${
      entry.upstream.status === null ? "none" : entry.upstream.status
    }`,
    `circuit=${entry.circuit_state}`,
    `client_reference=${entry.client_reference ?? "none"}`,
    `confirmation=required:${entry.confirmation.required} satisfied:${entry.confirmation.satisfied}`,
    `recorded_at=${entry.recorded_at}`,
  ];
  if (entry.refusal_code) {
    evidence.push(`refusal_code=${entry.refusal_code}`);
  }
  if (entry.confirmation.token_id) {
    evidence.push(`confirmation_token_id=${entry.confirmation.token_id}`);
  }
  return evidence;
}

/**
 * `startSession` then `reportResult` so the ledger keeps a revision trail for
 * the action rather than a single opaque row.
 */
export function createAgentActivityLedgerSink(ledger: AgentLedgerLike): OperatorActionLedger {
  const mirrored: OperatorActionLedgerEntry[] = [];
  return {
    record(entry) {
      const actor = entry.actor ?? { kind: "system" as const, id: "cc-warmbly-operator-channel" };
      const provenance = {
        source: {
          system: entry.source.system,
          kind: entry.source.kind,
          locator: entry.source.locator,
        },
        observed_at: entry.observed_at,
        freshness_status: entry.freshness_status,
        confidence: entry.confidence,
      };
      ledger.startSession({
        correlation_id: entry.correlation_id,
        agent: { id: OPERATOR_LEDGER_AGENT_ID, provider: OPERATOR_LEDGER_AGENT_PROVIDER },
        repo: OPERATOR_LEDGER_REPO,
        goal: goalFor(entry),
        started_at: entry.recorded_at,
        actor,
        ...provenance,
      });
      ledger.reportResult({
        correlation_id: entry.correlation_id,
        status: statusFor(entry),
        finished_at: entry.recorded_at,
        summary: summaryFor(entry),
        evidence: evidenceFor(entry),
        blockers: entry.refusal_reason ? [entry.refusal_reason] : [],
        actor,
        ...provenance,
      });
      mirrored.push(structuredClone(entry));
    },
    list() {
      return mirrored.map((entry) => structuredClone(entry));
    },
  };
}
