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
