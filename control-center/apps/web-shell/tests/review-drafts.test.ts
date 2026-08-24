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

const LEGACY_ID = "99999999-8888-4777-8666-555555555555";

function reviewSurface(rows: unknown[]): Promise<string> {
  const router = operationalRouter();
  const { fetchImpl } = recordingFetch((path) => {
    if (path.startsWith("/v1/commercial/review-drafts")) return { data: rows };
    return router(path);
  });
  const adapter = createHttpAdapter("http://context.test", fetchImpl, { kind: "human", id: "founder-local" });
  return adapter.readDestination("comercial").then((result) => {
    assert.equal(result.ok, true);
    if (!result.ok || result.loading) throw new Error("comercial não carregou");
    return commercialBlock(result.page.commercial!, "rascunhos");
  });
}

const RICH_DRAFT = {
  id: DRAFT_ID,
  account_id: "account-1",
  recipient: "obras@construtora.test",
  subject: "Laudo estrutural do bloco B",
  body_text: "Olá,\n\nVi o edital publicado ontem.\n\nAbraço.",
  state: "NEEDS_REVIEW",
  purpose: "INITIAL",
  ordinal: 1,
  content_hash: "sha256:exact",
  account: { nome_fantasia: "Construtora Exemplo" },
  fact_used: "Publicou edital de reforma do bloco B em 20/08",
  evidence_ids: ["ev-pncp-1", "ev-pncp-2"],
  fact_source: "fact_to_mention",
  policy_version: "confenge.policy.v3",
  route_class: "GENERIC_COMPANY",
  composer_version: "confenge.composer.v5",
  prompt_version: "confenge.draft.v6",
  editorial_state: "CURRENT",
  editorial_actionable: true,
  editorial_reason_codes: ["FACT_FRESH", "ROUTE_OK"],
  target_fit: { state: "FIT", reason: "porte e setor compatíveis", fresh: true, as_of: "2026-08-20T12:00:00Z" },
};

test("review surface renders the judging context inline, with no details disclosure to open", async () => {
  const html = await reviewSurface([RICH_DRAFT]);
  assert.match(html, /data-review-context="11111111-2222-4333-8444-555555555555"/);
  assert.match(html, /<dt>Fato observado<\/dt><dd>Publicou edital de reforma do bloco B em 20\/08<\/dd>/);
  assert.match(html, /<dt>Proveniência<\/dt><dd>ev-pncp-1, ev-pncp-2 \(origem: fact_to_mention\)<\/dd>/);
  assert.match(html, /<dt>Classe de rota<\/dt><dd>caixa genérica da empresa, como contato@ ou comercial@ \(GENERIC_COMPANY\)<\/dd>/);
  assert.match(html, /<dt>Target fit<\/dt><dd>FIT \(leitura atual; apurado em 2026-08-20T12:00:00Z; porte e setor compatíveis\)<\/dd>/);
  assert.match(html, /<dt>Composer<\/dt><dd>confenge\.composer\.v5 \(prompt: confenge\.draft\.v6\)<\/dd>/);
  assert.match(html, /<dt>Content hash<\/dt><dd>sha256:exact<\/dd>/);
  assert.match(html, /<dt>Estado editorial<\/dt><dd>atual<\/dd>/);
  assert.match(html, /<dt>Reason codes<\/dt><dd>FACT_FRESH; ROUTE_OK<\/dd>/);
  assert.match(html, /data-editorial-state="CURRENT"/);
  assert.match(html, /data-composer-version="confenge\.composer\.v5"/);
  // The message itself is read as text on the list; nothing is folded away.
  assert.match(html, /Vi o edital publicado ontem/);
  assert.doesNotMatch(html, /<details[^>]*>\s*<summary>Mensagem/);
});

test("a CURRENT row keeps the full editable decision form", async () => {
  const html = await reviewSurface([RICH_DRAFT]);
  assert.match(html, new RegExp(`data-review-form="${DRAFT_ID}"`));
  assert.match(html, /name="expected_content_hash" value="sha256:exact"/);
  assert.match(html, /<option value="SAVE_ADJUSTMENT">/);
  assert.match(html, /<option value="APPROVE">/);
  assert.match(html, /<option value="REJECT">/);
  assert.match(html, /name="reason"/);
  assert.match(html, /name="generic_ack"/);
  assert.match(html, /<button type="submit">Registrar decisão<\/button>/);
  assert.match(html, /data-editorial-actionable="true"/);
  // Only subject and body are editable; the judging context is plain text.
  assert.doesNotMatch(html, /<textarea name="subject"[^>]*readonly/);
  assert.match(html, /Aprovar vincula o hash exato e agenda a próxima janela útil\./);
});

