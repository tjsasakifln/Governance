import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import {
  argvLooksForbidden,
  commandArgvIsForbidden,
  defaultReadOnlyCommandArgv,
  evaluatePncpFreshness,
  isFixtureLocator,
  mapUpstreamStatus,
  runCanaryCli,
  runPncpCanary,
} from "../src/index.js";
import { CAPABILITIES, CANARY_COLLECTORS } from "../src/envelope.js";
import { fixturePath } from "./helpers.js";

const NOW = new Date("2026-08-21T12:00:00.000Z");
const PACKAGE_FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

function assertEnvelope(report: Awaited<ReturnType<typeof runPncpCanary>>): void {
  assert.equal(report.collector, "pncp");
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

describe("pncp production canary", () => {
  test("missing real binding is BLOCKED_UPSTREAM, never fixture FRESH", async () => {
    const report = await runPncpCanary({
      env: {},
      now: NOW,
      exists: () => false,
    });
    assertEnvelope(report);
    assert.equal(report.capability, "BLOCKED_UPSTREAM");
    assert.notEqual(report.freshness_status, "FRESH");
    assert.equal(isFixtureLocator(report.source.locator), false);
    assert.equal(JSON.stringify(report).includes(PACKAGE_FIXTURES), false);
    assert.ok((report.payload.required_bindings as string[]).includes("PNCP_CONTRACT_PATH"));
  });

  test("two pinned-clock blocked runs share idempotency_key", async () => {
    const first = await runPncpCanary({ env: {}, now: NOW, exists: () => false });
    const second = await runPncpCanary({ env: {}, now: NOW, exists: () => false });
    assert.equal(first.idempotency_key, second.idempotency_key);
    assert.equal(first.capability, second.capability);
  });

  test("repo fixture path is refused as a production source", async () => {
    let spawned = 0;
    const report = await runPncpCanary({
      env: { PNCP_CONTRACT_PATH: fixturePath("contract-fresh.json") },
      now: NOW,
      commandRunner: async () => {
        spawned += 1;
        throw new Error("must not spawn");
      },
    });
    assertEnvelope(report);
    assert.equal(report.capability, "BLOCKED_UPSTREAM");
    assert.equal(report.error?.code, "FIXTURE_FORBIDDEN");
    assert.notEqual(report.freshness_status, "FRESH");
    assert.equal(spawned, 0);
    assert.equal(isFixtureLocator(fixturePath("contract-fresh.json")), true);
  });

  test("--live ingest recrawl backfill never spawn", async () => {
    let spawned = 0;
    const runner = async () => {
      spawned += 1;
      throw new Error("must not spawn live collection");
    };
    for (const argv of [
      ["python3", "scripts/ops/pncp_contract_freshness.py", "--live", "--json"],
      ["python3", "x.py", "--ingest"],
      ["python3", "x.py", "--recrawl"],
      ["python3", "x.py", "backfill"],
    ]) {
      assert.equal(commandArgvIsForbidden(argv), true);
      assert.equal(argvLooksForbidden(argv), true);
      const evaluation = await evaluatePncpFreshness({
        kind: "command",
        commandArgv: argv,
        now: NOW,
        commandRunner: runner,
      });
      assert.equal(evaluation.freshness_status, "ERROR");
      assert.equal(evaluation.parse_error?.code, "FORBIDDEN_LIVE_COLLECTION");
      const canary = await runPncpCanary({ env: {}, now: NOW, argv, commandRunner: runner });
      assert.equal(canary.error?.code, "FORBIDDEN_LIVE_COLLECTION");
      assert.notEqual(canary.freshness_status, "FRESH");
    }
    assert.equal(spawned, 0);
    assert.equal(commandArgvIsForbidden(defaultReadOnlyCommandArgv("/var/lib/extra-cli/snapshot.json")), false);
  });

  test("DEGRADED maps to STALE and is not promoted", async () => {
    assert.equal(mapUpstreamStatus("DEGRADED").freshness_status, "STALE");
    const evaluation = await evaluatePncpFreshness({
      kind: "file",
      filePath: fixturePath("contract-degraded.json"),
      now: NOW,
    });
    assert.equal(evaluation.freshness_status, "STALE");
    assert.equal(evaluation.upstream_status, "DEGRADED");
    const report = await runPncpCanary({
      env: { PNCP_CONTRACT_PATH: "/var/lib/extra-cli/pncp/PNCP_CONTRACT_FRESHNESS.json" },
      now: NOW,
      exists: () => true,
      evaluate: async () => evaluation,
    });
    assertEnvelope(report);
    assert.equal(report.freshness_status, "STALE");
    assert.notEqual(report.freshness_status, "FRESH");
    assert.equal(report.capability, "BLOCKED_UPSTREAM");
    assert.equal(report.payload.upstream_status, "DEGRADED");
  });

  test("unknown contract version is CONTRACT_DRIFT", async () => {
    const evaluation = await evaluatePncpFreshness({
      kind: "file",
      filePath: fixturePath("contract-unknown-version.json"),
      now: NOW,
    });
    const report = await runPncpCanary({
      env: { PNCP_CONTRACT_HTTP_URL: "https://metrics.example.invalid/pncp" },
      now: NOW,
      evaluate: async () => evaluation,
    });
    assertEnvelope(report);
    assert.equal(report.capability, "CONTRACT_DRIFT");
    assert.notEqual(report.freshness_status, "FRESH");
  });

  test("CLI without binding emits BLOCKED_UPSTREAM JSON", async () => {
    const lines: string[] = [];
    const outcome = await runCanaryCli(["pncp", "--now", NOW.toISOString()], {}, {
      stdout: (line) => lines.push(line),
      stderr: () => undefined,
    });
    assert.equal(outcome.code, 0);
    const parsed = JSON.parse(lines.join("\n")) as Awaited<ReturnType<typeof runPncpCanary>>;
    assertEnvelope(parsed);
    assert.equal(parsed.capability, "BLOCKED_UPSTREAM");
  });
});
