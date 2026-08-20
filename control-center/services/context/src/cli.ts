import { actorFromEnv, bootFromEnv } from "./boot.ts";
import { canonicalStringify } from "./canonical.ts";
import { invalid, isServiceError } from "./errors.ts";
import { silentLogger } from "./log.ts";
import { parseScope } from "./scope.ts";
import type { Scope } from "./types.ts";

const COMMANDS = ["get_context", "get_active_directives", "get_priorities", "get_decisions"] as const;
type Command = (typeof COMMANDS)[number];

function parseArgs(argv: string[]): { command: Command; scope?: Scope } {
  const [command, ...rest] = argv;
  if (!command || !(COMMANDS as readonly string[]).includes(command)) {
    throw invalid(`command must be one of: ${COMMANDS.join(", ")}`);
  }
  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token?.startsWith("--")) {
      throw invalid(`unexpected argument: ${token ?? ""}`);
    }
    const key = token.slice(2);
    const value = rest[i + 1];
    if (!value || value.startsWith("--")) {
      throw invalid(`missing value for --${key}`);
    }
    flags[key] = value;
    i += 1;
  }
  const extra = Object.keys(flags).filter((k) => k !== "company" && k !== "domain" && k !== "resource");
  if (extra.length > 0) {
    throw invalid(`unknown flags: ${extra.sort().join(", ")}`);
  }
  if (command === "get_priorities" || command === "get_decisions") {
    if (!flags.company && !flags.domain && !flags.resource) {
      return { command };
    }
  }
  if (!flags.company) {
    throw invalid("--company is required");
  }
  return { command: command as Command, scope: parseScope(flags) };
}

export function runCli(argv: string[], env: NodeJS.ProcessEnv = process.env): string {
  const parsed = parseArgs(argv);
  const boot = bootFromEnv(env, { logger: silentLogger });
  const actor = actorFromEnv(env);
  let result: unknown;
  switch (parsed.command) {
    case "get_context":
      result = boot.service.getContext(actor, parsed.scope ?? parseScope({ company: boot.defaultCompany }));
      break;
    case "get_active_directives":
      result = {
        items: boot.service.getActiveDirectives(
          actor,
          parsed.scope ?? parseScope({ company: boot.defaultCompany }),
        ),
      };
      break;
    case "get_priorities":
      result = { items: boot.service.getPriorities(actor, parsed.scope) };
      break;
    case "get_decisions":
      result = { items: boot.service.getDecisions(actor, parsed.scope) };
      break;
  }
  return canonicalStringify(result);
}

function isDirectEntry(): boolean {
  const arg = process.argv[1];
  if (!arg) {
    return false;
  }
  const normalized = arg.replace(/\\/g, "/");
  return normalized.endsWith("/cli.ts") || normalized.endsWith("/cli.js");
}

if (isDirectEntry()) {
  try {
    process.stdout.write(runCli(process.argv.slice(2)));
  } catch (err) {
    if (isServiceError(err)) {
      process.stderr.write(canonicalStringify({ error: err.code, message: err.message }));
      process.exit(err.httpStatus >= 500 ? 1 : 2);
    }
    process.stderr.write(canonicalStringify({ error: "internal", message: "cli failed" }));
    process.exit(1);
  }
}
