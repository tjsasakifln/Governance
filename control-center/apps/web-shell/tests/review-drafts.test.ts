import assert from "node:assert/strict";
import { test } from "node:test";
import { bindReviewActions, consumeQueueFocus, consumeReviewFocus } from "../src/app";
import { createHttpAdapter } from "../src/adapters";
import { commercialBlock } from "../src/ui/domains";
import { operatorBanner } from "../src/ui/render";
import { recordingFetch, operationalRouter } from "./helpers";

const DRAFT_ID = "11111111-2222-4333-8444-555555555555";
const HASH = "sha256:exact";

function confirmedDecision(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const observedAt = new Date(Date.now() - 1_000).toISOString();
  const approvedAt = new Date(Date.now() - 2_000).toISOString();
  const dueAt = new Date(Date.now() + 86_400_000).toISOString();
  return {
    schema_version: "control-center.review-decision-receipt.v1",
    outcome: "confirmed",
    action: "APPROVE",
    touchpoint_id: DRAFT_ID,
    expected_content_hash: HASH,
    correlation_id: `review:APPROVE:${DRAFT_ID}:${HASH}`,
    observed_at: observedAt,
    message: `Aprovação confirmada no servidor em QUEUED para ${dueAt}.`,
    readback: { status: "confirmed", detail: "write e readback confirmam a mesma versão persistida" },
    receipt_id: `review:${DRAFT_ID}:2026-08-25T04:00:01Z`,
    content_hash: HASH,
    approved_content_hash: HASH,
    state: "QUEUED",
    due_at: dueAt,
    scheduled_for: dueAt,
    approved_by: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    approved_at: approvedAt,
    ...overrides,
  };
}

test("commercial review surface renders one exact-hash approval inspector without an immediate-send control", async () => {
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
  assert.match(html, /name="action" value="APPROVE"/);
  assert.match(html, /Aprovar e agendar para contato@example\.test/);
  assert.match(html, /data-review-edit="true"/);
  assert.match(html, /data-review-reject="true"/);
  assert.match(html, /sha256:exact/);
  assert.doesNotMatch(html, /enviar agora|dispatch-now/i);
});

test("review decision posts the expected hash and only confirms a canonical receipt", async () => {
  const requests: RequestInit[] = [];
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(init ?? {});
    return new Response(JSON.stringify(confirmedDecision()), { status: 200 });
  }) as typeof fetch;
  const adapter = createHttpAdapter("http://context.test", fetchImpl, { kind: "human", id: "founder-local" });
  const result = await adapter.reviewDraftAction({
    id: DRAFT_ID,
    action: "APPROVE",
    expected_content_hash: HASH,
  });
  assert.equal(result.ok, true);
  assert.match(result.message, /confirmada no servidor/);
  assert.equal(result.outcome, "executed");
  assert.equal(result.readback?.status, "confirmed");
  assert.equal(result.reviewDecision?.state, "QUEUED");
  assert.equal(result.reviewDecision?.approvedContentHash, HASH);
  assert.equal(result.receipt?.writes_to, "warmbly");
  assert.match(String(requests[0]?.body), /sha256:exact/);
  const headers = requests[0]?.headers as Record<string, string>;
  assert.equal(headers["idempotency-key"], `review:APPROVE:${DRAFT_ID}:${HASH}`);

  const replay = await adapter.reviewDraftAction({ id: DRAFT_ID, action: "APPROVE", expected_content_hash: HASH });
  assert.equal(replay.ok, true);
  const replayHeaders = requests[1]?.headers as Record<string, string>;
  assert.equal(replayHeaders["idempotency-key"], headers["idempotency-key"]);
  assert.equal(replay.receipt?.id, result.receipt?.id);

  const html = operatorBanner(result);
  assert.match(html, /Aprovação e agendamento confirmados pelo servidor/);
  assert.match(html, /data-review-decision-receipt="true"/);
  assert.match(html, /data-review-state="QUEUED"/);
  assert.match(html, /data-review-due-at=/);
  assert.match(html, /agendada pelo Warmbly; pausa e kill switch ainda governam a saída/);
  assert.match(html, /write \+ readback canônico confirmados/);
});

