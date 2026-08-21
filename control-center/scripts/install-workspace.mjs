#!/usr/bin/env node
/**
 * `npm run install` must not recurse into the npm lifecycle `install` script.
 * Inner install uses --ignore-scripts; native modules are rebuilt afterwards.
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

const hasLock = existsSync("package-lock.json");
const useCi = process.env.CI === "true" && hasLock;
const installCmd = useCi
  ? "npm ci --workspaces --include-workspace-root --ignore-scripts"
  : "npm install --workspaces --include-workspace-root --ignore-scripts";

execSync(installCmd, { stdio: "inherit", env: { ...process.env, npm_config_ignore_scripts: "true" } });

try {
  execSync(
    "npm rebuild esbuild embedded-postgres @embedded-postgres/linux-x64 --foreground-scripts",
    { stdio: "inherit" },
  );
} catch {
  // optional native rebuild; tests that need embedded postgres will fail honestly
}
