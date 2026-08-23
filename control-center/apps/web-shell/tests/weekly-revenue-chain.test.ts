import assert from "node:assert/strict";
import { test } from "node:test";
import type { CommercialSnapshot } from "../src/types";
import { commercialBlock } from "../src/ui/domains";

const IDENTITY = {
  correlation_id: "corr_extra_sbx_week_2026_34",
  account_id: "acc_extra_sbx_001",
  opportunity_id: "opp_extra_sbx_001",
  offer_id: "CFG-DIAG-EXP-v1",
  proposal_id: "prop_extra_sbx_001",
  charge_id: "charge_asaas_sbx_001",
  payment_id: "UNKNOWN",
};

function htmlFor(receipt: Record<string, unknown>, paymentId = "UNKNOWN"): string {
  return commercialBlock({
    schema_version: "control-center.commercial-snapshot.v1",
    id: "cc:commercial-snapshot:extra-weekly-sandbox",
    scope: "commercial",
    generated_at: "2026-08-22T20:00:00Z",
    provenance: {
      source: { system: "warmbly", kind: "commercial-intel", locator: "/v1/confenge/intel/executive" },
      observed_at: "2026-08-22T20:00:00Z",
      freshness_status: "FRESH",
      confidence: 1,
    },
    authority: {
      catalog_authority: "governance",
      commercial_runtime: "warmbly",
      this_document: "read_model",
    },
    operations: {
      overview: {},
      weekly_revenue_chains: [{
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
        },
        receipt,
        held: false,
        synthetic: true,
      }],
    },
  } as CommercialSnapshot, "visao");
}

test("Control Center exposes the complete weekly control row and keeps absent receipt UNKNOWN", () => {
  const html = htmlFor({ availability: "UNKNOWN" });
  assert.match(html, /corr_extra_sbx_week_2026_34/);
  assert.match(html, /Entregável mais recente[\s\S]{0,120}deliverable_weekly_sbx_001/);
  assert.match(html, /Evidência mais recente[\s\S]{0,120}evidence_sandbox_fixture_001/);
  assert.match(html, /Gate humano visível: WAIT/);
  assert.match(html, /Responsável[\s\S]{0,100}role_commercial_owner/);
  assert.match(html, /Próxima ação[\s\S]{0,120}human_review_commercial_terms/);
  assert.match(html, /Cobrança[\s\S]{0,160}BRL 8\.000,00/);
  assert.match(html, /Recebimento[\s\S]{0,100}UNKNOWN/);
  assert.doesNotMatch(html, /Recebimento[\s\S]{0,100}0,00/);
  assert.match(html, /Asaas é a autoridade financeira/);
});

test("the same correlation displays observed receipt only after the received fact", () => {
  const html = htmlFor({
    availability: "OBSERVED",
    id: "payment_asaas_sbx_001",
    status: "received",
    amount_cents: 800000,
    currency: "BRL",
  }, "payment_asaas_sbx_001");
  assert.match(html, /data-correlation-id="corr_extra_sbx_week_2026_34"/);
  assert.match(html, /Payment ID[\s\S]{0,100}payment_asaas_sbx_001/);
  assert.match(html, /Recebimento[\s\S]{0,180}payment_asaas_sbx_001[\s\S]{0,80}BRL 8\.000,00/);
});