test("browser never turns malformed or incomplete 2xx review bodies into success", async (t) => {
  const cases: Array<{ name: string; body?: unknown }> = [
    { name: "empty body", body: undefined },
    { name: "legacy ok boolean", body: { ok: true } },
    { name: "wrong id", body: confirmedDecision({ touchpoint_id: "99999999-8888-4777-8666-555555555555" }) },
    { name: "wrong hash", body: confirmedDecision({ content_hash: "sha256:other" }) },
    { name: "APPROVE not effective", body: confirmedDecision({ state: "NEEDS_REVIEW" }) },
    { name: "QUEUED without due_at", body: confirmedDecision({ due_at: "", scheduled_for: "" }) },
    { name: "readback stale", body: confirmedDecision({ readback: { status: "not_confirmed", detail: "stale" } }) },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const fetchImpl = (async () => scenario.body === undefined
        ? new Response(null, { status: 204 })
        : new Response(JSON.stringify(scenario.body), { status: 200 })) as typeof fetch;
      const adapter = createHttpAdapter("http://context.test", fetchImpl, { kind: "human", id: "founder-local" });
      const result = await adapter.reviewDraftAction({
        id: DRAFT_ID,
        action: "APPROVE",
        expected_content_hash: HASH,
      });
      assert.equal(result.ok, false);
      assert.equal(result.outcome, "unknown");
      assert.match(result.message, /não confirmado|recibo incompatível/i);
      assert.doesNotMatch(result.message, /aprovada e agendada para a próxima janela útil/i);
    });
  }
});

test("server not_confirmed and browser transport failure both say not to repeat", async () => {
  const notConfirmed = confirmedDecision({
    outcome: "not_confirmed",
    message: "Resultado não confirmado. Não repita ainda: readback indisponível.",
    readback: { status: "unavailable", detail: "readback indisponível" },
    receipt_id: undefined,
    state: undefined,
    due_at: undefined,
    scheduled_for: undefined,
  });
  const serverAdapter = createHttpAdapter(
    "http://context.test",
    (async () => new Response(JSON.stringify(notConfirmed), { status: 200 })) as typeof fetch,
    { kind: "human", id: "founder-local" },
  );
  const serverResult = await serverAdapter.reviewDraftAction({
    id: DRAFT_ID,
    action: "APPROVE",
    expected_content_hash: HASH,
  });
  assert.equal(serverResult.ok, false);
  assert.equal(serverResult.readback?.status, "unavailable");
  assert.match(serverResult.message, /não repita ainda/i);
  const unconfirmedHtml = operatorBanner(serverResult);
  assert.match(unconfirmedHtml, /Resultado não confirmado/);
  assert.match(unconfirmedHtml, /continua em Ação necessária/);
  assert.match(unconfirmedHtml, /Não repita agora/);

  const transportAdapter = createHttpAdapter(
    "http://context.test",
    (async () => { throw new Error("timeout pós-write"); }) as typeof fetch,
    { kind: "human", id: "founder-local" },
  );
  const transportResult = await transportAdapter.reviewDraftAction({
    id: DRAFT_ID,
    action: "APPROVE",
    expected_content_hash: HASH,
  });
  assert.equal(transportResult.ok, false);
  assert.equal(transportResult.code, "browser_transport");
  assert.match(transportResult.message, /não repita ainda/i);
});

test("review submit disables every control immediately and ignores a second click", async () => {
  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  let painted = 0;
  const controls = Array.from({ length: 6 }, () => ({ value: "", disabled: false, textContent: "" }));
  const fields: Record<string, { value: string; disabled?: boolean; textContent?: string }> = {
    action: { value: "APPROVE" },
    expected_content_hash: { value: HASH },
    subject: { value: "Assunto" },
    body_text: { value: "Corpo" },
    original_subject: { value: "Assunto" },
    original_body_text: { value: "Corpo" },
    reason: { value: "" },
    generic_ack: { value: "true" },
    submit: controls[0]!,
  };
  let listener: ((event: Event) => void) | undefined;
  const form = {
    addEventListener(_type: string, next: (event: Event) => void): void { listener = next; },
    getAttribute(name: string): string | null { return name === "data-review-form" ? DRAFT_ID : null; },
    setAttribute(): void {},
    querySelector(selector: string) {
      if (selector === 'button[type="submit"]') return fields.submit!;
      const name = selector.match(/name="([^"]+)"/)?.[1] ?? "";
      return fields[name] ?? null;
    },
    querySelectorAll(): typeof controls { return controls; },
  };
  const adapter = {
    reviewDraftAction: async () => {
      calls += 1;
      await held;
      return { ok: true, path: "/review", kind: "nota" as const, message: "confirmado" };
    },
  };
  bindReviewActions({ innerHTML: "", querySelectorAll: () => [form] } as never, adapter as never, () => { painted += 1; });
  const event = { preventDefault(): void {} } as unknown as Event;
  listener?.(event);
  listener?.(event);
  assert.equal(calls, 1);
  assert.equal(controls.every((control) => control.disabled), true);
  assert.equal(fields.submit?.textContent, "Confirmando no servidor…");
  release?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(painted, 1);
});

