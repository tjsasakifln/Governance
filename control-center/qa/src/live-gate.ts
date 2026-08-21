import { ATTACK_IDS } from "./attacks.js";
import { evaluateAttackViaPort } from "./evaluators.js";
import { buildGateReport } from "./gate.js";
import { LiveRuntimePort, type LiveSnapshot } from "./live-port.js";
import type { AttackVerdict, GateReport } from "./types.js";

/**
 * Run the 14 shipped evaluators against a live-runtime snapshot.
 * UNKNOWN / fail / missing / duplicate is not READY_FOR_INTERNAL_PRODUCTION.
 */
export function runLiveGate(snapshot: LiveSnapshot, asOf?: string): GateReport {
  const port = new LiveRuntimePort(snapshot);
  const verdicts: AttackVerdict[] = ATTACK_IDS.map((attackId) =>
    evaluateAttackViaPort(attackId, port),
  );
  return buildGateReport({
    corpus: "live",
    hostile: false,
    verdicts,
    asOf: asOf ?? snapshot.as_of,
    notes: [
      "Live-runtime corpus: evaluators ran on payloads collected from Postgres, MCP, and production HTTP.",
      "READY_FOR_INTERNAL_PRODUCTION requires every named check explicitly pass.",
      "UNKNOWN, unrun, missing, duplicate, or fail is fail-closed (not ready).",
      "The adversarial fixture corpus remains hostile and is not this gate.",
      "This entry performs no cobrança, checkout, refund, cancelamento, Asaas write, or commercial send.",
    ],
  });
}
