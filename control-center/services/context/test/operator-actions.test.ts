import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { createMemoryOperatorActionService } from "../src/operational/actions.ts";
import { createRequestListener } from "../src/http.ts";
import { frozenClock } from "../src/clock.ts";
import { sequentialIds } from "../src/ids.ts";
import { silentLogger } from "../src/log.ts";
import { createContextService } from "../src/service.ts";
import { createFixtureStore } from "../src/store/fixture.ts";

const FOUNDER = { kind: "human" as const, id: "human:founder", display_name: "Founder" };
const AGENT = { kind: "agent" as const, id: "agent:cc", display_name: "Agent" };

async function withServer(
  fn: (base: string) => Promise<void>,
  actorKind: "human" | "agent" = "human",
): Promise<void> {
  const store = createFixtureStore();
  const service = createContextService({
    store,
    clock: frozenClock("2026-08-21T12:00:00.000Z"),
    ids: sequentialIds("id"),
    founderActorId: FOUNDER.id,
    logger: silentLogger,
    defaultScope: "company",
    repoDomains: {},
  });
  const listener = createRequestListener({
    service,
    logger: silentLogger,
    operatorActions: createMemoryOperatorActionService(FOUNDER.id),
  });
  const server = createServer(listener);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const base = `http://127.0.0.1:${port}`;
  try {
    await fn(base);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  void actorKind;
}

async function post(base: string, actor: { kind: string; id: string }, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${base}/v1/operator-actions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-actor-id": actor.id,
      "x-actor-kind": actor.kind,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

test("founder can record a reversible validation action", async () => {
  await withServer(async (base) => {
    const first = await post(base, FOUNDER, {
      action_type: "ACKNOWLEDGE_EXCEPTION",
      target_canonical_id: "cc:attention-item:ex-1",
      target_source_id: "ex-1",
      idempotency_key: "ack-ex-1",
      correlation_id: "ack-ex-1",
      scope: "commercial",
      note: "reviewed",
    });
    assert.equal(first.status, 201);
    assert.equal(first.json.action_type, "ACKNOWLEDGE_EXCEPTION");
    assert.equal(first.json.resulting_status, "accepted");
    const replay = await post(base, FOUNDER, {
      action_type: "ACKNOWLEDGE_EXCEPTION",
      target_canonical_id: "cc:attention-item:ex-1",
      target_source_id: "ex-1",
      idempotency_key: "ack-ex-1",
      correlation_id: "ack-ex-1",
      scope: "commercial",
      note: "reviewed",
    });
    assert.equal(replay.json.resulting_status, "duplicate");
  });
});

test("agent cannot impersonate founder and send mutations are refused", async () => {
  await withServer(async (base) => {
    const agent = await post(base, AGENT, {
      action_type: "ACKNOWLEDGE_EXCEPTION",
      target_canonical_id: "cc:attention-item:ex-1",
      target_source_id: "ex-1",
      idempotency_key: "agent-ack",
      scope: "commercial",
    });
    assert.equal(agent.status >= 400, true);
    const send = await post(base, FOUNDER, {
      action_type: "SEND_EMAIL",
      target_canonical_id: "lead-1",
      target_source_id: "lead-1",
      idempotency_key: "send-1",
      scope: "commercial",
    });
    assert.equal(send.status >= 400, true);
    const unknown = await fetch(`${base}/v1/operator-actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action_type: "MARK_REVIEWED" }),
    });
    assert.equal(unknown.status >= 400, true);
  });
});

test("memory service fails closed on conflicting idempotency payload", async () => {
  await withServer(async (base) => {
    const first = await post(base, FOUNDER, {
      action_type: "ACKNOWLEDGE_EXCEPTION",
      target_canonical_id: "cc:attention-item:ex-1",
      target_source_id: "ex-1",
      idempotency_key: "conflict-mem",
      scope: "commercial",
      note: "first",
    });
    assert.equal(first.status, 201);
    const conflicted = await post(base, FOUNDER, {
      action_type: "MARK_REVIEWED",
      target_canonical_id: "cc:attention-item:other",
      target_source_id: "other",
      idempotency_key: "conflict-mem",
      scope: "commercial",
      note: "second",
    });
    assert.equal(conflicted.status, 409);
  });
});