test("absent editorial fields render an explicit word instead of undefined", async () => {
  const html = await reviewSurface([{
    id: DRAFT_ID,
    recipient: "contato@example.test",
    subject: "Assunto legado",
    body_text: "Corpo legado.",
    state: "NEEDS_REVIEW",
    purpose: "INITIAL",
    ordinal: 1,
    content_hash: "sha256:legacy",
    account: { nome_fantasia: "Construtora Exemplo" },
  }]);
  assert.doesNotMatch(html, /undefined/);
  assert.doesNotMatch(html, /\[object Object\]/);
  assert.match(html, /<dt>Fato observado<\/dt><dd>ausente<\/dd>/);
  assert.match(html, /<dt>Proveniência<\/dt><dd>ausente<\/dd>/);
  assert.match(html, /<dt>Classe de rota<\/dt><dd>não informado<\/dd>/);
  assert.match(html, /<dt>Target fit<\/dt><dd>não informado<\/dd>/);
  assert.match(html, /<dt>Composer<\/dt><dd>não informado<\/dd>/);
  assert.match(html, /<dt>Reason codes<\/dt><dd>nenhum<\/dd>/);
  assert.match(html, /<dt>Estado editorial<\/dt><dd>atual \(não informado pelo servidor, tratado como atual\)<\/dd>/);
  // An older backend still yields a decidable row.
  assert.match(html, /data-editorial-state="CURRENT"/);
  assert.match(html, /data-editorial-actionable="true"/);
  assert.match(html, new RegExp(`data-review-form="${DRAFT_ID}"`));
  assert.match(html, /data-composer-version=""/);
});

test("a partially reported target fit degrades field by field without crashing", async () => {
  const html = await reviewSurface([{
    ...RICH_DRAFT,
    evidence_ids: [],
    fact_source: "fact_to_mention",
    prompt_version: "",
    target_fit: { state: "FIT" },
  }]);
  assert.doesNotMatch(html, /undefined/);
  assert.match(html, /<dt>Proveniência<\/dt><dd>sem identificador de evidência \(origem: fact_to_mention\)<\/dd>/);
  assert.match(html, /<dt>Composer<\/dt><dd>confenge\.composer\.v5 \(prompt: não informado\)<\/dd>/);
  assert.match(html, /<dt>Target fit<\/dt><dd>FIT \(frescor não informado; apurado em não informado\)<\/dd>/);
});

test("a LEGACY_SUPERSEDED row is auditable but offers no decision control at all", async () => {
  const html = await reviewSurface([{
    ...RICH_DRAFT,
    id: LEGACY_ID,
    subject: "Assunto substituído",
    body_text: "Corpo histórico que segue auditável.",
    editorial_state: "LEGACY_SUPERSEDED",
    editorial_actionable: false,
    editorial_reason_codes: ["SUPERSEDED_BY_NEWER_DRAFT"],
    editorial_notice: "Rascunho substituído por uma recomposição mais recente. Mantido apenas para auditoria.",
  }]);
  assert.match(html, /data-editorial-state="LEGACY_SUPERSEDED"/);
  assert.match(html, /data-editorial-actionable="false"/);
  assert.match(html, /Rascunho substituído por uma recomposição mais recente\. Mantido apenas para auditoria\./);
  assert.match(html, /<dt>Estado editorial<\/dt><dd>histórico, substituído<\/dd>/);
  assert.match(html, /<dt>Reason codes<\/dt><dd>SUPERSEDED_BY_NEWER_DRAFT<\/dd>/);
  // History stays readable.
  assert.match(html, /Corpo histórico que segue auditável\./);
  assert.match(html, /<textarea name="body_text" rows="\d+" readonly>/);
  assert.match(html, /<textarea name="subject" rows="\d+" readonly>/);
  // No decision surface is emitted, not even disabled.
  assert.doesNotMatch(html, new RegExp(`data-review-form="${LEGACY_ID}"`));
  assert.doesNotMatch(html, /SAVE_ADJUSTMENT/);
  assert.doesNotMatch(html, /name="generic_ack"/);
  assert.doesNotMatch(html, /<button type="submit">/);
});

test("a legacy row without an editorial_notice still states why it cannot be decided", async () => {
  const html = await reviewSurface([{ ...RICH_DRAFT, id: LEGACY_ID, editorial_state: "LEGACY_SUPERSEDED" }]);
  assert.match(html, /uma versão mais recente o substituiu/);
  assert.doesNotMatch(html, /<button type="submit">/);
});

