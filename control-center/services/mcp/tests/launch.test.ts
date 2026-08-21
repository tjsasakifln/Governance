import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { MARKERS } from "../src/fixtures.js";
import { PROMPT_NAMES, RESOURCE_URIS } from "../src/types.js";
import { PROTOCOL_VERSION, TEST_TOKEN, errorData, isRecord, toolPayload } from "./helpers.js";

const root = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const require = createRequire(import.meta.url);
const tsxRoot = path.dirname(require.resolve("tsx/package.json"));
const tsxCli = path.join(tsxRoot, "dist/cli.mjs");
const entry = path.join(root, "src/index.ts");

describe("real entry point against fixtures", () => {
  it("completes preflight → get_context → report_session_result over stdio twice", async () => {
    const first = await runLaunchFlow("launch-1");
    const second = await runLaunchFlow("launch-2");
    assert.equal(first.contextMarker, MARKERS.commercial);
    assert.equal(second.contextMarker, MARKERS.commercial);
    assert.equal(first.reportAccepted, true);
    assert.equal(second.reportAccepted, true);
    assert.equal(first.protocolVersion, second.protocolVersion);
    assert.deepEqual(first.capabilities, second.capabilities);
    assert.equal(first.scope, second.scope);
    process.stdout.write(`${JSON.stringify({ event: "launch-flow-consistent", first, second })}\n`);
  });
});

interface LaunchSummary {
  protocolVersion: string;
  capabilities: string[];
  scope: string;
  contextMarker: string;
  reportAccepted: boolean;
  reportId: string;
}

async function runLaunchFlow(label: string): Promise<LaunchSummary> {
  const child = spawn(process.execPath, [tsxCli, entry], {
    cwd: root,
    env: {
      ...process.env,
      CONFENGE_MCP_AUTH_TOKEN: TEST_TOKEN,
      CONFENGE_MCP_RATE_LIMIT_MAX: "30",
      CONFENGE_MCP_HTTP_PORT: "",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const stderrChunks: string[] = [];
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderrChunks.push(chunk);
  });

  const client = new StdioClient(child);
  try {
    const init = await client.request({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "confenge-mcp-launch", version: "0.0.0" },
        _meta: { authorization: `Bearer ${TEST_TOKEN}` },
      },
    });
    const initResult = init["result"];
    assert.ok(isRecord(initResult), `${label} initialize result`);
    assert.equal(typeof initResult["protocolVersion"], "string");
    const capabilities = initResult["capabilities"];
    assert.ok(isRecord(capabilities));
    assert.ok(isRecord(capabilities["tools"]));
    assert.ok(isRecord(capabilities["resources"]));
    assert.ok(isRecord(capabilities["prompts"]));

    client.notify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: { _meta: { authorization: `Bearer ${TEST_TOKEN}` } },
    });

    const prompt = await client.request({
      jsonrpc: "2.0",
      id: 2,
      method: "prompts/get",
      params: {
        name: PROMPT_NAMES.preflight,
        arguments: { scope: "ops.commercial" },
        _meta: { authorization: `Bearer ${TEST_TOKEN}` },
      },
    });
    const promptResult = prompt["result"];
    assert.ok(isRecord(promptResult));
    assert.match(JSON.stringify(promptResult), /confenge\.get_context/);

    const resource = await client.request({
      jsonrpc: "2.0",
      id: 3,
      method: "resources/read",
      params: {
        uri: RESOURCE_URIS.checklist,
        _meta: { authorization: `Bearer ${TEST_TOKEN}` },
      },
    });
    const resourceResult = resource["result"];
    assert.ok(isRecord(resourceResult));
    assert.match(JSON.stringify(resourceResult), /preflight/i);

    const contextReply = await client.request({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "confenge.get_context",
        arguments: { scope: "ops.commercial" },
        _meta: { authorization: `Bearer ${TEST_TOKEN}` },
      },
    });
    const contextPayload = toolPayload(contextReply);
    assert.equal(contextPayload.isError, false);
    assert.ok(isRecord(contextPayload.data));
    assert.equal(contextPayload.data["scope"], "ops.commercial");
    assert.equal(typeof contextPayload.data["source"], "string");
    assert.equal(typeof contextPayload.data["observed_at"], "string");
    assert.equal(typeof contextPayload.data["freshness_status"], "string");
    const encoded = JSON.stringify(contextPayload.data);
    assert.match(encoded, new RegExp(MARKERS.commercial));
    assert.doesNotMatch(encoded, new RegExp(MARKERS.companyDump));

    const reportReply = await client.request({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "confenge.report_session_result",
        arguments: {
          session_id: `launch-${label}`,
          scope: "ops.commercial",
          summary: "Preflight and scoped context loaded; no provider mutation.",
          outcome: "completed",
        },
        _meta: { authorization: `Bearer ${TEST_TOKEN}` },
      },
    });
    const reportPayload = toolPayload(reportReply);
    assert.equal(reportPayload.isError, false);
    assert.ok(isRecord(reportPayload.data));
    assert.equal(reportPayload.data["accepted"], true);

    const stderr = stderrChunks.join("");
    assert.doesNotMatch(stderr, new RegExp(TEST_TOKEN));
    assert.match(stderr, /"msg":"mcp.listen"/);

    return {
      protocolVersion: String(initResult["protocolVersion"]),
      capabilities: Object.keys(capabilities).sort(),
      scope: String(contextPayload.data["scope"]),
      contextMarker: MARKERS.commercial,
      reportAccepted: reportPayload.data["accepted"] === true,
      reportId: String(reportPayload.data["id"]),
    };
  } catch (err) {
    const extra = stderrChunks.join("");
    throw new Error(`${label} failed: ${err instanceof Error ? err.message : String(err)}\nstderr=${extra}`);
  } finally {
    await client.close();
  }
}

class StdioClient {
  private buffer = "";
  private readonly pending = new Map<
    string | number,
    { resolve: (value: Record<string, unknown>) => void; reject: (err: Error) => void }
  >();

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.onData(chunk));
    child.on("error", (err) => {
      for (const wait of this.pending.values()) {
        wait.reject(err);
      }
      this.pending.clear();
    });
  }

  notify(message: Record<string, unknown>): void {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(message: Record<string, unknown>): Promise<Record<string, unknown>> {
    const id = message["id"];
    if (typeof id !== "string" && typeof id !== "number") {
      return Promise.reject(new Error("request id required"));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout waiting for id=${id}`));
      }, 10_000);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      this.child.stdin.write(`${JSON.stringify(message)}\n`);
    });
  }

  async close(): Promise<void> {
    if (!this.child.killed) {
      this.child.kill("SIGTERM");
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.child.kill("SIGKILL");
        resolve();
      }, 2000);
      this.child.on("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let idx = this.buffer.indexOf("\n");
    while (idx >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (line.length > 0) {
        this.onLine(line);
      }
      idx = this.buffer.indexOf("\n");
    }
  }

  private onLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    if (!isRecord(parsed)) {
      return;
    }
    const id = parsed["id"];
    if (typeof id !== "string" && typeof id !== "number") {
      return;
    }
    const wait = this.pending.get(id);
    if (!wait) {
      return;
    }
    this.pending.delete(id);
    if (parsed["error"]) {
      try {
        errorData(parsed);
      } catch {
        wait.reject(new Error(line));
        return;
      }
    }
    wait.resolve(parsed);
  }
}
