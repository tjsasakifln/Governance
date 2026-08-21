#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { logEvent } from "./log.js";
import { validExampleDir } from "./paths.js";
import { validateBundle } from "./validate.js";

export interface CliArgs {
  readonly help: boolean;
  readonly bundle: string;
}

export function parseCliArgs(argv: readonly string[]): CliArgs {
  if (argv.includes("--help") || argv.includes("-h")) {
    return { help: true, bundle: validExampleDir() };
  }
  const positional = argv.filter((arg) => !arg.startsWith("-"));
  const bundle = positional[0];
  if (bundle === undefined) {
    throw new Error("usage: cc-security-validate <bundle-dir>");
  }
  return { help: false, bundle };
}

export function runCli(argv: readonly string[] = process.argv.slice(2)): {
  readonly text: string;
  readonly exitCode: number;
} {
  const args = parseCliArgs(argv);
  if (args.help) {
    return {
      text: `Usage:
  tsx src/cli.ts <bundle-dir>

Validates a Control Center security bundle (Caddyfile, Authelia, compose, policy, health).
Exit 0 only when the bundle is accepted.
`,
      exitCode: 0,
    };
  }
  const resolved = path.isAbsolute(args.bundle) ? args.bundle : path.resolve(process.cwd(), args.bundle);
  const result = validateBundle(resolved);
  const verdict = result.ok ? "ACCEPT" : "REJECT";
  const text = `${verdict}\n${JSON.stringify(result, null, 2)}\n`;
  return { text, exitCode: result.ok ? 0 : 1 };
}

function printUsage(): void {
  process.stderr.write(`Usage:
  tsx src/cli.ts <bundle-dir>
`);
}

async function main(): Promise<void> {
  try {
    const { text, exitCode } = runCli();
    process.stdout.write(text);
    process.exitCode = exitCode;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent("security_validate_error", { error: message });
    process.stderr.write(`${message}\n`);
    printUsage();
    process.exitCode = 2;
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
  void main();
}
