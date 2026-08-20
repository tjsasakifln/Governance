import assert from "node:assert/strict";
import { test } from "node:test";
import { dispatch } from "../src/app-state.ts";
import {
  renderApp,
  renderHasHypothesisDistinction,
  renderHasLabeledFilters,
  renderHasNamedKinds,
  renderHasPreviewTitle,
  renderHasSaveImpact,
  renderHasSecretLeak,
} from "../src/ui/render.ts";
import { DIRECTIVE_KINDS } from "../src/types.ts";
import { makeSession } from "./helpers.ts";

test("list filters are labeled", () => {
  const html = renderApp(makeSession());
  assert.equal(renderHasLabeledFilters(html), true);
  assert.match(html, /<label for="filter-query">Buscar<\/label>/);
  assert.match(html, /<label for="filter-kind">Tipo<\/label>/);
  assert.match(html, /<label for="filter-scope">Escopo<\/label>/);
  assert.match(html, /<label for="filter-status">Status<\/label>/);
  for (const kind of DIRECTIVE_KINDS) {
    assert.match(html, new RegExp(`<option value="${kind}"`));
  }
});

test("create form names every kind, requires confirmation, and shows scope/expiry impact", () => {
  let session = makeSession();
  session = dispatch(session, { type: "open-create" });
  session = dispatch(session, { type: "select-kind", kind: "decision" });
  const html = renderApp(session);
  assert.equal(renderHasNamedKinds(html), true);
  assert.match(html, /id="create-kind-decision"/);
  assert.match(html, /id="create-kind-fact"/);
  assert.match(html, /id="create-kind-hypothesis"/);
  assert.match(html, /Decisão \(autoritativa\)/);
  assert.match(html, /Fato \(autoritativo\)/);
  assert.match(html, /id="kind-confirm"/);
  assert.match(html, /Confirmo que isto é uma DECISÃO/);
  assert.equal(renderHasSaveImpact(html), true);
  assert.match(html, /id="save-impact"/);
  assert.match(html, /Impacto de escopo e expiração \(antes de salvar\)/);
  assert.match(html, /data-impact="scope"/);
  assert.match(html, /data-impact="expiration"/);
  assert.equal(renderHasHypothesisDistinction(html), true);
});

test("hypothesis is distinguishable from authoritative kinds by accessible text, not color-only", () => {
  const session = makeSession();
  const list = renderApp(session);
  assert.match(list, /data-authority="hypothesis"/);
  assert.match(list, /data-authority="authoritative"/);
  assert.match(list, /Hipótese \(não autoritativa — não é fato nem decisão\)/);
  let creating = dispatch(session, { type: "open-create" });
  creating = dispatch(creating, { type: "select-kind", kind: "hypothesis" });
  const form = renderApp(creating);
  assert.match(form, /data-authority="hypothesis"/);
  assert.match(form, /não autoritativa/);
  assert.match(form, /não é fato nem decisão/i);
});

test("founder approval indicator is exposed as a status with an accessible name", () => {
  const html = renderApp(makeSession());
  assert.match(html, /role="status"/);
  assert.match(html, /aria-label="Aprovação founder:/);
  assert.match(html, /data-founder="yes"/);
});

test("agent preview heading uses the required scope title", () => {
  let session = makeSession();
  session = dispatch(session, { type: "open-preview", scope: "finance" });
  const html = renderApp(session);
  assert.equal(renderHasPreviewTitle(html, "finance"), true);
  assert.match(html, /contexto que um agente verá para scope finance/);
  assert.match(html, /data-preview-group="hypotheses"/);
  assert.match(html, /data-preview-group="decisions"/);
  assert.match(html, /data-preview-group="facts"/);
});

test("rendered HTML does not leak secrets", () => {
  const session = dispatch(makeSession(), { type: "open-create" });
  const html = renderApp(session);
  assert.equal(renderHasSecretLeak(html), false);
});
