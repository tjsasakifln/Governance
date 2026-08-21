import { parseAgentPayload } from "./agent.js";
import { timeoutFor } from "./allowlist.js";
import { connectHostOf, httpHostOf, identityFor, tlsServerNameOf } from "./identity.js";
import { toUtcIso } from "./ids.js";
import type { ProbePorts } from "./ports.js";
import { withTimeout } from "./timeout.js";
import type {
  Allowlist,
  AllowlistTarget,
  CheckKind,
  ProbeResult,
  ProbeStatus,
} from "./types.js";

function baseResult(
  target: AllowlistTarget,
  check: CheckKind,
  now: Date,
  status: ProbeStatus,
  summary: string,
  payload: Record<string, unknown>,
  agentObservedAt?: string,
): ProbeResult {
  const result: ProbeResult = {
    target_id: target.id,
    check,
    status,
    observed_at: toUtcIso(now),
    summary,
    payload,
  };
  if (agentObservedAt) {
    Object.assign(result, { agent_observed_at: agentObservedAt });
  }
  return result;
}

async function timed<T>(
  work: Promise<T>,
  timeoutMs: number,
): Promise<{ status: "ok"; value: T } | { status: "timeout" } | { status: "error"; error: string }> {
  try {
    const outcome = await withTimeout(work, timeoutMs);
    if (outcome.timedOut) {
      return { status: "timeout" };
    }
    return { status: "ok", value: outcome.value };
  } catch (err) {
    const message = err instanceof Error ? err.message : "probe failed";
    return { status: "error", error: message };
  }
}

async function probeReachability(
  target: AllowlistTarget,
  ports: ProbePorts,
  now: Date,
  timeoutMs: number,
): Promise<ProbeResult> {
  const host = connectHostOf(target);
  const port = target.port ?? 443;
  const outcome = await timed(ports.reachHost(host, port, timeoutMs), timeoutMs);
  if (outcome.status === "timeout") {
    return baseResult(target, "reachability", now, "timeout", `host reachability timed out after ${timeoutMs}ms`, {
      host,
      connect_host: host,
      port,
      timed_out: true,
    });
  }
  if (outcome.status === "error") {
    return baseResult(target, "reachability", now, "error", `host reachability error: ${outcome.error}`, {
      host,
      connect_host: host,
      port,
      error: outcome.error,
    });
  }
  const sample = outcome.value;
  if (!sample.ok) {
    return baseResult(
      target,
      "reachability",
      now,
      "error",
      `host ${host}:${port} unreachable${sample.error ? `: ${sample.error}` : ""}`,
      { host, connect_host: host, port, ok: false, error: sample.error ?? "unreachable" },
    );
  }
  const payload: Record<string, unknown> = { host, connect_host: host, port, ok: true };
  if (sample.latency_ms !== undefined) {
    payload.latency_ms = sample.latency_ms;
  }
  return baseResult(target, "reachability", now, "ok", `host ${host}:${port} reachable`, payload);
}

async function probeHttp(
  target: AllowlistTarget,
  ports: ProbePorts,
  now: Date,
  timeoutMs: number,
): Promise<ProbeResult> {
  const url = target.url ?? "";
  const expect = target.expect_status ?? 200;
  const identity = identityFor(target);
  const httpHost = httpHostOf(target);
  const tlsServerName = tlsServerNameOf(target);
  const connectHost = identity.connectHost;
  const identityFields: Record<string, unknown> = {
    url,
    expect_status: expect,
    http_host: httpHost,
    tls_server_name: tlsServerName,
  };
  if (connectHost) {
    identityFields.connect_host = connectHost;
  }
  const outcome = await timed(ports.httpGet(url, timeoutMs, identity), timeoutMs);
  if (outcome.status === "timeout") {
    return baseResult(target, "http", now, "timeout", `HTTP health timed out after ${timeoutMs}ms`, {
      ...identityFields,
      timed_out: true,
    });
  }
  if (outcome.status === "error") {
    return baseResult(target, "http", now, "error", `HTTP health error: ${outcome.error}`, {
      ...identityFields,
      error: outcome.error,
    });
  }
  const sample = outcome.value;
  if (sample.error && sample.status === 0) {
    return baseResult(target, "http", now, "error", `HTTP health error: ${sample.error}`, {
      ...identityFields,
      error: sample.error,
    });
  }
  const payload: Record<string, unknown> = {
    ...identityFields,
    status: sample.status,
  };
  if (sample.elapsed_ms !== undefined) {
    payload.elapsed_ms = sample.elapsed_ms;
  }
  if (sample.status === expect) {
    return baseResult(target, "http", now, "ok", `HTTP ${sample.status} for ${target.id}`, payload);
  }
  return baseResult(
    target,
    "http",
    now,
    "error",
    `HTTP health failed for ${target.id}: expected ${expect}, got ${sample.status}`,
    payload,
  );
}

