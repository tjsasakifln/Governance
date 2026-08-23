import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryRuntime, mount } from "../src/app";
import { createMockAdapter } from "../src/adapters/index";
import { OPERATIONAL_ENVELOPE_FIXTURE } from "../src/fixtures/operational-envelope";
import {
  DOMAIN_CARD_IDS,
  absenceNoteFor,
  assertNoHealthyOnUntrusted,
  summarizeDomains,
  type HojeDomainCard,
} from "../src/hoje-domains";
import { composeHoje } from "../src/hoje-compose";
import { renderHoje } from "../src/ui/hoje";

function cloneFixture(): Record<string, unknown> {
  return structuredClone(OPERATIONAL_ENVELOPE_FIXTURE) as Record<string, unknown>;
}

function cardOf(id: string): HojeDomainCard {
  const summary = summarizeDomains(OPERATIONAL_ENVELOPE_FIXTURE);
  const card = summary.cards.find((row) => row.id === id);
  assert.ok(card, `missing card ${id}`);
  return card;
}

function slotsOf(envelope: Record<string, unknown>): Record<string, Record<string, unknown>> {
  return envelope.snapshots as Record<string, Record<string, unknown>>;
}

test("one card per domain, in the order the issue names them", () => {
  const summary = summarizeDomains(OPERATIONAL_ENVELOPE_FIXTURE);
  assert.deepEqual(
    summary.cards.map((card) => card.id),
    [...DOMAIN_CARD_IDS],
  );
  assert.deepEqual(
    summary.cards.map((card) => card.label),
    ["Comercial", "Clientes", "Financeiro", "Engenharia", "Infra", "Warmbly / disparo de saída"],
  );
  for (const card of summary.cards) {
    assert.ok(card.state_reason.length > 0, `${card.id} has no state reason`);
    assert.ok(card.indicator.length > 0, `${card.id} has no headline indicator`);
    assert.ok(card.href.startsWith("#/"), `${card.id} has no link to its slice`);
  }
});

test("the five reliability states are distinguishable on the same screen", () => {
  const summary = summarizeDomains(OPERATIONAL_ENVELOPE_FIXTURE);
  const states = new Map(summary.cards.map((card) => [card.id, card.state]));
  assert.equal(states.get("comercial"), "atencao");
  assert.equal(states.get("clientes"), "saudavel");
  assert.equal(states.get("financeiro"), "desconhecido");
  assert.equal(states.get("engenharia"), "erro_coleta");
  assert.equal(states.get("infra"), "critico");
  assert.equal(states.get("warmbly"), "atencao");
  const labels = new Set(summary.cards.map((card) => card.state_label));
  assert.deepEqual(
    [...labels].sort(),
    ["atenção", "crítico", "desconhecido", "erro de coleta", "saudável"],
  );
  assertNoHealthyOnUntrusted(summary);
});

test("a STALE slot is atenção, not crítico: healthy:false is forced by the schema on every non-FRESH slot", () => {
  const envelope = cloneFixture();
  const finance = slotsOf(envelope).finance!;
  finance.freshness_status = "STALE";
  // The envelope schema forces `healthy:false` on every non-FRESH slot.
  finance.healthy = false;
  assert.equal(cardOfEnvelope(envelope, "financeiro").state, "atencao");

  // The same slot, now reporting a genuinely broken service, must escalate.
  // The open critical alert is cleared first so the escalation under test is
  // the reported status and nothing else.
  envelope.attention_now = [];
  const infra = slotsOf(envelope).infrastructure!;
  const infraSnapshot = infra.snapshot as Record<string, unknown>;
  infraSnapshot.status = "healthy";
  infraSnapshot.services = [{ service_name: "edge", status: "healthy" }];
  infra.healthy = true;
  assert.equal(cardOfEnvelope(envelope, "infra").state, "saudavel");
  infraSnapshot.status = "down";
  assert.equal(cardOfEnvelope(envelope, "infra").state, "critico");
});

function cardOfEnvelope(envelope: unknown, id: string): HojeDomainCard {
  const card = summarizeDomains(envelope).cards.find((row) => row.id === id);
  assert.ok(card, `missing card ${id}`);
  return card;
}

test("absence keeps its contract reason and never reads as zero occurrences", () => {
  const engineering = cardOf("engenharia");
  assert.equal(engineering.presence, "absent");
  assert.equal(engineering.absence_reason, "upstream_error");
  assert.match(engineering.state_reason, /Erro de coleta/);
  assert.equal(engineering.indicator, "sem indicador — leitura ausente");

  const envelope = cloneFixture();
  slotsOf(envelope).clients = {
    ...slotsOf(envelope).clients,
    presence: "absent",
    absence_reason: "not_configured",
    healthy: false,
    freshness_status: "UNKNOWN",
    snapshot: null,
  };
  const clients = cardOfEnvelope(envelope, "clientes");
  assert.equal(clients.state, "desconhecido");
  assert.match(clients.state_reason, /não está configurada/);
  assert.doesNotMatch(clients.state_reason, /Sem ocorrências/);
});

