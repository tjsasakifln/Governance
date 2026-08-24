import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import { test } from "node:test";
import { bootFromEnv } from "../src/boot.ts";
import { createRequestListener } from "../src/http.ts";
import { silentLogger } from "../src/log.ts";
import { createWarmblyReviewPortFromEnv } from "../src/operational/warmbly-review.ts";
import type { WarmblyReviewPort } from "../src/operational/warmbly-review.ts";

const FOUNDER = { kind: "human" as const, id: "founder-local" };
const AUTHENTICATED_OPERATOR = { kind: "human" as const, id: "operator" };
const DRAFT_ID = "11111111-2222-4333-8444-555555555555";

test("Warmbly review proxy preserves exact-hash decision metadata", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({ ok: true, items: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  const port = createWarmblyReviewPortFromEnv({
    WARMBLY_BASE_URL: "https://warmbly.example.test/",
    WARMBLY_API_TOKEN: "test-token",
  }, fetchImpl);
  assert.ok(port);

  await port.list(FOUNDER, new URLSearchParams({ limit: "999", offset: "12" }));
  await port.decide(FOUNDER, DRAFT_ID, {
    action: "APPROVE",
    expected_content_hash: "sha256:exact",
  }, "review-key");

  assert.equal(calls[0]?.url, "https://warmbly.example.test/v1/confenge/review/drafts?limit=200&offset=12");
  assert.equal(calls[1]?.url, `https://warmbly.example.test/v1/confenge/review/drafts/${DRAFT_ID}/decision`);
  const headers = calls[1]?.init.headers as Record<string, string>;
  assert.equal(headers.authorization, "Bearer test-token");
  assert.equal(headers["idempotency-key"], "review-key");
  assert.match(String(calls[1]?.init.body), /expected_content_hash/);
});

test("Warmbly review proxy stays absent when its credential is not configured", () => {
  assert.equal(createWarmblyReviewPortFromEnv({}), undefined);
});

test("review HTTP routes use trusted-edge identity and require JSON for decisions", async () => {
  const observed: Array<{ actor: unknown; key?: string; body?: unknown }> = [];
  const warmblyReview: WarmblyReviewPort = {
    async list(actor) {
      observed.push({ actor });
      return { items: [] };
    },
    async get(actor) {
      observed.push({ actor });
      return { id: DRAFT_ID };
    },
    async decide(actor, _id, body, key) {
      observed.push({ actor, body, key });
      return { ok: true };
    },
    async approveBatch(actor, body, key) {
      observed.push({ actor, body, key });
      return { ok: true };
    },
  };
  const boot = bootFromEnv({ CONTROL_CENTER_FOUNDER_ACTOR_ID: FOUNDER.id });
  const listener = createRequestListener({
    service: boot.service,
    logger: silentLogger,
    warmblyReview,
    operatorActor(req: IncomingMessage) {
      assert.equal(req.headers["x-actor-id"], "browser-forgery");
      return AUTHENTICATED_OPERATOR;
    },
  });
  const server = createServer(listener);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  try {
    const listed = await fetch(`${base}/v1/commercial/review-drafts`, {
      headers: { "x-actor-id": "browser-forgery" },
    });
    assert.equal(listed.status, 200);
    assert.deepEqual(observed[0]?.actor, AUTHENTICATED_OPERATOR);

    const rejectedForm = await fetch(`${base}/v1/commercial/review-drafts/${DRAFT_ID}`, {
      method: "POST",
      headers: { "x-actor-id": "browser-forgery" },
      body: JSON.stringify({ action: "APPROVE" }),
    });
    assert.equal(rejectedForm.status, 415);
    assert.equal(observed.length, 1);

    const decided = await fetch(`${base}/v1/commercial/review-drafts/${DRAFT_ID}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "review-http-key",
        "x-actor-id": "browser-forgery",
      },
      body: JSON.stringify({ action: "APPROVE", expected_content_hash: "sha256:exact" }),
    });
    assert.equal(decided.status, 200);
    assert.deepEqual(observed[1]?.actor, AUTHENTICATED_OPERATOR);
    assert.equal(observed[1]?.key, "review-http-key");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
