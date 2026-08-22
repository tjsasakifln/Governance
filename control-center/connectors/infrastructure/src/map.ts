import {
  coalesceServiceStatus,
  confidenceFor,
  daysUntil,
  freshnessFromProbe,
  worstFreshness,
} from "./freshness.js";
import { observationId, toUtcIso } from "./ids.js";
import type {
  Allowlist,
  AllowlistTarget,
  CheckKind,
  ProbeResult,
  ServiceCheck,
  ServiceHealth,
  ServiceStatus,
  SourceObservation,
} from "./types.js";
import { CHECK_KINDS } from "./types.js";

function targetById(allowlist: Allowlist, id: string): AllowlistTarget {
  const found = allowlist.targets.find((t) => t.id === id);
  if (!found) {
    throw new Error(`probe referenced unknown target ${id}`);
  }
  return found;
}

function numeric(payload: Readonly<Record<string, unknown>>, key: string): number | undefined {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nestedNumber(payload: Readonly<Record<string, unknown>>, path: readonly string[]): number | undefined {
  let node: unknown = payload;
  for (const key of path) {
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      return undefined;
    }
    node = (node as Record<string, unknown>)[key];
  }
  return typeof node === "number" && Number.isFinite(node) ? node : undefined;
}

function serviceStatusForCheck(
  probe: ProbeResult,
  allowlist: Allowlist,
  now: Date,
): { status: ServiceStatus; summary: string } {
  if (probe.status === "timeout") {
    return { status: "unhealthy", summary: probe.summary };
  }
  if (probe.status === "error") {
    return { status: "unhealthy", summary: probe.summary };
  }
  if (probe.status === "missing") {
    return { status: "unknown", summary: probe.summary };
  }

  const thresholds = allowlist.thresholds;
  switch (probe.check) {
    case "reachability":
    case "http":
      return { status: "healthy", summary: probe.summary };
    case "tls": {
      const notAfter = probe.payload.not_after;
      if (typeof notAfter !== "string") {
        return { status: "unknown", summary: "TLS not_after missing" };
      }
      const days = daysUntil(notAfter, now);
      if (Number.isNaN(days)) {
        return { status: "unknown", summary: "TLS not_after unusable" };
      }
      if (days < 0) {
        return {
          status: "unhealthy",
          summary: `TLS certificate expired ${Math.abs(Math.floor(days))} day(s) ago`,
        };
      }
      if (days <= thresholds.tls_crit_days) {
        return {
          status: "unhealthy",
          summary: `TLS certificate expires in ${days.toFixed(1)} days (crit ${thresholds.tls_crit_days})`,
        };
      }
      if (days <= thresholds.tls_warn_days) {
        return {
          status: "degraded",
          summary: `TLS certificate expires in ${days.toFixed(1)} days (warn ${thresholds.tls_warn_days})`,
        };
      }
      return { status: "healthy", summary: `TLS valid for ${days.toFixed(1)} more days` };
    }
    case "host_metrics": {
      const disk = nestedNumber(probe.payload, ["disk", "used_pct"]);
      const mem = nestedNumber(probe.payload, ["memory", "used_pct"]);
      if (disk !== undefined && disk >= thresholds.disk_crit_pct) {
        return { status: "unhealthy", summary: `disk ${disk.toFixed(0)}% >= crit ${thresholds.disk_crit_pct}%` };
      }
      if (mem !== undefined && mem >= thresholds.mem_warn_pct) {
        return { status: "degraded", summary: `memory ${mem.toFixed(0)}% >= warn ${thresholds.mem_warn_pct}%` };
      }
      if (disk !== undefined && disk >= thresholds.disk_warn_pct) {
        return { status: "degraded", summary: `disk ${disk.toFixed(0)}% >= warn ${thresholds.disk_warn_pct}%` };
      }
      return { status: "healthy", summary: probe.summary };
    }
    case "docker": {
      const services = probe.payload.services;
      if (!Array.isArray(services) || services.length === 0) {
        return { status: "unknown", summary: "Docker/service list empty" };
      }
      const unhealthy = services.filter((item) => {
        if (!item || typeof item !== "object") {
          return true;
        }
        const health = (item as Record<string, unknown>).health;
        return typeof health !== "string" || health.toLowerCase() !== "healthy";
      });
      if (unhealthy.length > 0) {
        const names = unhealthy
          .map((item) => {
            if (item && typeof item === "object" && "name" in item) {
              return String((item as Record<string, unknown>).name);
            }
            return "unnamed-container";
          })
          .join(", ");
        return { status: "unhealthy", summary: `unhealthy Docker/services: ${names}` };
      }
      return { status: "healthy", summary: probe.summary };
    }
    case "backup": {
      const status = probe.payload.status;
      const last = probe.payload.last_success_at;
      if (typeof status !== "string" || status.toLowerCase() === "missing") {
        return { status: "unhealthy", summary: "backup last-success signal missing" };
      }
      if (status.toLowerCase() === "failed" || status.toLowerCase() === "error") {
        return { status: "unhealthy", summary: `backup last-success status=${status}` };
      }
      if (typeof last !== "string" || last.length === 0) {
        return { status: "unhealthy", summary: "backup last-success timestamp missing" };
      }
      const lastMs = Date.parse(last);
      if (Number.isNaN(lastMs)) {
        return { status: "unhealthy", summary: "backup last-success timestamp unusable" };
      }
      const ageSec = (now.getTime() - lastMs) / 1000;
      if (ageSec > thresholds.backup_max_age_seconds) {
        return {
          status: "unhealthy",
          summary: `backup last-success is ${Math.floor(ageSec)}s old (max ${thresholds.backup_max_age_seconds}s)`,
        };
      }
      return { status: "healthy", summary: `backup last-success at ${last}` };
    }
    case "uptime":
      return { status: "healthy", summary: probe.summary };
  }
}