test("present-and-empty says sem ocorrências, absent says faltam dados", () => {
  assert.match(cardOf("clientes").state_reason, /Sem ocorrências/);
  assert.equal(absenceNoteFor(OPERATIONAL_ENVELOPE_FIXTURE, "clients"), null);
  assert.match(
    absenceNoteFor(OPERATIONAL_ENVELOPE_FIXTURE, "engineering") ?? "",
    /Erro de coleta|Faltam dados/,
  );
  assert.match(absenceNoteFor(undefined, "clients") ?? "", /envelope operacional não chegou/);
});

test("the action total is the sum of the parcels the operator can see", () => {
  const summary = summarizeDomains(OPERATIONAL_ENVELOPE_FIXTURE);
  const visible =
    summary.cards.reduce(
      (sum, card) => sum + card.pending.reduce((inner, item) => inner + item.count, 0),
      0,
    ) + summary.unmapped.reduce((sum, row) => sum + row.count, 0);
  assert.equal(summary.action_total, visible);
  assert.ok(summary.action_total !== null && summary.action_total > 0);
  assert.match(summary.action_total_note, /sinais para triagem, não itens únicos/);
  for (const card of summary.cards) {
    assert.equal(
      card.action_count,
      card.pending.reduce((sum, item) => sum + item.count, 0),
    );
  }
});

test("acknowledged alerts still count: reconhecer não esvazia a fila", () => {
  const envelope = cloneFixture();
  const withOpen = summarizeDomains(envelope);
  const attention = envelope.attention_now as Record<string, unknown>[];
  attention[0]!.status = "acknowledged";
  const withAck = summarizeDomains(envelope);
  assert.equal(withAck.action_total, withOpen.action_total);
  assert.equal(cardOfEnvelope(envelope, "infra").state, "critico");

  attention[0]!.status = "resolved";
  const resolved = summarizeDomains(envelope);
  assert.ok(
    resolved.action_total !== null &&
      withOpen.action_total !== null &&
      resolved.action_total < withOpen.action_total,
  );
});

test("alerts in a domain without a card are surfaced, not swallowed", () => {
  const summary = summarizeDomains(OPERATIONAL_ENVELOPE_FIXTURE);
  const pncp = summary.unmapped.find((row) => row.domain === "pncp");
  assert.ok(pncp, "pncp alert vanished from the panorama");
  assert.equal(pncp.count, 1);
  assert.equal(pncp.href, "#/crescimento");
});

test("outbound state is tri-state and an unreported kill switch is not 'ativo'", () => {
  const active = summarizeDomains(OPERATIONAL_ENVELOPE_FIXTURE);
  assert.equal(active.outbound.state, "PAUSED");
  assert.equal(active.outbound.observed, true);
  assert.match(active.outbound.detail, /pausado/i);

  const envelope = cloneFixture();
  const commercial = slotsOf(envelope).commercial!;
  const snapshot = commercial.snapshot as Record<string, unknown>;
  (snapshot.operations as Record<string, unknown>).dispatch = { state: "UNKNOWN", observed: false };
  const unknown = summarizeDomains(envelope);
  assert.equal(unknown.outbound.state, "UNKNOWN");
  assert.equal(unknown.outbound.label, "DESCONHECIDO");
  assert.equal(cardOfEnvelope(envelope, "warmbly").state, "desconhecido");
  assert.match(cardOfEnvelope(envelope, "warmbly").state_reason, /não é 'outbound parado'/);
});

test("critical integrations are rolled up worst-first and an errored source is never saudável", () => {
  const summary = summarizeDomains(OPERATIONAL_ENVELOPE_FIXTURE);
  const systems = summary.integrations.map((row) => row.system);
  assert.deepEqual(systems, ["github", "asaas", "collector", "warmbly"]);
  const github = summary.integrations[0]!;
  assert.equal(github.state, "erro_coleta");
  assert.match(github.detail, /Erro na origem/);
  assert.equal(github.error_code, "UPSTREAM_ERROR");
  for (const row of summary.integrations) {
    if (row.freshness_status !== "FRESH") assert.notEqual(row.state, "saudavel");
  }
});

test("a missing envelope produces desconhecido everywhere, never six healthy cards", () => {
  for (const raw of [undefined, null, {}, [], "nope", { snapshots: null }]) {
    const summary = summarizeDomains(raw);
    assert.equal(summary.envelope_present, false);
    assert.equal(summary.cards.length, 6);
    for (const card of summary.cards) {
      assert.equal(card.state, "desconhecido");
      assert.match(card.state_reason, /Faltam dados/);
    }
    assert.equal(summary.action_total, null);
    assert.match(summary.action_total_note, /Ausência de leitura não significa ausência de trabalho/);
    assertNoHealthyOnUntrusted(summary);
  }
});

