import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryRuntime, mount } from "../src/app";
import { createMockAdapter } from "../src/adapters/index";
import { httpAdapterFor } from "./helpers";
import { renderShell } from "../src/ui/render";
import { presentAgentStatus } from "../src/adapters/map";

test("Comercial page surfaces funnel, pipelines, aging, next action, stalled, drift and Extra histórica", () => {
  const root = { innerHTML: "" };
  const handle = mount(root, createMockAdapter(), createMemoryRuntime("#/comercial"));
  try {
    assert.match(root.innerHTML, /Novos leads/);
    assert.match(root.innerHTML, /Qualificados/);
    assert.match(root.innerHTML, /Oportunidades/);
    assert.match(root.innerHTML, /Propostas/);
    assert.match(root.innerHTML, /Clientes/);
    assert.match(root.innerHTML, /Pipeline nominal/);
    assert.match(root.innerHTML, /Pipeline ponderado \(probabilidade confiável\)/);
    assert.match(root.innerHTML, /Aging/);
    assert.match(root.innerHTML, /Missing next action/);
    assert.match(root.innerHTML, /Stalled stage/);
    assert.match(root.innerHTML, /Offer\/version drift/);
    assert.match(root.innerHTML, /Extra histórica/);
    assert.match(root.innerHTML, /data-public-offer="false"/);
    assert.doesNotMatch(root.innerHTML, /oferta pública da Extra/i);
  } finally {
    handle.unmount();
  }
});

test("Clientes page surfaces saúde, compromissos, owner, due date, entregáveis, blockers, próxima ação, evidência", () => {
  const root = { innerHTML: "" };
  const handle = mount(root, createMockAdapter(), createMemoryRuntime("#/clientes"));
  try {
    assert.match(root.innerHTML, /Acme Indústria/);
    assert.match(root.innerHTML, /Saúde/);
    assert.match(root.innerHTML, /Compromissos/);
    assert.match(root.innerHTML, /Owner/);
    assert.match(root.innerHTML, /Due date/);
    assert.match(root.innerHTML, /Entregáveis/);
    assert.match(root.innerHTML, /Blockers/);
    assert.match(root.innerHTML, /Próxima ação/);
    assert.match(root.innerHTML, /Evidência/);
    assert.match(root.innerHTML, /data-client-source="warmbly"/);
    assert.match(root.innerHTML, /data-client-source="asaas"/);
    assert.match(root.innerHTML, /data-client-source="governance"/);
    assert.match(root.innerHTML, /data-client-source="asaas"[^>]*data-absent="true"/);
  } finally {
    handle.unmount();
  }
});

test("Financeiro page surfaces contracted/billed/paid/received/overdue/receivable/refunds/chargebacks and gates MRR/runway", () => {
  const root = { innerHTML: "" };
  const handle = mount(root, createMockAdapter(), createMemoryRuntime("#/financeiro"));
  try {
    assert.match(root.innerHTML, /Contratado/);
    assert.match(root.innerHTML, /Faturado/);
    assert.match(root.innerHTML, /Pago/);
    assert.match(root.innerHTML, /Efetivamente recebido/);
    assert.match(root.innerHTML, /Vencido/);
    assert.match(root.innerHTML, /A receber/);
    assert.match(root.innerHTML, /Refunds/);
    assert.match(root.innerHTML, /Chargebacks/);
    assert.match(root.innerHTML, /MRR/);
    assert.match(root.innerHTML, /Runway/);
    assert.match(root.innerHTML, /omitido — caixa e despesas não confiáveis/);
    assert.match(root.innerHTML, /data-amount-cents="1500000"/);
    assert.match(root.innerHTML, /Mutações de provedor: forbidden/);
  } finally {
    handle.unmount();
  }
});

test("Engenharia page surfaces repo, branch, PRs, CI, P0/P1, aging, blockers, evidência and hipótese", () => {
  const root = { innerHTML: "" };
  const handle = mount(root, createMockAdapter(), createMemoryRuntime("#/engenharia"));
  try {
    assert.match(root.innerHTML, /Repositório/);
    assert.match(root.innerHTML, /Branch\/default/);
    assert.match(root.innerHTML, />PRs</);
    assert.match(root.innerHTML, />CI</);
    assert.match(root.innerHTML, /P0\/P1/);
    assert.match(root.innerHTML, /Aging/);
    assert.match(root.innerHTML, /Blockers/);
    assert.match(root.innerHTML, /Última evidência/);
    assert.match(root.innerHTML, /Trabalho ativo sem evidência/);
    assert.match(root.innerHTML, /data-hypothesis="true"/);
    assert.match(root.innerHTML, /permanece hipótese/);
  } finally {
    handle.unmount();
  }
});

