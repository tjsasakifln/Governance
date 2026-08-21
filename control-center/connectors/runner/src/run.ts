import { FRESHNESS_STATUSES, type FreshnessStatus } from "@confenge/control-center-contracts";
import { failedCollect, parseCollectConfig, collect as collectGithub } from "../../github/src/index.ts";
import { collect as collectWarmbly } from "../../warmbly/src/index.ts";
import { collectFinanceSnapshot, parseAsaasConfig } from "../../asaas/src/index.ts";
import { evaluatePncpFreshness, loadAdapterConfigFromEnv } from "../../pncp/src/index.ts";
import { collect as collectInfra } from "../../infrastructure/src/index.ts";

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
    transport: async () => ({
      status: 401,
      headers: {},
      body: "",
    }),
    now: () => now,
    logSink: () => undefined,
  });
  if (!parsed.ok) {
    const failed = failedCollect({
      now,
      allowlist: [],
      code: "missing_credentials",
      message: parsed.message,
    });
    return envelope("github", "ERROR", now, failed, {
      code: parsed.code,
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
      "ERROR",
      now,
      { ok: false },
      { code: "missing_credentials", message: "WARMBLY_BASE_URL and WARMBLY_TOKEN are required" },
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
      transport: {
        request: async () => ({ status: 401, headers: {}, bodyText: "{}" }),
      },
    });
    return envelope("asaas", canonical(String(snapshot.freshness_status)), now, snapshot);
  } catch (err) {
    const message = err instanceof Error ? err.message : "asaas collect failed";
    return envelope("asaas", "ERROR", now, { ok: false }, { code: "missing_credentials", message });
  }
}

async function runPncp(env: NodeJS.ProcessEnv, now: Date): Promise<CollectorEnvelope> {
  try {
    const config = loadAdapterConfigFromEnv(env);
    const evaluation = await evaluatePncpFreshness(config);
    return envelope("pncp", canonical(String(evaluation.freshness_status)), now, evaluation);
  } catch (err) {
    const message = err instanceof Error ? err.message : "pncp collect failed";
    return envelope("pncp", "ERROR", now, { ok: false }, { code: "unconfigured", message });
  }
}

async function runInfra(env: NodeJS.ProcessEnv, now: Date): Promise<CollectorEnvelope> {
  const raw = env.CC_INFRA_ALLOWLIST;
  if (!raw || raw.trim() === "") {
    return envelope(
      "infra",
      "UNKNOWN",
      now,
      { ok: false },
      { code: "missing_credentials", message: "CC_INFRA_ALLOWLIST is not configured" },
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
      ports: {
        now: () => now,
        reachHost: async () => ({ ok: false, error: "not probed" }),
        httpGet: async () => ({ status: 0, error: "not probed" }),
        readTls: async () => ({ not_after: "1970-01-01T00:00:00.000Z", error: "not probed" }),
        readAgent: async () => null,
      },
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

export async function runCollectors(options: {
  names?: readonly CollectorName[];
  env?: NodeJS.ProcessEnv;
  now?: Date;
  log?: (line: string) => void;
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
    const result = await RUNNERS[name](env, now);
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
