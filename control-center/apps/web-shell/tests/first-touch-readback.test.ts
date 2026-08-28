import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifySchedulingReadback,
  replayKeepsIdempotencyKey,
} from "../src/first-touch-readback";
import {
  humanGateIdempotencyKey,
  settleHumanGateIntent,
  type HumanGateIntent,
} from "../src/human-gate-idempotency";

test("HTTP 2xx without canonical queued readback is not QUEUED", () => {
  const key = "cc-human-gate:v1:fixture:0";
  const httpOnly = classifySchedulingReadback({
    http_ok: true,
    idempotency_key: key,
    approval_source: "DELEGATED_POLICY_APPROVE",
  });
  assert.equal(httpOnly.state, "APPROVAL_PENDING_READBACK");
  assert.equal(httpOnly.queued, false);
  assert.equal(httpOnly.reason_group, "READBACK_UNKNOWN");
  assert.equal(httpOnly.approval_source, "DELEGATED_POLICY_APPROVE");

  const confirmed = classifySchedulingReadback({
    http_ok: true,
    idempotency_key: key,
    approval_source: "DELEGATED_POLICY_APPROVE",
    readback: { status: "confirmed", state: "QUEUED", due_at: "2026-08-27T12:00:00Z" },
  });
  assert.equal(confirmed.state, "QUEUED");
  assert.equal(confirmed.queued, true);
  assert.equal(confirmed.reason_group, null);
});

test("timeout, invalid and stale readback stay unconfirmed on the same key", () => {
  const key = "cc-human-gate:v1:fixture:0";
  const timeout = classifySchedulingReadback({ timeout: true, idempotency_key: key, approval_source: "HUMAN_APPROVE" });
  const invalid = classifySchedulingReadback({
    idempotency_key: key,
    approval_source: "HUMAN_APPROVE",
    readback: { status: "invalid" },
  });
  const stale = classifySchedulingReadback({
    idempotency_key: key,
    approval_source: "HUMAN_APPROVE",
    readback: { status: "stale" },
  });
  for (const row of [timeout, invalid, stale]) {
    assert.equal(row.state, "APPROVAL_PENDING_READBACK");
    assert.equal(row.queued, false);
    assert.equal(row.idempotency_key, key);
    assert.equal(row.reason_group, "READBACK_UNKNOWN");
    assert.equal(row.approval_source, "HUMAN_APPROVE");
  }
  assert.equal(replayKeepsIdempotencyKey(timeout, invalid), true);
});

test("delegated queued and human exception queued stay distinct", () => {
  const key = "same-key";
  const delegated = classifySchedulingReadback({
    idempotency_key: key,
    approval_source: "DELEGATED_POLICY_APPROVE",
    readback: { status: "confirmed", state: "QUEUED", due_at: "2026-08-27T12:00:00Z" },
  });
  const human = classifySchedulingReadback({
    idempotency_key: key,
    approval_source: "HUMAN_APPROVE",
    readback: { status: "confirmed", state: "QUEUED", due_at: "2026-08-27T12:00:00Z" },
  });
  assert.equal(delegated.approval_source, "DELEGATED_POLICY_APPROVE");
  assert.equal(human.approval_source, "HUMAN_APPROVE");
  assert.notEqual(delegated.approval_source, human.approval_source);
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
  const pending = classifySchedulingReadback({ timeout: true, idempotency_key: first, approval_source: "HUMAN_APPROVE" });
  assert.equal(pending.idempotency_key, first);
  assert.equal(pending.queued, false);
});
