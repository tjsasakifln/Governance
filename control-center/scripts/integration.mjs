#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function run(cmd, args, extraEnv = {}) {
  const result = spawnSync(cmd, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run("npx", [
  "tsx",
  "--test",
  "--test-concurrency=1",
  "tests/convergence/contracts.test.ts",
  "tests/convergence/dockerfiles.test.ts",
  "tests/convergence/cve-exceptions.test.ts",
  "tests/convergence/web-prod-hardening.test.ts",
  "tests/convergence/importer-apply.test.ts",
  "tests/convergence/importer-apply-db.test.ts",
  "tests/convergence/mcp-context.test.ts",
  "tests/convergence/snapshots.test.ts",
  "tests/convergence/pncp-warmbly.test.ts",
  "tests/convergence/live-runtime-qa.test.ts",
  "tests/convergence/domain-gates.test.ts",
  "tests/convergence/lead-detail-surface.test.ts",
  "tests/convergence/auth-fail-closed.test.ts",
  "services/context/test/postgres-adapter.test.ts",
  "persistence/tests/migrate.test.ts",
]);
