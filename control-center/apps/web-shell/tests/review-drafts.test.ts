import assert from "node:assert/strict";
import { test } from "node:test";
import { createHttpAdapter } from "../src/adapters";
import { commercialBlock } from "../src/ui/domains";
import { recordingFetch, operationalRouter } from "./helpers";

const DRAFT_ID = "11111111-2222-4333-8444-555555555555";

test("commercial review surface renders editable exact-hash decisions without an immediate-send control", async () => {
  const router = operationalRouter();
  const { fetchImpl } = recordingFetch((path) => {
    if (path.startsWith("/v1/commercial/review-drafts")) {
      return { items: [{
        id: DRAFT_ID,
        account_id: "account-1",
        recipient: "contato@example.test",
        subject: "Reajuste do contrato público",
        body_text: "Olá,\n\nMensagem em revisão.",
        state: "NEEDS_REVIEW",
        purpose: "INITIAL",
        ordinal: 1,
        content_hash: "sha256:exact",
        account: { nome_fantasia: "Construtora Exemplo" },
      }] };
    }
    return router(path);
  });
  const adapter = createHttpAdapter("http://context.test", fetchImpl, { kind: "human", id: "founder-local" });
  const result = await adapter.readDestination("comercial");
  assert.equal(result.ok, true);
  if (!result.ok || result.loading) return;
  const html = commercialBlock(result.page.commercial!, "rascunhos");
  assert.match(html, new RegExp(`data-review-form="${DRAFT_ID}"`));
  assert.match(html, /SAVE_ADJUSTMENT/);
  assert.match(html, /APPROVE/);
  assert.match(html, /REJECT/);
  assert.match(html, /sha256:exact/);
  assert.doesNotMatch(html, /enviar agora|dispatch-now/i);
});

test("review decision posts the expected hash and reports next-window scheduling", async () => {
  let request: RequestInit | undefined;
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    request = init;
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;
  const adapter = createHttpAdapter("http://context.test", fetchImpl, { kind: "human", id: "founder-local" });
  const result = await adapter.reviewDraftAction({
    id: DRAFT_ID,
    action: "APPROVE",
    expected_content_hash: "sha256:exact",
  });
  assert.equal(result.ok, true);
  assert.match(result.message, /próxima janela útil/);
  assert.match(String(request?.body), /sha256:exact/);
  const headers = request?.headers as Record<string, string>;
  assert.match(String(headers["idempotency-key"]), /sha256:exact/);
});
