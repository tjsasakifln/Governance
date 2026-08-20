import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { collect } from "../src/collect.js";
import { GithubReadClient } from "../src/client.js";
import { MemoryEtagStore } from "../src/etag-store.js";
import { parseCollectConfig } from "../src/config.js";
import { createScriptedTransport } from "../src/fixture-transport.js";
import { fixtureDir, FIXED_NOW, loadConfig, observationIds, TEST_TOKEN } from "./helpers.js";
import type { HttpResponse } from "../src/types.js";

describe("HTTP policy", () => {
  it("issues only GET, skips repos outside the allowlist, and never hits api.github.com live", async () => {
    const { config, transport } = loadConfig("populated", {
      repos: ["tjsasakifln/Governance", "tjsasakifln/web-cfg"],
    });
    await collect(config);
    assert.ok(transport.requests.length > 0);
    for (const req of transport.requests) {
      assert.equal(req.method, "GET");
      const url = new URL(req.url);
      assert.equal(url.hostname, "api.github.com");
      assert.equal(url.pathname.includes("secret-repo"), false);
      assert.match(url.pathname, /^\/repos\/tjsasakifln\/(Governance|web-cfg)(\/|$)/);
    }

    const client = new GithubReadClient({
      apiBase: "https://api.github.com",
      token: TEST_TOKEN,
      transport: createScriptedTransport(() => {
        throw new Error("should not request non-allowlisted repo");
      }),
      etagStore: new MemoryEtagStore(),
      logger: () => {},
      now: () => FIXED_NOW,
      allowlist: ["tjsasakifln/Governance"],
    });
    await assert.rejects(
      () => client.get("/repos/tjsasakifln/secret-repo"),
      /non-allowlisted/,
    );
  });

  it("sends If-None-Match and reuses the prior body on 304", async () => {
    const repoBody = readFileSync(fixtureDir("populated/repo-governance.json"), "utf8");
    let calls = 0;
    const transport = createScriptedTransport((req) => {
      calls += 1;
      const ifNoneMatch = headerOf(req.headers, "if-none-match");
      if (calls === 1) {
        assert.equal(ifNoneMatch, undefined);
        return jsonResponse(200, repoBody, { etag: "W/\"repo-gov-1\"", "x-ratelimit-remaining": "50" });
      }
      assert.equal(ifNoneMatch, "W/\"repo-gov-1\"");
      return {
        status: 304,
        headers: { etag: "W/\"repo-gov-1\"", "x-ratelimit-remaining": "49" },
        body: "",
      };
    });
    const store = new MemoryEtagStore();
    const client = new GithubReadClient({
      apiBase: "https://api.github.com",
      token: TEST_TOKEN,
      transport,
      etagStore: store,
      logger: () => {},
      now: () => FIXED_NOW,
      allowlist: ["tjsasakifln/Governance"],
    });
    const first = await client.get("/repos/tjsasakifln/Governance");
    const second = await client.get("/repos/tjsasakifln/Governance");
    assert.equal(first.kind, "ok");
    assert.equal(second.kind, "ok");
    if (first.kind === "ok" && second.kind === "ok") {
      assert.equal(first.freshness_status, "fresh");
      assert.equal(second.freshness_status, "not_modified");
      assert.deepEqual(second.data, first.data);
      assert.equal(Array.isArray(second.data), false);
    }
    assert.equal(calls, 2);
  });

  it("stops further requests when remaining is 0", async () => {
    const repoBody = readFileSync(fixtureDir("populated/repo-governance.json"), "utf8");
    const transport = createScriptedTransport((req) => {
      if (new URL(req.url).pathname === "/repos/tjsasakifln/Governance") {
        return jsonResponse(200, repoBody, { etag: "W/\"x\"", "x-ratelimit-remaining": "0" });
      }
      throw new Error(`unexpected extra request ${req.method} ${req.url}`);
    });
    const parsed = parseCollectConfig({
      repos: ["tjsasakifln/Governance"],
      token: TEST_TOKEN,
      transport,
      now: () => FIXED_NOW,
      env: { GITHUB_TOKEN: TEST_TOKEN },
      logSink: () => {},
    });
    if (!parsed.ok) throw new Error(parsed.message);
    const result = await collect(parsed.config);
    assert.equal(transport.requests.length, 1);
    assert.ok(
      result.snapshot.repos[0]?.errors.some((error) => error.code === "skipped_rate_limit") ||
        result.snapshot.freshness_status === "stale" ||
        result.snapshot.freshness_status === "failed",
    );
    assert.notEqual(result.snapshot.repos[0]?.issues_collection.ok, true);
  });

  it("stops rather than retrying on 429/403 rate limit", async () => {
    const transport = createScriptedTransport(() => ({
      status: 403,
      headers: {
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": "1787241600",
      },
      body: JSON.stringify({ message: "API rate limit exceeded for user" }),
    }));
    const parsed = parseCollectConfig({
      repos: ["tjsasakifln/Governance", "tjsasakifln/web-cfg"],
      token: TEST_TOKEN,
      transport,
      now: () => FIXED_NOW,
      env: { GITHUB_TOKEN: TEST_TOKEN },
      logSink: () => {},
    });
    if (!parsed.ok) throw new Error(parsed.message);
    const result = await collect(parsed.config);
    assert.equal(transport.requests.length, 1);
    assert.equal(
      transport.requests.every((req) => req.method === "GET"),
      true,
    );
    const codes = [
      ...result.snapshot.errors.map((error) => error.code),
      ...(result.snapshot.repos[0]?.errors.map((error) => error.code) ?? []),
    ];
    assert.ok(codes.includes("rate_limit") || codes.includes("skipped_rate_limit"));
  });

  it("does not leak secrets into snapshot output or structured logs", async () => {
    const logs: string[] = [];
    const { config } = loadConfig("populated", { extraLogs: logs });
    const result = await collect(config);
    const blob = `${JSON.stringify(result)}\n${logs.join("\n")}`;
    assert.equal(blob.includes(TEST_TOKEN), false);
    assert.equal(/ghs_[A-Za-z0-9]+/.test(blob), false);
    assert.equal(blob.toLowerCase().includes("authorization"), false);
  });

  it("identical fixture collects share observation identities", async () => {
    const a = loadConfig("populated");
    const b = loadConfig("populated");
    const first = await collect(a.config);
    const second = await collect(b.config);
    assert.deepEqual(observationIds(first), observationIds(second));
  });
});

function jsonResponse(
  status: number,
  body: string,
  headers: Record<string, string>,
): HttpResponse {
  return {
    status,
    headers: { "content-type": "application/json", ...headers },
    body,
  };
}

function headerOf(headers: Record<string, string>, name: string): string | undefined {
  const want = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === want) return value;
  }
  return undefined;
}