test("Infra page surfaces HTTP, TLS, Docker, backup, disk/memory, PNCP freshness and partial outage", () => {
  const root = { innerHTML: "" };
  const handle = mount(root, createMockAdapter(), createMemoryRuntime("#/infra"));
  try {
    assert.match(root.innerHTML, />HTTP</);
    assert.match(root.innerHTML, />TLS</);
    assert.match(root.innerHTML, />Docker</);
    assert.match(root.innerHTML, />Backup</);
    assert.match(root.innerHTML, /Disco/);
    assert.match(root.innerHTML, /Memória/);
    assert.match(root.innerHTML, /PNCP freshness/);
    assert.match(root.innerHTML, /Partial outage/);
    assert.match(root.innerHTML, /data-partial-outage="true"/);
  } finally {
    handle.unmount();
  }
});

test("Memória groups decisions, directives, facts, constraints, priorities, risks, hypotheses", () => {
  const root = { innerHTML: "" };
  const handle = mount(root, createMockAdapter(), createMemoryRuntime("#/memoria"));
  try {
    for (const kind of [
      "decision",
      "directive",
      "fact",
      "constraint",
      "priority",
      "risk",
      "hypothesis",
    ]) {
      assert.match(root.innerHTML, new RegExp(`data-memory-kind="${kind}"`));
    }
    assert.match(root.innerHTML, /Decisions/);
    assert.match(root.innerHTML, /Revisões \/ supersession/);
  } finally {
    handle.unmount();
  }
});

test("Agentes page presents RUNNING/DONE/PARTIAL/BLOCKED/FAILED/UNKNOWN and never coerces stale RUNNING to DONE", () => {
  const root = { innerHTML: "" };
  const handle = mount(root, createMockAdapter(), createMemoryRuntime("#/agentes"));
  try {
    assert.match(root.innerHTML, /RUNNING/);
    assert.match(root.innerHTML, /PARTIAL/);
    assert.match(root.innerHTML, /UNKNOWN/);
    assert.match(root.innerHTML, /Agent\/provider/);
    assert.match(root.innerHTML, /Repo\/scope/);
    assert.match(root.innerHTML, /Goal\/campaign/);
    assert.match(root.innerHTML, /residual_work/);
    assert.match(root.innerHTML, /data-stale-running="true"/);
    assert.match(root.innerHTML, /não vira DONE/);
    const running = root.innerHTML.match(/data-status="RUNNING"[\s\S]*?data-freshness="STALE"/);
    assert.ok(running);
  } finally {
    handle.unmount();
  }
  assert.equal(presentAgentStatus("running", "STALE"), "RUNNING");
  assert.equal(presentAgentStatus("done", "FRESH"), "DONE");
  assert.equal(presentAgentStatus("wat", "FRESH"), "UNKNOWN");
});

test("HTTP domain pages populate from Goal 04 fixtures via frozen domain paths", async () => {
  const { adapter, calls } = httpAdapterFor();
  const root = { innerHTML: "" };
  const runtime = createMemoryRuntime("#/financeiro");
  const handle = mount(root, adapter, runtime);
  await new Promise((resolve) => setTimeout(resolve, 20));
  try {
    assert.match(root.innerHTML, /Contratado/);
    assert.match(root.innerHTML, /Efetivamente recebido/);
    assert.match(calls.join("\n"), /\/v1\/domains\/finance/);
    runtime.setHash("#/comercial");
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.match(root.innerHTML, /Novos leads/);
    assert.match(calls.join("\n"), /\/v1\/domains\/commercial/);
  } finally {
    handle.unmount();
  }
});

