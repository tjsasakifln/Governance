import type {
  Classification,
  FreshnessStatus,
  FreshnessThresholds,
  PncpMetricsSnapshot,
} from "./types.js";
import { isCredentialErrorCode } from "./parse.js";

function ageHours(iso: string | null, now: Date): number | null {
  if (!iso) {
    return null;
  }
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) {
    return null;
  }
  const hours = (now.getTime() - parsed) / 3_600_000;
  return hours < 0 ? 0 : hours;
}

export function hasDataTimestamp(snapshot: PncpMetricsSnapshot): boolean {
  return Boolean(snapshot.source_max_timestamp || snapshot.last_item_observed_at);
}

export function hasFreshnessEvidence(snapshot: PncpMetricsSnapshot): boolean {
  return (
    hasDataTimestamp(snapshot) &&
    snapshot.last_success_at !== null &&
    snapshot.recent_window_count !== null &&
    snapshot.consecutive_errors !== null
  );
}

function result(
  status: FreshnessStatus,
  reasons: string[],
  flags: {
    collector_alive: boolean;
    collector_stalled: boolean;
    confidence: number;
    evidence_present: boolean;
    timestamp_present: boolean;
  },
): Classification {
  return {
    status,
    reasons,
    collector_alive: flags.collector_alive,
    collector_stalled: flags.collector_stalled,
    confidence: flags.confidence,
    evidence_present: flags.evidence_present,
    timestamp_present: flags.timestamp_present,
  };
}

/**
 * Pure classifier. I/O stays in the adapter. Missing timestamp or evidence
 * never returns FRESH.
 */
export function classifyPncpFreshness(
  snapshot: PncpMetricsSnapshot,
  thresholds: FreshnessThresholds,
  now: Date,
): Classification {
  const evidencePresent = hasFreshnessEvidence(snapshot);
  const timestampPresent = hasDataTimestamp(snapshot);
  const lastSuccessAge = ageHours(snapshot.last_success_at, now);
  const dataTimestamp = snapshot.source_max_timestamp ?? snapshot.last_item_observed_at;
  const dataAge = ageHours(dataTimestamp, now);
  const heartbeatAge = ageHours(snapshot.collector_heartbeat_at, now);

  const collectorAlive =
    (heartbeatAge !== null && heartbeatAge <= thresholds.collectorAliveMaxAgeHours) ||
    (lastSuccessAge !== null && lastSuccessAge <= thresholds.collectorAliveMaxAgeHours);

  const windowCount = snapshot.recent_window_count;
  const dataStopped =
    !timestampPresent ||
    (dataAge !== null && dataAge > thresholds.dataSlaHours) ||
    windowCount === 0;

  const baseFlags = {
    collector_alive: collectorAlive,
    collector_stalled: false,
    evidence_present: evidencePresent,
    timestamp_present: timestampPresent,
  };

  if (
    snapshot.credential_status === "unavailable" ||
    isCredentialErrorCode(snapshot.error_code)
  ) {
    return result("ERROR", ["credential_unavailable"], {
      ...baseFlags,
      collector_alive: false,
      confidence: 0.9,
    });
  }

  if (snapshot.read_error) {
    return result("ERROR", [snapshot.read_error], {
      ...baseFlags,
      confidence: 0.8,
    });
  }

  if (
    snapshot.consecutive_errors !== null &&
    snapshot.consecutive_errors >= thresholds.consecutiveErrorThreshold
  ) {
    return result(
      "ERROR",
      [`consecutive_errors=${snapshot.consecutive_errors}`],
      { ...baseFlags, confidence: 0.85 },
    );
  }

  if (collectorAlive && dataStopped) {
    const reasons = ["collector_alive_data_stopped"];
    if (!timestampPresent) {
      reasons.push("missing_data_timestamp");
    }
    if (dataAge !== null && dataAge > thresholds.dataSlaHours) {
      reasons.push(`source_max_age_hours=${dataAge.toFixed(1)}`);
    }
    if (windowCount === 0) {
      reasons.push("recent_window_count=0");
    }
    if (windowCount === null) {
      reasons.push("recent_window_count_missing");
    }
    return result("STALE", reasons, {
      ...baseFlags,
      collector_stalled: true,
      confidence: 0.8,
    });
  }

  const silent =
    snapshot.last_success_at === null &&
    snapshot.last_item_observed_at === null &&
    snapshot.source_max_timestamp === null &&
    (windowCount === null || windowCount === 0) &&
    snapshot.collector_heartbeat_at === null;

  if (silent) {
    return result("UNKNOWN", ["silent_source", "incomplete_metrics"], {
      ...baseFlags,
      collector_alive: false,
      confidence: 0.2,
    });
  }

  const lagOk =
    snapshot.lag_seconds === null
      ? dataAge !== null && dataAge <= thresholds.dataSlaHours
      : snapshot.lag_seconds <= thresholds.dataSlaHours * 3600;

  const meetsFresh =
    evidencePresent &&
    timestampPresent &&
    lastSuccessAge !== null &&
    lastSuccessAge <= thresholds.lastSuccessSlaHours &&
    dataAge !== null &&
    dataAge <= thresholds.dataSlaHours &&
    windowCount !== null &&
    windowCount >= thresholds.minRecentWindowCount &&
    snapshot.consecutive_errors === 0 &&
    lagOk &&
    snapshot.read_error === null;

  if (meetsFresh) {
    return result("FRESH", ["live_pipeline"], {
      ...baseFlags,
      collector_alive: true,
      collector_stalled: false,
      confidence: 0.95,
    });
  }

  const dead =
    (lastSuccessAge !== null && lastSuccessAge > thresholds.deadPipelineMaxAgeHours) ||
    (dataAge !== null && dataAge > thresholds.deadPipelineMaxAgeHours) ||
    (!collectorAlive &&
      (lastSuccessAge === null || lastSuccessAge > thresholds.lastSuccessSlaHours) &&
      dataAge !== null);

  if (dead) {
    const reasons = ["dead_pipeline"];
    if (lastSuccessAge !== null) {
      reasons.push(`last_success_age_hours=${lastSuccessAge.toFixed(1)}`);
    }
    if (dataAge !== null) {
      reasons.push(`source_max_age_hours=${dataAge.toFixed(1)}`);
    }
    return result("STALE", reasons, { ...baseFlags, confidence: 0.75 });
  }

  if (lastSuccessAge !== null && lastSuccessAge > thresholds.lastSuccessSlaHours) {
    return result("STALE", ["last_success_beyond_sla"], {
      ...baseFlags,
      confidence: 0.7,
    });
  }

  if (dataAge !== null && dataAge > thresholds.dataSlaHours) {
    return result("STALE", ["data_beyond_sla"], { ...baseFlags, confidence: 0.7 });
  }

  if (!evidencePresent || !timestampPresent) {
    return result("UNKNOWN", ["incomplete_metrics"], {
      ...baseFlags,
      confidence: 0.25,
    });
  }

  return result("UNKNOWN", ["incomplete_metrics"], {
    ...baseFlags,
    confidence: 0.25,
  });
}
