import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { ATTACK_IDS, readyForInternalProduction, runLiveGate } from "../../qa/src/index.ts";
import { bootLiveRuntime, httpJson, type LiveRuntime } from "./live-runtime/harness.ts";
import { collectLiveSnapshot } from "./live-runtime/snapshot.ts";

let runtime: LiveRuntime;

before(async () => {
  runtime = await bootLiveRuntime();
});

after(async () => {
  await runtime.stop();
});

test("14 named attacks run once against the integrated runtime and grant READY only on explicit pass", async () => {
  const snapshot = await collectLiveSnapshot(runtime);
  const report = runLiveGate(snapshot);
  assert.equal(report.corpus, "live");
  assert.equal(report.attacks.length, 14);
  assert.deepEqual(report.named_attacks, [...ATTACK_IDS]);
  const seen = new Set<string>();
  for (const id of ATTACK_IDS) {
    const rows = report.attacks.filter((a) => a.attack_id === id);
    assert.equal(rows.length, 1, `attack must appear exactly once: ${id}`);
    const row = rows[0];
    assert.ok(row);
    assert.equal(seen.has(id), false);
    seen.add(id);
    assert.notEqual(row.state, "UNKNOWN", `${id} must not be UNKNOWN: ${row.reason}`);
    assert.equal(row.state, "pass", `${id} failed: ${row.reason} ${JSON.stringify(row.evidence)}`);
  }
  assert.equal(seen.size, 14);
  const ready = readyForInternalProduction(
    report.attacks.map((a) => ({ attack_id: a.attack_id, state: a.state, reason: a.reason })),
  );
  assert.equal(ready.READY_FOR_INTERNAL_PRODUCTION, true);
  assert.equal(report.READY_FOR_INTERNAL_PRODUCTION, true);
  assert.equal(typeof report.READY_FOR_INTERNAL_PRODUCTION, "boolean");
  assert.equal(report.forbidden_side_effects.asaas_write, false);
  assert.equal(report.forbidden_side_effects.commercial_send, false);
});

test("production context HTTP carries provenance on scoped responses", async () => {
  const res = await httpJson(`${runtime.contextBaseUrl}/v1/context?scope=company`, {
    headers: runtime.founderHeaders,
  });
  assert.equal(res.status, 200);
  const body = res.body as {
    source?: unknown;
    observed_at?: string;
    freshness_status?: string;
    confidence?: number;
  };
  assert.ok(body.source);
  assert.ok(typeof body.observed_at === "string" && body.observed_at.endsWith("Z"));
  assert.ok(["FRESH", "STALE", "UNKNOWN", "ERROR"].includes(String(body.freshness_status)));
  assert.equal(typeof body.confidence, "number");
});

test("UNKNOWN in the live reducer is fail-closed and is not ready", () => {
  const ready = readyForInternalProduction([
    ...ATTACK_IDS.slice(0, 13).map((id) => ({ attack_id: id, state: "pass" as const })),
    { attack_id: "missing provenance", state: "UNKNOWN" },
  ]);
  assert.equal(ready.READY_FOR_INTERNAL_PRODUCTION, false);
  assert.ok(ready.unknown_checks.includes("missing provenance"));
});
