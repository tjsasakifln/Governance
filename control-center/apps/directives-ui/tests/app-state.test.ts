import assert from "node:assert/strict";
import { test } from "node:test";
import { dispatch } from "../src/app-state.ts";
import { renderApp } from "../src/ui/render.ts";
import { makeSession } from "./helpers.ts";

test("decision create path: pick kind, confirm, title, body — defaults fill the rest", () => {
  let session = makeSession();
  session = dispatch(session, { type: "open-create" });
  session = dispatch(session, { type: "select-kind", kind: "decision" });
  session = dispatch(session, { type: "set-kind-confirmed", confirmed: true });
  session = dispatch(session, {
    type: "patch-create",
    patch: { title: "Congelar mutações Asaas", body: "Nenhuma escrita Asaas neste cockpit." },
  });
  const before = session.service.list().length;
  session = dispatch(session, { type: "submit-create" });
  assert.equal(session.ui.error, null);
  assert.equal(session.ui.errorCode, null);
  assert.equal(session.ui.screen, "detail");
  assert.ok(session.ui.selectedId);
  const created = session.service.get(session.ui.selectedId ?? "");
  assert.equal(created?.kind, "decision");
  assert.equal(created?.scope, "company");
  assert.equal(created?.status, "active");
  assert.equal(created?.expires_at, null);
  assert.equal(created?.title, "Congelar mutações Asaas");
  assert.equal(session.service.list().length, before + 1);
});

test("submitting a decision without kind confirmation fails and writes nothing", () => {
  let session = makeSession();
  const before = session.service.list().length;
  session = dispatch(session, { type: "open-create" });
  session = dispatch(session, { type: "select-kind", kind: "decision" });
  session = dispatch(session, {
    type: "patch-create",
    patch: { title: "Sem confirmação", body: "Não deve gravar." },
  });
  session = dispatch(session, { type: "submit-create" });
  assert.equal(session.ui.errorCode, "kind_not_confirmed");
  assert.match(session.ui.error ?? "", /Confirme explicitamente que o tipo é decision/);
  assert.equal(session.service.list().length, before);
});

test("changing the kind filter updates the rendered list through the shipped units", () => {
  let session = makeSession();
  session = dispatch(session, { type: "set-kind-filter", kind: "hypothesis" });
  const html = renderApp(session);
  assert.match(html, /cc:directive:01K3CC-OFFER-HYPOTHESIS/);
  assert.doesNotMatch(html, /cc:directive:01K3CC-NO-PROVIDER-MUTATION/);
  assert.match(html, /1 registro/);
});

test("explicit supersede from the UI leaves the prior record superseded", () => {
  let session = makeSession();
  session = dispatch(session, { type: "open-supersede", id: "cc:directive:01K3CC-WARMBLY-CRM" });
  session = dispatch(session, { type: "select-kind", kind: "fact" });
  session = dispatch(session, { type: "set-kind-confirmed", confirmed: true });
  session = dispatch(session, {
    type: "patch-create",
    patch: {
      title: "Warmbly continua o CRM",
      body: "Sucessor do fato comercial. História anterior permanece.",
    },
  });
  session = dispatch(session, { type: "submit-supersede" });
  assert.equal(session.ui.error, null);
  const old = session.service.get("cc:directive:01K3CC-WARMBLY-CRM");
  assert.equal(old?.status, "superseded");
  assert.match(old?.body ?? "", /Commercial pipeline/);
  const successor = session.service.get(session.ui.selectedId ?? "");
  assert.ok(successor?.supersedes?.includes("cc:directive:01K3CC-WARMBLY-CRM"));
  assert.equal(successor?.kind, "fact");
});