test("reason codes are read in Portuguese with the original token beside them", async () => {
  const html = await reviewSurface([{
    ...RICH_DRAFT,
    editorial_reason_codes: ["composer_superseded", "composer_unstamped", "policy_superseded"],
  }]);
  assert.match(
    html,
    /<dt>Reason codes<\/dt><dd>composta por um redator anterior ao vigente \(composer_superseded\); sem carimbo de redator \(composer_unstamped\); criada sob uma policy anterior \(policy_superseded\)<\/dd>/,
  );
  // The untranslated truth stays machine-readable next to the sentence.
  assert.match(html, /data-reason-codes="composer_superseded composer_unstamped policy_superseded"/);
});

test("a reason code with no authored translation is shown verbatim, never dropped", async () => {
  const html = await reviewSurface([{
    ...RICH_DRAFT,
    editorial_reason_codes: ["composer_superseded", "code_the_backend_just_invented"],
  }]);
  assert.match(
    html,
    /<dt>Reason codes<\/dt><dd>composta por um redator anterior ao vigente \(composer_superseded\); code_the_backend_just_invented<\/dd>/,
  );
  // Unknown codes are not doubled up as "label (token)" with the token as the label.
  assert.doesNotMatch(html, /code_the_backend_just_invented \(code_the_backend_just_invented\)/);
  assert.match(html, /data-reason-codes="composer_superseded code_the_backend_just_invented"/);
});

test("every route class the composer emits has a Portuguese reading", async () => {
  const cases: Array<[string, RegExp]> = [
    ["ROLE_OR_DEPARTMENT", /<dd>caixa de cargo ou departamento \(ROLE_OR_DEPARTMENT\)<\/dd>/],
    ["PUBLIC_COMPANY_FREEMAIL", /<dd>empresa em domínio de e-mail gratuito \(PUBLIC_COMPANY_FREEMAIL\)<\/dd>/],
    ["DIRECT_PERSON", /<dd>pessoa identificada diretamente \(DIRECT_PERSON\)<\/dd>/],
  ];
  for (const [routeClass, expected] of cases) {
    const html = await reviewSurface([{ ...RICH_DRAFT, route_class: routeClass }]);
    assert.match(html, expected, `${routeClass} não foi traduzida`);
    assert.match(html, new RegExp(`data-route-class="${routeClass}"`));
  }
});

test("an unrecognized route class falls back to the authored label and keeps the token", async () => {
  const html = await reviewSurface([{ ...RICH_DRAFT, route_class: "ROUTE_THE_BACKEND_JUST_INVENTED" }]);
  assert.match(
    html,
    /<dt>Classe de rota<\/dt><dd>classe de rota não reconhecida \(ROUTE_THE_BACKEND_JUST_INVENTED\)<\/dd>/,
  );
});

test("a historical row translates its reasons and still offers no form", async () => {
  const html = await reviewSurface([{
    ...RICH_DRAFT,
    id: LEGACY_ID,
    editorial_state: "LEGACY_SUPERSEDED",
    editorial_actionable: false,
    editorial_reason_codes: ["composer_superseded", "policy_superseded"],
  }]);
  assert.match(html, /composta por um redator anterior ao vigente \(composer_superseded\)/);
  assert.match(html, /criada sob uma policy anterior \(policy_superseded\)/);
  assert.match(html, /data-editorial-state="LEGACY_SUPERSEDED"/);
  assert.match(html, /data-editorial-actionable="false"/);
  assert.doesNotMatch(html, /<button type="submit">/);
});

test("payload values are escaped before reaching innerHTML", async () => {
  const html = await reviewSurface([{
    ...RICH_DRAFT,
    fact_used: '<img src=x onerror="alert(1)">',
    route_class: "<script>alert(2)</script>",
    evidence_ids: ["<b>ev</b>"],
  }]);
  assert.doesNotMatch(html, /<script>alert\(2\)<\/script>/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x/);
});

test("mixed rows keep decidable and historical drafts side by side", async () => {
  const html = await reviewSurface([
    RICH_DRAFT,
    { ...RICH_DRAFT, id: LEGACY_ID, editorial_state: "LEGACY_SUPERSEDED", editorial_actionable: false },
  ]);
  assert.equal(html.match(/class="card review-draft"/g)?.length, 2);
  assert.equal(html.match(/data-review-form=/g)?.length, 1);
  assert.equal(html.match(/<button type="submit">/g)?.length, 1);
});

test("the empty state survives the new context block", async () => {
  const html = await reviewSurface([]);
  assert.match(html, /Nenhum rascunho aguardando revisão\./);
  assert.match(html, /Aprovar vincula o hash exato e agenda a próxima janela útil\. Nenhum botão envia imediatamente\./);
});
