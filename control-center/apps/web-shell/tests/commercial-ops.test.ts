import assert from "node:assert/strict";
import { test } from "node:test";
import { paintShell, createMemoryRuntime } from "../src/app";
import { createMockAdapter } from "../src/adapters/index";
import { parseHash } from "../src/destinations";

function visibleText(html: string): string {
  return html
    .replace(/<details class="tech"[\s\S]*?<\/details>/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ");
}

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

test("cohort contract tokens receive authored labels and future values stay technical", () => {
  const base = createMockAdapter();
  const initial = base.readDestination("comercial");
  assert.ok(initial.ok && !initial.loading && initial.page.commercial);
  if (!initial.ok || initial.loading || !initial.page.commercial) return;
  const page = structuredClone(initial.page);
  const commercial = page.commercial;
  if (!commercial) return;
  commercial.operations = {
    cohorts: {
      mixing_rule: "acquisition_cohorts_and_event_period_metrics_are_labeled_separately",
      acquisition: [
        {
          window: "7d",
          kind: "acquisition_cohort",
          anchor_event: "contact.created_at",
          anchor_label: "Acquisition cohort: contact created_at. Not an event-period metric.",
          source: "control-center.derived_from_warmbly_crm_reads",
          population: 3,
        },
        {
          window: "future",
          kind: "FUTURE_KIND",
          anchor_event: "FUTURE_EVENT",
          anchor_label: "FUTURE_ANCHOR",
          source: "FUTURE_SOURCE",
          population: 1,
        },
      ],
      inbound_truth: {
        configured: true,
        kind: "event_period_funnel",
        anchor_event: "warmbly_inbound_truth_scoreboard",
        anchor_label: "Warmbly inbound-truth scoreboard. Not an acquisition cohort.",
      },
    },
  };
  const adapter = {
    mode: "mock" as const,
    readDestination: () => ({ ok: true as const, loading: false as const, page }),
  };
  const root = { innerHTML: "" };
  paintShell(root, adapter as never, "#/comercial/cohorts");
  const shown = visibleText(root.innerHTML);
  assert.match(shown, /Coortes de aquisição e métricas por período são apresentadas separadamente/);
  assert.match(shown, /coorte de aquisição/);
  assert.match(shown, /Coorte de aquisição ancorada na criação do contato/);
  assert.match(shown, /Placar de mensagens recebidas do Warmbly/);
  assert.match(shown, /tipo de coorte não reconhecido/);
  assert.match(shown, /Referência da métrica não reconhecida/);
  assert.match(shown, /Janela não reconhecida/);
  assert.doesNotMatch(
    shown,
    /acquisition_cohorts_and_event_period_metrics_are_labeled_separately|acquisition_cohort|Acquisition cohort|event_period_funnel|FUTURE_(?:KIND|EVENT|ANCHOR|SOURCE)/,
  );
  assert.match(root.innerHTML, /mixing_rule=acquisition_cohorts_and_event_period_metrics_are_labeled_separately/);
  assert.match(root.innerHTML, /data-cohort-kind="FUTURE_KIND"/);
  assert.match(root.innerHTML, /anchor_label=FUTURE_ANCHOR/);
  assert.match(root.innerHTML, /window=future/);

  (commercial.operations.cohorts as Record<string, unknown>).mixing_rule = "FUTURE_MIXING_RULE";
  paintShell(root, adapter as never, "#/comercial/cohorts");
  assert.match(visibleText(root.innerHTML), /Regra de separação não reconhecida/);
  assert.doesNotMatch(visibleText(root.innerHTML), /FUTURE_MIXING_RULE/);
  assert.match(root.innerHTML, /mixing_rule=FUTURE_MIXING_RULE/);
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
      report_month: "2026-08",
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
        authorized_at: "2026-08-22T10:00:00.000Z",
        expires_at: "2026-08-23T10:00:00.000Z",
        integrity_flags: [],
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
  assert.match(root.innerHTML, /Aceitos pelo SMTP<\/dt><dd>0<\/dd>/);
  assert.match(root.innerHTML, /Rejeições permanentes<\/dt><dd>desconhecido \/ dados ainda incompletos<\/dd>/);
  assert.match(root.innerHTML, /Aceite pelo SMTP não comprova entrega/);
  assert.match(root.innerHTML, /Mês do relatório<\/dt><dd>2026-08<\/dd>/);
  assert.match(root.innerHTML, /Autorizado em<\/dt><dd>2026-08-22T10:00:00.000Z<\/dd>/);
  assert.match(root.innerHTML, /Expira em<\/dt><dd>2026-08-23T10:00:00.000Z<\/dd>/);
  assert.match(root.innerHTML, /Instante de coleta\/observação/);
  assert.match(root.innerHTML, /Estado da autorização<\/dt><dd>ativa<\/dd>/);
  assert.match(root.innerHTML, /Estado do disparo<\/dt><dd>bloqueado fora da janela de envio<\/dd>/);
  assert.match(root.innerHTML, /Rota pessoa identificada diretamente/);
  assert.match(root.innerHTML, /authorization_state=active/);
  assert.match(root.innerHTML, /dispatch_state=blocked_outside_window/);
  assert.doesNotMatch(root.innerHTML, /Rejeições permanentes<\/dt><dd>0<\/dd>/);
});

test("cohort view does not present unproven telemetry as real outcomes", () => {
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
      availability: "UNKNOWN",
      last_update_at: "2026-08-22T18:00:00.000Z",
      current: {
        policy_version: "controlled-email.v1",
        outcomes: { provider_accepted: 99 },
        integrity_flags: ["grant_revoked", "FUTURE_FLAG"],
      },
      rows: [{ route_class: "SHOULD_NOT_RENDER", provider_accepted: 99 }],
    },
  };
  const adapter = {
    mode: "mock" as const,
    readDestination: () => ({ ok: true as const, loading: false as const, page }),
  };
  const root = { innerHTML: "" };
  paintShell(root, adapter as never, "#/comercial/cohorts");
  assert.match(root.innerHTML, /data-controlled-email="unknown"/);
  assert.match(root.innerHTML, /telemetria real não comprovada/);
  assert.match(root.innerHTML, /autorização observada como revogada/);
  assert.match(visibleText(root.innerHTML), /verificação não reconhecida/);
  assert.match(visibleText(root.innerHTML), /Coorte não identificada/);
  assert.doesNotMatch(visibleText(root.innerHTML), /FUTURE_FLAG|UNKNOWN/);
  assert.match(root.innerHTML, /integrity_flags=grant_revoked,FUTURE_FLAG/);
  assert.match(root.innerHTML, /Aceitos pelo SMTP<\/dt><dd>desconhecido \/ dados ainda incompletos<\/dd>/);
  assert.doesNotMatch(root.innerHTML, /SHOULD_NOT_RENDER/);
  assert.doesNotMatch(root.innerHTML, /Primeira coorte real de e-mail/);
});
