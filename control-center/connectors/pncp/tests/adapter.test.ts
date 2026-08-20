import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  CONTRACT_VERSION,
  commandArgvIsForbidden,
  defaultReadOnlyCommandArgv,
  evaluatePncpFreshness,
} from "../src/index.js";
import { fixturePath, readFixtureJson } from "./helpers.js";

const NOW = new Date("2026-08-20T12:00:00.000Z");

describe("READ-ONLY file / http / command adapters", () => {
  test("file adapter maps a valid 1.0 FRESH contract", async () => {
    const result = await evaluatePncpFreshness({
      kind: "file",
      filePath: fixturePath("contract-fresh.json"),
      now: NOW,
    });
    assert.equal(result.adapter_kind, "file");
    assert.equal(result.freshness_status, "FRESH");
    assert.equal(result.contract_version, CONTRACT_VERSION);
    assert.ok(result.as_of);
    assert.ok(result.serviceHealth.provenance.source.system);
  });

  test("file adapter missing path / missing file → ERROR", async () => {
    const unconfigured = await evaluatePncpFreshness({ kind: "file", now: NOW });
    assert.equal(unconfigured.freshness_status, "ERROR");
    assert.equal(unconfigured.parse_error?.code, "SOURCE_UNCONFIGURED");

    const missing = await evaluatePncpFreshness({
      kind: "file",
      filePath: fixturePath("does-not-exist.json"),
      now: NOW,
    });
    assert.equal(missing.freshness_status, "ERROR");
    assert.equal(missing.parse_error?.code, "ARTIFACT_MISSING");
    assert.notEqual(missing.freshness_status, "FRESH");
  });

  test("file adapter invalid JSON → ERROR", async () => {
    const result = await evaluatePncpFreshness({
      kind: "file",
      filePath: fixturePath("contract-invalid.json"),
      now: NOW,
    });
    assert.equal(result.freshness_status, "ERROR");
    assert.equal(result.parse_error?.code, "INVALID_JSON");
  });

  test("http GET of a valid 1.0 contract maps", async () => {
    const payload = await readFixtureJson("contract-fresh.json");
    const result = await evaluatePncpFreshness({
      kind: "http",
      httpUrl: "https://metrics.example.invalid/pncp-contract-freshness",
      now: NOW,
      fetchImpl: async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    assert.equal(result.adapter_kind, "http");
    assert.equal(result.freshness_status, "FRESH");
    assert.equal(result.upstream_status, "FRESH");
  });

  test("http network failure and non-2xx → ERROR", async () => {
    const down = await evaluatePncpFreshness({
      kind: "http",
      httpUrl: "https://metrics.example.invalid/pncp",
      now: NOW,
      fetchImpl: async () => {
        throw new Error("network down");
      },
    });
    assert.equal(down.freshness_status, "ERROR");
    assert.equal(down.parse_error?.code, "TRANSPORT_FAILURE");

    const notOk = await evaluatePncpFreshness({
      kind: "http",
      httpUrl: "https://metrics.example.invalid/pncp",
      now: NOW,
      fetchImpl: async () => new Response("nope", { status: 503 }),
    });
    assert.equal(notOk.freshness_status, "ERROR");
    assert.equal(notOk.parse_error?.code, "HTTP_ERROR");
    assert.notEqual(notOk.freshness_status, "FRESH");
  });

  test("injected command stdout of a 1.0 DEGRADED body maps to STALE without reclassification", async () => {
    const payload = await readFixtureJson("contract-degraded.json");
    const argv = defaultReadOnlyCommandArgv("/var/lib/extra-cli/snapshot.json");
    assert.equal(commandArgvIsForbidden(argv), false);
    assert.equal(argv.includes("--live"), false);
    assert.ok(argv.includes("--from-snapshot"));
    assert.ok(argv.includes("--json"));

    const result = await evaluatePncpFreshness({
      kind: "command",
      commandArgv: argv,
      now: NOW,
      commandRunner: async () => ({
        stdout: JSON.stringify(payload),
        exitCode: 0,
      }),
    });
    assert.equal(result.adapter_kind, "command");
    assert.equal(result.freshness_status, "STALE");
    assert.equal(result.upstream_status, "DEGRADED");
    assert.deepEqual(result.reason_codes, [
      "LOCK_BUSY_NO_CLOSE",
      "LAG_ABOVE_OPERATIONAL_TARGET",
    ]);
    assert.notEqual(result.freshness_status, "FRESH");
  });

  test("command non-zero exit and unreadable stdout → ERROR", async () => {
    const nonZero = await evaluatePncpFreshness({
      kind: "command",
      commandArgv: defaultReadOnlyCommandArgv("snapshot.json"),
      now: NOW,
      commandRunner: async () => ({ stdout: "", exitCode: 2 }),
    });
    assert.equal(nonZero.freshness_status, "ERROR");
    assert.equal(nonZero.parse_error?.code, "COMMAND_FAILED");

    const garbage = await evaluatePncpFreshness({
      kind: "command",
      commandArgv: defaultReadOnlyCommandArgv("snapshot.json"),
      now: NOW,
      commandRunner: async () => ({ stdout: "not-json", exitCode: 0 }),
    });
    assert.equal(garbage.freshness_status, "ERROR");
    assert.equal(garbage.parse_error?.code, "INVALID_JSON");
  });

  test("command adapter refuses --live", async () => {
    const result = await evaluatePncpFreshness({
      kind: "command",
      commandArgv: [
        "python3",
        "scripts/ops/pncp_contract_freshness.py",
        "--live",
        "--json",
      ],
      now: NOW,
      commandRunner: async () => {
        throw new Error("must not spawn live collection");
      },
    });
    assert.equal(result.freshness_status, "ERROR");
    assert.equal(result.parse_error?.code, "FORBIDDEN_LIVE_COLLECTION");
  });
});
