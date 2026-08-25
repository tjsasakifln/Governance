import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyRequest } from "../src/http/allowlist.ts";
import {
  CircuitOpenError,
  MethodNotAllowedError,
  TimeoutError,
  WarmblyClient,
} from "../src/http/client.ts";
import { serializeLog } from "../src/http/redaction.ts";
import { startFixtureStub } from "../src/stub-server.ts";
import { capturingLogger, loadFixture } from "./helpers.ts";

const TOKEN = "wmbly_super_secret_test_token_do_not_log";

describe("HTTP allowlist", () => {
  it("allows GET commercial reads and documented search/summary POST", () => {
    assert.equal(classifyRequest("GET", "/health").allowed, true);
    assert.equal(classifyRequest("GET", "/v1/crm/deals?limit=100").allowed, true);
    assert.equal(classifyRequest("GET", "/v1/confenge/first-touch/status").allowed, true);
    assert.equal(classifyRequest("POST", "/v1/contacts/search").allowed, true);
    assert.equal(classifyRequest("POST", "/v1/crm/deals/search").allowed, true);
    assert.equal(classifyRequest("POST", "/v1/crm/deals/summary").allowed, true);
    assert.equal(classifyRequest("POST", "/v1/crm/tasks/search").allowed, true);
    assert.equal(classifyRequest("POST", "/v1/crm/tasks/summary").allowed, true);
  });

  it("denies mutating methods and mutating POST paths", () => {
    assert.equal(classifyRequest("POST", "/v1/crm/deals").allowed, false);
    assert.equal(classifyRequest("POST", "/v1/crm/tasks").allowed, false);
    assert.equal(classifyRequest("POST", "/v1/contacts").allowed, false);
    assert.equal(classifyRequest("POST", "/v1/campaigns/abc/start").allowed, false);
    assert.equal(classifyRequest("POST", "/v1/confenge/import").allowed, false);
    assert.equal(classifyRequest("POST", "/v1/confenge/first-touch/status").allowed, false);
    assert.equal(classifyRequest("POST", "/v1/confenge/crm/bootstrap").allowed, false);
    assert.equal(classifyRequest("POST", "/v1/unibox/reply").allowed, false);
    assert.equal(classifyRequest("PATCH", "/v1/crm/deals/x").allowed, false);
    assert.equal(classifyRequest("PUT", "/v1/crm/deals/x").allowed, false);
    assert.equal(classifyRequest("DELETE", "/v1/crm/tasks/x").allowed, false);
  });
});

describe("WarmblyClient against a local stub", () => {
  it("never issues mutating calls even if a caller asks; stub state is untouched", async () => {
    const stub = await startFixtureStub({ payload: loadFixture("commercial-runtime.json"), token: TOKEN });
    const fetchHits: string[] = [];
    const logger = capturingLogger();
    try {
      const client = new WarmblyClient({
        baseUrl: stub.url,
        token: TOKEN,
        maxRetries: 0,
        logger: logger.logger,
        fetchImpl: async (input, init) => {
          fetchHits.push(`${init?.method ?? "GET"} ${String(input)}`);
          return fetch(input, init);
        },
      });

      await assert.rejects(
        () => client.request({ method: "POST", path: "/v1/crm/deals", body: { name: "nope" } }),
        MethodNotAllowedError,
      );
      await assert.rejects(
        () => client.request({ method: "PATCH", path: "/v1/crm/deals/deal-healthy-1" }),
        MethodNotAllowedError,
      );
      await assert.rejects(
        () => client.request({ method: "DELETE", path: "/v1/crm/tasks/task-overdue-1" }),
        MethodNotAllowedError,
      );
      await assert.rejects(
        () => client.request({ method: "POST", path: "/v1/confenge/import" }),
        MethodNotAllowedError,
      );
      await assert.rejects(
        () => client.request({ method: "POST", path: "/v1/unibox/reply" }),
        MethodNotAllowedError,
      );

      const search = await client.request({ method: "POST", path: "/v1/contacts/search", body: {} });
      assert.equal(search.status, 200);

      assert.equal(fetchHits.some((h) => h.startsWith("PATCH") || h.startsWith("DELETE") || h.startsWith("PUT")), false);
      assert.equal(
        fetchHits.some((h) => h.includes("/v1/crm/deals") && h.startsWith("POST ") && !h.includes("/search") && !h.includes("/summary")),
        false,
      );
      assert.equal(stub.calls.some((c) => c.method === "PATCH" || c.method === "DELETE" || c.method === "PUT"), false);
      assert.equal(
        stub.calls.some((c) => c.method === "POST" && c.path === "/v1/crm/deals"),
        false,
      );
    } finally {
      await stub.close();
    }
  });

  it("fires timeouts", async () => {
    const stub = await startFixtureStub({
      payload: loadFixture("commercial-runtime.json"),
      token: TOKEN,
      delayMs: 250,
    });
    try {
      const client = new WarmblyClient({
        baseUrl: stub.url,
        token: TOKEN,
        timeoutMs: 40,
        maxRetries: 0,
        logger: () => undefined,
      });
      await assert.rejects(() => client.request({ method: "GET", path: "/health" }), TimeoutError);
    } finally {
      await stub.close();
    }
  });

  it("opens the circuit breaker after repeated failures and then fail-closes without hitting the stub", async () => {
    const stub = await startFixtureStub({
      payload: loadFixture("commercial-runtime.json"),
      token: TOKEN,
      failStatus: 500,
    });
    try {
      const client = new WarmblyClient({
        baseUrl: stub.url,
        token: TOKEN,
        timeoutMs: 1_000,
        maxRetries: 0,
        failureThreshold: 2,
        resetMs: 60_000,
        logger: () => undefined,
      });
      await assert.rejects(() => client.request({ method: "GET", path: "/health" }));
      await assert.rejects(() => client.request({ method: "GET", path: "/health" }));
      const hitsAfterFailures = stub.calls.length;
      assert.ok(hitsAfterFailures >= 2);
      await assert.rejects(() => client.request({ method: "GET", path: "/health" }), CircuitOpenError);
      assert.equal(stub.calls.length, hitsAfterFailures);
    } finally {
      await stub.close();
    }
  });

  it("does not leak API keys in structured logs", async () => {
    const stub = await startFixtureStub({ payload: loadFixture("commercial-runtime.json"), token: TOKEN });
    const logger = capturingLogger();
    try {
      const client = new WarmblyClient({
        baseUrl: stub.url,
        token: TOKEN,
        maxRetries: 0,
        logger: logger.logger,
      });
      await client.request({ method: "GET", path: "/health" });
      const serialized = serializeLog({
        level: "info",
        msg: "probe",
        authorization: `Bearer ${TOKEN}`,
        token: TOKEN,
      });
      const blob = `${logger.blob()}\n${serialized}\n${JSON.stringify(client.describeAuthForLogs())}`;
      assert.equal(blob.includes(TOKEN), false);
      assert.equal(blob.includes("wmbly_super_secret"), false);
    } finally {
      await stub.close();
    }
  });
});
