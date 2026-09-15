import assert from "node:assert/strict";
import { test } from "node:test";
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
