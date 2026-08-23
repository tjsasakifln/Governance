import assert from "node:assert/strict";
import { test } from "node:test";
import type { CommercialSnapshot } from "../src/types";
import { commercialBlock } from "../src/ui/domains";

const OBSERVED_AT = "2026-08-22T20:00:00Z";
const IDENTITY = {
  correlation_id: "corr_extra_sbx_week_2026_34",
  account_id: "acc_extra_sbx_001",
  opportunity_id: "opp_extra_sbx_001",
  offer_id: "CFG-DIAG-EXP-v1",
  proposal_id: "prop_extra_sbx_001",
  charge_id: "charge_asaas_sbx_001",
  payment_id: "UNKNOWN",
};

function chainFor(receipt: Record<string, unknown>, paymentId = "UNKNOWN"): Record<string, unknown> {
  return {
    schema_version: "control-center.weekly-revenue-chain.v1",
    canonical_identity: { ...IDENTITY, payment_id: paymentId },
    latest_deliverable: { availability: "OBSERVED", value: "deliverable_weekly_sbx_001" },
    latest_evidence: { availability: "OBSERVED", value: "evidence_sandbox_fixture_001" },
    decision: { availability: "OBSERVED", value: "WAIT" },
    responsible: { availability: "OBSERVED", value: "role_commercial_owner" },
    deadline: { availability: "OBSERVED", value: "2026-08-24T20:59:59Z" },
    next_action: { availability: "OBSERVED", value: "human_review_commercial_terms" },
    proposal: { availability: "OBSERVED", value: "prop_extra_sbx_001" },
    charge: {
      availability: "OBSERVED",
      id: "charge_asaas_sbx_001",
      status: "confirmed",
      amount_cents: 800000,
      currency: "BRL",
      observed_at: "2026-08-22T19:58:00Z",
    },
    receipt,
    held: false,
    synthetic: false,
    source: {
      system: "warmbly",
      surface: "GET /v1/confenge/intel/executive?include_synthetic=0",
      contract: "confenge.commercial_intel.v1",
      month: "2026-08",
      observed_at: OBSERVED_AT,
      include_synthetic: false,
    },
    authority: {
      operation_and_visualization: "governance-control-center",
      action_and_outcome: "warmbly",
      financial_facts: "asaas",
    },
  };
}

function htmlForRows(rows: unknown[]): string {
  return commercialBlock({
    schema_version: "control-center.commercial-snapshot.v1",
    id: "cc:commercial-snapshot:extra-weekly-sandbox",
    scope: "commercial",
    generated_at: OBSERVED_AT,
    provenance: {
      source: { system: "warmbly", kind: "commercial-intel", locator: "/v1/confenge/intel/executive" },
      observed_at: OBSERVED_AT,
      freshness_status: "FRESH",
      confidence: 1,
    },
    authority: {
      catalog_authority: "governance",
      commercial_runtime: "warmbly",
      this_document: "read_model",
    },
    operations: { overview: {}, weekly_revenue_chains: rows },
  } as CommercialSnapshot, "visao");
}

function htmlFor(receipt: Record<string, unknown>, paymentId = "UNKNOWN"): string {
  return htmlForRows([chainFor(receipt, paymentId)]);
}

test("a cadeia semanal apresenta controle em pt-BR e mantém recebimento ausente sem inventar zero", () => {
  const html = htmlFor({ availability: "UNKNOWN" });
  assert.match(html, /data-weekly-revenue-chain-count="1"/);
  assert.match(html, /Aguardando decisão humana/);
  assert.match(html, /Responsável[\s\S]{0,100}responsável comercial/);
  assert.match(html, /Próxima ação[\s\S]{0,140}revisar os termos comerciais manualmente/);
  assert.match(html, /Cobrança[\s\S]{0,160}confirmada · BRL 8\.000,00/);
  assert.match(html, /Recebimento<\/dt><dd>sem dados<\/dd>/);
  assert.match(html, /Retenção<\/dt><dd>sem retenção observada<\/dd>/);
  assert.doesNotMatch(html, /Recebimento<\/dt><dd>[^<]*0,00/);
  assert.match(html, /Período da origem<\/dt><dd>08\/2026/);
  assert.match(html, /Coletado em[\s\S]{0,100}22\/08\/2026/);
  assert.match(html, /Asaas é a autoridade dos fatos financeiros/);
  assert.match(html, /<details[^>]*data-technical-detail="weekly-revenue"/);
  assert.match(html, /Identificadores e proveniência técnica/);
  assert.match(html, /corr_extra_sbx_week_2026_34/);
});

test("a mesma correlação mostra zero somente quando valor e moeda foram observados", () => {
  const html = htmlFor({
    availability: "OBSERVED",
    id: "payment_asaas_sbx_001",
    status: "received",
    amount_cents: 0,
    currency: "BRL",
    observed_at: "2026-08-22T19:59:00Z",
  }, "payment_asaas_sbx_001");
  assert.match(html, /data-correlation-id="corr_extra_sbx_week_2026_34"/);
  assert.match(html, /Recebimento[\s\S]{0,160}recebido · BRL 0,00/);
  assert.match(html, /ID financeiro do recebimento[\s\S]{0,120}payment_asaas_sbx_001/);
});

test("fato financeiro só aparece quando o ID do provedor coincide com a identidade canônica", () => {
  const html = htmlFor({
    availability: "OBSERVED",
    id: "payment_asaas_other_account",
    status: "received",
    amount_cents: 9900,
    currency: "BRL",
  }, "payment_asaas_sbx_001");
  const beforeTechnical = html.slice(0, html.indexOf("Identificadores e proveniência técnica"));
  assert.match(beforeTechnical, /data-absent="true"><dt>Recebimento<\/dt><dd>sem dados<\/dd>/);
  assert.doesNotMatch(beforeTechnical, /BRL 99,00/);
  assert.match(html, /ID financeiro do recebimento[\s\S]{0,120}payment_asaas_other_account/);
});

