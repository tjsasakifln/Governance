import assert from "node:assert/strict";
import { test } from "node:test";

import { WARMBLY_DISPATCH_PATHS } from "../src/adapters/paths";
import { WARMBLY_DISPATCH_ACTIONS } from "../src/adapters/contract";
import { HttpControlCenterAdapter } from "../src/adapters/http";

type Call = { url: string; init: RequestInit };

function adapterWith(
  responder: (url: string, init: RequestInit) => { status: number; body: unknown },
): { adapter: HttpControlCenterAdapter; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const { status, body } = responder(url, init);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  const adapter = new HttpControlCenterAdapter({
    baseUrl: "https://ops.confenge.com.br",
    fetchImpl,
    operator: { id: "founder", kind: "human" },
  } as never);
  return { adapter, calls };
}

test("the dispatch surface is exactly four routes and nothing wider", () => {
  assert.deepEqual(Object.keys(WARMBLY_DISPATCH_PATHS).sort(), [...WARMBLY_DISPATCH_ACTIONS].sort());
  for (const path of Object.values(WARMBLY_DISPATCH_PATHS)) {
    assert.ok(path.startsWith("/v1/warmbly/operator/"), `${path} escapes the operator prefix`);
  }
});

test("no actor header is sent: a client-settable actor must not reach a dispatch write", async () => {
  const { adapter, calls } = adapterWith(() => ({ status: 200, body: { ok: true, reason: "paused" } }));
  await adapter.warmblyDispatch({ action: "pause", reason: "bounce spike" });
  assert.equal(calls.length, 1);
  const headers = (calls[0]!.init.headers ?? {}) as Record<string, string>;
  assert.equal(headers["x-actor-id"], undefined);
  assert.equal(headers["x-actor-kind"], undefined);
  assert.equal((calls[0]!.init as { credentials?: string }).credentials, "include");
});

test("resume without a confirmation token never reaches the wire", async () => {
  const { adapter, calls } = adapterWith(() => ({ status: 200, body: { ok: true } }));
  const result = await adapter.warmblyDispatch({ action: "resume", reason: "incident resolved" });
  assert.equal(result.ok, false);
  assert.match(result.message, /token de confirmação/);
  assert.equal(calls.length, 0, "the resume must not be attempted without the second step");
});

test("a write with no audit reason never reaches the wire", async () => {
  const { adapter, calls } = adapterWith(() => ({ status: 200, body: { ok: true } }));
  for (const action of ["pause", "resume_confirm", "acknowledge"] as const) {
    const result = await adapter.warmblyDispatch({ action, reason: "   ", target_id: "lead-1" });
    assert.equal(result.ok, false, `${action} accepted an empty reason`);
  }
  assert.equal(calls.length, 0);
});

test("resume_confirm surfaces the token so the caller can replay exactly one resume", async () => {
  const { adapter, calls } = adapterWith((url) =>
    url.endsWith("/resume/confirm")
      ? { status: 202, body: { ok: false, confirmation_token: "tok-1", reason: "confirmation required" } }
      : { status: 200, body: { ok: true, reason: "resumed" } },
  );
  const confirmed = await adapter.warmblyDispatch({ action: "resume_confirm", reason: "incident resolved" });
  assert.equal(confirmed.confirmationToken, "tok-1");
  const resumed = await adapter.warmblyDispatch({
    action: "resume",
    reason: "incident resolved",
    confirmation_token: "tok-1",
  });
  assert.equal(resumed.ok, true);
  assert.equal(calls.length, 2);
  assert.ok(calls[1]!.url.endsWith(WARMBLY_DISPATCH_PATHS.resume));
  assert.match(String(calls[1]!.init.body), /tok-1/);
});

test("acknowledge without a target never reaches the wire", async () => {
  const { adapter, calls } = adapterWith(() => ({ status: 200, body: { ok: true } }));
  const result = await adapter.warmblyDispatch({ action: "acknowledge", reason: "seen" });
  assert.equal(result.ok, false);
  assert.equal(calls.length, 0);
});

test("a transport failure is reported as a failure, never as a silent success", async () => {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    throw new Error("boom");
  }) as unknown as typeof fetch;
  const adapter = new HttpControlCenterAdapter({
    baseUrl: "https://ops.confenge.com.br",
    fetchImpl,
    operator: { id: "founder", kind: "human" },
  } as never);
  const result = await adapter.warmblyDispatch({ action: "pause", reason: "bounce spike" });
  assert.equal(result.ok, false);
  assert.match(result.message, /transporte/);
});
