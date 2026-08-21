import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCanaryArgs, runCli, runWarmblyCanary } from "../src/canary.ts";
import { collect } from "../src/collect.ts";
import { CAPABILITIES, CANARY_COLLECTORS } from "../src/envelope.ts";
import { classifyRequest } from "../src/http/allowlist.ts";
import {
  MethodNotAllowedError,
  TimeoutError,
  WarmblyClient,
} from "../src/http/client.ts";
import { serializeLog } from "../src/http/redaction.ts";
import {
  REQUIRED_SECRET_NAMES,
  loadWarmblyProductionConfig,
  resolveWarmblySecrets,
} from "../src/production-config.ts";
import { startFixtureStub } from "../src/stub-server.ts";
import { capturingLogger, loadFixture, NOW } from "./helpers.ts";

const TOKEN = "wmbly_canary_secret_token_do_not_log";

function assertEnvelope(report: Awaited<ReturnType<typeof runWarmblyCanary>>): void {
  assert.equal(report.collector, "warmbly");
  assert.ok((CANARY_COLLECTORS as readonly string[]).includes(report.collector));
  assert.ok(["FRESH", "STALE", "UNKNOWN", "ERROR"].includes(report.freshness_status));
  assert.ok(report.observed_at.endsWith("Z"));
  assert.equal(typeof report.source.system, "string");
  assert.equal(typeof report.source.kind, "string");
  assert.equal(typeof report.source.locator, "string");
  assert.equal(typeof report.confidence, "number");
  assert.ok(
    report.error === null ||
      (typeof report.error.code === "string" && typeof report.error.message === "string"),
  );
  assert.equal(typeof report.payload, "object");
  assert.equal(typeof report.idempotency_key, "string");
  assert.ok((CAPABILITIES as readonly string[]).includes(report.capability));
}

