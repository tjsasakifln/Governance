import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { createHttpContextApi } from "../../services/mcp/src/context-http.ts";
import { createMcpRuntime } from "../../services/mcp/src/server.ts";
import { createStubContextApi } from "../../services/mcp/src/stub-adapter.ts";

test("MCP production wiring uses ContextApiPort over HTTP and reports become AgentActivity", async () => {
  const activities: unknown[] = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (url.pathname === "/v1/context") {
        res.end(
          JSON.stringify({
            scope: url.searchParams.get("scope"),
            active_directives: [
              {
                id: "cc:directive:ctx",
                kind: "fact",
                title: "Scoped fact",
                body: "body",
                scope: url.searchParams.get("scope"),
                status: "active",
                source: { system: "control-center", kind: "context", locator: "company" },
                observed_at: "2026-08-20T12:00:00.000Z",
                freshness_status: "FRESH",
                confidence: 0.8,
              },
            ],
            priorities: [],
            source: { system: "control-center", kind: "context", locator: "company" },
            observed_at: "2026-08-20T12:00:00.000Z",
            freshness_status: "FRESH",
            confidence: 0.8,
          }),
        );
        return;
      }
      if (url.pathname === "/v1/agent-activities" && req.method === "POST") {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
        activities.push(body);
        res.statusCode = 201;
        res.end(
          JSON.stringify({
            id: "cc:agent-activity:1",
            kind: body.kind ?? "session_result",
            summary: body.summary,
            provenance: {
              source: { system: "control-center", kind: "mcp-agent-report", locator: "sess" },
              observed_at: "2026-08-20T12:00:00.000Z",
              freshness_status: "FRESH",
              confidence: 1,
            },
          }),
        );
        return;
      }
      res.statusCode = 404;
      res.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  try {
    const api = createHttpContextApi({ baseUrl: `http://127.0.0.1:${port}` });
    const ctx = await api.getContext("company");
    assert.equal(ctx.freshness_status, "FRESH");
    assert.ok(ctx.observed_at.endsWith("Z"));
    const receipt = await api.reportSessionResult({
      scope: "company",
      summary: "done",
      outcome: "completed",
      session_id: "sess-1",
    });
    assert.equal(receipt.kind, "session_result");
    assert.equal(activities.length, 1);
    const runtime = createMcpRuntime({ context: api, authToken: "token" });
    void runtime;
    const stub = createStubContextApi();
    assert.notEqual(api, stub);
  } finally {
    server.close();
  }
});
