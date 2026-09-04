import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifySchedulingReadback,
  replayKeepsIdempotencyKey,
  type SchedulingReadbackInput,
} from "../src/first-touch-readback";
import {
  humanGateIdempotencyKey,
  settleHumanGateIntent,
  type HumanGateIntent,
} from "../src/human-gate-idempotency";

const KEY = "cc-human-gate:v1:fixture:0";

function v3Receipt(over: Partial<SchedulingReadbackInput> = {}): SchedulingReadbackInput {
  return {
    idempotency_key: KEY,
    approval_source: "DELEGATED_POLICY_APPROVE",
    policy_canonical: "CFG-FIRST-TOUCH-ROUTING-v3",
    policy_hash: "sha256:" + "a".repeat(64),
    executor: "warmbly/delegated-worker",
    authority: "DELEGATED_POLICY_APPROVE",
    recipient_hash: "b".repeat(64),
    content_hash: "c".repeat(64),
    evidence_hash: "d".repeat(64),
    source_hash: "e".repeat(64),
    window: "America/Sao_Paulo 09:00-18:00",
    runtime_sha: "4d29369ce6f5d0a086280f3d366c2af63ac364f0",
    readback_at: "2026-09-04T12:00:00Z",
    freshness: "FRESH",
    blockers: ["dispatch_paused"],
    readback: {
      status: "confirmed",
      state: "QUEUED",
      due_at: "2026-08-27T12:00:00Z",
    },
    ...over,
  };
}

test("HTTP 2xx without canonical queued readback is not QUEUED", () => {
  const httpOnly = classifySchedulingReadback({
    http_ok: true,
    idempotency_key: KEY,
    approval_source: "DELEGATED_POLICY_APPROVE",
    policy_canonical: "CFG-FIRST-TOUCH-ROUTING-v3",
  });
  assert.equal(httpOnly.state, "APPROVAL_PENDING_READBACK");
  assert.equal(httpOnly.queued, false);
  assert.equal(httpOnly.reason_group, "READBACK_UNKNOWN");
  assert.equal(httpOnly.approval_source, "DELEGATED_POLICY_APPROVE");
  assert.equal(httpOnly.provider_mutation, 0);

  const confirmed = classifySchedulingReadback(v3Receipt({ http_ok: true }));
  assert.equal(confirmed.state, "QUEUED");
  assert.equal(confirmed.queued, true);
  assert.equal(confirmed.reason_group, null);
  assert.equal(confirmed.provider_mutation, 0);
});

test("QUEUED requires receipt bindings; due_at alone is not enough", () => {
  const dueOnly = classifySchedulingReadback({
    http_ok: true,
    idempotency_key: KEY,
    approval_source: "DELEGATED_POLICY_APPROVE",
    policy_canonical: "CFG-FIRST-TOUCH-ROUTING-v3",
    readback: { status: "confirmed", state: "QUEUED", due_at: "2026-08-27T12:00:00Z" },
  });
  assert.equal(dueOnly.state, "APPROVAL_PENDING_READBACK");
  assert.equal(dueOnly.queued, false);
});

test("v1 v2 missing and unknown policy fail closed and never QUEUED", () => {
  const { policy_canonical: _pc, policy_id: _pid, policy_version: _pv, ...missingBase } = v3Receipt();
  const missing = classifySchedulingReadback(missingBase);
  assert.equal(missing.queued, false);
  assert.notEqual(missing.state, "QUEUED");
  assert.equal(missing.reason_group, "POLICY_FAIL_CLOSED");
  assert.equal(missing.provider_mutation, 0);

  for (const policy of ["v1", "CFG-FIRST-TOUCH-ROUTING-v1", "v2", "CFG-FIRST-TOUCH-ROUTING-v2", "v9"]) {
    const row = classifySchedulingReadback(v3Receipt({ policy_canonical: policy }));
    assert.equal(row.queued, false, policy);
    assert.equal(row.state, "READBACK_UNKNOWN", policy);
    assert.equal(row.reason_group, "POLICY_FAIL_CLOSED", policy);
    assert.equal(row.provider_mutation, 0);
  }
});

