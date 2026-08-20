import assert from "node:assert/strict";
import { createLogger } from "../src/logging.js";
import { createMcpRuntime, type McpRuntime, type McpRuntimeOptions } from "../src/server.js";
import { createStubContextApi } from "../src/stub-adapter.js";
import { FRESHNESS_STATUSES } from "../src/types.js";

export const TEST_TOKEN = "cc-test-token-fixture-not-a-secret";
export const PROTOCOL_VERSION = "2025-03-26";

export interface Booted {
  runtime: McpRuntime;
  logs: string[];
}

export function boot(overrides: McpRuntimeOptions = {}): Booted {
  const logs: string[] = [];
  const runtime = createMcpRuntime({
    context: createStubContextApi(),
    authToken: TEST_TOKEN,
    logger: createLogger({ write: (line) => logs.push(line) }),
    rateLimit: { max: 30, windowMs: 60_000 },
    secretsToRedact: [TEST_TOKEN],
    ...overrides,
  });
  return { runtime, logs };
}

export async function rpc(
  runtime: McpRuntime,
  message: Record<string, unknown>,
  extras?: { authorization?: string },
): Promise<Record<string, unknown> | null> {
  const raw = await runtime.handleRaw(JSON.stringify(message), extras);
  if (raw === null) {
    return null;
  }
  const parsed: unknown = JSON.parse(raw);
  assert.ok(parsed !== null && typeof parsed === "object");
  return parsed as Record<string, unknown>;
}

export function authMeta(token: string | undefined, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const meta: Record<string, unknown> = { ...extra };
  if (token !== undefined) {
    meta["authorization"] = `Bearer ${token}`;
  }
  return meta;
}

export async function handshake(
  runtime: McpRuntime,
  token: string | undefined = TEST_TOKEN,
): Promise<Record<string, unknown>> {
  const init = await rpc(runtime, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "confenge-mcp-tests", version: "0.0.0" },
      _meta: authMeta(token),
    },
  });
  assert.ok(init);
  await rpc(runtime, {
    jsonrpc: "2.0",
    method: "notifications/initialized",
    params: { _meta: authMeta(token) },
  });
  return init;
}

export async function callTool(
  runtime: McpRuntime,
  name: string,
  args: Record<string, unknown> | undefined,
  options: { token?: string | undefined; id?: number; extras?: { authorization?: string } } = {},
): Promise<Record<string, unknown>> {
  const token = Object.prototype.hasOwnProperty.call(options, "token") ? options.token : TEST_TOKEN;
  const reply = await rpc(
    runtime,
    {
      jsonrpc: "2.0",
      id: options.id ?? 2,
      method: "tools/call",
      params: {
        name,
        arguments: args ?? {},
        _meta: authMeta(token),
      },
    },
    options.extras,
  );
  assert.ok(reply);
  return reply;
}

export function toolPayload(reply: Record<string, unknown>): {
  correlation_id: string;
  data: unknown;
  isError: boolean;
} {
  if (reply["error"]) {
    throw new Error(`expected tool result, got error: ${JSON.stringify(reply["error"])}`);
  }
  const result = reply["result"];
  assert.ok(isRecord(result), "missing result");
  const isError = result["isError"] === true;
  const content = result["content"];
  assert.ok(Array.isArray(content) && content.length > 0, "missing content");
  const first = content[0];
  assert.ok(isRecord(first) && first["type"] === "text" && typeof first["text"] === "string");
  const parsed: unknown = JSON.parse(first["text"]);
  assert.ok(isRecord(parsed));
  assert.equal(typeof parsed["correlation_id"], "string");
  return {
    correlation_id: parsed["correlation_id"] as string,
    data: parsed["data"],
    isError,
  };
}

export function errorData(reply: Record<string, unknown>): {
  jsonRpcCode: number;
  code: string;
  message: string;
  correlation_id: string;
} {
  const error = reply["error"];
  assert.ok(isRecord(error), "expected JSON-RPC error");
  assert.equal(typeof error["code"], "number");
  assert.equal(typeof error["message"], "string");
  const data = error["data"];
  assert.ok(isRecord(data), "expected structured error data");
  const correlationId =
    typeof data["correlation_id"] === "string"
      ? data["correlation_id"]
      : isRecord(data["error"]) && typeof data["error"]["correlation_id"] === "string"
        ? data["error"]["correlation_id"]
        : undefined;
  assert.ok(correlationId, "structured error must include correlation_id");
  const nested = isRecord(data["error"]) ? data["error"] : data;
  const code = typeof nested["code"] === "string" ? nested["code"] : "UNKNOWN";
  return {
    jsonRpcCode: error["code"] as number,
    code,
    message: error["message"] as string,
    correlation_id: correlationId,
  };
}

export function assertProvenance(value: unknown, label: string): void {
  assert.ok(isRecord(value), `${label} must be an object`);
  assert.equal(typeof value["source"], "string", `${label}.source`);
  assert.ok((value["source"] as string).length > 0, `${label}.source non-empty`);
  assert.equal(typeof value["observed_at"], "string", `${label}.observed_at`);
  assert.ok(!Number.isNaN(Date.parse(value["observed_at"] as string)), `${label}.observed_at ISO`);
  assert.ok(
    (FRESHNESS_STATUSES as readonly string[]).includes(value["freshness_status"] as string),
    `${label}.freshness_status`,
  );
  if (value["confidence"] !== undefined) {
    assert.equal(typeof value["confidence"], "number", `${label}.confidence`);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function encode(value: unknown): string {
  return JSON.stringify(value);
}