/** What each check kind tells an operator, used when the catalog omits a role. */
const CHECK_ROLE_LABELS: Record<CheckKind, string> = {
  reachability: "alcance TCP",
  host_metrics: "métricas de host",
  docker: "containers",
  http: "endpoint HTTP",
  tls: "certificado TLS",
  backup: "frescor de backup",
  uptime: "uptime do host",
};

/**
 * The service's function. The catalog wins; otherwise the checks describe it.
 * Never empty, because two rows that differ only by position are unreadable.
 */
export function roleFor(target: AllowlistTarget): string {
  const declared = target.role?.trim();
  if (declared) {
    return declared;
  }
  const ordered = CHECK_KINDS.filter((kind) => target.checks.includes(kind));
  return ordered.length > 0 ? ordered.map((kind) => CHECK_ROLE_LABELS[kind]).join(" + ") : "sem checks";
}

/**
 * The logical address the checks address, with any userinfo and query string
 * removed. This value is rendered in the cockpit, so it must never be able to
 * carry a credential even if one slipped past the allowlist parser.
 */
export function logicalEndpoint(target: AllowlistTarget): string {
  if (target.url) {
    try {
      const url = new URL(target.url);
      url.username = "";
      url.password = "";
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch {
      // Unparsable URL: fall through to the host/port form rather than echoing it.
    }
  }
  const host = target.http_host ?? target.tls_server_name ?? target.host ?? target.connect_host;
  if (host && host.trim() !== "") {
    return target.port ? `${host.trim()}:${target.port}` : host.trim();
  }
  if (target.agent_id) {
    return `agent:${target.agent_id}`;
  }
  return `target:${target.id}`;
}

/** Worst observed round trip across a service's checks. */
function latencyOf(observations: readonly SourceObservation[]): number | undefined {
  let worst: number | undefined;
  for (const obs of observations) {
    for (const key of ["latency_ms", "elapsed_ms"] as const) {
      const value = numeric(obs.payload, key);
      if (value !== undefined && (worst === undefined || value > worst)) {
        worst = value;
      }
    }
  }
  return worst;
}

const STATUS_SEVERITY: Record<ServiceStatus, number> = {
  unhealthy: 3,
  degraded: 2,
  unknown: 1,
  healthy: 0,
};

/** The worst non-healthy check summary, so the card can name what broke. */
function lastErrorOf(checks: readonly ServiceCheck[]): string | undefined {
  let worst: ServiceCheck | undefined;
  for (const check of checks) {
    if (check.status === "healthy") {
      continue;
    }
    if (!worst || STATUS_SEVERITY[check.status] > STATUS_SEVERITY[worst.status]) {
      worst = check;
    }
  }
  return worst ? `${worst.check}: ${worst.summary}` : undefined;
}

export function mapObservation(
  probe: ProbeResult,
  allowlist: Allowlist,
  now: Date,
): SourceObservation {
  const freshnessArgs: {
    probeStatus: ProbeResult["status"];
    now: Date;
    staleAfterSeconds: number;
    agentObservedAt?: string;
  } = {
    probeStatus: probe.status,
    now,
    staleAfterSeconds: allowlist.thresholds.stale_after_seconds,
  };
  if (probe.agent_observed_at) {
    freshnessArgs.agentObservedAt = probe.agent_observed_at;
  }
  const freshness = freshnessFromProbe(freshnessArgs);
  const classified = serviceStatusForCheck(probe, allowlist, now);
  const observation: SourceObservation = {
    observation_id: observationId(allowlist.source, probe.target_id, probe.check),
    source: allowlist.source,
    observed_at: probe.observed_at,
    freshness_status: freshness,
    scope: "infrastructure",
    target_id: probe.target_id,
    check: probe.check,
    summary: classified.summary,
    payload: {
      ...probe.payload,
      probe_status: probe.status,
      service_status: classified.status,
      agent_observed_at: probe.agent_observed_at ?? null,
    },
    confidence: confidenceFor(freshness, probe.status),
  };
  return observation;
}

export function mapServiceHealth(
  target: AllowlistTarget,
  observations: readonly SourceObservation[],
  allowlist: Allowlist,
  now: Date,
): ServiceHealth {
  const owned = observations.filter((obs) => obs.target_id === target.id);
  const checks: ServiceCheck[] = owned.map((obs) => {
    const status = obs.payload.service_status;
    const checkStatus: ServiceStatus =
      status === "healthy" || status === "degraded" || status === "unhealthy" || status === "unknown"
        ? status
        : "unknown";
    return {
      check: obs.check,
      status: checkStatus,
      freshness_status: obs.freshness_status,
      summary: obs.summary,
    };
  });
  const freshness = worstFreshness(checks.map((c) => c.freshness_status));
  const status = coalesceServiceStatus(
    checks.map((c) => c.status),
    freshness,
  );
  const uptimeObs = owned.find((obs) => obs.check === "uptime");
  const health: ServiceHealth = {
    service_id: target.id,
    display_name: target.display_name,
    role: roleFor(target),
    endpoint: logicalEndpoint(target),
    source: allowlist.source,
    observed_at: owned[0]?.observed_at ?? toUtcIso(now),
    freshness_status: freshness,
    status,
    checks,
    confidence: owned.length
      ? Math.min(...owned.map((obs) => obs.confidence ?? 0.2))
      : 0.2,
  };
  const uptime = uptimeObs ? numeric(uptimeObs.payload, "uptime_seconds") : undefined;
  const restarts = uptimeObs ? numeric(uptimeObs.payload, "restart_count") : undefined;
  if (uptime !== undefined) {
    Object.assign(health, { uptime_seconds: uptime });
  }
  if (restarts !== undefined) {
    Object.assign(health, { restart_count: restarts });
  }
  const latency = latencyOf(owned);
  if (latency !== undefined) {
    Object.assign(health, { latency_ms: latency });
  }
  const lastError = lastErrorOf(checks);
  if (lastError !== undefined) {
    Object.assign(health, { last_error: lastError });
  }
  if (target.runbook_url !== undefined) {
    Object.assign(health, { runbook_url: target.runbook_url });
  }
  return health;
}

export function mapCollectRecords(
  allowlist: Allowlist,
  probes: readonly ProbeResult[],
  now: Date,
): { observations: SourceObservation[]; service_health: ServiceHealth[] } {
  const observations = probes.map((probe) => mapObservation(probe, allowlist, now));
  observations.sort((a, b) => a.observation_id.localeCompare(b.observation_id));
  const service_health = allowlist.targets.map((target) =>
    mapServiceHealth(target, observations, allowlist, now),
  );
  service_health.sort((a, b) => a.service_id.localeCompare(b.service_id));
  return { observations, service_health };
}

export function assertKnownTargets(allowlist: Allowlist, probes: readonly ProbeResult[]): void {
  for (const probe of probes) {
    targetById(allowlist, probe.target_id);
  }
}