test("assertNoHealthyOnUntrusted refuses a card painted saudável on an untrusted reading", () => {
  const summary = summarizeDomains(OPERATIONAL_ENVELOPE_FIXTURE);
  const forged = {
    ...summary,
    cards: summary.cards.map((card) =>
      card.id === "financeiro" ? { ...card, state: "saudavel" as const } : card,
    ),
  };
  assert.throws(() => assertNoHealthyOnUntrusted(forged), /painted saudável on UNKNOWN/);
});

test("money that cannot be read is reported missing, never as 0,00", () => {
  const envelope = cloneFixture();
  const finance = slotsOf(envelope).finance!;
  finance.snapshot = {
    schema_version: "control-center.finance-snapshot.v1",
    id: "cc:finance-snapshot:broken",
    overdue: { amount_cents: "480000", currency: "BRL" },
  };
  const card = cardOfEnvelope(envelope, "financeiro");
  assert.doesNotMatch(card.indicator, /0,00/);
  assert.match(card.indicator, /não legíveis/);
  assert.match(card.indicator, /ausência de valor não é zero/);
});

test("the rendered Hoje page shows the panorama, the total, the links and no 'ignorar'", () => {
  const view = composeHoje({
    generated_at: "2026-08-20T18:00:00Z",
    headline: "cockpit",
    priorities: [],
    incidents: [],
    clients: [],
    commercial: null,
    finance: null,
    engineering: null,
    infra: [],
    activities: [],
    operational_envelope: OPERATIONAL_ENVELOPE_FIXTURE,
  });
  const html = renderHoje(view);
  assert.match(html, /data-band="domains"/);
  for (const id of DOMAIN_CARD_IDS) {
    assert.match(html, new RegExp(`data-domain-card="${id}"`), `card ${id} not rendered`);
  }
  assert.match(html, /data-domain-state="saudavel"/);
  assert.match(html, /data-domain-state="atencao"/);
  assert.match(html, /data-domain-state="critico"/);
  assert.match(html, /data-domain-state="erro_coleta"/);
  assert.match(html, /data-domain-state="desconhecido"/);
  assert.match(html, /data-action-total="\d+"/);
  assert.match(html, /sinal\(is\) operacional\(is\) exigem triagem/);
  assert.doesNotMatch(html, /data-domain-link=[^>]*>[^<]*item\(ns\)/);
  assert.match(html, /href="#\/comercial"/);
  assert.match(html, /href="#\/clientes"/);
  assert.match(html, /href="#\/financeiro"/);
  assert.match(html, /href="#\/engenharia"/);
  assert.match(html, /href="#\/infra"/);
  assert.match(html, /href="#\/warmbly"/);
  assert.match(html, /data-outbound-state="PAUSED"/);
  assert.match(html, /data-integration="github"/);
  assert.match(html, /última atualização/);
  assert.doesNotMatch(html, /ignorar/);
  assert.match(html, /erro de coleta/);
  assert.match(html, /desconhecido/);
});

test("mounted Hoje shows the panorama and drops 'ignorar' from every compressed band", () => {
  const root = { innerHTML: "" };
  const handle = mount(root, createMockAdapter(), createMemoryRuntime("#/hoje"));
  try {
    assert.match(root.innerHTML, /Panorama por domínio\./);
    assert.match(root.innerHTML, /data-domain-card="warmbly"/);
    assert.match(root.innerHTML, /data-action-total=/);
    assert.doesNotMatch(root.innerHTML, /ignorar/);
  } finally {
    handle.unmount();
  }
});

test("hostile strings coming from the envelope are escaped before they reach the page", () => {
  const envelope = cloneFixture();
  const observations = envelope.source_observations as Record<string, unknown>[];
  observations[2]!.error = {
    code: "UPSTREAM_ERROR",
    message: `<img src=x onerror="alert(1)">`,
  };
  const commercial = slotsOf(envelope).commercial!;
  const snapshot = commercial.snapshot as Record<string, unknown>;
  (snapshot.operations as Record<string, unknown>).dispatch = {
    state: "PAUSED",
    observed: true,
    pause_reason: `<script>alert("xss")</script>`,
  };
  const view = composeHoje({
    generated_at: "2026-08-20T18:00:00Z",
    headline: "cockpit",
    priorities: [],
    incidents: [],
    clients: [],
    commercial: null,
    finance: null,
    engineering: null,
    infra: [],
    activities: [],
    operational_envelope: envelope,
  });
  const html = renderHoje(view);
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;img/);
  assert.match(html, /&lt;script&gt;/);
});
