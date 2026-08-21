import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AUTHORIZED_WRITE_PATH,
  WRITE_SHORTCUT_DIRECTIVE_KIND,
  WRITE_SHORTCUT_KINDS,
  createHttpAdapter,
  isAuthorizedWritePath,
} from "../src/adapters/index";
import { jsonResponse } from "./helpers";

test("write shortcuts POST only authorized Context Service paths and never provider verbs", async () => {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ url, method, body });
    return jsonResponse({ id: "cc:directive:written" }, 201);
  }) as typeof fetch;
  const adapter = createHttpAdapter("http://127.0.0.1:8787", fetchImpl, {
    kind: "human",
    id: "founder-local",
  });
  for (const kind of WRITE_SHORTCUT_KINDS) {
    const result = await adapter.writeShortcut(kind, { title: `t ${kind}`, body: "corpo do atalho" });
    assert.equal(result.ok, true, kind);
    assert.equal(result.path, AUTHORIZED_WRITE_PATH);
  }
  assert.equal(calls.length, 4);
  for (const call of calls) {
    assert.equal(call.method, "POST");
    assert.equal(isAuthorizedWritePath(new URL(call.url).pathname), true);
    assert.equal(call.url.endsWith("/v1/directives"), true);
    assert.doesNotMatch(call.url, /asaas|checkout|refund|cobranca|cancelamento/i);
    const body = call.body as { kind: string; source: { kind: string } };
    assert.ok(Object.values(WRITE_SHORTCUT_DIRECTIVE_KIND).includes(body.kind as never));
    assert.equal(body.source.kind, "founder-shortcut");
  }
  assert.equal(WRITE_SHORTCUT_DIRECTIVE_KIND.decision, "decision");
  assert.equal(WRITE_SHORTCUT_DIRECTIVE_KIND.nota, "fact");
  assert.equal(WRITE_SHORTCUT_DIRECTIVE_KIND.risco, "risk");
  assert.equal(WRITE_SHORTCUT_DIRECTIVE_KIND.hipotese, "hypothesis");
});
