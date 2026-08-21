import assert from "node:assert/strict";
import { test } from "node:test";
import { runCli } from "../src/cli.ts";
import { runCollectors } from "../src/run.ts";

test("missing credentials emit ERROR or UNKNOWN, never FRESH", async () => {
  const result = await runCollectors({
    names: ["github", "warmbly", "asaas", "pncp", "infra"],
    env: {},
    now: new Date("2026-08-20T12:00:00.000Z"),
    log: () => undefined,
  });
  assert.equal(result.collectors.length, 5);
  for (const row of result.collectors) {
    assert.ok(["FRESH", "STALE", "UNKNOWN", "ERROR"].includes(row.freshness_status));
    assert.notEqual(row.freshness_status, "FRESH");
    assert.ok(row.freshness_status === "ERROR" || row.freshness_status === "UNKNOWN");
    assert.equal(typeof row.observed_at, "string");
    assert.equal(typeof row.source.system, "string");
  }
});

test("github with credentials uses liveTransport against api.github.com", async () => {
  const urls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response("{}", { status: 401, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const result = await runCollectors({
      names: ["github"],
      env: {
        GITHUB_REPOS: "tjsasakifln/Governance",
        GITHUB_TOKEN: "cc-test-github-token",
      },
      now: new Date("2026-08-20T12:00:00.000Z"),
      log: () => undefined,
    });
    assert.equal(result.collectors.length, 1);
    assert.ok(urls.some((url) => url.includes("api.github.com")), `live github urls: ${urls.join(",")}`);
    assert.notEqual(result.collectors[0]?.freshness_status, "FRESH");
  } finally {
    globalThis.fetch = original;
  }
});

test("asaas with credentials uses DefaultFetchTransport against sandbox host", async () => {
  const urls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response("{}", { status: 401, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const result = await runCollectors({
      names: ["asaas"],
      env: {
        ASAAS_ENVIRONMENT: "sandbox",
        ASAAS_API_KEY: "cc-test-asaas-key",
      },
      now: new Date("2026-08-20T12:00:00.000Z"),
      log: () => undefined,
    });
    assert.equal(result.collectors.length, 1);
    assert.ok(
      urls.some((url) => url.includes("api-sandbox.asaas.com")),
      `live asaas urls: ${urls.join(",")}`,
    );
    assert.notEqual(result.collectors[0]?.freshness_status, "FRESH");
  } finally {
    globalThis.fetch = original;
  }
});

test("infra with allowlist uses createLivePorts and probes a live HTTP target", async () => {
  const { createServer } = await import("node:http");
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
  });
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.once("error", reject);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    const result = await runCollectors({
      names: ["infra"],
      env: {
        CC_INFRA_ALLOWLIST: JSON.stringify({
          version: 1,
          collector_id: "infrastructure.local",
          source: "infrastructure",
          default_timeout_ms: 500,
          targets: [
            {
              id: "svc-up",
              display_name: "svc-up",
              url: `http://127.0.0.1:${port}/health`,
              expect_status: 200,
              checks: ["http"],
            },
          ],
        }),
      },
      now: new Date("2026-08-20T12:00:00.000Z"),
      log: () => undefined,
    });
    assert.equal(result.collectors.length, 1);
    const row = result.collectors[0];
    assert.notEqual(row?.error?.message, "not probed");
    const payload = row?.payload as { service_health?: Array<{ status: string; freshness_status: string }> };
    const health = payload.service_health?.[0];
    assert.equal(health?.status, "healthy");
    assert.equal(health?.freshness_status, "FRESH");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("shipped CLI without credentials prints ERROR not FRESH", async () => {
  let stdout = "";
  const outcome = await runCli(["--only=github"], {}, {
    stdout: (line) => {
      stdout += line;
    },
    stderr: () => undefined,
  });
  assert.equal(outcome.code, 0);
  assert.match(stdout, /ERROR/);
  assert.doesNotMatch(stdout, /"freshness_status": "FRESH"/);
});
