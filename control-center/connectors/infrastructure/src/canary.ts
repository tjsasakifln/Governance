#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { collect } from "./collect.js";
import {
  buildEnvelope,
  toCanaryReport,
  type Capability,
  type CanaryReport,
} from "./envelope.js";
import { worstFreshness } from "./freshness.js";
import {
  CANONICAL_HEALTH_URL,
  CANONICAL_HTTP_HOST,
  loadProductionAllowlist,
} from "./production-config.js";
import { createLivePorts } from "./live-ports.js";
import { logEvent, redact } from "./log.js";
import type { ProbePorts } from "./ports.js";
import type { CollectResult, FreshnessStatus } from "./types.js";
import { toUtcIso } from "./ids.js";

export interface InfraCanaryOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly now?: Date;
  readonly ports?: ProbePorts;
  readonly allowlist?: unknown;
  readonly log?: (line: string) => void;
}

function confidenceFor(status: FreshnessStatus): number {
  switch (status) {
    case "FRESH":
      return 0.9;
    case "STALE":
      return 0.5;
    case "UNKNOWN":
      return 0;
    case "ERROR":
      return 0;
  }
}

function capabilityFor(result: CollectResult): Capability {
  const statuses = result.observations.map((row) => row.freshness_status);
  if (statuses.length === 0) {
    return "ERROR";
  }
  const unique = new Set(statuses);
  if (unique.size === 1 && unique.has("FRESH")) {
    return "AVAILABLE";
  }
  if (unique.has("FRESH") || unique.has("STALE")) {
    return "PARTIAL";
  }
  return "ERROR";
}

export async function runInfraCanary(options: InfraCanaryOptions = {}): Promise<CanaryReport> {
  const now = options.now ?? new Date();
  const observedAt = toUtcIso(now);
  const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  const allowlist = options.allowlist ?? loadProductionAllowlist();
  const ports =
    options.ports ??
    createLivePorts({
      now: () => now,
      ...(options.env?.CONTROL_CENTER_INFRA_AGENT_URL
        ? { agentBaseUrl: options.env.CONTROL_CENTER_INFRA_AGENT_URL }
        : {}),
    });

  logEvent("infra_canary_start", {
    collector: "infra",
    health_url: CANONICAL_HEALTH_URL,
    http_host: CANONICAL_HTTP_HOST,
  });

  try {
    const result = await collect({ allowlist, ports });
    const freshness = worstFreshness(result.observations.map((row) => row.freshness_status));
    const httpObs = result.observations.find((row) => row.check === "http");
    const tcpObs = result.observations.find((row) => row.check === "reachability");
    const tlsObs = result.observations.find((row) => row.check === "tls");
    const httpError =
      httpObs && httpObs.freshness_status !== "FRESH"
        ? {
            code: "HTTP_OBSERVATION",
            message: String(httpObs.summary),
          }
        : null;
    const envelopeError =
      freshness === "FRESH"
        ? null
        : httpError ?? {
            code: "INFRA_UNHEALTHY",
            message: "one or more infrastructure observations are not FRESH",
          };
    const envelope = buildEnvelope({
      collector: "infra",
      freshness_status: freshness,
      observed_at: observedAt,
      source: {
        system: "infrastructure",
        kind: "netcup-http-tls-tcp",
        locator: CANONICAL_HEALTH_URL,
      },
      confidence: confidenceFor(freshness),
      error: envelopeError,
      payload: {
        health_url: CANONICAL_HEALTH_URL,
        http_host: CANONICAL_HTTP_HOST,
        observations: result.observations.map((row) => ({
          target_id: row.target_id,
          check: row.check,
          freshness_status: row.freshness_status,
          summary: row.summary,
          connect_host: row.payload.connect_host ?? null,
          tls_server_name: row.payload.tls_server_name ?? null,
          http_host: row.payload.http_host ?? null,
        })),
        tcp_freshness: tcpObs?.freshness_status ?? "UNKNOWN",
        tls_freshness: tlsObs?.freshness_status ?? "UNKNOWN",
        http_freshness: httpObs?.freshness_status ?? "UNKNOWN",
        exception_count: result.exceptions.length,
      },
    });
    const report = toCanaryReport(envelope, capabilityFor(result));
    log(
      JSON.stringify(
        redact({
          event: "infra_canary_finish",
          collector: report.collector,
          capability: report.capability,
          freshness_status: report.freshness_status,
        }),
      ),
    );
    return report;
  } catch (err) {
    const message = err instanceof Error ? err.message : "infra canary failed";
    const envelope = buildEnvelope({
      collector: "infra",
      freshness_status: "ERROR",
      observed_at: observedAt,
      source: {
        system: "infrastructure",
        kind: "netcup-http-tls-tcp",
        locator: CANONICAL_HEALTH_URL,
      },
      confidence: 0,
      error: { code: "ERROR", message },
      payload: {},
    });
    return toCanaryReport(envelope, "ERROR");
  }
}

export function parseCanaryArgs(argv: readonly string[]): { collector: "infra"; now?: Date } {
  let now: Date | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") {
      throw new Error("usage: cc-connector-canary infra [--now UTC-Z]");
    }
    if (token === "--now") {
      const raw = argv[i + 1];
      i += 1;
      if (!raw) {
        throw new Error("--now requires a UTC timestamp");
      }
      const parsed = new Date(raw);
      if (Number.isNaN(parsed.getTime())) {
        throw new Error(`invalid --now: ${raw}`);
      }
      now = parsed;
      continue;
    }
    if (token === "infra") {
      continue;
    }
    if (token === "warmbly" || token === "asaas" || token === "pncp") {
      throw new Error(`this package canary only accepts infra, got ${token}`);
    }
  }
  return now ? { collector: "infra", now } : { collector: "infra" };
}

export async function runCli(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  io: { stdout: (line: string) => void; stderr: (line: string) => void } = {
    stdout: (line) => process.stdout.write(`${line}\n`),
    stderr: (line) => process.stderr.write(`${line}\n`),
  },
): Promise<{ code: number; report?: CanaryReport }> {
  try {
    const args = parseCanaryArgs(argv);
    const report = await runInfraCanary({
      env,
      ...(args.now ? { now: args.now } : {}),
      log: (line) => io.stderr(line),
    });
    io.stdout(JSON.stringify(redact(report), null, 2));
    return { code: 0, report };
  } catch (err) {
    const message = err instanceof Error ? err.message : "canary failed";
    io.stderr(JSON.stringify({ event: "infra_canary_error", error: message }));
    return { code: 2 };
  }
}

function isMain(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return import.meta.url === pathToFileURL(entry).href;
}

if (isMain()) {
  void runCli().then((outcome) => {
    process.exitCode = outcome.code;
  });
}
