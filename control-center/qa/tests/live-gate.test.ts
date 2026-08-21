import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  ATTACK_IDS,
  LiveRuntimePort,
  emptyLiveSnapshot,
  evaluateAttackViaPort,
  loadControlFixture,
  parseCorpus,
  readyForInternalProduction,
  runGate,
  runLiveGate,
  type LiveSnapshot,
} from "../src/index.js";

function asDirectives(payload: unknown): unknown[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return [];
  }
  const list = (payload as { directives?: unknown }).directives;
  return Array.isArray(list) ? list : [];
}

function snapshotFromControlFixtures(): LiveSnapshot {
  return {
    as_of: "2026-08-20T15:00:00.000Z",
    freshness: loadControlFixture("stale data mostrado como saudável").payload,
    ledger: loadControlFixture("double counting financeiro").payload,
    directives: {
      directives: [
        ...asDirectives(loadControlFixture("hypothesis promovida a fact").payload),
        ...asDirectives(loadControlFixture("agent sobrescrevendo founder decision").payload),
        ...asDirectives(loadControlFixture("conflicting directives/supersession").payload),
      ],
    },
    scopes: loadControlFixture("scope leakage entre cliente/repos").payload,
    events: loadControlFixture("duplicated collector event").payload,
    operations: loadControlFixture("provider mutation acidental").payload,
    surfaces: loadControlFixture("secret/PII leakage").payload,
    instants: loadControlFixture("timezone boundary").payload,
    health: loadControlFixture("partial outage").payload,
    sessions: loadControlFixture("stale RUNNING agent session").payload,
    auth: loadControlFixture("auth bypass assumptions").payload,
    aggregates: loadControlFixture("missing provenance").payload,
  };
}

describe("live runtime port drives shipped evaluators", () => {
  it("evaluates every named attack exactly once through LiveRuntimePort", () => {
    const snapshot = snapshotFromControlFixtures();
    const port = new LiveRuntimePort(snapshot);
    const seen = new Set<string>();
    for (const id of ATTACK_IDS) {
      const verdict = evaluateAttackViaPort(id, port);
      assert.equal(verdict.attack_id, id);
      assert.equal(seen.has(id), false);
      seen.add(id);
      assert.equal(verdict.state, "pass", id);
    }
    assert.equal(seen.size, 14);
  });

  it("runLiveGate grants READY only when every check is pass", () => {
    const report = runLiveGate(snapshotFromControlFixtures());
    assert.equal(report.corpus, "live");
    assert.equal(report.attacks.length, 14);
    assert.deepEqual(report.named_attacks, [...ATTACK_IDS]);
    for (const id of ATTACK_IDS) {
      const row = report.attacks.find((a) => a.attack_id === id);
      assert.ok(row, id);
      assert.equal(row.state, "pass");
      assert.equal(row.case_kind, "live");
    }
    assert.equal(report.READY_FOR_INTERNAL_PRODUCTION, true);
    const ready = readyForInternalProduction(
      report.attacks.map((a) => ({ attack_id: a.attack_id, state: a.state, reason: a.reason })),
    );
    assert.equal(ready.READY_FOR_INTERNAL_PRODUCTION, true);
  });

  it("UNKNOWN payload shape is fail-closed and is not ready", () => {
    const snapshot = emptyLiveSnapshot("2026-08-20T15:00:00.000Z");
    const broken: LiveSnapshot = {
      ...snapshot,
      freshness: "unusable",
      ledger: 12,
      directives: null,
      scopes: undefined,
    };
    const report = runLiveGate(broken);
    assert.equal(report.READY_FOR_INTERNAL_PRODUCTION, false);
    const unknown = report.attacks.filter((a) => a.state === "UNKNOWN");
    assert.ok(unknown.length >= 1);
    assert.ok(report.ready.unknown_checks.length + report.ready.failed_checks.length > 0);
    assert.equal(report.ready.passed_checks.length === 14, false);
  });

  it("missing check in the reducer is not ready even if others pass", () => {
    const report = runLiveGate(snapshotFromControlFixtures());
    const without = report.attacks
      .filter((a) => a.attack_id !== "missing provenance")
      .map((a) => ({ attack_id: a.attack_id, state: a.state as "pass" }));
    const ready = readyForInternalProduction(without);
    assert.equal(ready.READY_FOR_INTERNAL_PRODUCTION, false);
    assert.ok(ready.missing_checks.includes("missing provenance"));
  });
});

describe("live CLI corpus", () => {
  it("parseCorpus accepts live", () => {
    assert.equal(parseCorpus(["--corpus", "live"]), "live");
  });

  it("runGate(live) reads a snapshot file and uses shipped evaluators", () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-qa-live-"));
    const path = join(dir, "snapshot.json");
    writeFileSync(path, `${JSON.stringify(snapshotFromControlFixtures())}\n`);
    const report = runGate("live", ["--corpus", "live", "--snapshot", path]);
    assert.equal(report.corpus, "live");
    assert.equal(report.READY_FOR_INTERNAL_PRODUCTION, true);
    assert.equal(report.attacks.length, 14);
  });
});
