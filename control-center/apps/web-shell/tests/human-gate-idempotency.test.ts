import assert from "node:assert/strict";
import { test } from "node:test";

import {
  humanGateIdempotencyKey,
  settleHumanGateIntent,
  type HumanGateIntent,
} from "../src/human-gate-idempotency";

function store() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

test("retry, reload and two tabs reuse the same key while outcome is unknown", () => {
  const shared = store();
  const intent: HumanGateIntent = {
    action: "review",
    version_id: "version-fixture",
    candidate_id: "candidate-fixture",
    decision: "APPROVE",
    reason: "evidence reviewed",
    acknowledged: true,
  };
  const tabA = humanGateIdempotencyKey(intent, shared);
  const tabB = humanGateIdempotencyKey({ ...intent }, shared);
  assert.equal(tabA, tabB);
  settleHumanGateIntent(intent, "unknown", shared);
  assert.equal(humanGateIdempotencyKey(intent, shared), tabA);
});

test("a definitive response advances the generation but changed payload has another identity", () => {
  const shared = store();
  const intent: HumanGateIntent = { action: "create", limit: 3 };
  const first = humanGateIdempotencyKey(intent, shared);
  settleHumanGateIntent(intent, "executed", shared);
  const second = humanGateIdempotencyKey(intent, shared);
  assert.notEqual(first, second);
  assert.notEqual(humanGateIdempotencyKey({ ...intent, limit: 4 }, shared), second);
  const decision: HumanGateIntent = { action: "decide", version_id: "v-id", decision: "NO_GO", reason: "fixture", confirmation: "v3" };
  assert.notEqual(humanGateIdempotencyKey(decision, shared), humanGateIdempotencyKey({ ...decision, confirmation: "v4" }, shared));
});

test("selection mode and recovery set are part of the create intent", () => {
  const shared = store();
  const a = "11111111-1111-4111-8111-111111111111";
  const b = "22222222-2222-4222-8222-222222222222";
  const next: HumanGateIntent = { action: "create", limit: 10, selection_mode: "NEXT_UNCLAIMED" };
  const recovery: HumanGateIntent = { action: "create", limit: 10, selection_mode: "RECOVER_PRIOR", recover_version_ids: [b, a] };
  assert.notEqual(humanGateIdempotencyKey(next, shared), humanGateIdempotencyKey(recovery, shared));
  assert.equal(
    humanGateIdempotencyKey(recovery, shared),
    humanGateIdempotencyKey({ ...recovery, recover_version_ids: [a, b] }, shared),
  );
});