async function probeTls(
  target: AllowlistTarget,
  ports: ProbePorts,
  now: Date,
  timeoutMs: number,
): Promise<ProbeResult> {
  const host = connectHostOf(target);
  const port = target.port ?? 443;
  const identity = identityFor(target);
  const tlsServerName = tlsServerNameOf(target);
  const identityFields: Record<string, unknown> = {
    host,
    connect_host: host,
    tls_server_name: tlsServerName,
    port,
  };
  const outcome = await timed(ports.readTls(host, port, timeoutMs, identity), timeoutMs);
  if (outcome.status === "timeout") {
    return baseResult(target, "tls", now, "timeout", `TLS probe timed out after ${timeoutMs}ms`, {
      ...identityFields,
      timed_out: true,
    });
  }
  if (outcome.status === "error") {
    return baseResult(target, "tls", now, "error", `TLS probe error: ${outcome.error}`, {
      ...identityFields,
      error: outcome.error,
    });
  }
  const sample = outcome.value;
  if (sample.error) {
    return baseResult(target, "tls", now, "error", `TLS probe error: ${sample.error}`, {
      ...identityFields,
      error: sample.error,
    });
  }
  return baseResult(target, "tls", now, "ok", `TLS certificate observed for ${tlsServerName} via ${host}`, {
    ...identityFields,
    not_after: sample.not_after,
  });
}

async function loadAgent(
  target: AllowlistTarget,
  ports: ProbePorts,
  now: Date,
  timeoutMs: number,
  check: CheckKind,
): Promise<
  | { status: "ok"; payload: NonNullable<ReturnType<typeof parseAgentPayload>> }
  | { status: Exclude<ProbeStatus, "ok">; result: ProbeResult }
> {
  const agentId = target.agent_id ?? target.id;
  const outcome = await timed(ports.readAgent(agentId), timeoutMs);
  if (outcome.status === "timeout") {
    return {
      status: "timeout",
      result: baseResult(target, check, now, "timeout", `agent payload timed out after ${timeoutMs}ms`, {
        agent_id: agentId,
        timed_out: true,
      }),
    };
  }
  if (outcome.status === "error") {
    return {
      status: "error",
      result: baseResult(target, check, now, "error", `agent payload error: ${outcome.error}`, {
        agent_id: agentId,
        error: outcome.error,
      }),
    };
  }
  if (outcome.value === null) {
    return {
      status: "missing",
      result: baseResult(
        target,
        check,
        now,
        "missing",
        `agent payload missing for ${agentId} (fail-closed)`,
        { agent_id: agentId, missing: true },
      ),
    };
  }
  const parsed = parseAgentPayload(outcome.value);
  if (!parsed) {
    return {
      status: "missing",
      result: baseResult(target, check, now, "missing", `agent payload unusable for ${agentId}`, {
        agent_id: agentId,
        unusable: true,
      }),
    };
  }
  return { status: "ok", payload: parsed };
}

