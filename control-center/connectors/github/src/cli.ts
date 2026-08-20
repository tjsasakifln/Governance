#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { collect, failedCollect } from "./collect.js";
import { parseCollectConfig, parseRepos } from "./config.js";
import { loadFixtureDir } from "./fixture-transport.js";
import { liveTransport } from "./live-transport.js";
import { collectEnvSecrets, createLogger, serializeForOutput } from "./log.js";
import type { CollectResult, HttpTransport } from "./types.js";

export type CliArgs = {
  command: "collect";
  out: string | null;
  fixtureDir: string | null;
  repos: string | null;
  now: string | null;
  help: boolean;
};

export function parseArgv(argv: string[]): CliArgs {
  const args: CliArgs = {
    command: "collect",
    out: null,
    fixtureDir: null,
    repos: null,
    now: null,
    help: false,
  };
  const rest = argv[0] === "collect" ? argv.slice(1) : argv;
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }
    const next = rest[i + 1];
    if (token === "--out" && next) {
      args.out = next;
      i += 1;
      continue;
    }
    if ((token === "--fixture-dir" || token === "--fixtures") && next) {
      args.fixtureDir = next;
      i += 1;
      continue;
    }
    if (token === "--repos" && next) {
      args.repos = next;
      i += 1;
      continue;
    }
    if (token === "--now" && next) {
      args.now = next;
      i += 1;
      continue;
    }
    if (token === "collect") {
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

export function helpText(): string {
  return `Confenge Control Center GitHub collector (read-only)

Usage:
  npm run collect -- --out snapshot.json [--fixture-dir fixtures/populated] [--repos owner/name] [--now ISO-UTC]

Env:
  GITHUB_TOKEN | GITHUB_PAT | GH_TOKEN | GITHUB_APP_INSTALLATION_TOKEN
  GITHUB_REPOS=owner/name,owner/name
  GITHUB_API_BASE=https://api.github.com
  GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY / GITHUB_APP_INSTALLATION_ID
    (documented for operators; mint installation tokens out of band — this collector never POSTs)

This collector issues only GET requests. It never writes issues, PRs, labels, or merges.
`;
}

export async function runCli(
  argv: string[],
  env: NodeJS.Dict<string> = process.env,
  write: (path: string, body: string) => void = (path, body) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body, "utf8");
  },
  logSink: (line: string) => void = (line) => console.error(line),
): Promise<{ code: number; result?: CollectResult; error?: string }> {
  let args: CliArgs;
  try {
    args = parseArgv(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid arguments";
    logSink(message);
    return { code: 2, error: message };
  }
  if (args.help) {
    logSink(helpText());
    return { code: 0 };
  }

  const now = args.now ? () => new Date(args.now as string) : () => new Date();
  if (args.now && Number.isNaN(now().getTime())) {
    return { code: 2, error: `Invalid --now timestamp: ${args.now}` };
  }

  let transport: HttpTransport;
  let fixtureRepos: string[] | undefined;
  if (args.fixtureDir) {
    const loaded = loadFixtureDir(resolve(args.fixtureDir));
    transport = loaded.transport;
    fixtureRepos = loaded.manifest.repos;
  } else {
    transport = liveTransport;
  }

  const secrets = collectEnvSecrets(env);
  const logger = createLogger(logSink, now, secrets);
  const parsed = parseCollectConfig({
    env,
    repos: args.repos ?? fixtureRepos ?? env.GITHUB_REPOS,
    transport,
    now,
    logger,
  });

  if (!parsed.ok) {
    const allowlist = safeAllowlist(args.repos ?? fixtureRepos ?? env.GITHUB_REPOS);
    const result = failedCollect({
      now: now(),
      allowlist,
      code: parsed.code === "missing_credentials" || parsed.code === "missing_installation_token"
        ? parsed.code
        : parsed.code === "invalid_config"
          ? "invalid_config"
          : "missing_credentials",
      message: parsed.message,
    });
    persist(args.out, result, secrets, write);
    logger("collect_failed", { code: parsed.code, message: parsed.message });
    return { code: 1, result, error: parsed.message };
  }

  const result = await collect(parsed.config);
  persist(args.out, result, [...secrets, ...parsed.secrets], write);
  const failed = result.snapshot.freshness_status === "failed";
  return { code: failed ? 1 : 0, result };
}

function persist(
  out: string | null,
  result: CollectResult,
  secrets: string[],
  write: (path: string, body: string) => void,
): void {
  if (!out) {
    return;
  }
  write(resolve(out), `${serializeForOutput(result, secrets)}\n`);
}

function safeAllowlist(raw: unknown): string[] {
  const parsed = parseRepos(raw ?? "");
  return parsed.ok ? parsed.repos : [];
}

const argv1 = process.argv[1];
if (argv1 && import.meta.url === pathToFileURL(resolve(argv1)).href) {
  runCli(process.argv.slice(2))
    .then((outcome) => {
      if (outcome.error && outcome.code !== 0) {
        process.exitCode = outcome.code;
      } else {
        process.exitCode = outcome.code;
      }
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "cli_failed";
      console.error(JSON.stringify({ event: "cli_crash", message }));
      process.exitCode = 1;
    });
}
