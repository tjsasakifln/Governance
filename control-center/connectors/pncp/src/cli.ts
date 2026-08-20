import { evaluatePncpFreshness } from "./evaluate.js";
import { loadAdapterConfigFromEnv } from "./config.js";
import type { AdapterConfig, AdapterKind } from "./types.js";
import { ADAPTER_KINDS } from "./types.js";

function argValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return argv[index + 1];
}

function isAdapterKind(value: string): value is AdapterKind {
  return (ADAPTER_KINDS as readonly string[]).includes(value);
}

function parseArgv(argv: string[]): AdapterConfig {
  const rawKind = argValue(argv, "--kind") ?? process.env.PNCP_ADAPTER_KIND ?? "file";
  const kind: AdapterKind = isAdapterKind(rawKind) ? rawKind : "file";
  return loadAdapterConfigFromEnv(process.env, {
    kind,
    filePath: argValue(argv, "--path") ?? process.env.PNCP_CONTRACT_PATH,
    httpUrl: argValue(argv, "--url") ?? process.env.PNCP_CONTRACT_HTTP_URL,
  });
}

export function cliOutput(evaluation: Awaited<ReturnType<typeof evaluatePncpFreshness>>): Record<string, unknown> {
  return {
    freshness_status: evaluation.freshness_status,
    upstream_status: evaluation.upstream_status,
    contract_version: evaluation.contract_version,
    reason_codes: evaluation.reason_codes,
    as_of: evaluation.as_of,
    deployed_sha: evaluation.deployed_sha,
    policy_version: evaluation.policy_version,
    serviceHealth: evaluation.serviceHealth,
    sourceObservation: evaluation.sourceObservation,
  };
}

async function main(): Promise<void> {
  const config = parseArgv(process.argv.slice(2));
  const evaluation = await evaluatePncpFreshness(config);
  process.stdout.write(`${JSON.stringify(cliOutput(evaluation), null, 2)}\n`);
}

const isDirect =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("/cli.ts") || process.argv[1].endsWith("/cli.js"));

if (isDirect) {
  main().catch((cause: unknown) => {
    const message = cause instanceof Error ? cause.message : "unknown_error";
    process.stderr.write(
      `${JSON.stringify({ level: "error", event: "cli_failed", message })}\n`,
    );
    process.exitCode = 1;
  });
}
