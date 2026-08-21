#!/usr/bin/env node
/**
 * Productive Governance → Control Center memory bootstrap.
 *
 *   cc-governance-bootstrap --dry-run
 *   cc-governance-bootstrap --apply --allow-control-center-db-write
 *
 * Dry-run is the default. Apply is explicit, Control Center DB only,
 * idempotent, and never writes Git or providers.
 */
import { pathToFileURL } from "node:url";
import { runCli, type CliDeps, type CliIo, type CliOutcome } from "./cli.js";

export {
  describeBootstrap,
  helpText,
  parseArgv,
  runCli,
  STAGING_RC_CANDIDATE_COUNT,
  type CliArgs,
  type CliDeps,
  type CliIo,
  type CliOutcome,
} from "./cli.js";

export async function runBootstrap(
  argv: string[],
  env: NodeJS.Dict<string> = process.env,
  io?: CliIo,
  deps?: CliDeps,
): Promise<CliOutcome> {
  return runCli(argv, env, io, deps);
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return import.meta.url === pathToFileURL(entry).href;
}

if (isDirectRun()) {
  runBootstrap(process.argv.slice(2)).then((outcome) => {
    process.exitCode = outcome.code;
  });
}
