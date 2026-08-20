import { hasDataTimestamp, hasFreshnessEvidence } from "./classify.js";
import type {
  Classification,
  FreshnessEvidence,
  FreshnessStatus,
  FreshnessThresholds,
  PncpMetricsSnapshot,
  ServiceHealth,
  SourceObservation,
} from "./types.js";
import {
  PNCP_HEALTHY_LABEL,
  PNCP_SOURCE_ID,
  SCHEMA_VERSION,
  STATUS_LABELS,
} from "./types.js";

export function buildEvidence(
  snapshot: PncpMetricsSnapshot,
  thresholds: FreshnessThresholds,
): FreshnessEvidence {
  return {
    last_item_observed_at: snapshot.last_item_observed_at,
    last_success_at: snapshot.last_success_at,
    source_max_timestamp: snapshot.source_max_timestamp,
    recent_window_count: snapshot.recent_window_count,
    consecutive_errors: snapshot.consecutive_errors,
    lag_seconds: snapshot.lag_seconds,
    collector_heartbeat_at: snapshot.collector_heartbeat_at,
    recent_window_hours: thresholds.recentWindowHours,
    last_success_sla_hours: thresholds.lastSuccessSlaHours,
    data_sla_hours: thresholds.dataSlaHours,
  };
}

export function evidenceIsEmpty(evidence: FreshnessEvidence): boolean {
  return (
    evidence.last_item_observed_at === null &&
    evidence.source_max_timestamp === null &&
    evidence.last_success_at === null &&
    evidence.recent_window_count === null
  );
}

/**
 * Fail-closed projection. "PNCP saudável" / healthy=true is unrepresentable
 * without a data timestamp and freshness evidence.
 */
export function projectPncpHealth(
  snapshot: PncpMetricsSnapshot,
  classification: Classification,
  thresholds: FreshnessThresholds,
): { serviceHealth: ServiceHealth; sourceObservation: SourceObservation } {
  const evidence = buildEvidence(snapshot, thresholds);
  const timestampPresent =
    classification.timestamp_present && hasDataTimestamp(snapshot);
  const evidencePresent =
    classification.evidence_present && hasFreshnessEvidence(snapshot);

  let status: FreshnessStatus = classification.status;
  const reasons = [...classification.reasons];
  if (status === "FRESH" && (!timestampPresent || !evidencePresent)) {
    status = "UNKNOWN";
    reasons.push("fail_closed_missing_timestamp_or_evidence");
  }

  const healthy = status === "FRESH" && timestampPresent && evidencePresent;
  const label = healthy ? PNCP_HEALTHY_LABEL : STATUS_LABELS[status];

  if (!healthy && label === PNCP_HEALTHY_LABEL) {
    throw new Error("invariant: healthy label requires timestamp and evidence");
  }

  const dataObservedAt =
    snapshot.source_max_timestamp ?? snapshot.last_item_observed_at;

  const serviceHealth: ServiceHealth = {
    schema_version: SCHEMA_VERSION,
    source: PNCP_SOURCE_ID,
    observed_at: snapshot.observed_at,
    freshness_status: status,
    confidence: classification.confidence,
    service: PNCP_SOURCE_ID,
    healthy,
    label,
    reasons,
    evidence,
    collector_alive: classification.collector_alive,
    collector_stalled: classification.collector_stalled,
  };

  const sourceObservation: SourceObservation = {
    schema_version: SCHEMA_VERSION,
    source: PNCP_SOURCE_ID,
    observed_at: dataObservedAt,
    freshness_status: status,
    confidence: classification.confidence,
    last_item_observed_at: snapshot.last_item_observed_at,
    last_success_at: snapshot.last_success_at,
    lag_seconds: snapshot.lag_seconds,
    recent_window_count: snapshot.recent_window_count,
    consecutive_errors: snapshot.consecutive_errors,
    source_max_timestamp: snapshot.source_max_timestamp,
    evidence,
  };

  return { serviceHealth, sourceObservation };
}
