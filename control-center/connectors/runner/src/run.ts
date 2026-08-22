import { FRESHNESS_STATUSES, type FreshnessStatus } from "@confenge/control-center-contracts";
import { failedCollect, parseCollectConfig, collect as collectGithub, liveTransport } from "../../github/src/index.ts";
// Import the collect surface directly, not the connector barrel. The barrel
// also re-exports the operator write channel, which pulls
// @confenge/control-center-security into this process's static import graph —
// a package the read-only collector neither declares nor needs, and whose
// absence crash-looped the container on boot. The read plane must not link the
// write plane.
import { collect as collectWarmbly } from "../../warmbly/src/collect.ts";
import { collectFinanceSnapshot, DefaultFetchTransport, parseAsaasConfig } from "../../asaas/src/index.ts";
import { evaluatePncpFreshness, loadAdapterConfigFromEnv } from "../../pncp/src/index.ts";
import { collect as collectInfra, createLivePorts } from "../../infrastructure/src/index.ts";

export const COLLECTOR_NAMES = ["github", "warmbly", "asaas", "pncp", "infra"] as const;
export type CollectorName = (typeof COLLECTOR_NAMES)[number];

export interface CollectorEnvelope {
  collector: CollectorName;
  freshness_status: FreshnessStatus;
  observed_at: string;
  source: { system: string; kind: string; locator: string };
  confidence: number;
  error?: { code: string; message: string };
  payload: unknown;
}

export interface RunCollectorsResult {
  ran_at: string;
  collectors: CollectorEnvelope[];
}

function nowIso(now: Date): string {
  return now.toISOString();
}

function canonical(status: string): FreshnessStatus {
  if ((FRESHNESS_STATUSES as readonly string[]).includes(status)) {
    return status as FreshnessStatus;
  }
  if (status === "failed" || status === "degraded" || status === "unsupported") {
    return status === "unsupported" ? "UNKNOWN" : status === "degraded" ? "STALE" : "ERROR";
  }
  if (status === "fresh" || status === "not_modified") {
    return "FRESH";
  }
  if (status === "stale") {
    return "STALE";
  }
  if (status === "unknown") {
    return "UNKNOWN";
  }
  return "ERROR";
}

function envelope(
  collector: CollectorName,
  freshness: FreshnessStatus,
  now: Date,
  payload: unknown,
  error?: { code: string; message: string },
): CollectorEnvelope {
  const body: CollectorEnvelope = {
    collector,
    freshness_status: freshness,
    observed_at: nowIso(now),
    source: { system: collector, kind: "collector-runner", locator: collector },
    confidence: freshness === "FRESH" ? 0.9 : freshness === "STALE" ? 0.5 : 0,
    payload,
  };
  if (error) {
    body.error = error;
  }
  return body;
}

async function runGithub(env: NodeJS.ProcessEnv, now: Date): Promise<CollectorEnvelope> {
  const parsed = parseCollectConfig({
    env,
    repos: env.GITHUB_REPOS,
    transport: liveTransport,
    now: () => now,
    logSink: () => undefined,
  });
  if (!parsed.ok) {
    const blocked =
      parsed.code === "missing_credentials" ||
      parsed.code === "missing_installation_token" ||
      /token|credential|secret/i.test(parsed.message);
    const failed = failedCollect({
      now,
      allowlist: [],
      code: blocked || parsed.code === "invalid_config" ? "missing_credentials" : "invalid_config",
      message: parsed.message,
    });
    return envelope("github", blocked ? "UNKNOWN" : "ERROR", now, failed, {
      code: blocked ? "BLOCKED_BY_SECRET" : parsed.code === "invalid_config" ? "NOT_CONFIGURED" : parsed.code,
      message: parsed.message,
    });
  }
  const result = await collectGithub(parsed.config);
  return envelope("github", canonical(result.snapshot.freshness_status), now, result);
}

async function runWarmbly(env: NodeJS.ProcessEnv, now: Date): Promise<CollectorEnvelope> {
  const baseUrl = env.WARMBLY_BASE_URL?.trim();
  const token = env.WARMBLY_TOKEN?.trim() || env.WARMBLY_API_TOKEN?.trim();
  if (!baseUrl || !token) {
    return envelope(
      "warmbly",
      "UNKNOWN",
      now,
      { ok: false, availability: "BLOCKED_BY_SECRET" },
      { code: "BLOCKED_BY_SECRET", message: "WARMBLY_BASE_URL and WARMBLY_TOKEN are required" },
    );
  }
  try {
    const snapshot = await collectWarmbly({
      clientOptions: { baseUrl, token },
      now,
    });
    return envelope("warmbly", canonical(String(snapshot.freshness_status)), now, snapshot);
  } catch (err) {
    const message = err instanceof Error ? err.message : "warmbly collect failed";
    return envelope("warmbly", "ERROR", now, { ok: false }, { code: "collect_failed", message });
  }
}

