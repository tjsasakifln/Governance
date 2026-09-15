import assert from "node:assert/strict";
import { test } from "node:test";
import { COMMERCIAL_SNAPSHOT } from "../src/fixtures/catalog";
import { OPERATIONAL_ENVELOPE_FIXTURE } from "../src/fixtures/operational-envelope";
import { composeHoje } from "../src/hoje-compose";
import { commercialBlock } from "../src/ui/domains";
import type { CommercialSnapshot } from "../src/types";

function snapshot(extra: Record<string, unknown>): CommercialSnapshot {
  return {
    schema_version: "control-center.commercial-snapshot.v1",
    id: "cc:commercial-snapshot:absence",
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
    ...extra,
  } as unknown as CommercialSnapshot;
}

function factValue(html: string, label: string): string {
  const match = new RegExp(`<dt>${label}</dt><dd>([\\s\\S]*?)</dd>`).exec(html);
  assert.ok(match, `fact "${label}" not rendered`);
  return match[1] ?? "";
}

test("absent counts render ausente, never 0", () => {
  const html = commercialBlock(snapshot({ funnel: { opportunities: 2 }, availability: "FRESH" }), "visao");
  assert.match(factValue(html, "Novos leads"), /ausente/);
  assert.doesNotMatch(factValue(html, "Novos leads"), /\b0\b/);
  assert.match(factValue(html, "Mensagens recebidas sem leitura"), /ausente/);
  assert.match(factValue(html, "Pipeline aberto"), /ausente/);
  assert.equal(factValue(html, "Oportunidades"), "2");
  assert.match(html, /data-absent="true"/);
  // The operations overview line for a missing inbound count is a dash, not 0.
  assert.equal(factValue(html, "Mensagens recebidas a tratar"), "—");
});

test("a real zero still renders as 0", () => {
  const html = commercialBlock(
    snapshot({ funnel: { new_leads: 0, opportunities: 0 }, inbound_unread_count: 0, pipeline_open_count: 0 }),
    "visao",
  );
  assert.equal(factValue(html, "Novos leads"), "0");
  assert.equal(factValue(html, "Mensagens recebidas sem leitura"), "0");
  assert.equal(factValue(html, "Pipeline aberto"), "0");
});

test("auto_send reads não observado unless Warmbly actually reported the switch", () => {
  const render = (auto_send: unknown) =>
    factValue(commercialBlock(snapshot({ operations: { auto_send } }), "visao"), "Envio automático");
  assert.equal(render({ enabled: false, observed: false, source: "warmbly.confenge.status" }), "não observado");
  assert.equal(render({ enabled: false, source: "warmbly.confenge.status" }), "não observado");
  assert.equal(render(undefined), "não observado");
  assert.equal(render({ enabled: false, observed: true, source: "warmbly.confenge.status" }), "desligado");
  assert.match(render({ enabled: true, source: "warmbly.confenge.status" }), /observado ligado/);
  const html = commercialBlock(snapshot({ operations: { auto_send: { enabled: false, observed: false } } }), "visao");
  assert.match(html, /data-auto-send="not_observed"/);
  assert.doesNotMatch(html, /Envio automático<\/dt><dd>desligado/);
});

test("Hoje does not claim a clean commercial reading when inbound_unread_count was not observed", () => {
  const clean: CommercialSnapshot = {
    ...COMMERCIAL_SNAPSHOT,
    inbound_unread_count: 0,
    at_risk_client_count: 0,
    aging_count: 0,
    stalled_count: 0,
    missing_next_action_count: 0,
    offer_version_drift: { count: 0 },
    provenance: { ...COMMERCIAL_SNAPSHOT.provenance, freshness_status: "FRESH" },
  };
  const { inbound_unread_count: _omitted, ...unobserved } = clean;
  assert.equal("inbound_unread_count" in unobserved, false);
  const compose = (commercial: CommercialSnapshot) =>
    composeHoje({
      generated_at: "2026-08-20T18:00:00Z",
      headline: "cockpit",
      priorities: [],
      incidents: [],
      clients: [],
      commercial,
      finance: null,
      engineering: null,
      infra: [],
      activities: [],
      operational_envelope: OPERATIONAL_ENVELOPE_FIXTURE,
    }).sections.find((s) => s.id === "commercial");

  const observed = compose(clean);
  assert.ok(observed);
  assert.equal(observed.compressed, true);
  assert.match(observed.compressed_summary ?? "", /veio limpa/);
  assert.doesNotMatch(observed.compressed_summary ?? "", /não observado|leitura parcial/);

  const partial = compose(unobserved as CommercialSnapshot);
  assert.ok(partial);
  assert.equal(partial.compressed, true);
  assert.equal(partial.rows.length, 0);
  assert.doesNotMatch(partial.compressed_summary ?? "", /veio limpa/);
  assert.match(partial.compressed_summary ?? "", /leitura parcial: inbound não observado/);
  assert.match(partial.compressed_summary ?? "", /ausência não é zero/);
  assert.doesNotMatch(partial.compressed_summary ?? "", /inbound 0|leads 0/);
});
