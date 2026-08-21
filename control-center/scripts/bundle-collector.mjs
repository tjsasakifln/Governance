#!/usr/bin/env node
/**
 * Builder-only collector emit. Sibling connectors mix .ts/.js and cannot share one tsc program.
 * esbuild follows the server graph; it does not survive in the runtime image.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const runner = join(root, "connectors/runner");
const outfile = join(runner, "dist/server.js");
const entry = join(runner, "src/server.ts");
const localEsbuild = join(root, "node_modules/esbuild/bin/esbuild");
const args = [
  entry,
  "--bundle",
  "--platform=node",
  "--format=esm",
  `--outfile=${outfile}`,
  "--legal-comments=none",
];

let result;
if (existsSync(localEsbuild)) {
  result = spawnSync(localEsbuild, args, { stdio: "inherit", cwd: runner });
} else {
  result = spawnSync("npx", ["--yes", "esbuild@0.25.11", ...args], { stdio: "inherit", cwd: runner });
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
if (!existsSync(outfile)) {
  process.stderr.write("collector bundle missing\n");
  process.exit(1);
}
process.stdout.write(`${JSON.stringify({ ok: true, outfile })}\n`);