async function runAsaas(env: NodeJS.ProcessEnv, now: Date): Promise<CollectorEnvelope> {
  try {
    const config = parseAsaasConfig(env);
    const snapshot = await collectFinanceSnapshot({
      config,
      now,
      transport: new DefaultFetchTransport(),
    });
    return envelope("asaas", canonical(String(snapshot.freshness_status)), now, snapshot);
  } catch (err) {
    const message = err instanceof Error ? err.message : "asaas collect failed";
    const blocked = /credential|api key|ASAAS/i.test(message);
    return envelope(
      "asaas",
      blocked ? "UNKNOWN" : "ERROR",
      now,
      { ok: false, availability: blocked ? "BLOCKED_BY_SECRET" : "UPSTREAM_ERROR" },
      { code: blocked ? "BLOCKED_BY_SECRET" : "UPSTREAM_ERROR", message },
    );
  }
}

async function runPncp(env: NodeJS.ProcessEnv, now: Date): Promise<CollectorEnvelope> {
  try {
    const config = loadAdapterConfigFromEnv(env);
    const evaluation = await evaluatePncpFreshness(config);
    return envelope("pncp", canonical(String(evaluation.freshness_status)), now, evaluation);
  } catch (err) {
    const message = err instanceof Error ? err.message : "pncp collect failed";
    return envelope(
      "pncp",
      "UNKNOWN",
      now,
      { ok: false, availability: "NOT_CONFIGURED" },
      { code: "NOT_CONFIGURED", message },
    );
  }
}

async function runInfra(env: NodeJS.ProcessEnv, now: Date): Promise<CollectorEnvelope> {
  const raw = env.CC_INFRA_ALLOWLIST;
  if (!raw || raw.trim() === "") {
    return envelope(
      "infra",
      "UNKNOWN",
      now,
      { ok: false, availability: "NOT_CONFIGURED" },
      { code: "NOT_CONFIGURED", message: "CC_INFRA_ALLOWLIST is not configured" },
    );
  }
  try {
    let allowlist: unknown = raw;
    try {
      allowlist = JSON.parse(raw) as unknown;
    } catch {
      // keep string; collect will fail-closed
    }
    const result = await collectInfra({
      allowlist,
      ports: createLivePorts({
        now: () => now,
        agentBaseUrl: env.CONTROL_CENTER_INFRA_AGENT_URL,
      }),
    });
    const freshness = result.observations[0]?.freshness_status
      ? canonical(String(result.observations[0].freshness_status))
      : "UNKNOWN";
    return envelope("infra", freshness, now, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "infra collect failed";
    return envelope("infra", "ERROR", now, { ok: false }, { code: "collect_failed", message });
  }
}

const RUNNERS: Record<CollectorName, (env: NodeJS.ProcessEnv, now: Date) => Promise<CollectorEnvelope>> = {
  github: runGithub,
  warmbly: runWarmbly,
  asaas: runAsaas,
  pncp: runPncp,
  infra: runInfra,
};

export type CollectFn = (ctx: {
  env: NodeJS.ProcessEnv;
  now: Date;
  signal?: AbortSignal;
}) => Promise<CollectorEnvelope>;

export async function runCollectors(options: {
  names?: readonly CollectorName[];
  env?: NodeJS.ProcessEnv;
  now?: Date;
  log?: (line: string) => void;
  collectFns?: Partial<Record<CollectorName, CollectFn>>;
  signal?: AbortSignal;
}): Promise<RunCollectorsResult> {
  const now = options.now ?? new Date();
  const env = options.env ?? process.env;
  const names = options.names ?? COLLECTOR_NAMES;
  const log = options.log ?? ((line) => process.stderr.write(`${line}\n`));
  const collectors: CollectorEnvelope[] = [];
  log(
    JSON.stringify({
      event: "collector_run_start",
      collectors: names,
      observed_at: nowIso(now),
    }),
  );
  for (const name of names) {
    const started = Date.now();
    if (options.signal?.aborted) {
      collectors.push(
        envelope(name, "ERROR", now, { ok: false }, { code: "timeout", message: "collector timed out" }),
      );
      continue;
    }
    const injected = options.collectFns?.[name];
    const result = injected
      ? await injected({ env, now, signal: options.signal })
      : await RUNNERS[name](env, now);
    collectors.push(result);
    log(
      JSON.stringify({
        event: "collector_finished",
        collector: name,
        freshness_status: result.freshness_status,
        duration_ms: Date.now() - started,
        error: result.error?.code ?? null,
      }),
    );
  }
  log(
    JSON.stringify({
      event: "collector_run_complete",
      collectors: names,
      freshness: collectors.map((row) => row.freshness_status),
    }),
  );
  return { ran_at: nowIso(now), collectors };
}
