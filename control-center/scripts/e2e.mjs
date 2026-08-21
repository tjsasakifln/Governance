#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function run(cmd, args) {
  return spawnSync(cmd, args, { cwd: root, stdio: "inherit", env: process.env });
}

const units = run("npx", [
  "tsx",
  "--test",
  "apps/web-shell/tests/adapters.test.ts",
  "apps/web-shell/tests/contract.test.ts",
  "tests/convergence/web-http.test.ts",
]);
if (units.status !== 0) {
  process.exit(units.status ?? 1);
}

const probe = run("node", ["apps/web-shell/scripts/e2e.mjs"]);
process.exit(probe.status === null ? 0 : probe.status);
