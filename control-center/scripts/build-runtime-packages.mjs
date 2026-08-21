#!/usr/bin/env node
/**
 * Builder-only: typecheck + tsc emit for the workspaces a runtime image needs.
 * Package unit tests stay in CI; they need embedded-postgres install scripts.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const name = process.argv[2];

const SETS = {
  context: [
    "@confenge/control-center-contracts",
    "@confenge/control-center-persistence",
    "@confenge/control-center-context",
  ],
  mcp: ["@confenge/control-center-contracts", "@confenge/control-center-mcp"],
  collector: ["@confenge/control-center-contracts", "@confenge/control-center-collector"],
  ops: ["@confenge/control-center-deploy"],
  web: ["@confenge/control-center-web-shell"],
};

const workspaces = SETS[name];
if (!workspaces) {
  process.stderr.write(`unknown image set ${name}; expected ${Object.keys(SETS).join("|")}\n`);
  process.exit(1);
}

function run(args) {
  const result = spawnSync("npm", args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

for (const ws of workspaces) {
  run(["run", "typecheck", `--workspace=${ws}`]);
  run(["run", "build", `--workspace=${ws}`]);
}