test("weighted pipeline without reliable probability is omitted", () => {
  const html = renderShell({
    destination: "comercial",
    viewKind: "ready",
    mockScenario: "http",
    adapterMode: "http",
    view: {
      kind: "ready",
      data: {
        id: "comercial",
        label: "Comercial",
        scope: "commercial",
        generated_at: "2026-08-20T18:00:00Z",
        operator: { kind: "human", id: "human:operator" },
        headline: "x",
        attention: [],
        priorities: [],
        commercial: {
          schema_version: "control-center.commercial-snapshot.v1",
          id: "cc:commercial-snapshot:x",
          scope: "commercial",
          generated_at: "2026-08-20T18:00:00Z",
          provenance: {
            source: { system: "warmbly", kind: "crm-read-model", locator: "x" },
            observed_at: "2026-08-20T18:00:00Z",
            freshness_status: "FRESH",
            confidence: 1,
          },
          authority: {
            catalog_authority: "governance",
            commercial_runtime: "warmbly",
            this_document: "read_model",
          },
          pipeline_open_count: 0,
          inbound_unread_count: 0,
          at_risk_client_count: 0,
          pipeline_nominal: { amount_cents: 1, currency: "BRL" },
        },
      },
    },
  });
  assert.match(html, /omitido — probabilidade não confiável/);
});

const IDENTITY_PROVENANCE = {
  source: { system: "warmbly", kind: "crm-read-model", locator: "commercial/pipeline" },
  observed_at: "2026-08-20T18:00:00Z",
  freshness_status: "FRESH",
  confidence: 0.8,
} as const;

function clientesHtml(clients: unknown[]): string {
  return renderShell({
    destination: "clientes",
    viewKind: "ready",
    mockScenario: "http",
    adapterMode: "http",
    view: {
      kind: "ready",
      data: {
        id: "clientes",
        label: "Clientes",
        scope: "clients",
        generated_at: "2026-08-20T18:00:00Z",
        operator: { kind: "human", id: "human:operator" },
        headline: "x",
        attention: [],
        priorities: [],
        clients: clients as never,
      },
    },
  });
}

test("client:unknown is not rendered as an operational client", () => {
  const html = clientesHtml([
    {
      schema_version: "control-center.client-status.v1",
      id: "cc:client-status:unknown",
      scope: "client:unknown",
      client_slug: "unknown",
      display_name: "Cliente",
      lifecycle: "unknown",
      provenance: IDENTITY_PROVENANCE,
      sources: { warmbly: "UNKNOWN", asaas: "UNKNOWN", governance: "UNKNOWN" },
    },
  ]);
  assert.doesNotMatch(html, /<h2 id="clientes-title">Clientes<\/h2>/);
  assert.doesNotMatch(html, /class="card client"/);
});

test("an identity-less record becomes a data-quality queue entry with origin, reason and action", () => {
  const html = clientesHtml([
    {
      schema_version: "control-center.client-status.v1",
      id: "cc:client-status:unknown",
      scope: "client:unknown",
      client_slug: "unknown",
      display_name: "Cliente",
      lifecycle: "unknown",
      provenance: IDENTITY_PROVENANCE,
      sources: { warmbly: "UNKNOWN", asaas: "UNKNOWN", governance: "UNKNOWN" },
    },
  ]);
  assert.match(html, /data-queue="client-identity"/);
  assert.match(html, /data-operational-client="false"/);
  assert.match(html, /Qualidade de dados — identidade de cliente \(1\)/);
  assert.match(html, /Origem/);
  assert.match(html, /warmbly · commercial\/pipeline/);
  assert.match(html, /Motivo/);
  assert.match(html, /Ação necessária/);
  assert.match(html, /identificador ausente ou reservado/);
});

test("real clients keep rendering next to the identity queue", () => {
  const html = clientesHtml([
    {
      schema_version: "control-center.client-status.v1",
      id: "cc:client-status:acme-industria",
      scope: "client:acme-industria",
      client_slug: "acme-industria",
      display_name: "Acme Indústria",
      lifecycle: "active",
      provenance: IDENTITY_PROVENANCE,
      sources: { warmbly: "FRESH", asaas: "UNKNOWN", governance: "UNKNOWN" },
    },
    {
      schema_version: "control-center.client-status.v1",
      id: "cc:client-status:unknown",
      scope: "client:unknown",
      client_slug: "unknown",
      display_name: "Cliente",
      lifecycle: "unknown",
      provenance: IDENTITY_PROVENANCE,
      sources: { warmbly: "UNKNOWN", asaas: "UNKNOWN", governance: "UNKNOWN" },
    },
  ]);
  assert.match(html, /Acme Indústria/);
  assert.match(html, /class="card client"/);
  assert.match(html, /Qualidade de dados — identidade de cliente \(1\)/);
});
