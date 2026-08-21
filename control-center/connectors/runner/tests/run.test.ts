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