test("timestamps financeiros hostis, impossíveis ou futuros falham fechados sem vazar no HTML", () => {
  const invalidInstants = [
    "person@example.com",
    "2026-02-30T19:59:00Z",
    "2026-08-22T20:00:01Z",
  ];
  for (const kind of ["charge", "receipt"] as const) {
    for (const observedAt of invalidInstants) {
      const paymentId = kind === "receipt" ? "payment_asaas_sbx_001" : "UNKNOWN";
      const chain = chainFor({ availability: "UNKNOWN" }, paymentId);
      const fact = {
        availability: "OBSERVED",
        id: kind === "charge" ? "charge_asaas_sbx_001" : paymentId,
        status: kind === "charge" ? "confirmed" : "received",
        amount_cents: 0,
        currency: "BRL",
        observed_at: observedAt,
      };
      chain[kind] = fact;
      const html = htmlForRows([chain]);
      const label = kind === "charge" ? "Cobrança" : "Recebimento";
      const beforeTechnical = html.slice(0, html.indexOf("Identificadores e proveniência técnica"));
      assert.match(beforeTechnical, new RegExp(`data-absent="true"><dt>${label}<\\/dt><dd>sem dados<\\/dd>`));
      assert.doesNotMatch(beforeTechnical, /BRL 0,00/);
      assert.doesNotMatch(html, new RegExp(observedAt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  }
});

test("tokens futuros ficam autorais e o valor bruto permanece apenas no detalhe técnico", () => {
  const chain = chainFor({ availability: "UNKNOWN" });
  chain.decision = { availability: "OBSERVED", value: "ESCALATE" };
  chain.responsible = { availability: "OBSERVED", value: "role_future_owner" };
  chain.next_action = { availability: "OBSERVED", value: "future_action" };
  chain.charge = {
    availability: "OBSERVED",
    id: "charge_asaas_sbx_001",
    status: "future_provider_state",
    amount_cents: 800000,
    currency: "BRL",
  };
  const html = htmlForRows([chain]);
  const beforeTechnical = html.slice(0, html.indexOf("Identificadores e proveniência técnica"));
  const visibleBeforeTechnical = beforeTechnical.replace(/<[^>]*>/g, " ");
  assert.match(visibleBeforeTechnical, /estado não reconhecido/);
  for (const raw of ["ESCALATE", "role_future_owner", "future_action", "future_provider_state"]) {
    assert.doesNotMatch(visibleBeforeTechnical, new RegExp(raw));
    assert.match(html, new RegExp(raw));
  }
});

test("lookup herdado, sintético, autoridade falsa e correlação duplicada falham fechados", () => {
  const inheritedDecision = Object.create({ availability: "OBSERVED", value: "GO" }) as Record<string, unknown>;
  const inherited = chainFor({ availability: "UNKNOWN" });
  inherited.decision = inheritedDecision;
  const inheritedHtml = htmlForRows([inherited]);
  assert.match(inheritedHtml, /Decisão comercial<\/dt><dd>sem dados<\/dd>/);
  assert.doesNotMatch(inheritedHtml, />prosseguir</);

  const synthetic = { ...chainFor({ availability: "UNKNOWN" }), synthetic: true };
  const wrongAuthority = structuredClone(chainFor({ availability: "UNKNOWN" }));
  (wrongAuthority.authority as Record<string, unknown>).financial_facts = "lookalike";
  const duplicate = chainFor({ availability: "UNKNOWN" });
  const rejected = htmlForRows([synthetic, wrongAuthority, duplicate, structuredClone(duplicate)]);
  assert.match(rejected, /data-weekly-revenue-chain-count="0"/);
  assert.match(rejected, /data-weekly-revenue-rejected="4"/);
  assert.match(rejected, /Nenhuma cadeia real comprovada/);
  assert.match(rejected, /4 registro\(s\) não foram exibidos/);

  const impossibleSourceDate = chainFor({ availability: "UNKNOWN" });
  (impossibleSourceDate.source as Record<string, unknown>).observed_at = "2026-02-30T20:00:00Z";
  const invalidTime = htmlForRows([impossibleSourceDate]);
  assert.match(invalidTime, /data-weekly-revenue-chain-count="0"/);

  const mismatchedProposal = chainFor({ availability: "UNKNOWN" });
  mismatchedProposal.proposal = { availability: "OBSERVED", value: "prop_other_account" };
  const unboundProposal = htmlForRows([mismatchedProposal]);
  assert.match(unboundProposal, /data-absent="true"><dt>Proposta<\/dt><dd>sem dados<\/dd>/);
});

test("conteúdo hostil é escapado e a estrutura mantém título, artigo, lista e detalhe acessível", () => {
  const hostile = chainFor({ availability: "UNKNOWN" });
  (hostile.charge as Record<string, unknown>).status = "<img src=x onerror=alert(1)>";
  const html = htmlForRows([hostile]);
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /onerror=alert/);
  assert.match(html, /<section[^>]*aria-labelledby="weekly-revenue-title"/);
  assert.match(html, /<h2 id="weekly-revenue-title">/);
  assert.match(html, /<article class="card"/);
  assert.match(html, /<dl class="facts">/);
  assert.match(html, /<details[\s\S]*<summary>Identificadores e proveniência técnica<\/summary>/);
});