describe("warmbly production canary", () => {
  it("missing secrets yield CREDENTIAL_MISSING / BLOCKED_BY_SECRET and never open a socket", async () => {
    let fetches = 0;
    const report = await runWarmblyCanary({
      env: {},
      now: NOW,
      fetchImpl: async () => {
        fetches += 1;
        throw new Error("transport must not run without secrets");
      },
    });
    assertEnvelope(report);
    assert.equal(report.freshness_status, "UNKNOWN");
    assert.equal(report.capability, "BLOCKED_BY_SECRET");
    assert.equal(report.error?.code, "CREDENTIAL_MISSING");
    assert.equal(report.confidence, 0);
    assert.notEqual(report.freshness_status, "FRESH");
    assert.ok(Array.isArray(report.payload.required_secrets));
    assert.ok((report.payload.required_secrets as string[]).includes("WARMBLY_BASE_URL"));
    assert.ok((report.payload.required_secrets as string[]).includes("WARMBLY_API_TOKEN"));
    assert.deepEqual([...REQUIRED_SECRET_NAMES], ["WARMBLY_BASE_URL", "WARMBLY_API_TOKEN"]);
    const secrets = resolveWarmblySecrets({});
    assert.equal(secrets.ok, false);
    assert.equal(fetches, 0);
  });

  it("two pinned-clock blocked runs share idempotency_key", async () => {
    const first = await runWarmblyCanary({ env: {}, now: NOW });
    const second = await runWarmblyCanary({ env: {}, now: NOW });
    assert.equal(first.idempotency_key, second.idempotency_key);
    assert.equal(first.capability, second.capability);
  });

  it("empty 200 commercial payload is not an error, while 401/403/429/5xx stay ERROR", async () => {
    const emptyPayload = {
      health: { status: "ok" },
      pipelines: [],
      deals: [],
      tasks: [],
      contacts: [],
      campaigns: [],
      api_version: "v1",
    };
    const stub = await startFixtureStub({
      payload: emptyPayload,
      token: TOKEN,
    });
    try {
      const fresh = await runWarmblyCanary({
        env: { WARMBLY_BASE_URL: stub.url, WARMBLY_API_TOKEN: TOKEN },
        now: NOW,
      });
      assertEnvelope(fresh);
      assert.notEqual(fresh.capability, "BLOCKED_BY_SECRET");
      assert.notEqual(`${fresh.freshness_status}`, "ERROR");
    } finally {
      await stub.close();
    }

    for (const status of [401, 403, 429, 500, 503]) {
      const failing = await startFixtureStub({
        payload: loadFixture("commercial-runtime.json"),
        token: TOKEN,
        failStatus: status,
      });
      try {
        const report = await runWarmblyCanary({
          env: { WARMBLY_BASE_URL: failing.url, WARMBLY_API_TOKEN: TOKEN },
          now: NOW,
          clientOptions: { maxRetries: 0, timeoutMs: 500, failureThreshold: 99 },
        });
        assertEnvelope(report);
        assert.notEqual(report.freshness_status, "FRESH");
        assert.ok(report.freshness_status === "ERROR" || report.freshness_status === "UNKNOWN");
      } finally {
        await failing.close();
      }
    }
  });

  it("timeout is ERROR/UNKNOWN, not empty FRESH", async () => {
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
      const report = await runWarmblyCanary({
        env: { WARMBLY_BASE_URL: stub.url, WARMBLY_API_TOKEN: TOKEN },
        now: NOW,
        clientOptions: { timeoutMs: 40, maxRetries: 0, logger: () => undefined, failureThreshold: 99 },
      });
      assertEnvelope(report);
      assert.notEqual(report.freshness_status, "FRESH");
    } finally {
      await stub.close();
    }
  });

  it("mutating POST/PATCH/PUT/DELETE never hit the injected transport; POST /search and /summary may", async () => {
    const hits: string[] = [];
    const client = new WarmblyClient({
      baseUrl: "https://warmbly.example.invalid",
      token: TOKEN,
      maxRetries: 0,
      logger: () => undefined,
      fetchImpl: async (input, init) => {
        hits.push(`${init?.method ?? "GET"} ${String(input)}`);
        throw new Error("transport must not run for denied methods");
      },
    });
    for (const req of [
      { method: "POST" as const, path: "/v1/crm/deals" },
      { method: "PATCH" as const, path: "/v1/crm/deals/x" },
      { method: "PUT" as const, path: "/v1/crm/deals/x" },
      { method: "DELETE" as const, path: "/v1/crm/tasks/x" },
    ]) {
      assert.equal(classifyRequest(req.method, req.path).allowed, false);
      await assert.rejects(() => client.request(req), MethodNotAllowedError);
    }
    assert.equal(hits.length, 0);
    assert.equal(classifyRequest("POST", "/v1/contacts/search").allowed, true);
    assert.equal(classifyRequest("POST", "/v1/crm/deals/summary").allowed, true);
  });

  it("canary collect with recording transport never issues mutating methods", async () => {
    const payload = loadFixture("commercial-runtime.json");
    const stub = await startFixtureStub({ payload, token: TOKEN });
    const hits: string[] = [];
    try {
      const snapshot = await collect({
        now: NOW,
        client: new WarmblyClient({
          baseUrl: stub.url,
          token: TOKEN,
          maxRetries: 0,
          logger: () => undefined,
          fetchImpl: async (input, init) => {
            hits.push(`${init?.method ?? "GET"} ${String(input)}`);
            return fetch(input, init);
          },
        }),
      });
      assert.ok(snapshot);
      assert.equal(hits.some((h) => /^(PATCH|PUT|DELETE) /.test(h)), false);
      assert.equal(
        hits.some((h) => h.startsWith("POST ") && !/\/search|\/summary/.test(h)),
        false,
      );
    } finally {
      await stub.close();
    }
  });

  it("redacts secrets from canary JSON and logs", async () => {
    const logger = capturingLogger();
    const report = await runWarmblyCanary({
      env: { WARMBLY_BASE_URL: "https://warmbly.example.invalid", WARMBLY_API_TOKEN: TOKEN },
      now: NOW,
      clientOptions: {
        maxRetries: 0,
        timeoutMs: 20,
        logger: logger.logger,
        fetchImpl: async () => {
          throw new Error(`failed with Bearer ${TOKEN}`);
        },
      },
    });
    const serialized = serializeLog({
      level: "error",
      msg: "canary",
      authorization: `Bearer ${TOKEN}`,
      token: TOKEN,
    });
    const blob = `${JSON.stringify(report)}\n${logger.blob()}\n${serialized}`;
    assert.equal(blob.includes(TOKEN), false);
    assert.equal(/wmbly_canary_secret/.test(blob), false);
  });

  it("CLI entry emits the frozen envelope for missing secrets", async () => {
    const lines: string[] = [];
    const outcome = await runCli(["warmbly", "--now", NOW.toISOString()], {}, {
      stdout: (line) => lines.push(line),
      stderr: () => undefined,
    });
    assert.equal(outcome.code, 0);
    const parsed = JSON.parse(lines.join("\n")) as Awaited<ReturnType<typeof runWarmblyCanary>>;
    assertEnvelope(parsed);
    assert.equal(parsed.capability, "BLOCKED_BY_SECRET");
    assert.equal(parseCanaryArgs(["warmbly"]).collector, "warmbly");
    const cfg = loadWarmblyProductionConfig();
    assert.equal(cfg.collector, "warmbly");
    assert.equal(cfg.mode, "read-only");
  });
});
