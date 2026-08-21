import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  authMeta,
  boot,
  callTool,
  errorData,
  handshake,
  rpc,
  TEST_TOKEN,
} from "./helpers.js";

describe("MCP abuse and protocol failures", () => {
  it("rejects missing auth token with a correlation id and does not leak the token", async () => {
    const { runtime, logs } = boot();
    await handshake(runtime);
    const reply = await callTool(runtime, "confenge.get_context", { scope: "ops.commercial" }, { token: undefined });
    const err = errorData(reply);
    assert.equal(err.code, "UNAUTHENTICATED");
    assert.ok(err.correlation_id.length > 0);
    const blob = `${JSON.stringify(reply)}\n${logs.join("\n")}`;
    assert.doesNotMatch(blob, new RegExp(TEST_TOKEN));
  });

  it("rejects a wrong token with a correlation id and does not leak either token", async () => {
    const { runtime, logs } = boot();
    await handshake(runtime);
    const wrong = "definitely-not-the-configured-token";
    const reply = await callTool(runtime, "confenge.get_priorities", {}, { token: wrong });
    const err = errorData(reply);
    assert.equal(err.code, "INVALID_TOKEN");
    assert.ok(err.correlation_id.length > 0);
    const blob = `${JSON.stringify(reply)}\n${logs.join("\n")}`;
    assert.doesNotMatch(blob, new RegExp(TEST_TOKEN));
    assert.doesNotMatch(blob, new RegExp(wrong));
  });

  it("fail-closes when the server has no configured auth token", async () => {
    const { runtime } = boot({ authToken: undefined, secretsToRedact: [] });
    await handshake(runtime, undefined);
    const reply = await callTool(runtime, "confenge.get_company_state", {}, { token: TEST_TOKEN });
    const err = errorData(reply);
    assert.equal(err.code, "UNAUTHENTICATED");
    assert.match(err.message, /not configured|missing/i);
  });

  it("returns a structured parse error for malformed JSON-RPC", async () => {
    const { runtime } = boot();
    const raw = await runtime.handleRaw("{not-json");
    assert.ok(raw);
    const reply = JSON.parse(raw) as Record<string, unknown>;
    const err = errorData(reply);
    assert.equal(err.code, "PARSE_ERROR");
    assert.equal(err.jsonRpcCode, -32700);
    assert.ok(err.correlation_id.length > 0);
  });

  it("returns a structured error for an unknown tool", async () => {
    const { runtime } = boot();
    await handshake(runtime);
    const reply = await callTool(runtime, "confenge.not_a_real_tool", { scope: "ops.commercial" });
    const err = errorData(reply);
    assert.equal(err.code, "UNKNOWN_TOOL");
    assert.ok(err.correlation_id.length > 0);
  });

  it("requires scope and client on scoped tools", async () => {
    const { runtime } = boot();
    await handshake(runtime);

    const missingScope = await callTool(runtime, "confenge.get_context", {});
    const scopeErr = errorData(missingScope);
    assert.equal(scopeErr.code, "MISSING_SCOPE");
    assert.ok(scopeErr.correlation_id.length > 0);

    const missingDirectiveScope = await callTool(runtime, "confenge.get_active_directives", {});
    assert.equal(errorData(missingDirectiveScope).code, "MISSING_SCOPE");

    const missingClient = await callTool(runtime, "confenge.get_client_context", {});
    const clientErr = errorData(missingClient);
    assert.equal(clientErr.code, "MISSING_CLIENT");
    assert.ok(clientErr.correlation_id.length > 0);
  });

  it("rate-limits rapid tools/call traffic with a correlation id", async () => {
    const { runtime } = boot({ rateLimit: { max: 3, windowMs: 60_000 } });
    await handshake(runtime);
    for (let i = 0; i < 3; i += 1) {
      const reply = await callTool(runtime, "confenge.get_priorities", {}, { id: 20 + i });
      assert.equal(reply["error"], undefined);
    }
    const limited = await callTool(runtime, "confenge.get_priorities", {}, { id: 99 });
    const err = errorData(limited);
    assert.equal(err.code, "RATE_LIMITED");
    assert.ok(err.correlation_id.length > 0);
  });

  it("propagates a client correlation id on failures", async () => {
    const { runtime } = boot();
    await handshake(runtime);
    const reply = await rpc(runtime, {
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: {
        name: "confenge.get_context",
        arguments: {},
        _meta: { ...authMeta(TEST_TOKEN), correlation_id: "cc-mcp-fixed-test-id" },
      },
    });
    assert.ok(reply);
    const err = errorData(reply);
    assert.equal(err.correlation_id, "cc-mcp-fixed-test-id");
    assert.equal(err.code, "MISSING_SCOPE");
  });
});
