#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { COLLECTOR_NAMES, runCollectors, type CollectorName } from "./run.ts";

export async function runCli(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
  io: { stdout: (line: string) => void; stderr: (line: string) => void } = {
    stdout: (line) => process.stdout.write(`${line}\n`),
    stderr: (line) => process.stderr.write(`${line}\n`),
  },
): Promise<{ code: number; result?: Awaited<ReturnType<typeof runCollectors>> }> {
  const names: CollectorName[] = [];
  for (const token of argv) {
    if (token === "--help" || token === "-h") {
      io.stdout(
        `cc-collector [--only github,warmbly,asaas,pncp,infra]\nSimple observable runner. Missing credentials emit UNKNOWN or ERROR, never FRESH.`,
      );
      return { code: 0 };
    }
    if (token.startsWith("--only=")) {
      const list = token.slice("--only=".length).split(",").map((item) => item.trim());
      for (const name of list) {
        if ((COLLECTOR_NAMES as readonly string[]).includes(name)) {
          names.push(name as CollectorName);
        } else {
          io.stderr(`unknown collector: ${name}`);
          return { code: 2 };
        }
      }
      continue;
    }
    if (token === "--only") {
      continue;
    }
    if ((COLLECTOR_NAMES as readonly string[]).includes(token)) {
      names.push(token as CollectorName);
    }
  }
  const result = await runCollectors({
    names: names.length > 0 ? names : COLLECTOR_NAMES,
    env,
    log: io.stderr,
  });
  io.stdout(JSON.stringify(result, null, 2));
  const healthyFresh = result.collectors.some(
    (row) => row.freshness_status === "FRESH" && !row.error,
  );
  void healthyFresh;
  return { code: 0, result };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runCli(process.argv.slice(2)).then((outcome) => {
    process.exitCode = outcome.code;
  });
}
