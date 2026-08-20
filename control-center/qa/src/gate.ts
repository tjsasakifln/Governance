import { ATTACK_IDS, ATTACK_COUNT, isAttackId, type AttackId } from "./attacks.js";
import { FixturePort } from "./adapters.js";
import { evaluateAttack, evaluateAttackViaPort } from "./evaluators.js";
import type {
  AttackVerdict,
  CheckInput,
  GateReport,
  GateReportAttack,
  ReadyVerdict,
  VerdictState,
} from "./types.js";

const RULE = "fail-closed conjunction of the 14 named attack checks" as const;

export function readyForInternalProduction(checks: readonly CheckInput[]): ReadyVerdict {
  const seen = new Map<AttackId, CheckInput[]>();
  const unknownIds: AttackId[] = [];
  const extra: string[] = [];

  for (const check of checks) {
    if (!isAttackId(check.attack_id)) {
      extra.push(String(check.attack_id));
      continue;
    }
    const arr = seen.get(check.attack_id) ?? [];
    arr.push(check);
    seen.set(check.attack_id, arr);
  }

  const missing_checks = ATTACK_IDS.filter((id) => !seen.has(id));
  const duplicate_checks = ATTACK_IDS.filter((id) => (seen.get(id)?.length ?? 0) > 1);
  const failed_checks: AttackId[] = [];
  const unknown_checks: AttackId[] = [];
  const passed_checks: AttackId[] = [];

  for (const id of ATTACK_IDS) {
    const entries = seen.get(id);
    if (!entries || entries.length === 0) {
      continue;
    }
    const first = entries[0];
    if (!first) {
      continue;
    }
    if (entries.length > 1) {
      continue;
    }
    if (first.state === "pass") {
      passed_checks.push(id);
    } else if (first.state === "fail") {
      failed_checks.push(id);
    } else {
      unknown_checks.push(id);
      unknownIds.push(id);
    }
  }

  const ready =
    missing_checks.length === 0 &&
    duplicate_checks.length === 0 &&
    failed_checks.length === 0 &&
    unknown_checks.length === 0 &&
    passed_checks.length === ATTACK_COUNT;

  const reason = ready
    ? "all 14 named checks are explicitly pass"
    : "fail-closed: UNKNOWN, unrun, missing, duplicate, or fail is not READY_FOR_INTERNAL_PRODUCTION";

  return {
    READY_FOR_INTERNAL_PRODUCTION: ready,
    rule: RULE,
    named_attack_count: ATTACK_COUNT,
    missing_checks,
    duplicate_checks,
    failed_checks,
    unknown_checks: unknown_checks.length > 0 ? unknown_checks : unknownIds,
    passed_checks,
    reason,
  };
}

export function checksFromVerdicts(verdicts: readonly AttackVerdict[]): CheckInput[] {
  return verdicts.map((v) => ({
    attack_id: v.attack_id,
    state: v.state,
    reason: v.reason,
  }));
}

export function evaluateFixturePayload(attackId: AttackId, payload: unknown): AttackVerdict {
  return evaluateAttackViaPort(attackId, new FixturePort(payload));
}

export function readyContribution(state: VerdictState): "ready-component" | "not-ready" {
  return state === "pass" ? "ready-component" : "not-ready";
}

export function buildGateReport(args: {
  corpus: GateReport["corpus"];
  hostile: boolean;
  verdicts: AttackVerdict[];
  notes?: string[];
  asOf?: string;
}): GateReport {
  const ready = readyForInternalProduction(checksFromVerdicts(args.verdicts));
  const attacks: GateReportAttack[] = args.verdicts.map((v) => ({
    attack_id: v.attack_id,
    case_kind:
      args.corpus === "adversarial"
        ? "adversarial"
        : args.corpus === "controls"
          ? "control"
          : args.corpus,
    state: v.state,
    ready_contribution: readyContribution(v.state),
    reason: v.reason,
    evidence: v.evidence,
  }));

  return {
    schema_version: "control-center.qa-gate-report.v1",
    corpus: args.corpus,
    hostile: args.hostile,
    as_of: args.asOf ?? new Date().toISOString(),
    READY_FOR_INTERNAL_PRODUCTION: ready.READY_FOR_INTERNAL_PRODUCTION,
    ready,
    attacks,
    named_attacks: [...ATTACK_IDS],
    forbidden_side_effects: {
      cobranca: false,
      checkout: false,
      refund: false,
      cancelamento: false,
      asaas_write: false,
      commercial_send: false,
    },
    notes: args.notes ?? [],
  };
}

export { evaluateAttack };
