#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isOsLibLauncherFailure } from "../src/playwright-env.ts";

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, "..");
const ccRoot = join(app, "../..");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitHttp(url, timeoutMs) {
  const started = Date.now();
  let last = "";
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      last = `status ${response.status}`;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    await sleep(150);
  }
  throw new Error(`timeout waiting for ${url}: ${last}`);
}

function patchIdentity(html) {
  return html
    .replace(
      /<meta name="cc-actor-id" content="[^"]*" \/>/,
      '<meta name="cc-actor-id" content="founder-local" />',
    )
    .replace(
      /<meta name="cc-actor-kind" content="[^"]*" \/>/,
      '<meta name="cc-actor-kind" content="human" />',
    );
}

async function tryPlaywright(baseUrl, screenshot) {
  const probe = spawnSync("node", [join(here, "launch-probe.mjs"), baseUrl, screenshot], {
    cwd: app,
    encoding: "utf8",
  });
  const output = `${probe.stdout || ""}${probe.stderr || ""}`;
  process.stdout.write(probe.stdout || "");
  process.stderr.write(probe.stderr || "");
  if (probe.status === 0) {
    return { ok: true, output };
  }
  writeFileSync(join(app, "playwright-env.log"), output || "playwright probe failed");
  return { ok: false, launcher: isOsLibLauncherFailure(output), output };
}

const built = spawnSync("npm", ["run", "build"], { cwd: app, stdio: "inherit" });
if (built.status !== 0) {
  process.exit(built.status ?? 1);
}

const distHtml = join(app, "dist/index.html");
writeFileSync(distHtml, patchIdentity(readFileSync(distHtml, "utf8")));

const context = spawn("npx", ["tsx", "scripts/boot-production-context.ts"], {
  cwd: ccRoot,
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: "8799",
    NODE_ENV: "test",
    CONTROL_CENTER_FOUNDER_ACTOR_ID: "founder-local",
  },
  stdio: "ignore",
});
const web = spawn("node", [join(here, "serve-prod.mjs")], {
  cwd: app,
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: "4173",
    CC_CONTEXT_UPSTREAM: "http://127.0.0.1:8799",
    CC_ACTOR_ID: "founder-local",
    CC_ACTOR_KIND: "human",
  },
  stdio: "ignore",
});

let exitCode = 1;
try {
  await waitHttp("http://127.0.0.1:8799/healthz", 45_000);
  await waitHttp("http://127.0.0.1:4173/healthz", 15_000);
  const proxied = await fetch("http://127.0.0.1:4173/v1/context?scope=company", {
    headers: { "x-actor-id": "founder-local", "x-actor-kind": "human" },
  });
  const ctxBody = await proxied.json();
  if (!proxied.ok || !Array.isArray(ctxBody.risks) || ctxBody.risks.length < 1 || !Array.isArray(ctxBody.priorities) || ctxBody.priorities.length < 1) {
    throw new Error(`production context proxy is not substantially filled: status=${proxied.status}`);
  }
  const attentionHeaders = { "x-actor-id": "founder-local", "x-actor-kind": "human" };
  const attention = await fetch("http://127.0.0.1:4173/v1/attention?scope=company&horizon=now", {
    headers: attentionHeaders,
  });
  if (attention.status === 404) {
    throw new Error("production cockpit still 404s /v1/attention?scope=company&horizon=now");
  }
  if (!attention.ok) {
    throw new Error(`production /v1/attention is not served by the real backend: status=${attention.status}`);
  }
  process.stdout.write(
    `context_risks=${ctxBody.risks.length} context_priorities=${ctxBody.priorities.length}\n`,
  );
  const shotDir = process.env.CC_SCREENSHOT_DIR
    ? process.env.CC_SCREENSHOT_DIR
    : mkdtempSync(join(tmpdir(), "cc-web-"));
  mkdirSync(shotDir, { recursive: true });
  const screenshot = join(shotDir, "web-shell.png");
  const probe = await tryPlaywright("http://127.0.0.1:4173/", screenshot);
  if (probe.ok) {
    process.stdout.write(`screenshot=${screenshot}\n`);
    exitCode = 0;
  } else if (probe.launcher) {
    process.stdout.write("playwright launcher unavailable; adapter unit tests remain the e2e fallback\n");
    exitCode = 0;
  } else {
    process.stderr.write("playwright launched but the production web-shell assertion failed\n");
    exitCode = 1;
  }
} catch (err) {
  process.stderr.write(String(err));
  process.stderr.write("\n");
  exitCode = 1;
} finally {
  context.kill();
  web.kill();
}
process.exit(exitCode);
