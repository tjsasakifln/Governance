import type { AttackId } from "./attacks.js";

export type VerdictState = "pass" | "fail" | "UNKNOWN";

export type CaseKind =
  | "adversarial"
  | "control"
  | "all-pass"
  | "unknown-check"
  | "missing-check"
  | "live";

export interface AttackVerdict {
  attack_id: AttackId;
  state: VerdictState;
  reason: string;
  evidence: Record<string, unknown>;
}

export interface CheckInput {
  attack_id: AttackId;
  state: VerdictState;
  reason?: string;
}

export interface ReadyVerdict {
  READY_FOR_INTERNAL_PRODUCTION: boolean;
  rule: "fail-closed conjunction of the 14 named attack checks";
  named_attack_count: number;
  missing_checks: AttackId[];
  duplicate_checks: AttackId[];
  failed_checks: AttackId[];
  unknown_checks: AttackId[];
  passed_checks: AttackId[];
  reason: string;
}

export interface QaFixture {
  schema_version: "control-center.qa-fixture.v1";
  attack_id: AttackId;
  case_kind: "adversarial" | "control";
  description: string;
  expected_state: "fail" | "pass";
  reject_outcome: string;
  payload: unknown;
}

export interface ExplicitChecksFile {
  schema_version: "control-center.qa-checks.v1";
  description: string;
  checks: CheckInput[];
}

export interface SourceRefLike {
  system?: unknown;
  kind?: unknown;
  locator?: unknown;
  label?: unknown;
}

export interface ProvenanceLike {
  source?: SourceRefLike | string;
  observed_at?: unknown;
  freshness_status?: unknown;
  confidence?: unknown;
}

export interface ActorLike {
  kind?: unknown;
  id?: unknown;
  role?: unknown;
  display_name?: unknown;
}

export interface GateReportAttack {
  attack_id: AttackId;
  case_kind: CaseKind;
  state: VerdictState;
  ready_contribution: "ready-component" | "not-ready";
  reason: string;
  evidence: Record<string, unknown>;
}

export interface GateReport {
  schema_version: "control-center.qa-gate-report.v1";
  corpus: "adversarial" | "controls" | "all-pass" | "unknown-check" | "missing-check" | "live";
  hostile: boolean;
  as_of: string;
  READY_FOR_INTERNAL_PRODUCTION: boolean;
  ready: ReadyVerdict;
  attacks: GateReportAttack[];
  named_attacks: AttackId[];
  forbidden_side_effects: {
    cobranca: false;
    checkout: false;
    refund: false;
    cancelamento: false;
    asaas_write: false;
    commercial_send: false;
  };
  notes: string[];
}
