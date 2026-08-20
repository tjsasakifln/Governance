export { createClientOps } from "./ops.js";
export type { ClientOps, CreateClientOpsOptions, QueryArgs } from "./ops.js";

export { ingestClientStatus, buildClientStatus, deriveNextAction } from "./ingest.js";
export type { IngestOptions } from "./ingest.js";
export type { IngestDraft } from "./validate.js";

export {
  scoreAccountHealth,
  classifyCommitment,
  isOpenBlocker,
  isOpenRisk,
  isBlockedDeliverable,
  isMaterialRisk,
  HEALTH_DELTAS,
  DUE_SOON_HOURS,
  bandFor,
  lifecycleFromHealth,
} from "./health.js";

export {
  queryAttention,
  queryDueCommitments,
  queryOpenBlockers,
  toHomepageAttention,
  requiresAttention,
  DEFAULT_DUE_HORIZON_HOURS,
} from "./queries.js";
export type { QueryInput } from "./queries.js";

export { InMemoryClientStore } from "./store.js";
export type { ClientStatusRepository } from "./store.js";

export { parseScope, formatClientScope, matchesScope } from "./scope.js";
export type { ParsedScope } from "./scope.js";

export {
  serializeCanonical,
  serializeClientStatus,
  serializeAttention,
  canonicalize,
} from "./serialize.js";

export { ClientOpsError, isClientOpsError, CLIENT_OPS_ERROR_CODES } from "./errors.js";
export type { ClientOpsErrorCode } from "./errors.js";

export { parseIngestInput } from "./validate.js";
export { findSensitiveHits, collectKeys, FORBIDDEN_KEY_REGEX } from "./sensitive.js";
export { frozenClock, systemClock, toUtcIso, isUtcDateTime, parseUtc } from "./clock.js";

export {
  SCHEMA_VERSION,
  FRESHNESS_STATUSES,
  COMMITMENT_STATUSES,
  BLOCKER_STATUSES,
  DELIVERABLE_STATUSES,
  RISK_STATUSES,
  RISK_SEVERITIES,
  HEALTH_BANDS,
  CLIENT_LIFECYCLES,
  HEALTH_REASON_CODES,
  SOURCE_MANUAL,
  SOURCE_GOVERNANCE,
  SOURCE_DERIVED_HEALTH,
  SOURCE_DERIVED_NEXT_ACTION,
  SOURCE_DERIVED_DUE_DATES,
  clientStatusId,
  clientScope,
  adapterSource,
} from "./contract.js";

export type {
  Provenance,
  Money,
  Commitment,
  Blocker,
  Deliverable,
  Risk,
  NextAction,
  HealthReason,
  AccountHealth,
  DueDate,
  ClientStatus,
  AttentionItem,
  HomepageAttention,
  DueCommitmentItem,
  OpenBlockerItem,
  ClientFactsPort,
  FreshnessStatus,
  CommitmentStatus,
  BlockerStatus,
  DeliverableStatus,
  RiskStatus,
  RiskSeverity,
  HealthBand,
  ClientLifecycle,
  HealthReasonCode,
} from "./contract.js";
