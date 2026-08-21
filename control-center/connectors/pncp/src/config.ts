import type { AdapterConfig, AdapterKind } from "./types.js";
import { ADAPTER_KINDS } from "./types.js";

export const EXTRA_CLI_FRESHNESS_SCRIPT =
  "scripts/ops/pncp_contract_freshness.py" as const;

const FORBIDDEN_COMMAND_TOKENS = new Set([
  "--live",
  "live",
  "--ingest",
  "ingest",
  "--recrawl",
  "recrawl",
  "--backfill",
  "backfill",
]);

export const ENV_VAR_DOCS = [
  "PNCP_ADAPTER_KIND=file|http|command",
  "PNCP_CONTRACT_PATH=<read-only extra-cli PNCP_CONTRACT_FRESHNESS/1.0 JSON>",
  "PNCP_CONTRACT_HTTP_URL=<read-only GET URL of the same contract>",
  "PNCP_COMMAND_SNAPSHOT=<path passed to extra-cli --from-snapshot --json>",
] as const;

export function defaultReadOnlyCommandArgv(snapshotPath: string): string[] {
  return [
    "python3",
    EXTRA_CLI_FRESHNESS_SCRIPT,
    "--from-snapshot",
    snapshotPath,
    "--json",
  ];
}

export function commandArgvIsForbidden(argv: readonly string[]): boolean {
  return argv.some((token) => FORBIDDEN_COMMAND_TOKENS.has(token));
}

function isAdapterKind(value: string): value is AdapterKind {
  return (ADAPTER_KINDS as readonly string[]).includes(value);
}

export function loadAdapterConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  overrides: Partial<AdapterConfig> = {},
): AdapterConfig {
  const rawKind = overrides.kind ?? env.PNCP_ADAPTER_KIND ?? "file";
  const kind: AdapterKind = isAdapterKind(rawKind) ? rawKind : "file";
  const filePath =
    overrides.filePath ??
    env.PNCP_CONTRACT_PATH ??
    env.PNCP_COMMAND_SNAPSHOT;
  return {
    kind,
    filePath,
    httpUrl: overrides.httpUrl ?? env.PNCP_CONTRACT_HTTP_URL,
    fetchImpl: overrides.fetchImpl,
    httpTimeoutMs: overrides.httpTimeoutMs,
    commandArgv: overrides.commandArgv,
    commandRunner: overrides.commandRunner,
    now: overrides.now,
  };
}
