import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import { test } from "node:test";
import { bootFromEnv } from "../src/boot.ts";
import { createRequestListener } from "../src/http.ts";
import { silentLogger } from "../src/log.ts";
import { createWarmblyReviewPortFromEnv, reviewDraftPage } from "../src/operational/warmbly-review.ts";
import type { WarmblyReviewPort } from "../src/operational/warmbly-review.ts";

const FOUNDER = { kind: "human" as const, id: "founder-local" };
const AUTHENTICATED_OPERATOR = { kind: "human" as const, id: "operator" };
const DRAFT_ID = "11111111-2222-4333-8444-555555555555";
const HASH = "sha256:exact";
const DUE_AT = "2026-08-26T12:00:00Z";
const APPROVED_AT = "2026-08-25T04:00:00Z";
const UPDATED_AT = "2026-08-25T04:00:01Z";

function queuedTouchpoint(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: DRAFT_ID,
    content_hash: HASH,
    approved_content_hash: HASH,
    state: "QUEUED",
    due_at: DUE_AT,
    approved_by: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    approved_at: APPROVED_AT,
    updated_at: UPDATED_AT,
    ...overrides,
  };
}

function decisionBody(touchpoint = queuedTouchpoint(), scheduledFor: unknown = DUE_AT): unknown {
  return { data: { touchpoint, scheduled_for: scheduledFor } };
}

test("review list publishes only authoritative and internally consistent pagination", () => {
  const rows = Array.from({ length: 55 }, (_, index) => ({ id: `draft-${index}` }));
  const fullPage = Array.from({ length: 100 }, (_, index) => ({ id: `draft-${index}` }));
  assert.deepEqual(reviewDraftPage({
    data: fullPage,
    pagination: {
      limit: 100,
      offset: 100,
      total: 250,
      remaining_count: 50,
      has_more: true,
      next_offset: 200,
    },
  }, 100, 100).page, {
    limit: 100,
    offset: 100,
    loaded_count: 100,
    coverage_status: "TOTAL_KNOWN",
    total_count: 250,
    remaining_count: 50,
    has_more: true,
    next_offset: 200,
  });
  assert.deepEqual(reviewDraftPage({ data: fullPage, pagination: { has_more: true } }, 100, 100).page, {
    limit: 100,
    offset: 100,
    loaded_count: 100,
    coverage_status: "PAGE_ONLY",
    has_more: true,
    next_offset: 200,
  });
  assert.deepEqual(reviewDraftPage({ data: rows, pagination: { total: 155, has_more: false } }, 100, 100).page, {
    limit: 100,
    offset: 100,
    loaded_count: 55,
    coverage_status: "TOTAL_KNOWN",
    total_count: 155,
    remaining_count: 0,
    has_more: false,
  });
  assert.equal(reviewDraftPage({ data: rows }, 100, 0).page.coverage_status, "UNPROVEN");

  const contradictions = [
    { total: 54, has_more: false },
    { total: 250, has_more: false },
    { total: -1, has_more: true },
    { total: "250", has_more: true },
    { has_more: "true" },
    { total: 250, has_more: true },
  ];
  for (const pagination of contradictions) {
    const page = reviewDraftPage({ data: rows, pagination }, 100, 0).page;
    assert.equal(page.coverage_status, "UNPROVEN");
    assert.equal(Object.hasOwn(page, "total_count"), false);
    assert.equal(Object.hasOwn(page, "has_more"), false);
  }
  const cursorContradictions = [
    { total: 250, has_more: true, next_offset: 999 },
    { total: 250, has_more: true, remaining_count: 1 },
    { total: 250, has_more: true, limit: 50 },
    { total: 250, has_more: true, offset: 0 },
    { has_more: true, next_offset: "200" },
  ];
  for (const pagination of cursorContradictions) {
    const page = reviewDraftPage({ data: fullPage, pagination }, 100, 100).page;
    assert.equal(page.coverage_status, "UNPROVEN");
    assert.equal(Object.hasOwn(page, "next_offset"), false);
  }
  assert.throws(
    () => reviewDraftPage({ data: { id: "not-a-list" } }, 100, 0),
    /did not contain a data array/,
  );
});

