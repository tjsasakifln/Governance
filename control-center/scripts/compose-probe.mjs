#!/usr/bin/env node
/**
 * Local/CI compose probe: boot real images (postgres + context + mcp), hit a
 * context body that carries provenance + freshness, then POST MCP get_context.
 * Does not bind host :80/:443.
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const deploy = resolve(dirname(fileURLToPath(import.meta.url)), "../deploy");
const password = "compose-probe-not-production";
const mcpToken = "compose-probe-mcp-not-production";
const env = {
  ...process.env,
  POSTGRES_PASSWORD: password,
  POSTGRES_USER: "control_center",
  POSTGRES_DB: "control_center",
  CONTROL_CENTER_FOUNDER_ACTOR_ID: "founder-local",
  CONFENGE_MCP_AUTH_TOKEN: mcpToken,
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

function waitWget(service, url, extraArgs = []) {
  const deadline = Date.now() + 120000;
  let last = "";
  while (Date.now() < deadline) {
    const probe = run([
      "exec",
      "-T",
      service,
      "wget",
      "-qO-",
      "--timeout=3",
      "--tries=1",
      ...extraArgs,
      url,
    ]);
    last = `status=${probe.status}\n${probe.stdout || ""}\n${probe.stderr || ""}`;
    if (probe.status === 0 && (probe.stdout || "").trim().length > 0) {
      return (probe.stdout || "").trim();
    }
    spawnSync("sleep", ["2"]);
  }
  fail(`${service} ${url} not retrieved: ${last}`, null);
}

function wgetOnce(service, url, extraArgs = []) {
  return run(["exec", "-T", service, "wget", "-qO-", "--timeout=5", "--tries=1", ...extraArgs, url]);
}

const up = run(["up", "-d", "--build", "postgres", "context", "mcp"], {
  timeout: 180000,
});
process.stdout.write(up.stdout || "");
process.stderr.write(up.stderr || "");
if (up.status !== 0) {
  fail("docker compose up failed", up);
}

const body = waitWget("context", "http://127.0.0.1:8080/v1/context?scope=company", [
  "--header=x-actor-id: founder-local",
  "--header=x-actor-kind: human",
]);
const mcpHealthBody = waitWget("mcp", "http://127.0.0.1:8080/healthz");

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
const init = wgetOnce("mcp", "http://127.0.0.1:8080/mcp", [
  `--header=Authorization: Bearer ${mcpToken}`,
  "--header=Content-Type: application/json",
  `--post-data=${initPayload}`,
]);
const initBody = (init.stdout || "").trim();

wgetOnce("mcp", "http://127.0.0.1:8080/mcp", [
  `--header=Authorization: Bearer ${mcpToken}`,
  "--header=Content-Type: application/json",
  `--post-data=${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}`,
]);

const callPayload = JSON.stringify({
  jsonrpc: "2.0",
  id: 2,
  method: "tools/call",
  params: {
    name: "confenge.get_context",
    arguments: { scope: "company" },
  },
});
const mcpCall = wgetOnce("mcp", "http://127.0.0.1:8080/mcp", [
  `--header=Authorization: Bearer ${mcpToken}`,
  "--header=Content-Type: application/json",
  `--post-data=${callPayload}`,
]);
const mcpCallBody = (mcpCall.stdout || "").trim();

run(["down", "-v"], { stdio: "ignore" });

let parsed;
try {
  parsed = JSON.parse(body);
} catch {
  fail(`context body is not JSON: ${body.slice(0, 400)}`, null);
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