async function probeHostMetrics(
  target: AllowlistTarget,
  ports: ProbePorts,
  now: Date,
  timeoutMs: number,
): Promise<ProbeResult> {
  const loaded = await loadAgent(target, ports, now, timeoutMs, "host_metrics");
  if (loaded.status !== "ok") {
    return loaded.result;
  }
  const { disk, memory, load } = loaded.payload;
  if (!disk && !memory && !load) {
    return baseResult(
      target,
      "host_metrics",
      now,
      "missing",
      "agent exposed no disk/memory/load metrics",
      { agent_id: target.agent_id ?? target.id },
      loaded.payload.observed_at,
    );
  }
  return baseResult(
    target,
    "host_metrics",
    now,
    "ok",
    "host disk/memory/load observed",
    {
      disk: disk ?? null,
      memory: memory ?? null,
      load: load ?? null,
    },
    loaded.payload.observed_at,
  );
}

async function probeDocker(
  target: AllowlistTarget,
  ports: ProbePorts,
  now: Date,
  timeoutMs: number,
): Promise<ProbeResult> {
  const loaded = await loadAgent(target, ports, now, timeoutMs, "docker");
  if (loaded.status !== "ok") {
    return loaded.result;
  }
  const services = loaded.payload.docker?.services ?? [];
  if (services.length === 0) {
    return baseResult(
      target,
      "docker",
      now,
      "missing",
      "agent exposed no Docker/service health",
      { services: [] },
      loaded.payload.observed_at,
    );
  }
  return baseResult(
    target,
    "docker",
    now,
    "ok",
    `Docker/service health observed (${services.length} services)`,
    { services: services.map((s) => ({ ...s })) },
    loaded.payload.observed_at,
  );
}

async function probeBackup(
  target: AllowlistTarget,
  ports: ProbePorts,
  now: Date,
  timeoutMs: number,
): Promise<ProbeResult> {
  const loaded = await loadAgent(target, ports, now, timeoutMs, "backup");
  if (loaded.status !== "ok") {
    return loaded.result;
  }
  const backup = loaded.payload.backup;
  if (!backup) {
    return baseResult(
      target,
      "backup",
      now,
      "missing",
      "backup last-success signal missing",
      { missing: true },
      loaded.payload.observed_at,
    );
  }
  return baseResult(
    target,
    "backup",
    now,
    "ok",
    `backup signal status=${backup.status}`,
    { status: backup.status, last_success_at: backup.last_success_at ?? null },
    loaded.payload.observed_at,
  );
}

async function probeUptime(
  target: AllowlistTarget,
  ports: ProbePorts,
  now: Date,
  timeoutMs: number,
): Promise<ProbeResult> {
  const loaded = await loadAgent(target, ports, now, timeoutMs, "uptime");
  if (loaded.status !== "ok") {
    return loaded.result;
  }
  const host = loaded.payload.host;
  if (!host || (host.uptime_seconds === undefined && host.restart_count === undefined)) {
    return baseResult(
      target,
      "uptime",
      now,
      "missing",
      "uptime/restart signal missing",
      { missing: true },
      loaded.payload.observed_at,
    );
  }
  return baseResult(
    target,
    "uptime",
    now,
    "ok",
    "uptime/restart observed",
    {
      uptime_seconds: host.uptime_seconds ?? null,
      restart_count: host.restart_count ?? null,
    },
    loaded.payload.observed_at,
  );
}

async function runCheck(
  target: AllowlistTarget,
  check: CheckKind,
  ports: ProbePorts,
  now: Date,
  timeoutMs: number,
): Promise<ProbeResult> {
  switch (check) {
    case "reachability":
      return probeReachability(target, ports, now, timeoutMs);
    case "http":
      return probeHttp(target, ports, now, timeoutMs);
    case "tls":
      return probeTls(target, ports, now, timeoutMs);
    case "host_metrics":
      return probeHostMetrics(target, ports, now, timeoutMs);
    case "docker":
      return probeDocker(target, ports, now, timeoutMs);
    case "backup":
      return probeBackup(target, ports, now, timeoutMs);
    case "uptime":
      return probeUptime(target, ports, now, timeoutMs);
  }
}

export async function runProbes(allowlist: Allowlist, ports: ProbePorts): Promise<ProbeResult[]> {
  const now = ports.now();
  const results: ProbeResult[] = [];
  for (const target of allowlist.targets) {
    const timeoutMs = timeoutFor(allowlist, target);
    for (const check of target.checks) {
      results.push(await runCheck(target, check, ports, now, timeoutMs));
    }
  }
  return results;
}
