/**
 * Canonical attack identifiers. These strings are the contract: docs, fixtures,
 * evaluators, CLI output, and READY_FOR_INTERNAL_PRODUCTION all use them verbatim.
 */

export const ATTACK_IDS = [
  "stale data mostrado como saudável",
  "double counting financeiro",
  "hypothesis promovida a fact",
  "agent sobrescrevendo founder decision",
  "scope leakage entre cliente/repos",
  "duplicated collector event",
  "provider mutation acidental",
  "secret/PII leakage",
  "timezone boundary",
  "partial outage",
  "stale RUNNING agent session",
  "conflicting directives/supersession",
  "auth bypass assumptions",
  "missing provenance",
] as const;

export type AttackId = (typeof ATTACK_IDS)[number];

export const ATTACK_SLUGS: Record<AttackId, string> = {
  "stale data mostrado como saudável": "stale-data-mostrado-como-saudavel",
  "double counting financeiro": "double-counting-financeiro",
  "hypothesis promovida a fact": "hypothesis-promovida-a-fact",
  "agent sobrescrevendo founder decision": "agent-sobrescrevendo-founder-decision",
  "scope leakage entre cliente/repos": "scope-leakage-entre-cliente-repos",
  "duplicated collector event": "duplicated-collector-event",
  "provider mutation acidental": "provider-mutation-acidental",
  "secret/PII leakage": "secret-pii-leakage",
  "timezone boundary": "timezone-boundary",
  "partial outage": "partial-outage",
  "stale RUNNING agent session": "stale-running-agent-session",
  "conflicting directives/supersession": "conflicting-directives-supersession",
  "auth bypass assumptions": "auth-bypass-assumptions",
  "missing provenance": "missing-provenance",
};

const ATTACK_ID_SET: ReadonlySet<string> = new Set(ATTACK_IDS);

export function isAttackId(value: unknown): value is AttackId {
  return typeof value === "string" && ATTACK_ID_SET.has(value);
}

export function assertAttackId(value: unknown): AttackId {
  if (!isAttackId(value)) {
    throw new Error(`unknown attack_id: ${String(value)}`);
  }
  return value;
}

export const ATTACK_COUNT = ATTACK_IDS.length;