test("timeout, invalid and stale readback stay unconfirmed on the same key", () => {
  const timeout = classifySchedulingReadback({
    timeout: true,
    idempotency_key: KEY,
    approval_source: "HUMAN_APPROVE",
    policy_canonical: "CFG-FIRST-TOUCH-ROUTING-v3",
  });
  const invalid = classifySchedulingReadback({
    idempotency_key: KEY,
    approval_source: "HUMAN_APPROVE",
    policy_canonical: "CFG-FIRST-TOUCH-ROUTING-v3",
    readback: { status: "invalid" },
  });
  const stale = classifySchedulingReadback({
    idempotency_key: KEY,
    approval_source: "HUMAN_APPROVE",
    policy_canonical: "CFG-FIRST-TOUCH-ROUTING-v3",
    readback: { status: "stale" },
  });
  for (const row of [timeout, invalid, stale]) {
    assert.equal(row.state, "APPROVAL_PENDING_READBACK");
    assert.equal(row.queued, false);
    assert.equal(row.idempotency_key, KEY);
    assert.equal(row.reason_group, "READBACK_UNKNOWN");
    assert.equal(row.approval_source, "HUMAN_APPROVE");
    assert.equal(row.provider_mutation, 0);
  }
  assert.equal(replayKeepsIdempotencyKey(timeout, invalid), true);
});

test("omitted or null blockers is not QUEUED; empty blockers array may confirm", () => {
  const { blockers: _blockers, ...omitted } = v3Receipt();
  const omittedRow = classifySchedulingReadback(omitted);
  assert.equal(omittedRow.queued, false);
  assert.notEqual(omittedRow.state, "QUEUED");

  const nullRow = classifySchedulingReadback(v3Receipt({ blockers: null }));
  assert.equal(nullRow.queued, false);
  assert.notEqual(nullRow.state, "QUEUED");

  const empty = classifySchedulingReadback(v3Receipt({ blockers: [] }));
  assert.equal(empty.state, "QUEUED");
  assert.equal(empty.queued, true);
  assert.equal(empty.provider_mutation, 0);
});

test("stale freshness on an otherwise complete receipt does not confirm QUEUED", () => {
  const stale = classifySchedulingReadback(v3Receipt({ freshness: "stale" }));
  assert.equal(stale.state, "APPROVAL_PENDING_READBACK");
  assert.equal(stale.queued, false);
});

test("delegated queued and human exception queued stay distinct", () => {
  const delegated = classifySchedulingReadback(v3Receipt());
  const human = classifySchedulingReadback(
    v3Receipt({ approval_source: "HUMAN_APPROVE", authority: "HUMAN_APPROVE" }),
  );
  assert.equal(delegated.approval_source, "DELEGATED_POLICY_APPROVE");
  assert.equal(human.approval_source, "HUMAN_APPROVE");
  assert.notEqual(delegated.approval_source, human.approval_source);
  assert.equal(delegated.state, "QUEUED");
  assert.equal(human.state, "QUEUED");
});

test("unknown outcome reuses the human-gate idempotency key", () => {
  const values = new Map<string, string>();
  const store = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
  const intent: HumanGateIntent = {
    action: "review",
    version_id: "version-fixture",
    candidate_id: "candidate-fixture",
    decision: "APPROVE",
    reason: "evidence reviewed",
    acknowledged: true,
  };
  const first = humanGateIdempotencyKey(intent, store);
  settleHumanGateIntent(intent, "unknown", store);
  const retry = humanGateIdempotencyKey(intent, store);
  assert.equal(first, retry);
  const pending = classifySchedulingReadback({
    timeout: true,
    idempotency_key: first,
    approval_source: "HUMAN_APPROVE",
    policy_canonical: "CFG-FIRST-TOUCH-ROUTING-v3",
  });
  assert.equal(pending.idempotency_key, first);
  assert.equal(pending.queued, false);
});
