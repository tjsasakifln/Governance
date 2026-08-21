#!/usr/bin/env node
import { aggregateFinanceReadModel, assertIntegerCents } from "./aggregate.js";
import { loadFixtureDocument } from "./adapter.js";
import { createLogger } from "./log.js";

export interface CliArgs {
  fixture: string | null;
  help: boolean;
}

export function parseArgv(argv: string[]): CliArgs {
  const args: CliArgs = { fixture: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }
    const next = argv[i + 1];
    if ((token === "--fixture" || token === "-f") && next) {
      args.fixture = next;
      i += 1;
      continue;
    }
    if (token && !token.startsWith("-") && args.fixture === null) {
      args.fixture = token;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

export function helpText(): string {
  return `Confenge Control Center finance read-model (read-only)

Usage:
  npm run cli -- --fixture fixtures/mixed-stages.json

Never mutates Asaas or any payment provider. Values are integer cents.
`;
}

export function runCli(argv: string[] = process.argv.slice(2)): number {
  const args = parseArgv(argv);
  const fixture = args.fixture ?? process.env.CC_FINANCE_FIXTURE ?? null;
  if (args.help || !fixture) {
    process.stdout.write(`${helpText()}\n`);
    return args.help ? 0 : 1;
  }
  const doc = loadFixtureDocument(fixture);
  const envWindow = process.env.CC_FINANCE_FRESHNESS_WINDOW_SECONDS;
  let freshnessWindow = doc.freshness_window_seconds;
  if (envWindow !== undefined && envWindow !== "") {
    const parsed = Number(envWindow);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new Error("CC_FINANCE_FRESHNESS_WINDOW_SECONDS must be a non-negative integer");
    }
    freshnessWindow = parsed;
  }
  const snapshot = aggregateFinanceReadModel(doc.events, {
    as_of: doc.as_of,
    cash_in_window: doc.cash_in_window,
    freshness_window_seconds: freshnessWindow,
    snapshot_id: `cc:finance-snapshot:${doc.id}`,
  });
  assertIntegerCents(snapshot);
  process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
  return 0;
}

const invoked = process.argv[1]?.includes("cli.ts") || process.argv[1]?.includes("cli.js");
if (invoked) {
  try {
    process.exitCode = runCli();
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    createLogger().error("finance_cli_failed", { code: "FINANCE_CLI_FAILED" });
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
