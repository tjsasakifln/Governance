import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { PACK_ROOT } from "../src/paths.ts";

export function runCli(
  args: string[],
  env: NodeJS.ProcessEnv = {},
): SpawnSyncReturns<string> {
  return spawnSync("npx", ["tsx", "src/cli.ts", ...args], {
    cwd: PACK_ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

export function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function testKey(): string {
  return randomBytes(32).toString("hex");
}
