#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseAllowlist } from "./allowlist.js";
import { collect } from "./collect.js";
import { createFixturePorts, parseFixture } from "./fixture-ports.js";
import { createLivePorts } from "./live-ports.js";
import { logEvent } from "./log.js";

export interface CliArgs {
  readonly fixture?: string;
  readonly live: boolean;
  readonly allowlist?: string;
}

export function parseCliArgs(argv: readonly string[]): CliArgs {
  let fixture: string | undefined;
  let allowlist: string | undefined;
  let live = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--fixture") {
      fixture = argv[i + 1];
      i += 1;
    } else if (arg === "--allowlist") {
      allowlist = argv[i + 1];
      i += 1;
    } else if (arg === "--live") {
      live = true;
    } else if (arg === "--help" || arg === "-h") {
      throw new Error("usage: collect --fixture <path> | --live [--allowlist <path>]");
    }
  }
  const args: CliArgs = { live };
  if (fixture) {
    Object.assign(args, { fixture });
  }
  if (allowlist) {
    Object.assign(args, { allowlist });
  }
  return args;
}

function resolvePath(raw: string): string {
  return isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
}

export async function collectFromFixtureFile(fixturePath: string): Promise<unknown> {
  const raw: unknown = JSON.parse(await readFile(resolvePath(fixturePath), "utf8"));
  const fixture = parseFixture(raw);
  const allowlist = parseAllowlist(fixture.allowlist);
  return collect({
    allowlist,
    ports: createFixturePorts(fixture, allowlist),
  });
}

export async function runCli(argv: readonly string[] = process.argv.slice(2)): Promise<string> {
  const args = parseCliArgs(argv);
  if (args.fixture && args.live) {
    throw new Error("use either --fixture or --live, not both");
  }
  if (args.fixture) {
    const result = await collectFromFixtureFile(args.fixture);
    return JSON.stringify(result, null, 2);
  }
  if (!args.live) {
    throw new Error("usage: collect --fixture <path> | --live [--allowlist <path>]");
  }
  const allowlistPath =
    args.allowlist ?? process.env.CONTROL_CENTER_INFRA_ALLOWLIST_PATH;
  if (!allowlistPath) {
    throw new Error("live mode requires --allowlist or CONTROL_CENTER_INFRA_ALLOWLIST_PATH");
  }
  const allowlistRaw: unknown = JSON.parse(await readFile(resolvePath(allowlistPath), "utf8"));
  const agentBaseUrl = process.env.CONTROL_CENTER_INFRA_AGENT_URL;
  const result = await collect({
    allowlist: allowlistRaw,
    ports: createLivePorts(agentBaseUrl ? { agentBaseUrl } : {}),
  });
  return JSON.stringify(result, null, 2);
}

async function main(): Promise<void> {
  try {
    const json = await runCli();
    process.stdout.write(`${json}\n`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "collect failed";
    logEvent("infra_collect_error", { error: message });
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
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
