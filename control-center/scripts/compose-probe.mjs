#!/usr/bin/env node
/**
 * Local/CI compose probe: boot real images (postgres + context + mcp), hit a
 * context body that carries provenance + freshness, then POST MCP get_context.
 * Uses `node` fetch inside the container — runtimes no longer ship wget.
 * Does not bind host :80/:443.
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const deploy = resolve(dirname(fileURLToPath(import.meta.url)), "../deploy");
const password = "compose-probe-not-production";
const mcpToken = "compose-probe-mcp-not-production";
const release = spawnSync("git", ["rev-parse", "HEAD"], {
  cwd: deploy,
  encoding: "utf8",
});
const releaseSha = (release.stdout ?? "").trim();
if (release.status !== 0 || !/^[0-9a-f]{40}$/.test(releaseSha)) {
  process.stderr.write(`compose probe could not resolve an immutable release SHA: ${release.stderr ?? ""}\n`);
  process.exit(1);
}
const env = {
  ...process.env,
  POSTGRES_PASSWORD: password,
  POSTGRES_USER: "control_center",
  POSTGRES_DB: "control_center",
  CONTROL_CENTER_FOUNDER_ACTOR_ID: "founder-local",
  CONFENGE_MCP_AUTH_TOKEN: mcpToken,
  CC_RELEASE_SHA: releaseSha,
  CONTROL_CENTER_BACKUP_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  CONTROL_CENTER_DATABASE_URL: `postgres://control_center:${password}@postgres:5432/control_center`,
};

function run(args, extra = {}) {
  return spawnSync("docker", ["compose", ...args], {
    cwd: deploy,
    env,
    encoding: "utf8",
    ...extra,
  });
}

function dumpLogs() {
  const logs = run(["logs", "--no-color", "--tail", "80", "postgres", "context", "mcp"]);
  process.stderr.write(logs.stdout || "");
  process.stderr.write(logs.stderr || "");
}

function fail(message, result) {
  process.stderr.write(message);
  process.stderr.write("\n");
  if (result?.stdout) process.stderr.write(result.stdout);
  if (result?.stderr) process.stderr.write(result.stderr);
  dumpLogs();
  run(["down", "-v"], { stdio: "ignore" });
  process.exit(1);
}

function nodeFetchScript(spec) {
  return `
    const spec = ${JSON.stringify(spec)};
    const res = await fetch(spec.url, {
      method: spec.method ?? "GET",
      headers: spec.headers ?? {},
      body: spec.body,
    });
    const text = await res.text();
    process.stdout.write(text);
    if (!res.ok && res.status !== 204) process.exit(1);
  `;
}

function execNodeFetch(service, spec) {
  return run(["exec", "-T", service, "node", "--input-type=module", "-e", nodeFetchScript(spec)]);
}

function waitFetch(service, spec) {
  const deadline = Date.now() + 120000;
  let last = "";
  while (Date.now() < deadline) {
    const probe = execNodeFetch(service, spec);
    last = `status=${probe.status}\n${probe.stdout || ""}\n${probe.stderr || ""}`;
    if (probe.status === 0 && (probe.stdout || "").trim().length > 0) {
      return (probe.stdout || "").trim();
    }
    spawnSync("sleep", ["2"]);
  }
  fail(`${service} ${spec.url} not retrieved: ${last}`, null);
}

const up = run(["up", "-d", "--build", "postgres", "context", "mcp"], {
  timeout: 180000,
});
process.stdout.write(up.stdout || "");
process.stderr.write(up.stderr || "");
if (up.status !== 0) {
  fail("docker compose up failed", up);
}

const body = waitFetch("context", {
  url: "http://127.0.0.1:8080/v1/context?scope=company",
  headers: { "x-actor-id": "founder-local", "x-actor-kind": "human" },
});
const runtimeIdentityBody = waitFetch("context", {
  url: "http://127.0.0.1:8080/v1/runtime-identity",
});
const mcpHealthBody = waitFetch("mcp", { url: "http://127.0.0.1:8080/healthz" });

const initPayload = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "compose-probe", version: "0.0.0" },
  },
});
const init = execNodeFetch("mcp", {
  url: "http://127.0.0.1:8080/mcp",
  method: "POST",
  headers: {
    Authorization: `Bearer ${mcpToken}`,
    "Content-Type": "application/json",
  },
  body: initPayload,
});
const initBody = (init.stdout || "").trim();

execNodeFetch("mcp", {
  url: "http://127.0.0.1:8080/mcp",
  method: "POST",
  headers: {
    Authorization: `Bearer ${mcpToken}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
});

const callPayload = JSON.stringify({
  jsonrpc: "2.0",
  id: 2,
  method: "tools/call",
  params: {
    name: "confenge.get_context",
    arguments: { scope: "company" },
  },
});
const mcpCall = execNodeFetch("mcp", {
  url: "http://127.0.0.1:8080/mcp",
  method: "POST",
  headers: {
    Authorization: `Bearer ${mcpToken}`,
    "Content-Type": "application/json",
  },
  body: callPayload,
});
const mcpCallBody = (mcpCall.stdout || "").trim();

run(["down", "-v"], { stdio: "ignore" });

let parsed;
try {
  parsed = JSON.parse(body);
} catch {
  fail(`context body is not JSON: ${body.slice(0, 400)}`, null);
}

let runtimeIdentity;
try {
  runtimeIdentity = JSON.parse(runtimeIdentityBody);
} catch {
  fail(`context runtime identity is not JSON: ${runtimeIdentityBody.slice(0, 400)}`, null);
}
if (runtimeIdentity.release_status !== "PINNED" || runtimeIdentity.release_sha !== releaseSha) {
  fail(`context runtime identity diverged from checkout ${releaseSha}: ${runtimeIdentityBody.slice(0, 400)}`, null);
}

const freshness = parsed.freshness_status;
const observed = parsed.observed_at;
const source = parsed.source;
const okFreshness =
  freshness === "FRESH" ||
  freshness === "STALE" ||
  freshness === "UNKNOWN" ||
  freshness === "ERROR";
if (!okFreshness || typeof observed !== "string" || !String(observed).endsWith("Z") || !source) {
  fail(
    `context body missing provenance/freshness: freshness=${freshness} observed_at=${observed} source=${JSON.stringify(source)}`,
    null,
  );
}

if (!mcpHealthBody.includes("confenge-control-center-mcp") && !mcpHealthBody.includes('"ok"')) {
  fail(`mcp healthz missing: ${mcpHealthBody.slice(0, 400)}`, null);
}

let mcpInit;
try {
  mcpInit = JSON.parse(initBody);
} catch {
  fail(`mcp initialize is not JSON: ${initBody.slice(0, 400)}`, null);
}
const initResult = mcpInit && typeof mcpInit === "object" ? mcpInit.result : undefined;
if (!initResult || initResult.serverInfo?.name !== "confenge-control-center") {
  fail(`mcp initialize missing serverInfo: ${initBody.slice(0, 400)}`, null);
}

let mcpRpc;
try {
  mcpRpc = JSON.parse(mcpCallBody);
} catch {
  fail(`mcp get_context is not JSON: ${mcpCallBody.slice(0, 400)}`, null);
}

const structured = mcpRpc?.result?.structuredContent?.data;
const textBlob = mcpRpc?.result?.content?.[0]?.text;
let mcpData = structured && typeof structured === "object" ? structured : null;
if (!mcpData && typeof textBlob === "string") {
  try {
    const inner = JSON.parse(textBlob);
    mcpData = inner && typeof inner === "object" ? (inner.data ?? inner) : null;
  } catch {
    mcpData = null;
  }
}
const mcpFreshness = mcpData?.freshness_status;
const mcpObserved = mcpData?.observed_at;
const mcpSource = mcpData?.source;
const mcpFreshOk =
  mcpFreshness === "FRESH" ||
  mcpFreshness === "STALE" ||
  mcpFreshness === "UNKNOWN" ||
  mcpFreshness === "ERROR";
if (!mcpFreshOk || typeof mcpObserved !== "string" || !String(mcpObserved).endsWith("Z") || !mcpSource) {
  fail(
    `mcp get_context missing provenance/freshness: ${mcpCallBody.slice(0, 600)}`,
    null,
  );
}

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      freshness_status: freshness,
      observed_at: observed,
      source,
      confidence: parsed.confidence,
      release_sha: runtimeIdentity.release_sha,
      mcp_health: mcpHealthBody,
      mcp_server: initResult.serverInfo,
      mcp_freshness_status: mcpFreshness,
      mcp_observed_at: mcpObserved,
      mcp_source: mcpSource,
    },
    null,
    2,
  )}\n`,
);
process.stdout.write("compose-probe ok\n");
