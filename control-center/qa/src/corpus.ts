import { ATTACK_IDS, type AttackId } from "./attacks.js";
import {
  loadAttackFixture,
  loadControlFixture,
  loadExplicitChecks,
} from "./adapters.js";
import { evaluateAttackViaPort } from "./evaluators.js";
import { FixturePort } from "./adapters.js";
import { buildGateReport, readyForInternalProduction } from "./gate.js";
import type { AttackVerdict, CheckInput, GateReport } from "./types.js";

export function evaluateNamedPayload(attackId: AttackId, payload: unknown): AttackVerdict {
  return evaluateAttackViaPort(attackId, new FixturePort(payload));
}

export function runAdversarialCorpus(): GateReport {
  const verdicts: AttackVerdict[] = ATTACK_IDS.map((attackId) => {
    const fixture = loadAttackFixture(attackId);
    return evaluateNamedPayload(attackId, fixture.payload);
  });
  return buildGateReport({
    corpus: "adversarial",
    hostile: true,
    verdicts,
    notes: [
      "Adversarial corpus must fail every named attack.",
      "READY_FOR_INTERNAL_PRODUCTION is not granted against attack fixtures.",
      "This entry performs no cobrança, checkout, refund, cancelamento, Asaas write, or commercial send.",
    ],
  });
}

export function runControlCorpus(): GateReport {
  const verdicts: AttackVerdict[] = ATTACK_IDS.map((attackId) => {
    const fixture = loadControlFixture(attackId);
    return evaluateNamedPayload(attackId, fixture.payload);
  });
  return buildGateReport({
    corpus: "controls",
    hostile: false,
    verdicts,
    notes: [
      "Non-attack controls must not be classified as the corresponding attack.",
      "READY_FOR_INTERNAL_PRODUCTION requires every named check explicitly pass.",
    ],
  });
}

export function runExplicitChecksCorpus(
  name: "all-pass" | "unknown-check" | "missing-check",
): GateReport {
  const file = loadExplicitChecks(name);
  const ready = readyForInternalProduction(file.checks);
  const verdicts: AttackVerdict[] = ATTACK_IDS.map((attackId) => {
    const found = file.checks.find((c) => c.attack_id === attackId);
    const state = found?.state ?? "UNKNOWN";
    const reason =
      found === undefined
        ? "check unrun/missing"
        : (found.reason ?? `explicit ${found.state}`);
    return {
      attack_id: attackId,
      state,
      reason,
      evidence: { explicit: true, present: found !== undefined },
    };
  });
  const report = buildGateReport({
    corpus: name,
    hostile: !ready.READY_FOR_INTERNAL_PRODUCTION,
    verdicts,
    notes: [file.description],
  });
  return report;
}

export function explicitChecksOf(name: "all-pass" | "unknown-check" | "missing-check"): CheckInput[] {
  return loadExplicitChecks(name).checks;
}
