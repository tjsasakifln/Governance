import assert from "node:assert/strict";
import { test } from "node:test";
import { paintShell, createMemoryRuntime } from "../src/app";
import { createMockAdapter } from "../src/adapters/index";
import { parseHash } from "../src/destinations";

test("commercial surfaces render cohort, pipeline, activity and exception operator forms", () => {
  const adapter = createMockAdapter();
  const root = { innerHTML: "" };
  paintShell(root, adapter, "#/comercial/cohorts");
  assert.match(root.innerHTML, /data-surface="cohorts"/);
  assert.match(root.innerHTML, /Coortes/);
  paintShell(root, adapter, "#/comercial/excecoes");
  assert.match(root.innerHTML, /data-operator-form="ACKNOWLEDGE_EXCEPTION"|Exceções comerciais/);
  assert.match(root.innerHTML, /data-operator-scope="control-center-only"/);
  assert.match(root.innerHTML, /não resolve a exceção no Warmbly/);
  assert.equal(/resolvid[oa] no Warmbly|exception resolved in Warmbly/i.test(root.innerHTML), false);
  paintShell(root, adapter, "#/comercial/pipeline");
  assert.match(root.innerHTML, /Pipeline ativo/);
  paintShell(root, adapter, "#/crescimento");
  assert.match(root.innerHTML, /Funil de crescimento/);
  for (const hop of [
    "search_visibility",
    "click_session",
    "cta",
    "inbound_event",
    "lead",
    "qualified_lead",
    "opportunity",
    "commercial_proposal",
    "client_revenue",
  ]) {
    assert.match(root.innerHTML, new RegExp(`data-growth-hop="${hop}"`));
  }
});

test("parseHash keeps commercial surfaces and client resources", () => {
  assert.equal(parseHash("#/comercial/atividade").surface, "atividade");
  assert.equal(parseHash("#/clientes/acme-industria").resource, "acme-industria");
});

test("memory runtime can navigate commercial surfaces", () => {
  const runtime = createMemoryRuntime("#/comercial");
  assert.equal(runtime.getHash(), "#/comercial");
  runtime.setHash("#/comercial/cohorts");
  assert.equal(runtime.getHash(), "#/comercial/cohorts");
});