test("Warmbly review proxy preserves exact-hash decision metadata", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    const body = init.method === "POST"
      ? decisionBody()
      : url.endsWith(`/v1/confenge/review/drafts/${DRAFT_ID}`)
        ? { data: queuedTouchpoint() }
        : { data: [] };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  const port = createWarmblyReviewPortFromEnv({
    WARMBLY_BASE_URL: "https://warmbly.example.test/",
    WARMBLY_API_TOKEN: "test-token",
  }, fetchImpl);
  assert.ok(port);

  const listed = await port.list(FOUNDER, new URLSearchParams({ limit: "999", offset: "12" }));
  assert.deepEqual(listed, {
    schema_version: "control-center.review-draft-page.v1",
    data: [],
    page: {
      limit: 200,
      offset: 12,
      loaded_count: 0,
      coverage_status: "UNPROVEN",
    },
  });
  const result = await port.decide(FOUNDER, DRAFT_ID, {
    action: "APPROVE",
    expected_content_hash: HASH,
  }, "review-key");

  assert.equal(calls[0]?.url, "https://warmbly.example.test/v1/confenge/review/drafts?limit=200&offset=12");
  assert.equal(calls[1]?.url, `https://warmbly.example.test/v1/confenge/review/drafts/${DRAFT_ID}/decision`);
  assert.equal(calls[2]?.url, `https://warmbly.example.test/v1/confenge/review/drafts/${DRAFT_ID}`);
  const headers = calls[1]?.init.headers as Record<string, string>;
  assert.equal(headers.authorization, "Bearer test-token");
  assert.equal(headers["idempotency-key"], "review-key");
  assert.match(String(calls[1]?.init.body), /expected_content_hash/);
  assert.deepEqual(result, {
    schema_version: "control-center.review-decision-receipt.v1",
    outcome: "confirmed",
    action: "APPROVE",
    touchpoint_id: DRAFT_ID,
    expected_content_hash: HASH,
    correlation_id: "review-key",
    observed_at: (result as { observed_at: string }).observed_at,
    message: `Aprovação confirmada no servidor em QUEUED para ${DUE_AT}.`,
    readback: {
      status: "confirmed",
      detail: "write e readback confirmam a mesma versão persistida",
    },
    receipt_id: `review:${DRAFT_ID}:${UPDATED_AT}`,
    content_hash: HASH,
    approved_content_hash: HASH,
    state: "QUEUED",
    due_at: DUE_AT,
    scheduled_for: DUE_AT,
    approved_by: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    approved_at: APPROVED_AT,
  });
});

test("2xx vazio continua não confirmado mesmo quando o GET posterior parece agendado", async () => {
  const fetchImpl = (async (_input: RequestInfo | URL, init: RequestInit = {}) => {
    if (init.method === "POST") return new Response(null, { status: 204 });
    return new Response(JSON.stringify({ data: queuedTouchpoint() }), { status: 200 });
  }) as typeof fetch;
  const port = createWarmblyReviewPortFromEnv({
    WARMBLY_BASE_URL: "https://warmbly.example.test",
    WARMBLY_API_TOKEN: "test-token",
  }, fetchImpl);
  assert.ok(port);
  const result = await port.decide(FOUNDER, DRAFT_ID, {
    action: "APPROVE",
    expected_content_hash: HASH,
  }, "review-key") as Record<string, unknown>;
  assert.equal(result.outcome, "not_confirmed");
  assert.match(String(result.message), /não repita ainda/i);
  assert.match(String((result.readback as Record<string, unknown>).detail), /sem JSON utilizável/);
  assert.equal(Object.hasOwn(result, "receipt_id"), false);
});

test("APPROVE falha fechado para resposta incompatível, hash divergente, scheduling ausente e readback stale", async (t) => {
  const cases: Array<{
    name: string;
    write: unknown;
    readback: unknown;
    failure: RegExp;
  }> = [
    {
      name: "body incompatível",
      write: { data: { ok: true } },
      readback: { data: queuedTouchpoint() },
      failure: /não contém um touchpoint válido/,
    },
    {
      name: "hash divergente",
      write: decisionBody(queuedTouchpoint({ content_hash: "sha256:other", approved_content_hash: "sha256:other" })),
      readback: { data: queuedTouchpoint({ content_hash: "sha256:other", approved_content_hash: "sha256:other" }) },
      failure: /diverge do hash exato/,
    },
    {
      name: "sem due_at",
      write: decisionBody(queuedTouchpoint({ due_at: "" }), undefined),
      readback: { data: queuedTouchpoint({ due_at: "" }) },
      failure: /sem due_at estável/,
    },
    {
      name: "readback stale",
      write: decisionBody(),
      readback: { data: queuedTouchpoint({ state: "NEEDS_REVIEW", approved_content_hash: "", due_at: "" }) },
      failure: /estado mudou/,
    },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const fetchImpl = (async (_input: RequestInfo | URL, init: RequestInit = {}) => new Response(
        JSON.stringify(init.method === "POST" ? scenario.write : scenario.readback),
        { status: 200 },
      )) as typeof fetch;
      const port = createWarmblyReviewPortFromEnv({
        WARMBLY_BASE_URL: "https://warmbly.example.test",
        WARMBLY_API_TOKEN: "test-token",
      }, fetchImpl);
      assert.ok(port);
      const result = await port.decide(FOUNDER, DRAFT_ID, {
        action: "APPROVE",
        expected_content_hash: HASH,
      }, "review-key") as Record<string, unknown>;
      assert.equal(result.outcome, "not_confirmed");
      assert.match(String((result.readback as Record<string, unknown>).detail), scenario.failure);
    });
  }
});

