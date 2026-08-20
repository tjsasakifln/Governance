import type { FreshnessStatus, ProbeStatus, ServiceStatus } from "./types.js";

export function freshnessFromProbe(args: {
  probeStatus: ProbeStatus;
  now: Date;
  staleAfterSeconds: number;
  agentObservedAt?: string;
}): FreshnessStatus {
  if (args.probeStatus === "timeout" || args.probeStatus === "error") {
    return "ERROR";
  }
  if (args.probeStatus === "missing") {
    return "UNKNOWN";
  }
  if (args.agentObservedAt) {
    const observedMs = Date.parse(args.agentObservedAt);
    if (Number.isNaN(observedMs)) {
      return "UNKNOWN";
    }
    const ageSec = (args.now.getTime() - observedMs) / 1000;
    if (ageSec > args.staleAfterSeconds) {
      return "STALE";
    }
    if (ageSec < -args.staleAfterSeconds) {
      return "UNKNOWN";
    }
  }
  return "FRESH";
}

export function worstFreshness(statuses: readonly FreshnessStatus[]): FreshnessStatus {
  const rank: Record<FreshnessStatus, number> = {
    ERROR: 4,
    STALE: 3,
    UNKNOWN: 2,
    FRESH: 1,
  };
  let worst: FreshnessStatus = "FRESH";
  for (const status of statuses) {
    if (rank[status] > rank[worst]) {
      worst = status;
    }
  }
  return worst;
}

export function worstServiceStatus(statuses: readonly ServiceStatus[]): ServiceStatus {
  const rank: Record<ServiceStatus, number> = {
    unhealthy: 4,
    degraded: 3,
    unknown: 2,
    healthy: 1,
  };
  let worst: ServiceStatus = "healthy";
  for (const status of statuses) {
    if (rank[status] > rank[worst]) {
      worst = status;
    }
  }
  return worst;
}

/** Healthy+FRESH is only legal when freshness is FRESH and status is healthy. */
export function coalesceServiceStatus(
  checkStatuses: readonly ServiceStatus[],
  freshness: FreshnessStatus,
): ServiceStatus {
  const worst = worstServiceStatus(checkStatuses);
  if (freshness !== "FRESH" && worst === "healthy") {
    return "unknown";
  }
  return worst;
}

export function confidenceFor(freshness: FreshnessStatus, probeStatus: ProbeStatus): number {
  if (probeStatus === "timeout") {
    return 0.1;
  }
  if (probeStatus === "error" || probeStatus === "missing") {
    return 0.2;
  }
  if (freshness === "STALE") {
    return 0.4;
  }
  if (freshness === "UNKNOWN") {
    return 0.3;
  }
  if (freshness === "ERROR") {
    return 0.2;
  }
  return 0.95;
}

export function daysUntil(notAfterIso: string, now: Date): number {
  const notAfter = Date.parse(notAfterIso);
  if (Number.isNaN(notAfter)) {
    return Number.NaN;
  }
  return (notAfter - now.getTime()) / 86_400_000;
}
