import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  assembleCollectorSnapshots,
  EngineeringError,
  parseCollectorSnapshot,
} from "../src/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(root, "fixtures", name), "utf8"));
}

describe("collector snapshot adapter", () => {
  it("accepts GitHub-collector-shaped fixtures", () => {
    const parsed = parseCollectorSnapshot(loadFixture("pr-stale.json"));
    assert.equal(parsed.schema, "confenge.control_center.engineering_snapshot.v1");
    assert.equal(parsed.repos[0]?.repo?.full_name, "confenge/billing-api");
    assert.equal("token" in parsed, false);
    assert.equal("diff" in (parsed.repos[0]?.open_pull_requests[0] ?? {}), false);
  });

  it("rejects a snapshot missing provenance fail-closed", () => {
    const raw = loadFixture("ci-red.json") as Record<string, unknown>;
    delete raw.source;
    assert.throws(
      () => parseCollectorSnapshot(raw),
      (error: unknown) =>
        error instanceof EngineeringError && error.code === "missing_provenance",
    );
  });

  it("rejects a nested observation missing observed_at", () => {
    const raw = loadFixture("ci-red.json") as {
      repos: Array<{ repo: Record<string, unknown> | null }>;
    };
    const identity = raw.repos[0]?.repo;
    assert.ok(identity);
    delete identity.observed_at;
    assert.throws(
      () => parseCollectorSnapshot(raw),
      (error: unknown) =>
        error instanceof EngineeringError &&
        (error.code === "missing_provenance" || error.code === "invalid_input"),
    );
  });

  it("assembles the four named fixtures into one collector snapshot", () => {
    const assembled = assembleCollectorSnapshots([
      loadFixture("pr-stale.json"),
      loadFixture("ci-red.json"),
      loadFixture("repo-quiet-saudavel.json"),
      loadFixture("repo-quiet-desconhecido.json"),
    ]);
    assert.equal(assembled.repos.length, 4);
    assert.equal(assembled.allowlist.length, 4);
    assert.equal(assembled.freshness_status, "failed");
  });
});
