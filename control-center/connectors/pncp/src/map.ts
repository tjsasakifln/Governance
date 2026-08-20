import type {
  FreshnessStatus,
  HealthStatus,
  StatusMapping,
  UpstreamStatus,
} from "./types.js";

/**
 * Translation table only. extra-cli `status` is the sole grade.
 * DEGRADED is demoted to STALE and preserved as `upstream_status`.
 * This function never inspects lag, windows, or error counts.
 */
const UPSTREAM_TO_CC: Record<UpstreamStatus, FreshnessStatus> = {
  FRESH: "FRESH",
  DEGRADED: "STALE",
  STALE: "STALE",
  UNKNOWN: "UNKNOWN",
};

export function mapUpstreamStatus(status: UpstreamStatus): StatusMapping {
  return {
    upstream_status: status,
    freshness_status: UPSTREAM_TO_CC[status],
  };
}

/** Trust of the translated signal. Not a recency classifier. */
export function confidenceFor(
  freshness: FreshnessStatus,
  upstream: UpstreamStatus | null,
): number {
  switch (freshness) {
    case "FRESH":
      return 0.95;
    case "STALE":
      return upstream === "DEGRADED" ? 0.7 : 0.55;
    case "UNKNOWN":
      return 0.25;
    case "ERROR":
      return 0;
  }
}

export function healthStatusFor(freshness: FreshnessStatus): HealthStatus {
  switch (freshness) {
    case "FRESH":
      return "healthy";
    case "STALE":
      return "degraded";
    case "UNKNOWN":
      return "unknown";
    case "ERROR":
      return "down";
  }
}
