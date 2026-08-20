import { confidenceFor, healthStatusFor } from "./map.js";
import { stripSecretKeys } from "./parse.js";
import type {
  ErrorObject,
  EvaluationContext,
  FreshnessStatus,
  PncpContractV1,
  PncpFreshnessEvaluation,
  Provenance,
  ServiceHealth,
  SourceObservation,
  SourceRef,
  StatusMapping,
  UpstreamStatus,
} from "./types.js";
import {
  CONTRACT_VERSION,
  EXTRA_CLI_SOURCE_KIND,
  EXTRA_CLI_SYSTEM,
  PNCP_SCOPE,
  PNCP_SERVICE_HEALTH_ID,
  PNCP_SERVICE_NAME,
  PNCP_SOURCE_OBSERVATION_ID,
  SERVICE_HEALTH_SCHEMA,
  SOURCE_OBSERVATION_SCHEMA,
} from "./types.js";

function sourceRef(locator: string): SourceRef {
  return {
    system: EXTRA_CLI_SYSTEM,
    kind: EXTRA_CLI_SOURCE_KIND,
    locator,
    label: CONTRACT_VERSION,
  };
}

function provenanceFor(
  locator: string,
  observedAt: string,
  freshness: FreshnessStatus,
  upstream: UpstreamStatus | null,
): Provenance {
  return {
    source: sourceRef(locator),
    observed_at: observedAt,
    freshness_status: freshness,
    confidence: confidenceFor(freshness, upstream),
  };
}

export function contractEvidence(
  contract: PncpContractV1,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    contract_version: contract.contract_version,
    upstream_status: contract.status,
    reason_codes: [...contract.reason_codes],
    as_of: contract.as_of,
    deployed_sha: contract.deployed_sha,
    policy_version: contract.policy_version,
    current_lag_hours: contract.current_lag_hours,
    lag_p50_hours: contract.lag_p50_hours,
    lag_p95_hours: contract.lag_p95_hours,
    lag_p99_hours: contract.lag_p99_hours,
    lag_sample_n: contract.lag_sample_n,
    source_publication_or_update_at: contract.source_publication_or_update_at,
    first_observed_at: contract.first_observed_at,
    persisted_at: contract.persisted_at,
    last_run_at: contract.last_run_at,
    next_run_at: contract.next_run_at,
    latest_successful_closed_window: contract.latest_successful_closed_window,
    oldest_unresolved_gap: contract.oldest_unresolved_gap,
    unresolved_window_count: contract.unresolved_window_count,
    source_window: contract.source_window,
    slo: contract.slo,
    timer: contract.timer,
    health_exit: contract.health_exit,
    campaign_verdict_hint: contract.campaign_verdict_hint,
  };
  return stripSecretKeys(payload);
}

function idempotencyKey(
  asOf: string | null,
  upstream: UpstreamStatus | null,
  freshness: FreshnessStatus,
  errorCode?: string,
): string {
  if (asOf && upstream) {
    return `extra-cli:pncp-contract-freshness:${asOf}:${upstream}`;
  }
  return `extra-cli:pncp-contract-freshness:${freshness}:${errorCode ?? "ERROR"}`;
}

function toIso(date: Date): string {
  return date.toISOString();
}

export function projectSuccess(
  contract: PncpContractV1,
  mapping: StatusMapping,
  ctx: EvaluationContext,
): PncpFreshnessEvaluation {
  const observedAt = contract.as_of;
  const collectedAt = toIso(ctx.collectedAt);
  const provenance = provenanceFor(
    ctx.locator,
    observedAt,
    mapping.freshness_status,
    mapping.upstream_status,
  );
  const evidence = contractEvidence(contract);
  const message =
    mapping.upstream_status === "DEGRADED"
      ? `upstream DEGRADED mapped to STALE (${contract.reason_codes.join(",") || "no reason_codes"})`
      : contract.reason_codes[0];

  const serviceHealth: ServiceHealth = {
    schema_version: SERVICE_HEALTH_SCHEMA,
    id: PNCP_SERVICE_HEALTH_ID,
    scope: PNCP_SCOPE,
    service_name: PNCP_SERVICE_NAME,
    status: healthStatusFor(mapping.freshness_status),
    provenance,
    checked_at: collectedAt,
    message: message || undefined,
  };

  const sourceObservation: SourceObservation = {
    schema_version: SOURCE_OBSERVATION_SCHEMA,
    id: PNCP_SOURCE_OBSERVATION_ID,
    scope: PNCP_SCOPE,
    provenance,
    collected_at: collectedAt,
    idempotency_key: idempotencyKey(
      contract.as_of,
      mapping.upstream_status,
      mapping.freshness_status,
    ),
    payload: evidence,
    payload_schema_ref: CONTRACT_VERSION,
  };

  return {
    freshness_status: mapping.freshness_status,
    upstream_status: mapping.upstream_status,
    contract_version: contract.contract_version,
    reason_codes: [...contract.reason_codes],
    as_of: contract.as_of,
    deployed_sha: contract.deployed_sha,
    policy_version: contract.policy_version,
    mapping,
    parse_error: null,
    adapter_kind: ctx.adapterKind,
    locator: ctx.locator,
    contract,
    serviceHealth,
    sourceObservation,
  };
}

export function projectFailure(
  ctx: EvaluationContext,
  error: ErrorObject,
  extras: {
    contract_version?: string | null;
  } = {},
): PncpFreshnessEvaluation {
  const collectedAt = toIso(ctx.collectedAt);
  const provenance = provenanceFor(ctx.locator, collectedAt, "ERROR", null);

  const serviceHealth: ServiceHealth = {
    schema_version: SERVICE_HEALTH_SCHEMA,
    id: PNCP_SERVICE_HEALTH_ID,
    scope: PNCP_SCOPE,
    service_name: PNCP_SERVICE_NAME,
    status: healthStatusFor("ERROR"),
    provenance,
    checked_at: collectedAt,
    message: error.message,
  };

  const sourceObservation: SourceObservation = {
    schema_version: SOURCE_OBSERVATION_SCHEMA,
    id: PNCP_SOURCE_OBSERVATION_ID,
    scope: PNCP_SCOPE,
    provenance,
    collected_at: collectedAt,
    idempotency_key: idempotencyKey(null, null, "ERROR", error.code),
    payload: {
      contract_version: extras.contract_version ?? null,
      upstream_status: null,
      reason_codes: [],
    },
    payload_schema_ref: CONTRACT_VERSION,
    error,
  };

  return {
    freshness_status: "ERROR",
    upstream_status: null,
    contract_version: extras.contract_version ?? null,
    reason_codes: [],
    as_of: null,
    deployed_sha: null,
    policy_version: null,
    mapping: null,
    parse_error: error,
    adapter_kind: ctx.adapterKind,
    locator: ctx.locator,
    contract: null,
    serviceHealth,
    sourceObservation,
  };
}
