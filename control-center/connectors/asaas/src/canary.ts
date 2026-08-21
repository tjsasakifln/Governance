#!/usr/bin/env node
import { collectFinanceSnapshot } from "./collect.js";
import { ASAAS_GET_ALLOWLIST_PATHS, assertGetAllowed, isMutationMethod } from "./allowlist.js";
import { AsaasHttpError, AsaasMutationForbiddenError } from "./errors.js";
import {
  buildEnvelope,
  mapAsaasFreshness,
  toCanaryReport,
  type CanonicalFreshness,
  type CanaryReport,
} from "./envelope.js";
import { DefaultFetchTransport, GetOnlyAsaasClient } from "./http-client.js";
import { createLogger, redactDeep } from "./log.js";
import {
  ASAAS_REQUIRED_SECRETS,
  loadAsaasProductionConfig,
  resolveAsaasProductionConfig,
} from "./production-config.js";
import { mapChargeLifecycle } from "./status.js";
import type { HttpTransport } from "./types.js";

export interface AsaasCanaryOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly now?: Date;
  readonly transport?: HttpTransport;
  readonly log?: (line: string) => void;
}

function confidenceFor(status: CanonicalFreshness): number {
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

function locatorFor(envName: string | undefined, baseUrl: string | undefined): string {
  if (baseUrl) {
    return baseUrl;
  }
  if (envName === "production") {
    return "https://api.asaas.com";
  }
  if (envName === "sandbox") {
    return "https://api-sandbox.asaas.com";
  }
  return "ASAAS_ENVIRONMENT";
}

function httpStatusCapability(status: number): { freshness: CanonicalFreshness; code: string } {
  if (status === 401 || status === 403) {
    return { freshness: "ERROR", code: "UPSTREAM_AUTH" };
  }
  if (status === 429) {
    return { freshness: "ERROR", code: "UPSTREAM_RATE_LIMIT" };
  }
  if (status >= 500) {
    return { freshness: "ERROR", code: "UPSTREAM_5XX" };
  }
  return { freshness: "ERROR", code: "UPSTREAM" };
}

export async function runAsaasCanary(options: AsaasCanaryOptions = {}): Promise<CanaryReport> {
  const now = options.now ?? new Date();
  const observedAt = now.toISOString();
  const env = options.env ?? process.env;
  const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  loadAsaasProductionConfig();
  const resolved = resolveAsaasProductionConfig(env);

  if (!resolved.ok) {
    const blocked = resolved.code === "CREDENTIAL_MISSING";
    const envelope = buildEnvelope({
      collector: "asaas",
      freshness_status: blocked ? "UNKNOWN" : "ERROR",
      observed_at: observedAt,
      source: {
        system: "asaas",
        kind: "finance-api",
        locator: locatorFor(env.ASAAS_ENVIRONMENT, undefined),
      },
      confidence: 0,
      error: { code: resolved.code, message: resolved.message },
      payload: {
        required_secrets: [...ASAAS_REQUIRED_SECRETS],
        secret_aliases: {
          ASAAS_API_KEY: ["ASAAS_API_KEY_SANDBOX", "ASAAS_API_KEY_PRODUCTION"],
        },
        missing: resolved.missing,
      },
    });
    log(JSON.stringify({ event: "asaas.canary.blocked", code: resolved.code, missing: resolved.missing }));
    return toCanaryReport(envelope, blocked ? "BLOCKED_BY_SECRET" : "ERROR");
  }

  const logger = createLogger(resolved.config.apiKey, (row) => log(JSON.stringify(row)));
  try {
    const snapshot = await collectFinanceSnapshot({
      config: resolved.config,
      now,
      transport: options.transport ?? new DefaultFetchTransport(),
      logSink: (row) => logger.info(String(row.event ?? "asaas"), row),
    });
    const freshness = mapAsaasFreshness(snapshot.freshness_status);
    const confirmedIds = snapshot.entities.charges
      .filter((charge) => charge.provider_status === "CONFIRMED")
      .map((charge) => charge.provider_id);
    const envelope = buildEnvelope({
      collector: "asaas",
      freshness_status: freshness,
      observed_at: observedAt,
      source: {
        system: "asaas",
        kind: "finance-api",
        locator: resolved.config.baseUrl,
      },
      confidence: confidenceFor(freshness),
      error: freshness === "FRESH" ? null : { code: "ASAAS_NOT_FRESH", message: `snapshot freshness=${freshness}` },
      payload: {
        environment: snapshot.environment,
        charge_count: snapshot.entities.charges.length,
        customer_count: snapshot.entities.customers.length,
        paid_cents: snapshot.buckets.paid.cents,
        received_cents: snapshot.buckets.received.cents,
        confirmed_not_in_received: confirmedIds.every(
          (id) => !snapshot.buckets.received.provider_ids.includes(id),
        ),
        allowlisted_gets: [...ASAAS_GET_ALLOWLIST_PATHS],
      },
    });
    const capability = freshness === "FRESH" ? "AVAILABLE" : freshness === "STALE" ? "PARTIAL" : "ERROR";
    return toCanaryReport(envelope, capability);
  } catch (err) {
    if (err instanceof AsaasMutationForbiddenError) {
      const envelope = buildEnvelope({
        collector: "asaas",
        freshness_status: "ERROR",
        observed_at: observedAt,
        source: { system: "asaas", kind: "finance-api", locator: resolved.config.baseUrl },
        confidence: 0,
        error: { code: "MUTATION_FORBIDDEN", message: err.message },
        payload: { required_secrets: [...ASAAS_REQUIRED_SECRETS] },
      });
      return toCanaryReport(envelope, "ERROR");
    }
    if (err instanceof AsaasHttpError) {
      const mapped = httpStatusCapability(err.status);
      const envelope = buildEnvelope({
        collector: "asaas",
        freshness_status: mapped.freshness,
        observed_at: observedAt,
        source: { system: "asaas", kind: "finance-api", locator: resolved.config.baseUrl },
        confidence: 0,
        error: { code: mapped.code, message: err.message },
        payload: { http_status: err.status },
      });
      return toCanaryReport(envelope, "ERROR");
    }
    const message = err instanceof Error ? err.message : "asaas canary failed";
    const timedOut = /timeout|abort/i.test(message);
    const envelope = buildEnvelope({
      collector: "asaas",
      freshness_status: "ERROR",
      observed_at: observedAt,
      source: { system: "asaas", kind: "finance-api", locator: resolved.config.baseUrl },
      confidence: 0,
      error: { code: timedOut ? "TIMEOUT" : "ERROR", message },
      payload: {},
    });
    return toCanaryReport(envelope, "ERROR");
  }
}

export function parseCanaryArgs(argv: readonly string[]): { collector: "asaas"; now?: Date } {
  let now: Date | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") {
      throw new Error("usage: cc-connector-canary asaas [--now UTC-Z]");
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
    if (token === "asaas") {
      continue;
    }
    if (token === "warmbly" || token === "pncp" || token === "infra") {
      throw new Error(`this package canary only accepts asaas, got ${token}`);
    }
  }
  return now ? { collector: "asaas", now } : { collector: "asaas" };
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
    const report = await runAsaasCanary({ env, now: args.now, log: io.stderr });
    io.stdout(JSON.stringify(redactDeep(report, env.ASAAS_API_KEY ?? ""), null, 2));
    return { code: 0, report };
  } catch (err) {
    const message = err instanceof Error ? err.message : "canary failed";
    io.stderr(JSON.stringify({ event: "asaas.canary.error", error: message }));
    return { code: 2 };
  }
}

export function denyAsaasMutation(method: string, path: string): void {
  if (isMutationMethod(method)) {
    throw new AsaasMutationForbiddenError(method, path);
  }
  assertGetAllowed(method, path);
}

export { mapChargeLifecycle, GetOnlyAsaasClient };

const isDirect =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("/canary.ts") || process.argv[1].endsWith("/canary.js"));

if (isDirect) {
  void runCli().then((outcome) => {
    process.exitCode = outcome.code;
  });
}
