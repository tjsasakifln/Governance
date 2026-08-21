#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, "..");

function tryPlaywright() {
  const screenshot = join(mkdtempSync(join(tmpdir(), "cc-web-")), "web-shell.png");
  const preview = spawn("npm", ["run", "preview", "--", "--host", "127.0.0.1", "--port", "4173"], {
    cwd: app,
    stdio: "ignore",
  });
  const started = Date.now();
  while (Date.now() - started < 4000) {
    // give vite preview a moment
  }
  const probe = spawnSync("node", [join(here, "launch-probe.mjs"), "http://127.0.0.1:4173/", screenshot], {
    cwd: app,
    encoding: "utf8",
  });
  preview.kill();
  if (probe.status === 0) {
    process.stdout.write(probe.stdout);
    return true;
  }
  process.stderr.write(probe.stderr || probe.stdout || "playwright probe failed\n");
  writeFileSync(join(app, "playwright-env.log"), probe.stderr || probe.stdout || "playwright launcher failed");
  return false;
}

const built = spawnSync("npm", ["run", "build"], { cwd: app, stdio: "inherit" });
if (built.status !== 0) {
  process.exit(built.status ?? 1);
}

try {
  if (!tryPlaywright()) {
    process.stdout.write("playwright launcher unavailable; adapter unit tests remain the e2e fallback\n");
  }
} catch (err) {
  process.stderr.write(String(err));
  process.stdout.write("playwright launcher unavailable; adapter unit tests remain the e2e fallback\n");
}
