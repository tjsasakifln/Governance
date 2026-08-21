#!/usr/bin/env node
import { collect } from "./collect.ts";
import { buildEnvelope, toCanaryReport, type CanaryReport, type FreshnessStatus } from "./envelope.ts";
import { classifyRequest } from "./http/allowlist.ts";
import { WarmblyClient, type WarmblyClientOptions } from "./http/client.ts";
import { createStderrLogger, redactUnknown } from "./http/redaction.ts";
import {
  REQUIRED_SECRET_NAMES,
  loadWarmblyProductionConfig,
  resolveWarmblySecrets,
  sanitizeLocator,
} from "./production-config.ts";

export interface WarmblyCanaryOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly now?: Date;
  readonly clientOptions?: Partial<WarmblyClientOptions>;
  readonly fetchImpl?: typeof fetch;
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

function mapHttpStatusFreshness(status: number): FreshnessStatus {
  if (status === 401 || status === 403) {
    return "ERROR";
  }
  if (status === 429 || status >= 500) {
    return "ERROR";
  }
  return "ERROR";
}

export async function runWarmblyCanary(options: WarmblyCanaryOptions = {}): Promise<CanaryReport> {
  const now = options.now ?? new Date();
  const observedAt = now.toISOString();
  const env = options.env ?? process.env;
  const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  const production = loadWarmblyProductionConfig();
  const secrets = resolveWarmblySecrets(env);

  if (!secrets.ok) {
    const envelope = buildEnvelope({
      collector: "warmbly",
      freshness_status: "UNKNOWN",
      observed_at: observedAt,
      source: {
        system: "warmbly",
        kind: "commercial-api",
        locator: "WARMBLY_BASE_URL",
      },
      confidence: 0,
      error: {
        code: "CREDENTIAL_MISSING",
        message: `Missing ${secrets.missing.join(", ")} (aliases: WARMBLY_TOKEN, WARMBLY_API_KEY)`,
      },
      payload: {
        required_secrets: [...REQUIRED_SECRET_NAMES],
        secret_aliases: production.secret_aliases,
        missing: secrets.missing,
      },
    });
    const report = toCanaryReport(envelope, "BLOCKED_BY_SECRET");
    log(JSON.stringify(redactUnknown({ event: "warmbly.canary.blocked_by_secret", missing: secrets.missing })));
    return report;
  }

  const locator = sanitizeLocator(secrets.baseUrl);
  try {
    const snapshot = await collect({
      now,
      client: new WarmblyClient({
        baseUrl: secrets.baseUrl,
        token: secrets.token,
        timeoutMs: options.clientOptions?.timeoutMs ?? 8_000,
        maxRetries: options.clientOptions?.maxRetries ?? 0,
        logger: options.clientOptions?.logger ?? createStderrLogger(),
        fetchImpl: options.fetchImpl ?? options.clientOptions?.fetchImpl ?? fetch,
        sleep: options.clientOptions?.sleep,
        now: options.clientOptions?.now,
        failureThreshold: options.clientOptions?.failureThreshold,
        resetMs: options.clientOptions?.resetMs,
        backoffMs: options.clientOptions?.backoffMs,
      }),
    });
    const freshness = snapshot.freshness_status;
    const envelope = buildEnvelope({
      collector: "warmbly",
      freshness_status: freshness,
      observed_at: observedAt,
      source: { system: "warmbly", kind: "commercial-api", locator },
      confidence: confidenceFor(freshness),
      error:
        freshness === "FRESH"
          ? null
          : {
              code: "WARMBLY_NOT_FRESH",
              message: `Warmbly snapshot freshness=${freshness}`,
            },
      payload: {
        schema: snapshot.schema,
        health: snapshot.health,
        attention_count: snapshot.attention.length,
        observation_count: snapshot.observations.length,
        observations: snapshot.observations.map((row) => ({
          surface: row.surface,
          http_method: row.http_method,
          http_path: row.http_path,
          http_status: row.http_status,
          freshness_status: row.provenance.freshness_status,
        })),
      },
    });
    const capability =
      freshness === "FRESH" ? "AVAILABLE" : freshness === "STALE" ? "PARTIAL" : "ERROR";
    return toCanaryReport(envelope, capability);
  } catch (err) {
    const status = typeof err === "object" && err && "status" in err ? Number((err as { status: number }).status) : 0;
    const freshness = status > 0 ? mapHttpStatusFreshness(status) : "ERROR";
    const message = err instanceof Error ? err.message : "warmbly canary failed";
    const envelope = buildEnvelope({
      collector: "warmbly",
      freshness_status: freshness,
      observed_at: observedAt,
      source: { system: "warmbly", kind: "commercial-api", locator },
      confidence: 0,
      error: { code: status === 401 || status === 403 ? "UPSTREAM_AUTH" : "ERROR", message },
      payload: { required_secrets: [...REQUIRED_SECRET_NAMES] },
    });
    return toCanaryReport(envelope, "ERROR");
  }
}

export function parseCanaryArgs(argv: readonly string[]): { collector: "warmbly"; now?: Date } {
  let now: Date | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") {
      throw new Error("usage: cc-connector-canary warmbly [--now UTC-Z]");
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
    if (token === "warmbly") {
      continue;
    }
    if (token === "asaas" || token === "pncp" || token === "infra") {
      throw new Error(`this package canary only accepts warmbly, got ${token}`);
    }
  }
  return now ? { collector: "warmbly", now } : { collector: "warmbly" };
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
    const report = await runWarmblyCanary({
      env,
      now: args.now,
      log: io.stderr,
    });
    io.stdout(JSON.stringify(redactUnknown(report), null, 2));
    return { code: 0, report };
  } catch (err) {
    const message = err instanceof Error ? err.message : "canary failed";
    io.stderr(JSON.stringify({ event: "warmbly.canary.error", error: message }));
    return { code: 2 };
  }
}

export function assertWarmblyMutationDenied(method: string, path: string): void {
  const classified = classifyRequest(method, path);
  if (classified.allowed) {
    throw new Error(`expected denial for ${method} ${path}`);
  }
}

const isDirect =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("/canary.ts") || process.argv[1].endsWith("/canary.js"));

if (isDirect) {
  runCli().then((outcome) => {
    process.exitCode = outcome.code;
  });
}
