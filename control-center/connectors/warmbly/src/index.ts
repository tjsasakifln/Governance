export {
  attentionSlice,
  collect,
  collectFromFixture,
  collectFromWarmblyPayload,
  WarmblyClient,
} from "./collect.ts";
export type { CollectOptions } from "./collect.ts";
export {
  COMMERCIAL_SNAPSHOT_SCHEMA,
  SNAPSHOT_SOURCE,
} from "./contracts/snapshot.ts";
export type {
  CommercialAttentionItem,
  CommercialSnapshot,
  FreshnessStatus,
  Money,
  Provenance,
  RequiredUpstreamContract,
  SourceObservation,
} from "./contracts/snapshot.ts";
export type { WarmblyPayload } from "./contracts/warmbly-payload.ts";
export { classifyRequest, isAllowedRead } from "./http/allowlist.ts";
export {
  CircuitOpenError,
  MethodNotAllowedError,
  TimeoutError,
} from "./http/client.ts";
export { COLLECT_ROUTES, MAPPED_READ_ROUTES } from "./collector/routes.ts";
export { normalizeIntelEnvelope, intelSurfaceForRouteKey } from "./collector/envelope.ts";
export type { EnvelopeResult, IntelSurface } from "./collector/envelope.ts";
export { fetchWarmblyPayload } from "./collector/fetch.ts";
export {
  parseCanaryArgs,
  runCli as runCanaryCli,
  runWarmblyCanary,
} from "./canary.ts";
export { CAPABILITIES, CANARY_COLLECTORS, buildEnvelope } from "./envelope.ts";
export type { Capability, CanaryReport } from "./envelope.ts";
export {
  REQUIRED_SECRET_NAMES,
  loadWarmblyProductionConfig,
  resolveWarmblySecrets,
} from "./production-config.ts";
/**
 * Operator action channel — the narrow, named write surface. Everything else
 * exported from this connector stays read-only.
 */
export * from "./operator/index.ts";
export {
  HUMAN_GATE_CONTRACT,
  HUMAN_GATE_PREFIX,
  HUMAN_GATE_ROUTES,
  createHumanGateHttpHandler,
} from "./human-gate/http.ts";
export type { HumanGateHttpOptions } from "./human-gate/http.ts";
export {
  ADJUSTMENT_FIELDS,
  ADJUST_EDGE_ONLY_FIELDS,
  ADJUST_ERROR_CODES,
  ADJUST_REFUSED_FIELDS,
  ADJUST_REQUEST_FIELDS,
  ADJUST_RESPONSE_FIELDS,
  FORBIDDEN_HUMAN_GATE_SEGMENTS,
  HUMAN_GATE_OPERATIONS,
  HUMAN_GATE_OUTCOMES,
  HUMAN_GATE_WRITE_OPERATIONS,
  UUID_PATTERN_SOURCE,
  WARMBLY_COHORTS_PREFIX,
  isCanonicalUuid,
  validateAdjustRequest,
} from "./human-gate/contract.ts";
export type {
  AdjustErrorCode,
  AdjustRequest,
  AdjustRequestField,
  AdjustValidation,
  CohortAdjustResponse,
  CohortAdjustment,
  CohortAdjustmentDiffEntry,
  HumanGateOperation,
  HumanGateOutcome,
} from "./human-gate/contract.ts";