test("a confirmed decision navigates to the next actionable draft", async () => {
  const nextId = "22222222-3333-4444-8555-666666666666";
  const controls = Array.from({ length: 5 }, () => ({ value: "", disabled: false, textContent: "" }));
  const fields: Record<string, { value: string; disabled?: boolean; textContent?: string }> = {
    action: { value: "APPROVE" },
    expected_content_hash: { value: HASH },
    next_review_id: { value: nextId },
    subject: { value: "Assunto" },
    body_text: { value: "Corpo" },
    original_subject: { value: "Assunto" },
    original_body_text: { value: "Corpo" },
    reason: { value: "" },
    submit: controls[0]!,
  };
  let listener: ((event: Event) => void) | undefined;
  const form = {
    addEventListener(_type: string, next: (event: Event) => void): void { listener = next; },
    getAttribute(name: string): string | null { return name === "data-review-form" ? DRAFT_ID : null; },
    setAttribute(): void {},
    querySelector(selector: string) {
      if (selector === 'button[type="submit"]') return fields.submit!;
      const name = selector.match(/name="([^"]+)"/)?.[1] ?? "";
      return fields[name] ?? null;
    },
    querySelectorAll(): typeof controls { return controls; },
  };
  let painted = 0;
  let destination = "";
  const adapter = {
    reviewDraftAction: async () => ({ ok: true, path: "/review", kind: "nota" as const, message: "confirmado" }),
  };
  bindReviewActions(
    { innerHTML: "", querySelectorAll: () => [form] } as never,
    adapter as never,
    () => { painted += 1; },
    (hash) => { destination = hash; },
  );
  listener?.({ preventDefault(): void {} } as unknown as Event);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(destination, `#/comercial/rascunhos?resource=${nextId}&focus=review`);
  assert.equal(painted, 0);
});

test("the post-decision focus marker focuses the inspector once and is removed", () => {
  let focused = 0;
  let scrolled = 0;
  let replaced = "";
  const inspector = {
    addEventListener(): void {},
    getAttribute(): string | null { return null; },
    focus(): void { focused += 1; },
    scrollIntoView(): void { scrolled += 1; },
  };
  consumeReviewFocus(
    { innerHTML: "", querySelectorAll: () => [inspector] } as never,
    `#/comercial/rascunhos?resource=${DRAFT_ID}&focus=review`,
    (hash) => { replaced = hash; },
  );
  assert.equal(focused, 1);
  assert.equal(scrolled, 1);
  assert.equal(replaced, `#/comercial/rascunhos?resource=${DRAFT_ID}`);
  assert.equal(
    consumeQueueFocus(
      { innerHTML: "", querySelectorAll: () => [inspector] } as never,
      `#/comercial/rascunhos?resource=${DRAFT_ID}&focus=review`,
      true,
      () => { throw new Error("activity focus must not consume review focus"); },
    ),
    false,
  );
  assert.equal(focused, 1);
});

test("unsaved edits must be persisted and reread before APPROVE", () => {
  let called = false;
  let painted = 0;
  const fields: Record<string, { value: string }> = {
    action: { value: "APPROVE" },
    expected_content_hash: { value: HASH },
    subject: { value: "Assunto alterado" },
    body_text: { value: "Corpo" },
    original_subject: { value: "Assunto original" },
    original_body_text: { value: "Corpo" },
    reason: { value: "" },
    generic_ack: { value: "false" },
  };
  let listener: ((event: Event) => void) | undefined;
  const form = {
    addEventListener(_type: string, next: (event: Event) => void): void { listener = next; },
    getAttribute(): string { return DRAFT_ID; },
    querySelector(selector: string) {
      const name = selector.match(/name="([^"]+)"/)?.[1] ?? "";
      return fields[name] ?? null;
    },
  };
  const adapter = { reviewDraftAction: async () => { called = true; throw new Error("must not run"); } };
  bindReviewActions({ innerHTML: "", querySelectorAll: () => [form] } as never, adapter as never, () => { painted += 1; });
  listener?.({ preventDefault(): void {} } as unknown as Event);
  assert.equal(called, false);
  assert.equal(painted, 1);
  assert.equal((adapter as { lastOperatorResult?: { code?: string } }).lastOperatorResult?.code, "review_adjustment_not_saved");
});

const LEGACY_ID = "99999999-8888-4777-8666-555555555555";

