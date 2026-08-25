#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { isOsLibLauncherFailure } from "../src/playwright-env.ts";

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, "..");
const ccRoot = join(app, "../..");
const E2E_RELEASE_SHA = "8a2eb1f012345678901234567890123456789012";
const REQUIRED_RUNTIME_BASELINE_SHA = "64ece7d38abacd3adeaa02735b4f22af66caab0f";

function assertRuntimeIdentity(identity, service) {
  if (identity.schema_version !== "control-center.runtime-identity.v1"
    || identity.service !== service
    || identity.release_sha !== E2E_RELEASE_SHA
    || identity.required_baseline_sha !== REQUIRED_RUNTIME_BASELINE_SHA
    || identity.release_status !== "PINNED"
    || identity.production_required !== true) {
    throw new Error(`invalid runtime identity for ${service}: ${JSON.stringify(identity)}`);
  }
}

async function freePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address();
  if (!address || typeof address === "string") throw new Error("could not allocate local e2e port");
  const port = address.port;
  await new Promise((resolve, reject) => probe.close((err) => (err ? reject(err) : resolve())));
  return port;
}

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

const contextPort = await freePort();
const webPort = await freePort();
const contextBase = `http://127.0.0.1:${contextPort}`;
const webBase = `http://127.0.0.1:${webPort}`;

const context = spawn("npx", ["tsx", "scripts/boot-production-context.ts"], {
  cwd: ccRoot,
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(contextPort),
    NODE_ENV: "test",
    CONTROL_CENTER_ENV: "production",
    CC_RELEASE_SHA: E2E_RELEASE_SHA,
    CONTROL_CENTER_FOUNDER_ACTOR_ID: "founder-local",
  },
  stdio: "ignore",
});
const web = spawn("node", [join(here, "serve-prod.mjs")], {
  cwd: app,
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(webPort),
    CC_CONTEXT_UPSTREAM: contextBase,
    CC_ACTOR_ID: "founder-local",
    CC_ACTOR_KIND: "human",
    CONTROL_CENTER_ENV: "production",
    CC_RELEASE_SHA: E2E_RELEASE_SHA,
  },
  stdio: "ignore",
});

let exitCode = 1;
try {
  await waitHttp(`${contextBase}/healthz`, 45_000);
  await waitHttp(`${webBase}/healthz`, 15_000);
  await waitHttp(`${contextBase}/ready`, 15_000);
  await waitHttp(`${webBase}/ready`, 15_000);
  const contextIdentity = await fetch(`${contextBase}/v1/runtime-identity`).then((response) => response.json());
  const webIdentity = await fetch(`${webBase}/runtime-identity`).then((response) => response.json());
  assertRuntimeIdentity(contextIdentity, "control-center-context");
  assertRuntimeIdentity(webIdentity, "control-center-web");
  const cockpitHtml = await fetch(`${webBase}/`).then((response) => response.text());
  if (!cockpitHtml.includes(`name="cc-release-sha" content="${E2E_RELEASE_SHA}"`)) {
    throw new Error("authenticated cockpit does not receive the immutable release SHA");
  }
  const proxied = await fetch(`${webBase}/v1/context?scope=company`, {
    headers: { "x-actor-id": "founder-local", "x-actor-kind": "human" },
  });
  const ctxBody = await proxied.json();
  if (!proxied.ok || !Array.isArray(ctxBody.risks) || ctxBody.risks.length < 1 || !Array.isArray(ctxBody.priorities) || ctxBody.priorities.length < 1) {
    throw new Error(`production context proxy is not substantially filled: status=${proxied.status}`);
  }
  const attentionHeaders = { "x-actor-id": "founder-local", "x-actor-kind": "human" };
  const attention = await fetch(`${webBase}/v1/attention?scope=company&horizon=now`, {
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
  const probe = await tryPlaywright(`${webBase}/`, screenshot);
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
