import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runCli } from "../src/cli.js";
import { fixtureDir, FIXED_NOW, TEST_TOKEN } from "./helpers.js";
import type { CollectResult } from "../src/types.js";

describe("shipped collect CLI entry", () => {
  it("writes a snapshot with provenance from fixture dir", async () => {
    const files = new Map<string, string>();
    const logs: string[] = [];
    const first = await runCli(
      [
        "collect",
        "--fixture-dir",
        fixtureDir("populated"),
        "--out",
        "/tmp/unused-out-a.json",
        "--now",
        FIXED_NOW.toISOString(),
      ],
      { GITHUB_TOKEN: TEST_TOKEN },
      (path, body) => {
        files.set(path, body);
      },
      (line) => logs.push(line),
    );
    assert.equal(first.code, 0);
    assert.ok(first.result);
    const written = [...files.values()][0];
    assert.ok(written);
    const parsed = JSON.parse(written) as CollectResult;
    assert.equal(parsed.snapshot.source, "github");
    assert.equal(parsed.snapshot.observed_at, FIXED_NOW.toISOString());
    assert.ok(parsed.snapshot.freshness_status);
    assert.ok(parsed.snapshot.repos.length > 0);
    assert.ok(parsed.observations.length > 0);
    assert.equal(written.includes(TEST_TOKEN), false);

    const files2 = new Map<string, string>();
    const second = await runCli(
      [
        "collect",
        "--fixture-dir",
        fixtureDir("populated"),
        "--out",
        "/tmp/unused-out-b.json",
        "--now",
        FIXED_NOW.toISOString(),
      ],
      { GITHUB_TOKEN: TEST_TOKEN },
      (path, body) => {
        files2.set(path, body);
      },
      () => {},
    );
    assert.equal(second.code, 0);
    assert.deepEqual(
      first.result?.observations.map((item) => item.observation_id),
      second.result?.observations.map((item) => item.observation_id),
    );
  });

  it("error fixture writes failed freshness rather than zero issues success", async () => {
    const files = new Map<string, string>();
    const outcome = await runCli(
      [
        "collect",
        "--fixture-dir",
        fixtureDir("error-403"),
        "--out",
        "/tmp/unused-error.json",
        "--now",
        FIXED_NOW.toISOString(),
      ],
      { GITHUB_TOKEN: TEST_TOKEN },
      (path, body) => {
        files.set(path, body);
      },
      () => {},
    );
    assert.equal(outcome.code, 1);
    const written = [...files.values()][0];
    assert.ok(written);
    const parsed = JSON.parse(written) as CollectResult;
    assert.equal(parsed.snapshot.freshness_status, "failed");
    const repo = parsed.snapshot.repos[0];
    assert.ok(repo);
    assert.notEqual(repo.issues_collection.ok, true);
    assert.deepEqual(repo.open_issues, []);
    assert.ok(repo.errors.some((error) => error.resource === "issues"));
  });

  it("missing credentials fail closed through the CLI entry", async () => {
    const files = new Map<string, string>();
    const outcome = await runCli(
      [
        "collect",
        "--fixture-dir",
        fixtureDir("populated"),
        "--repos",
        "tjsasakifln/Governance",
        "--out",
        "/tmp/unused-auth.json",
        "--now",
        FIXED_NOW.toISOString(),
      ],
      {},
      (path, body) => {
        files.set(path, body);
      },
      () => {},
    );
    assert.equal(outcome.code, 1);
    const written = [...files.values()][0];
    assert.ok(written);
    const parsed = JSON.parse(written) as CollectResult;
    assert.equal(parsed.snapshot.freshness_status, "failed");
    assert.equal(parsed.snapshot.errors[0]?.code, "missing_credentials");
    assert.deepEqual(parsed.snapshot.repos, []);
  });
});