test("readback indisponível após write retorna receipt ambíguo sem convidar replay", async () => {
  const fetchImpl = (async (_input: RequestInfo | URL, init: RequestInit = {}) => {
    if (init.method === "POST") return new Response(JSON.stringify(decisionBody()), { status: 200 });
    throw new Error("timeout");
  }) as typeof fetch;
  const port = createWarmblyReviewPortFromEnv({
    WARMBLY_BASE_URL: "https://warmbly.example.test",
    WARMBLY_API_TOKEN: "test-token",
  }, fetchImpl);
  assert.ok(port);
  const result = await port.decide(FOUNDER, DRAFT_ID, {
    action: "APPROVE",
    expected_content_hash: HASH,
  }, "review-key") as Record<string, unknown>;
  assert.equal(result.outcome, "not_confirmed");
  assert.deepEqual(result.readback, {
    status: "unavailable",
    detail: "o readback canônico ficou indisponível depois da escrita",
  });
  assert.match(String(result.message), /não repita ainda/i);
});

test("replay confirmado preserva correlation e receipt sem segunda semântica", async () => {
  const keys: string[] = [];
  const fetchImpl = (async (_input: RequestInfo | URL, init: RequestInit = {}) => {
    if (init.method === "POST") {
      keys.push(String((init.headers as Record<string, string>)["idempotency-key"]));
      return new Response(JSON.stringify(decisionBody()), { status: 200 });
    }
    return new Response(JSON.stringify({ data: queuedTouchpoint() }), { status: 200 });
  }) as typeof fetch;
  const port = createWarmblyReviewPortFromEnv({
    WARMBLY_BASE_URL: "https://warmbly.example.test",
    WARMBLY_API_TOKEN: "test-token",
  }, fetchImpl);
  assert.ok(port);
  const input = { action: "APPROVE", expected_content_hash: HASH };
  const first = await port.decide(FOUNDER, DRAFT_ID, input, "review-key") as Record<string, unknown>;
  const replay = await port.decide(FOUNDER, DRAFT_ID, input, "review-key") as Record<string, unknown>;
  assert.deepEqual(keys, ["review-key", "review-key"]);
  assert.equal(first.receipt_id, replay.receipt_id);
  assert.equal(first.outcome, "confirmed");
  assert.equal(replay.outcome, "confirmed");
});

test("APPROVE não aceita edição implícita no mesmo write", async () => {
  let called = false;
  const fetchImpl = (async () => {
    called = true;
    return new Response(JSON.stringify(decisionBody()), { status: 200 });
  }) as typeof fetch;
  const port = createWarmblyReviewPortFromEnv({
    WARMBLY_BASE_URL: "https://warmbly.example.test",
    WARMBLY_API_TOKEN: "test-token",
  }, fetchImpl);
  assert.ok(port);
  await assert.rejects(
    port.decide(FOUNDER, DRAFT_ID, {
      action: "APPROVE",
      expected_content_hash: HASH,
      subject: "mudou",
    }, "review-key"),
    /save the adjustment before APPROVE/,
  );
  assert.equal(called, false);
});

test("SAVE_ADJUSTMENT e REJECT também exigem write/readback da mesma versão", async (t) => {
  const cases = [
    {
      action: "SAVE_ADJUSTMENT",
      body: { action: "SAVE_ADJUSTMENT", expected_content_hash: HASH, subject: "novo assunto" },
      touchpoint: queuedTouchpoint({
        content_hash: "sha256:adjusted",
        approved_content_hash: "",
        state: "NEEDS_REVIEW",
        due_at: "",
        approved_by: "",
        approved_at: "",
      }),
    },
    {
      action: "REJECT",
      body: { action: "REJECT", expected_content_hash: HASH, reason: "tom inadequado" },
      touchpoint: queuedTouchpoint({
        approved_content_hash: "",
        state: "REJECTED_REWRITE_PENDING",
        due_at: "",
        approved_by: "",
        approved_at: "",
      }),
    },
  ] as const;
  for (const scenario of cases) {
    await t.test(scenario.action, async () => {
      const fetchImpl = (async (_input: RequestInfo | URL, init: RequestInit = {}) => new Response(
        JSON.stringify(init.method === "POST"
          ? { data: { touchpoint: scenario.touchpoint } }
          : { data: scenario.touchpoint }),
        { status: 200 },
      )) as typeof fetch;
      const port = createWarmblyReviewPortFromEnv({
        WARMBLY_BASE_URL: "https://warmbly.example.test",
        WARMBLY_API_TOKEN: "test-token",
      }, fetchImpl);
      assert.ok(port);
      const result = await port.decide(FOUNDER, DRAFT_ID, scenario.body, "review-key") as Record<string, unknown>;
      assert.equal(result.outcome, "confirmed");
      assert.equal(result.action, scenario.action);
      assert.equal((result.readback as Record<string, unknown>).status, "confirmed");
    });
  }
});

test("falha de transporte durante o POST preserva ambiguidade e a mesma chave de recuperação", async () => {
  const port = createWarmblyReviewPortFromEnv({
    WARMBLY_BASE_URL: "https://warmbly.example.test",
    WARMBLY_API_TOKEN: "test-token",
  }, (async () => { throw new Error("timeout"); }) as typeof fetch);
  assert.ok(port);
  await assert.rejects(
    port.decide(FOUNDER, DRAFT_ID, { action: "APPROVE", expected_content_hash: HASH }, "review-key"),
    /não repita ainda.*mesma Idempotency-Key/i,
  );
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