function reviewSurface(rows: unknown[], resource: string | null = null, query: string | null = null): Promise<string> {
  const router = operationalRouter();
  const { fetchImpl } = recordingFetch((path) => {
    if (path.startsWith("/v1/commercial/review-drafts")) return { data: rows };
    return router(path);
  });
  const adapter = createHttpAdapter("http://context.test", fetchImpl, { kind: "human", id: "founder-local" });
  return adapter.readDestination("comercial").then((result) => {
    assert.equal(result.ok, true);
    if (!result.ok || result.loading) throw new Error("comercial não carregou");
    return commercialBlock(result.page.commercial!, "rascunhos", resource, query);
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
  assert.match(html, /<dt>Estado editorial<\/dt><dd>atual<\/dd>/);
  // Hash e versão são prova de auditoria, não entrada da decisão: vão para o
  // detalhe técnico recolhido, não para a tabela visível.
  assert.doesNotMatch(html, /<dt>Content hash<\/dt>/);
  assert.doesNotMatch(html, /<dt>Composer<\/dt>/);
  assert.match(html, /<dt>content_hash<\/dt><dd><code>sha256:exact<\/code><\/dd>/);
  assert.match(html, /<dt>composer_version<\/dt><dd><code>confenge\.composer\.v5<\/code><\/dd>/);
  assert.match(html, /<dt>prompt_version<\/dt><dd><code>confenge\.draft\.v6<\/code><\/dd>/);
  assert.match(html, /<details class="tech" data-tech="review-draft">/);
  assert.match(html, /<dt>Reason codes<\/dt><dd>FACT_FRESH; ROUTE_OK<\/dd>/);
  assert.match(html, /data-editorial-state="CURRENT"/);
  assert.match(html, /data-composer-version="confenge\.composer\.v5"/);
  // The message itself is read as text on the list; nothing is folded away.
  assert.match(html, /Vi o edital publicado ontem/);
  assert.doesNotMatch(html, /<details[^>]*>\s*<summary>Mensagem/);
});

test("a CURRENT row exposes approval as the primary action without a decision dropdown", async () => {
  const html = await reviewSurface([RICH_DRAFT]);
  assert.match(html, new RegExp(`data-review-form="${DRAFT_ID}"`));
  assert.match(html, /name="expected_content_hash" value="sha256:exact"/);
  assert.match(html, /name="action" value="APPROVE"/);
  assert.match(html, /data-approve-submit="true">Aprovar e agendar para obras@construtora\.test<\/button>/);
  assert.match(html, /data-review-edit="true"/);
  assert.match(html, /data-review-reject="true"/);
  assert.doesNotMatch(html, /<select name="action">/);
  assert.doesNotMatch(html, /name="reason"/);
  assert.doesNotMatch(html, /name="generic_ack"/);
  assert.match(html, /data-editorial-actionable="true"/);
  assert.match(html, /data-review-mode="approve"/);
  assert.match(html, /Aprovar vincula o hash exato e agenda a próxima janela útil\./);
});

test("edit and reject modes keep one explicit exact-hash form", async () => {
  const edit = await reviewSurface([RICH_DRAFT], DRAFT_ID, `resource=${DRAFT_ID}&mode=edit`);
  assert.equal(edit.match(/data-review-form=/g)?.length, 1);
  assert.match(edit, /data-review-mode="edit"/);
  assert.match(edit, /name="action" value="SAVE_ADJUSTMENT"/);
  assert.match(edit, /<textarea name="subject" rows="\d+">Laudo estrutural/);
  assert.match(edit, /<textarea name="body_text" rows="\d+">Olá,/);
  assert.match(edit, /Salvar ajuste/);
  assert.doesNotMatch(edit, /name="generic_ack"/);

  const reject = await reviewSurface([RICH_DRAFT], DRAFT_ID, `resource=${DRAFT_ID}&mode=reject`);
  assert.equal(reject.match(/data-review-form=/g)?.length, 1);
  assert.match(reject, /data-review-mode="reject"/);
  assert.match(reject, /name="action" value="REJECT"/);
  assert.match(reject, /Motivo para reescrita/);
  assert.match(reject, /Rejeitar e solicitar reescrita/);
  assert.doesNotMatch(reject, /<select name="action">/);
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
  assert.match(html, /<dt>Estado editorial<\/dt><dd>atual \(não informado pelo servidor, tratado como atual\)<\/dd>/);
  // Ausência que não muda a decisão não vira linha: some do card.
  assert.doesNotMatch(html, /<dt>Target fit<\/dt>/);
  assert.doesNotMatch(html, /<dt>Composer<\/dt>/);
  assert.doesNotMatch(html, /<dt>Reason codes<\/dt>/);
  // Fato e proveniência faltando debaixo de um corpo escrito é dito em voz alta.
  assert.match(html, /data-fact-missing="true"/);
  assert.match(html, /nem o fato observado nem a proveniência dele/);
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
  assert.match(html, /<dt>composer_version<\/dt><dd><code>confenge\.composer\.v5<\/code><\/dd>/);
  assert.doesNotMatch(html, /<dt>prompt_version<\/dt>/);
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
  assert.match(html, /data-review-readonly=/);
  assert.match(html, /data-exact-body="true"/);
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
  assert.equal(html.match(/data-review-list-item=/g)?.length, 2);
  assert.equal(html.match(/data-review-inspector=/g)?.length, 1);
  assert.equal(html.match(/data-review-form=/g)?.length, 1);
  assert.equal(html.match(/<button type="submit"/g)?.length, 1);
});

test("a deep link selects one inspector and an absent resource falls back safely", async () => {
  const secondId = "22222222-3333-4444-8555-666666666666";
  const rows = [RICH_DRAFT, { ...RICH_DRAFT, id: secondId, recipient: "segunda@empresa.test" }];
  const selected = await reviewSurface(rows, secondId, `resource=${secondId}`);
  assert.match(selected, new RegExp(`data-review-row="${secondId}"[^>]+aria-current="page"`));
  assert.match(selected, new RegExp(`data-review-inspector="${secondId}"`));
  assert.doesNotMatch(selected, /data-review-selection-fallback/);

  const missing = await reviewSurface(rows, "draft-inexistente", "resource=draft-inexistente");
  assert.match(missing, /data-review-selection-fallback="true"/);
  assert.match(missing, new RegExp(`data-review-inspector="${DRAFT_ID}"`));
});

test("0, 1, 55, 100 and 500 rows never create a form per backlog item", async () => {
  for (const size of [0, 1, 55, 100, 500]) {
    const rows = Array.from({ length: size }, (_, index) => ({
      ...RICH_DRAFT,
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      account_id: `account-${index}`,
      account: { nome_fantasia: `Empresa ${index}` },
      recipient: `contato-${index}@example.test`,
      content_hash: `sha256:${index}`,
    }));
    const html = await reviewSurface(rows);
    assert.equal(html.match(/data-review-list-item=/g)?.length ?? 0, size, `${size} linhas`);
    assert.equal(html.match(/data-review-inspector=/g)?.length ?? 0, size === 0 ? 0 : 1, `${size} inspectors`);
    assert.equal(html.match(/data-review-form=/g)?.length ?? 0, size === 0 ? 0 : 1, `${size} forms`);
    assert.ok((html.match(/<textarea/g)?.length ?? 0) <= 4, `${size} linhas não multiplicam textareas`);
  }
});

test("um rascunho com fato e proveniência não ganha alerta de evidência inventado", async () => {
  const html = await reviewSurface([RICH_DRAFT]);
  assert.doesNotMatch(html, /data-fact-missing="true"/);
});

test("só a proveniência faltando é dita sem misturar com o fato", async () => {
  const html = await reviewSurface([{ ...RICH_DRAFT, evidence_ids: [], fact_source: "" }]);
  assert.match(html, /data-fact-missing="true"/);
  assert.match(html, /não enviou a proveniência do fato/);
  assert.match(html, /<dt>Fato observado<\/dt><dd>Publicou edital de reforma do bloco B em 20\/08<\/dd>/);
});

test("um rascunho histórico mantém a auditoria recolhida e nenhuma decisão", async () => {
  const html = await reviewSurface([{
    ...RICH_DRAFT,
    id: LEGACY_ID,
    editorial_state: "LEGACY_SUPERSEDED",
    editorial_actionable: false,
  }]);
  assert.match(html, /<details class="tech" data-tech="review-draft">/);
  assert.match(html, /<dt>content_hash<\/dt><dd><code>sha256:exact<\/code><\/dd>/);
  assert.match(html, /<dt>editorial_state<\/dt><dd><code>LEGACY_SUPERSEDED<\/code><\/dd>/);
  assert.doesNotMatch(html, /<button type="submit">/);
});

test("the empty state survives the new context block", async () => {
  const html = await reviewSurface([]);
  assert.match(html, /Nenhum rascunho aguardando revisão\./);
  assert.match(html, /Aprovar vincula o hash exato e agenda a próxima janela útil\. Nenhum botão envia imediatamente\./);
});
