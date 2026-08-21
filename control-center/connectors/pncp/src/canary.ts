#!/usr/bin/env node
import { evaluatePncpFreshness } from "./evaluate.js";
import {
  buildEnvelope,
  toCanaryReport,
  type Capability,
  type CanaryReport,
} from "./envelope.js";
import { logEvent } from "./log.js";
import {
  PNCP_BINDING_SECRETS,
  argvLooksForbidden,
  isFixtureLocator,
  loadPncpProductionConfig,
  resolvePncpProductionBinding,
} from "./production-config.js";
import { CONTRACT_VERSION, type AdapterConfig, type FreshnessStatus, type PncpFreshnessEvaluation } from "./types.js";

export interface PncpCanaryOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly now?: Date;
  readonly argv?: readonly string[];
  readonly exists?: (path: string) => boolean;
  readonly evaluate?: (config: AdapterConfig) => Promise<PncpFreshnessEvaluation>;
  readonly commandRunner?: AdapterConfig["commandRunner"];
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

function capabilityFor(evaluation: PncpFreshnessEvaluation): Capability {
  if (evaluation.parse_error?.code === "UNKNOWN_CONTRACT_VERSION") {
    return "CONTRACT_DRIFT";
  }
  if (evaluation.freshness_status === "FRESH") {
    return "AVAILABLE";
  }
  if (evaluation.freshness_status === "STALE" || evaluation.freshness_status === "UNKNOWN") {
    return "BLOCKED_UPSTREAM";
  }
  return "ERROR";
}

export async function runPncpCanary(options: PncpCanaryOptions = {}): Promise<CanaryReport> {
  const now = options.now ?? new Date();
  const observedAt = now.toISOString();
  const env = options.env ?? process.env;
  const argv = options.argv ?? [];
  loadPncpProductionConfig();

  if (argvLooksForbidden(argv)) {
    const envelope = buildEnvelope({
      collector: "pncp",
      freshness_status: "ERROR",
      observed_at: observedAt,
      source: { system: "extra-cli", kind: "pncp-contract-freshness", locator: "forbidden-argv" },
      confidence: 0,
      error: {
        code: "FORBIDDEN_LIVE_COLLECTION",
        message: "PNCP --live / ingest / recrawl / backfill is forbidden",
      },
      payload: { forbidden: ["--live", "ingest", "recrawl", "backfill"] },
    });
    logEvent("error", "pncp_canary_forbidden", { argv: argv.filter((t) => t.startsWith("-")) });
    return toCanaryReport(envelope, "ERROR");
  }

  const binding = resolvePncpProductionBinding(env, options.exists);
  if (!binding.ok) {
    const blocked = binding.code === "BINDING_MISSING" || binding.code === "FIXTURE_FORBIDDEN";
    const envelope = buildEnvelope({
      collector: "pncp",
      freshness_status: "UNKNOWN",
      observed_at: observedAt,
      source: { system: "extra-cli", kind: "pncp-contract-freshness", locator: "PNCP_CONTRACT_PATH" },
      confidence: 0,
      error: { code: binding.code, message: binding.message },
      payload: {
        required_bindings: [...PNCP_BINDING_SECRETS],
        contract: CONTRACT_VERSION,
      },
    });
    return toCanaryReport(envelope, blocked ? "BLOCKED_UPSTREAM" : "ERROR");
  }

  if (binding.kind === "file" && isFixtureLocator(binding.filePath)) {
    const envelope = buildEnvelope({
      collector: "pncp",
      freshness_status: "UNKNOWN",
      observed_at: observedAt,
      source: { system: "extra-cli", kind: "pncp-contract-freshness", locator: "PNCP_CONTRACT_PATH" },
      confidence: 0,
      error: { code: "FIXTURE_FORBIDDEN", message: "production PNCP binding must not be a repo fixture" },
      payload: { required_bindings: [...PNCP_BINDING_SECRETS] },
    });
    return toCanaryReport(envelope, "BLOCKED_UPSTREAM");
  }

  const config: AdapterConfig = {
    kind: binding.kind,
    now,
    ...(binding.kind === "file" ? { filePath: binding.filePath } : { httpUrl: binding.httpUrl }),
  };
  if (options.commandRunner) {
    throw new Error("production PNCP canary must not run extra-cli commands");
  }

  const evaluate = options.evaluate ?? evaluatePncpFreshness;
  const evaluation = await evaluate(config);
  const freshness = evaluation.freshness_status;
  const envelope = buildEnvelope({
    collector: "pncp",
    freshness_status: freshness,
    observed_at: observedAt,
    source: {
      system: "extra-cli",
      kind: "pncp-contract-freshness",
      locator: evaluation.locator,
    },
    confidence: confidenceFor(freshness),
    error:
      freshness === "FRESH"
        ? null
        : {
            code: evaluation.parse_error?.code ?? "PNCP_NOT_FRESH",
            message: evaluation.parse_error?.message ?? `upstream ${evaluation.upstream_status ?? "unknown"}`,
          },
    payload: {
      contract_version: evaluation.contract_version,
      upstream_status: evaluation.upstream_status,
      reason_codes: evaluation.reason_codes,
      adapter_kind: evaluation.adapter_kind,
      as_of: evaluation.as_of,
    },
  });
  return toCanaryReport(envelope, capabilityFor(evaluation));
}

export function parseCanaryArgs(argv: readonly string[]): { collector: "pncp"; now?: Date; argv: readonly string[] } {
  let now: Date | undefined;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") {
      throw new Error("usage: cc-connector-canary pncp [--now UTC-Z]");
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
    if (token === "pncp") {
      continue;
    }
    if (token === "warmbly" || token === "asaas" || token === "infra") {
      throw new Error(`this package canary only accepts pncp, got ${token}`);
    }
    if (token) {
      rest.push(token);
    }
  }
  return now ? { collector: "pncp", now, argv: rest } : { collector: "pncp", argv: rest };
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
    const report = await runPncpCanary({
      env,
      argv: [...argv, ...args.argv],
      ...(args.now ? { now: args.now } : {}),

    });
    io.stdout(JSON.stringify(report, null, 2));
    return { code: 0, report };
  } catch (err) {
    const message = err instanceof Error ? err.message : "canary failed";
    io.stderr(JSON.stringify({ event: "pncp.canary.error", error: message }));
    return { code: 2 };
  }
}

const isDirect =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("/canary.ts") || process.argv[1].endsWith("/canary.js"));

if (isDirect) {
  void runCli().then((outcome) => {
    process.exitCode = outcome.code;
  });
}
