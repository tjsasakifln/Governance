export { ATTACK_IDS, ATTACK_SLUGS, ATTACK_COUNT, isAttackId, assertAttackId } from "./attacks.js";
export type { AttackId } from "./attacks.js";
export {
  evaluateAttack,
  evaluateAttackViaPort,
  EVALUATORS,
  evaluateStaleDataShownAsHealthy,
  evaluateDoubleCountingFinanceiro,
  evaluateHypothesisPromotedToFact,
  evaluateAgentOverwritingFounderDecision,
  evaluateScopeLeakage,
  evaluateDuplicatedCollectorEvent,
  evaluateProviderMutationAcidental,
  evaluateSecretPiiLeakage,
  evaluateTimezoneBoundary,
  evaluatePartialOutage,
  evaluateStaleRunningAgentSession,
  evaluateConflictingDirectives,
  evaluateAuthBypassAssumptions,
  evaluateMissingProvenance,
} from "./evaluators.js";
export {
  readyForInternalProduction,
  evaluateFixturePayload,
  buildGateReport,
  checksFromVerdicts,
} from "./gate.js";
export {
  runAdversarialCorpus,
  runControlCorpus,
  runExplicitChecksCorpus,
  evaluateNamedPayload,
} from "./corpus.js";
export {
  loadAttackFixture,
  loadControlFixture,
  loadExplicitChecks,
  loadMatrixJson,
  loadReadyDefinitionJson,
  loadMergeChecklistJson,
  FixturePort,
} from "./adapters.js";
export type { QaRuntimePort } from "./adapters.js";
export { LiveRuntimePort, emptyLiveSnapshot, payloadForAttack } from "./live-port.js";
export type { LiveSnapshot } from "./live-port.js";
export { runLiveGate } from "./live-gate.js";
export type {
  AttackVerdict,
  CheckInput,
  ReadyVerdict,
  QaFixture,
  GateReport,
  VerdictState,
} from "./types.js";
export { FORBIDDEN_PROVIDER_OPERATIONS, isForbiddenProviderOperation } from "./forbidden.js";
export { parseCorpus, runGate, formatReport } from "./cli.js";
