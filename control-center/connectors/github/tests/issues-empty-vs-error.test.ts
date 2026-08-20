import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collect, failedCollect } from "../src/collect.js";
import { parseCollectConfig } from "../src/config.js";
import { loadConfig, FIXED_NOW } from "./helpers.js";
import { createScriptedTransport } from "../src/fixture-transport.js";

describe("empty issues vs collection error", () => {
  it("HTTP 200 with [] is success with zero issues", async () => {
    const { config } = loadConfig("empty-issues");
    const result = await collect(config);
    const repo = result.snapshot.repos[0];
    assert.ok(repo);
    assert.equal(repo.issues_collection.ok, true);
    assert.deepEqual(repo.open_issues, []);
    assert.equal(
      repo.errors.some((error) => error.resource === "issues"),
      false,
    );
    assert.notEqual(result.snapshot.freshness_status, "failed");
  });

  it("HTTP 200 with labeled issues is success with those issues", async () => {
    const { config } = loadConfig("populated", {
      repos: ["tjsasakifln/Governance"],
    });
    const result = await collect(config);
    const repo = result.snapshot.repos[0];
    assert.ok(repo);
    assert.equal(repo.issues_collection.ok, true);
    assert.ok(repo.open_issues.length >= 2);
    assert.ok(repo.open_issues.every((issue) => issue.priority !== undefined));
    assert.equal(
      repo.errors.some((error) => error.resource === "issues"),
      false,
    );
  });

  it("HTTP 403 is a failed issues collection, not zero-issue success", async () => {
    const { config } = loadConfig("error-403");
    const result = await collect(config);
    const repo = result.snapshot.repos[0];
    assert.ok(repo);
    assert.equal(repo.issues_collection.ok, false);
    assert.deepEqual(repo.open_issues, []);
    const issueError = repo.errors.find((error) => error.resource === "issues");
    assert.ok(issueError);
    assert.equal(issueError.code, "http_403");
    assert.equal(issueError.freshness_status, "failed");
    assert.equal(result.snapshot.freshness_status, "failed");
    assert.notEqual(
      JSON.stringify(result.snapshot),
      JSON.stringify({
        ok: true,
        open_issues: [],
      }),
    );
  });

  it("HTTP 429 is a rate-limit error channel, not zero issues", async () => {
    const { config, transport } = loadConfig("error-429");
    const result = await collect(config);
    assert.ok(
      result.snapshot.freshness_status === "failed" ||
        result.snapshot.freshness_status === "stale",
    );
    assert.ok(result.snapshot.errors.length + (result.snapshot.repos[0]?.errors.length ?? 0) > 0);
    const repo = result.snapshot.repos[0];
    assert.ok(repo);
    assert.equal(repo.repo, null);
    assert.equal(repo.issues_collection.ok, false);
    assert.deepEqual(repo.open_issues, []);
    const codes = [...result.snapshot.errors, ...repo.errors].map((error) => error.code);
    assert.ok(codes.includes("rate_limit") || codes.includes("http_429"));
    assert.equal(transport.requests.length, 1, "429 must stop further requests");
  });

  it("HTTP 5xx is a failed issues collection, not zero-issue success", async () => {
    const { config } = loadConfig("error-500");
    const result = await collect(config);
    const repo = result.snapshot.repos[0];
    assert.ok(repo);
    assert.equal(repo.issues_collection.ok, false);
    assert.deepEqual(repo.open_issues, []);
    const issueError = repo.errors.find((error) => error.resource === "issues");
    assert.ok(issueError);
    assert.equal(issueError.code, "http_5xx");
    assert.equal(issueError.http_status, 500);
    assert.equal(result.snapshot.freshness_status, "failed");
  });

  it("missing credentials fail closed with no HTTP calls", async () => {
    const transport = createScriptedTransport(() => {
      throw new Error("network must not be used without credentials");
    });
    const parsed = parseCollectConfig({
      repos: ["tjsasakifln/Governance"],
      transport,
      now: () => FIXED_NOW,
      env: {},
    });
    assert.equal(parsed.ok, false);
    if (parsed.ok) {
      throw new Error("expected missing credentials");
    }
    assert.equal(parsed.code, "missing_credentials");
    const result = failedCollect({
      now: FIXED_NOW,
      allowlist: ["tjsasakifln/Governance"],
      code: "missing_credentials",
      message: parsed.message,
    });
    assert.equal(result.snapshot.freshness_status, "failed");
    assert.deepEqual(result.snapshot.repos, []);
    assert.equal(result.snapshot.errors[0]?.code, "missing_credentials");
    assert.equal(transport.requests.length, 0);
  });
});
