import { exceptionId, slug } from "./ids.js";
import type { ActionableException, Allowlist, SourceObservation } from "./types.js";

function serviceStatusOf(obs: SourceObservation): string {
  const value = obs.payload.service_status;
  return typeof value === "string" ? value : "unknown";
}

function timedOut(obs: SourceObservation): boolean {
  return obs.payload.probe_status === "timeout" || obs.payload.timed_out === true;
}

function isIncident(obs: SourceObservation): boolean {
  const status = serviceStatusOf(obs);
  if (status === "unhealthy") {
    return true;
  }
  if (obs.freshness_status === "ERROR" || obs.freshness_status === "STALE") {
    return true;
  }
  if (obs.freshness_status === "UNKNOWN" && status !== "healthy") {
    return true;
  }
  return false;
}

function severityOf(obs: SourceObservation): ActionableException["severity"] {
  const status = serviceStatusOf(obs);
  if (status === "degraded" && obs.freshness_status === "FRESH") {
    return "warning";
  }
  if (obs.check === "tls" && status === "degraded") {
    return "warning";
  }
  return "critical";
}

function titleOf(obs: SourceObservation, displayName: string): string {
  const status = serviceStatusOf(obs);
  if (timedOut(obs)) {
    return `Timed out ${obs.check} probe for ${displayName}`;
  }
  if (obs.freshness_status === "STALE") {
    return `Stale ${obs.check} metrics for ${displayName}`;
  }
  if (obs.check === "tls") {
    return `TLS incident on ${displayName}`;
  }
  if (obs.check === "backup") {
    return `Backup last-success incident on ${displayName}`;
  }
  if (obs.check === "docker") {
    return `Docker/service health incident on ${displayName}`;
  }
  if (obs.check === "http") {
    return `HTTP health incident on ${displayName}`;
  }
  if (obs.check === "reachability") {
    return `Host unreachable: ${displayName}`;
  }
  return `Infrastructure ${status} on ${displayName} (${obs.check})`;
}

function evidenceOf(obs: SourceObservation, displayName: string): string {
  const bits = [
    `check=${obs.check}`,
    `allowlisted_target=${obs.target_id}`,
    `display_name=${displayName}`,
    `probe_status=${String(obs.payload.probe_status ?? "unknown")}`,
    `service_status=${serviceStatusOf(obs)}`,
    `freshness_status=${obs.freshness_status}`,
    `observed_at=${obs.observed_at}`,
    `summary=${obs.summary}`,
  ];
  if (obs.check === "http" && typeof obs.payload.url === "string") {
    bits.push(`url=${obs.payload.url}`);
  }
  if (obs.check === "http" && typeof obs.payload.status === "number") {
    bits.push(`http_status=${obs.payload.status}`);
  }
  if (obs.check === "tls" && typeof obs.payload.not_after === "string") {
    bits.push(`tls_not_after=${obs.payload.not_after}`);
  }
  if (obs.check === "backup") {
    bits.push(`backup_status=${String(obs.payload.status ?? "missing")}`);
    bits.push(`last_success_at=${String(obs.payload.last_success_at ?? "missing")}`);
  }
  if (obs.check === "docker" && Array.isArray(obs.payload.services)) {
    bits.push(`services=${JSON.stringify(obs.payload.services)}`);
  }
  return bits.join("; ");
}

function qualifier(obs: SourceObservation): string {
  if (obs.check === "docker" && Array.isArray(obs.payload.services)) {
    const names = obs.payload.services
      .filter((item) => item && typeof item === "object")
      .map((item) => String((item as Record<string, unknown>).name ?? "unnamed-container"))
      .join(",");
    return slug(names);
  }
  return "";
}

export function deriveExceptions(
  allowlist: Allowlist,
  observations: readonly SourceObservation[],
): ActionableException[] {
  const names = new Map(allowlist.targets.map((t) => [t.id, t.display_name]));
  const exceptions: ActionableException[] = [];
  for (const obs of observations) {
    if (!isIncident(obs)) {
      continue;
    }
    const displayName = names.get(obs.target_id) ?? obs.target_id;
    const evidence = evidenceOf(obs, displayName);
    if (evidence.trim().length === 0) {
      continue;
    }
    exceptions.push({
      exception_id: exceptionId(allowlist.source, obs.target_id, obs.check, qualifier(obs)),
      source: allowlist.source,
      timestamp: obs.observed_at,
      observed_at: obs.observed_at,
      target_id: obs.target_id,
      check: obs.check,
      severity: severityOf(obs),
      title: titleOf(obs, displayName),
      evidence,
      freshness_status: obs.freshness_status,
    });
  }
  exceptions.sort((a, b) => a.exception_id.localeCompare(b.exception_id));
  return exceptions;
}
