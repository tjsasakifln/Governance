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
  const cohortsHtml = root.innerHTML;
  const subnavAt = cohortsHtml.indexOf('aria-label="Superfícies comerciais"');
  const recorteAt = cohortsHtml.indexOf('id="comercial-recorte"');
  assert.equal(recorteAt, -1);
  assert.equal(subnavAt > 0, true);
  paintShell(root, adapter, "#/comercial/excecoes");
  assert.match(root.innerHTML, /data-operator-form="ACKNOWLEDGE_EXCEPTION"|Exceções comerciais/);
  assert.match(root.innerHTML, /data-operator-scope="control-center-only"/);
  assert.match(root.innerHTML, /não resolve a exceção no Warmbly/);
  assert.equal(/resolvid[oa] no Warmbly|exception resolved in Warmbly/i.test(root.innerHTML), false);
  paintShell(root, adapter, "#/comercial");
  const visao = root.innerHTML;
  assert.equal(visao.indexOf('aria-label="Superfícies comerciais"') < visao.indexOf('id="comercial-recorte"'), true);
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

test("cohort decision view renders explicit zero but never turns UNKNOWN into zero", () => {
  const base = createMockAdapter();
  const initial = base.readDestination("comercial");
  assert.equal(initial.ok, true);
  if (!initial.ok || !initial.page || !initial.page.commercial) return;
  const page = structuredClone(initial.page);
  const commercial = page.commercial;
  if (!commercial) return;
  commercial.operations = {
    cohorts: { acquisition: [] },
    controlled_outbound: {
      availability: "OBSERVED",
      last_update_at: "2026-08-22T18:00:00.000Z",
      current: {
        cohort_id: "cohort-real-10",
        cohort_hash: "sha256:cohort",
        policy_version: "controlled-email.v1",
        authorized_quantity: 10,
        sent: 0,
        reserved: 0,
        max_daily_volume: 10,
        authorization_state: "active",
        route_class_distribution: { DIRECT_PERSON: 1 },
        dispatch: { state: "blocked_outside_window" },
        outcomes: {
          provider_accepted: 0,
          hard_bounce: null,
          soft_bounce: null,
          reply: null,
          positive_reply: null,
          opt_out: null,
        },
      },
      rows: [],
    },
  };
  const adapter = {
    mode: "mock" as const,
    readDestination: () => ({ ok: true as const, loading: false as const, page }),
  };
  const root = { innerHTML: "" };
  paintShell(root, adapter as never, "#/comercial/cohorts");
  assert.match(root.innerHTML, /Enviados<\/dt><dd>0<\/dd>/);
  assert.match(root.innerHTML, /SMTP accepted<\/dt><dd>0<\/dd>/);
  assert.match(root.innerHTML, /Hard bounce<\/dt><dd>UNKNOWN \/ dados ainda incompletos<\/dd>/);
  assert.match(root.innerHTML, /SMTP accepted não é delivery/);
  assert.doesNotMatch(root.innerHTML, /Hard bounce<\/dt><dd>0<\/dd>/);
});
