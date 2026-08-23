import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { paintShell } from "../src/app";
import {
  ALERT_SLA_MINUTES,
  ageLabel,
  alertClassOf,
  deadlineFor,
  impactSentence,
  ownerFor,
  priorityAlert,
  splitEngineReason,
} from "../src/alerts";
import { composeHoje } from "../src/hoje-compose";
import { PRIORITY_FIXTURES } from "../src/fixtures/catalog";
import { httpAdapterFor, readContractFixture } from "./helpers";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Recorded output of the real context service over `representativeOperationalData()`.
 *
 * `services/context/test/today-golden.test.ts` re-serves those routes and fails
 * if a single byte drifts, so these assertions run against a payload the
 * backend actually emits — `/v1/today` and `/v1/attention` return `RankedItem`,
 * which is wider than `priority-recommendation.v1` and carries the scoring
 * prose that this issue is about.
 */
const GOLDEN = JSON.parse(
  readFileSync(join(here, "fixtures/operational-today.golden.json"), "utf8"),
) as {
  today: { today: Array<Record<string, unknown>> };
  attention_now: { items: Array<Record<string, unknown>> };
  attention_today: { items: Array<Record<string, unknown>> };
};

/** Scoring vocabulary that must never reach the front of a card. */
const INTERNAL_TOKENS = [
  "peso_categoria",
  "freshness_bp",
  "confidence_bp",
  "KILL-RULE",
  "× eixo",
  "score_milli",
];

function goldenRouter(): (url: string) => unknown {
  return (url: string) => {
    const path = url.split("?")[0] ?? url;
    const query = url.split("?")[1] ?? "";
    if (path.endsWith("/v1/today")) return GOLDEN.today;
    if (path.endsWith("/v1/attention")) {
      return query.includes("horizon=now") ? GOLDEN.attention_now : GOLDEN.attention_today;
    }
    if (path.endsWith("/v1/operational-snapshots")) return {};
    if (path.endsWith("/v1/agent-activities")) return { items: [] };
    return undefined;
  };
}

async function paintHoje(): Promise<string> {
  const { adapter } = httpAdapterFor(goldenRouter());
  const root = { innerHTML: "" };
  paintShell(root, adapter, "#/hoje");
  for (let i = 0; i < 80; i += 1) {
    if (root.innerHTML.includes('data-view-state="ready"')) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.match(root.innerHTML, /data-view-state="ready"/, "Hoje never settled on the golden payload");
  return root.innerHTML;
}

/** Everything outside a `<details>` element. `<details>` never nests here. */
function withoutDisclosures(html: string): string {
  return html.replace(/<details[\s\S]*?<\/details>/g, "");
}

function cardFor(html: string, id: string): string {
  const start = html.indexOf(`data-id="${id}" data-severity=`);
  assert.ok(start >= 0, `no alert card for ${id}`);
  const end = html.indexOf("</article>", start);
  assert.ok(end > start, `unterminated card for ${id}`);
  return html.slice(start, end);
}

test("live ranked items paint severity, impact, origin, owner, age and deadline in Portuguese", async () => {
  const html = await paintHoje();
  const card = cardFor(html, "cc:attention-item:overdue-receivable");
  assert.match(card, /data-severity-pill="high">Alto</);
  assert.match(card, /<strong>Impacto:<\/strong> Afeta receita/);
  assert.match(card, /<dt>Origem<\/dt><dd>asaas · receivable-read/);
  assert.match(card, /finance\/receivables/);
  assert.match(card, /<dt>Responsável<\/dt>[\s\S]*?data-owner-destination="financeiro">Financeiro</);
  assert.match(card, /<dt>Idade<\/dt><dd>há \d+ (min|h|d)/);
  assert.match(card, /<dt>Prazo<\/dt>[\s\S]*?SLA Alto: 4 h após a detecção, política do cockpit/);
  assert.match(card, /O que fazer agora/);
  assert.match(card, /Tratar o recebível vencido/);
  assert.match(card, /class="alert-open" href="#\/financeiro">Abrir Financeiro</);
});

test("the scoring formula appears only inside the collapsed 'Como foi priorizado'", async () => {
  const html = await paintHoje();
  assert.match(html, /<summary>Como foi priorizado<\/summary>/);
  // The formula has to be somewhere: the requirement is quarantine, not deletion.
  assert.match(html, /peso_categoria/);
  const front = withoutDisclosures(html);
  for (const token of INTERNAL_TOKENS) {
    assert.equal(
      front.includes(token),
      false,
      `"${token}" leaked outside <details>: ${front.slice(Math.max(0, front.indexOf(token) - 160), front.indexOf(token) + 160)}`,
    );
  }
  // And the disclosure is closed: no `open` attribute on any of them.
  assert.equal(/<details[^>]*\sopen[\s>]/.test(html), false);
});

test("a kill-rule item explains itself in Portuguese inside the disclosure, not as jargon on the card", async () => {
  const html = await paintHoje();
  const card = cardFor(html, "cc:attention-item:open-incident");
  const front = withoutDisclosures(card);
  assert.equal(front.includes("KILL-RULE"), false);
  assert.match(card, /Regra fixa de risco crítico \(KILL-RULE\)/);
  assert.match(front, /data-severity-pill="critical">Crítico</);
  assert.match(front, /Desbloquear o incidente de engenharia/);
});

test("a low-severity cosmetic item is visually distinct from a critical incident", async () => {
  const html = await paintHoje();
  const cosmetic = cardFor(html, "cc:attention-item:cosmetic-copy");
  const incident = cardFor(html, "cc:attention-item:client-risk");
  assert.match(cosmetic, /data-alert-class="ajuste"/);
  assert.match(cosmetic, /data-severity-pill="low">Baixo</);
  assert.match(cosmetic, /Ajuste de baixa gravidade/);
  assert.match(cosmetic, /Sem prazo — entra no backlog/);
  assert.match(incident, /data-alert-class="incidente"/);
  assert.match(incident, /data-severity-pill="critical">Crítico</);
  assert.notEqual(
    /data-alert-class="([a-z]+)"/.exec(cosmetic)?.[1],
    /data-alert-class="([a-z]+)"/.exec(incident)?.[1],
  );
  const css = readFileSync(join(here, "../src/styles.css"), "utf8");
  assert.match(css, /\.alert-card\[data-alert-class="ajuste"\]/);
  assert.match(css, /\.alert-card\[data-alert-class="incidente"\]\[data-severity="critical"\]/);
});

test("every live alert offers acknowledge and open-detail, and says acknowledging does not resolve", async () => {
  const html = await paintHoje();
  const card = cardFor(html, "cc:attention-item:client-risk");
  assert.match(card, /<form data-operator-form="ACKNOWLEDGE_EXCEPTION"/);
  assert.match(card, /name="target_canonical_id" value="cc:attention-item:client-risk"/);
  assert.match(card, /name="target_source_id" value="clients\/roll-up"/);
  assert.match(card, /Reconhecer sem resolver/);
  assert.match(card, /Não resolve o incidente, não altera o sistema de origem e o item continua no ranking/);
  assert.match(card, /class="alert-open" href="#\/clientes"/);
  // No resolve/dismiss control anywhere: nothing in the backend transitions
  // AttentionItem.status, so offering one would be a lie.
  assert.equal(/data-operator-form="(RESOLVE|DISMISS)[A-Z_]*"/.test(html), false);
});

test("acknowledging from the card POSTs ACKNOWLEDGE_EXCEPTION and nothing else", async () => {
  const calls: Array<{ url: string; method: string; body: Record<string, unknown> }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (method === "POST") {
      calls.push({ url, method, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return new Response(JSON.stringify({ id: "cc:operator-action:ack" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }
    const payload = goldenRouter()(url.replace(/^https?:\/\/[^/]+/, ""));
    return new Response(JSON.stringify(payload ?? { error: "not_found" }), {
      status: payload === undefined ? 404 : 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  const { createHttpAdapter } = await import("../src/adapters/index");
  const adapter = createHttpAdapter("http://127.0.0.1:8787", fetchImpl, {
    kind: "human",
    id: "founder-local",
  });
  const result = await adapter.operatorAction({
    action_type: "ACKNOWLEDGE_EXCEPTION",
    target_canonical_id: "cc:attention-item:client-risk",
    target_source_id: "clients/roll-up",
    note: "triagem iniciada",
  });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.url, /\/v1\/operator-actions$/);
  assert.equal(calls[0]!.body.action_type, "ACKNOWLEDGE_EXCEPTION");
  assert.match(String(result.message), /Warmbly não foi alterado/);
});

test("acknowledged items keep ranking: the shell must not hide them after an acknowledge", async () => {
  // `DEFAULT_SCORING_CONFIG.eligible_statuses` is ["open","acknowledged"], and
  // selectHomepageAttention mirrors it. A card that vanished on acknowledge
  // would be the silent resolution the issue forbids.
  const acknowledged = {
    ...GOLDEN.attention_now,
    items: GOLDEN.attention_now.items.map((item) => ({ ...item, status: "acknowledged" })),
  };
  const router = (url: string) => {
    const path = url.split("?")[0] ?? url;
    if (path.endsWith("/v1/today")) return GOLDEN.today;
    if (path.endsWith("/v1/attention")) return acknowledged;
    if (path.endsWith("/v1/operational-snapshots")) return {};
    if (path.endsWith("/v1/agent-activities")) return { items: [] };
    return undefined;
  };
  const { adapter } = httpAdapterFor(router);
  const root = { innerHTML: "" };
  paintShell(root, adapter, "#/hoje");
  for (let i = 0; i < 80; i += 1) {
    if (root.innerHTML.includes('data-view-state="ready"')) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.match(root.innerHTML, /data-id="cc:attention-item:client-risk"/);
  assert.match(root.innerHTML, /data-band="incidents" data-compressed="false"/);
});

test("splitEngineReason agrees with the engine on real ranked prose", () => {
  const items = [...GOLDEN.today.today, ...GOLDEN.attention_now.items];
  assert.ok(items.length >= 3);
  for (const item of items) {
    const reason = String(item.reason);
    const { plain, technical } = splitEngineReason(reason);
    assert.match(technical, /^Score /, reason);
    assert.equal(plain.length > 0 ? `${plain} ${technical}` : technical, reason);
  }
});

test("a hand-written rationale with no formula stays on the front of the card", () => {
  const view = composeHoje({
    generated_at: "2026-08-20T18:00:00Z",
    headline: "cockpit",
    priorities: PRIORITY_FIXTURES,
    incidents: [],
    clients: [],
    commercial: null,
    finance: null,
    engineering: null,
    infra: [],
    activities: [],
  });
  const top3 = view.sections.find((section) => section.id === "top3");
  assert.ok(top3);
  const first = top3.rows[0];
  assert.ok(first?.alert);
  assert.match(first.alert.description, /fila de inbound/);
  assert.equal(first.alert.breakdown, "");
  assert.equal(first.summary, first.alert.description);
});

test("SLA, age, owner, class and impact are derived, not invented per card", () => {
  assert.equal(ALERT_SLA_MINUTES.critical, 60);
  assert.equal(ALERT_SLA_MINUTES.low, null);

  const overdue = deadlineFor("critical", "2026-08-20T10:00:00Z", "2026-08-20T13:00:00Z");
  assert.equal(overdue.overdue, true);
  assert.match(overdue.label, /vencido há 2 h/);
  const pending = deadlineFor("high", "2026-08-20T10:00:00Z", "2026-08-20T11:00:00Z");
  assert.equal(pending.overdue, false);
  assert.match(pending.label, /faltam 3 h/);
  assert.equal(deadlineFor("low", "2026-08-20T10:00:00Z", "2026-08-20T23:00:00Z").overdue, false);

  assert.equal(ageLabel("2026-08-20T10:00:00Z", "2026-08-20T10:20:00Z"), "há 20 min");
  assert.equal(ageLabel("2026-08-18T10:00:00Z", "2026-08-20T10:00:00Z"), "há 2 d");
  assert.equal(ageLabel("2026-08-20T10:20:00Z", "2026-08-20T10:00:00Z"), "agora");

  assert.equal(alertClassOf("critical"), "incidente");
  assert.equal(alertClassOf("medium"), "acao");
  assert.equal(alertClassOf("low"), "ajuste");
  // Category beats severity: cosmetic work never wears the incident band.
  assert.equal(alertClassOf("critical", "estetica"), "ajuste");
  assert.equal(alertClassOf("high", "refactor"), "ajuste");

  assert.equal(ownerFor("client:acme-industria").destination, "clientes");
  assert.equal(ownerFor("repo:tjsasakifln/Governance").destination, "engenharia");
  assert.equal(ownerFor("company", "finance").destination, "financeiro");
  assert.equal(ownerFor("company").label, "Fundador (sem área dedicada)");

  assert.match(impactSentence("high", "receita"), /receita/);
  assert.match(impactSentence("high", "nao-existe"), /Impacto alto/);
});

test("a priority with no engine severity is not inflated to critical", () => {
  const first = PRIORITY_FIXTURES[0]!;
  const alert = priorityAlert(first, "2026-08-20T18:00:00Z");
  assert.equal(alert.severity, "high");
  assert.notEqual(alert.severity, "critical");
  const second = priorityAlert({ ...first, rank: 2 }, "2026-08-20T18:00:00Z");
  assert.equal(second.severity, "medium");
});

test("a plain priority-recommendation.v1 body keeps its rationale on the front, not in the disclosure", async () => {
  // The contract body carries `rationale` (operator prose) and no `reason`,
  // `category` or `evidence_refs`. Nothing about it is engine output, so
  // rankingFrom must decline it and the sentence must stay readable.
  const priority = readContractFixture("priority-recommendation") as Record<string, unknown>;
  const attention = readContractFixture("attention-item") as Record<string, unknown>;
  const router = (url: string) => {
    const path = url.split("?")[0] ?? url;
    if (path.endsWith("/v1/today")) {
      return { generated_at: "2026-08-20T18:00:00Z", headline: "cockpit", priorities: [priority] };
    }
    if (path.endsWith("/v1/attention")) return { items: [attention] };
    if (path.endsWith("/v1/operational-snapshots")) return {};
    if (path.endsWith("/v1/agent-activities")) return { items: [] };
    return undefined;
  };
  const { adapter } = httpAdapterFor(router);
  const root = { innerHTML: "" };
  paintShell(root, adapter, "#/hoje");
  for (let i = 0; i < 80; i += 1) {
    if (root.innerHTML.includes('data-view-state="ready"')) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const card = cardFor(root.innerHTML, String(priority.id));
  const front = withoutDisclosures(card);
  assert.ok(front.includes(String(priority.rationale)), `rationale left the front: ${front}`);
  assert.match(card, /Sem fórmula de priorização registrada/);
  const attentionCard = cardFor(root.innerHTML, String(attention.id));
  assert.ok(withoutDisclosures(attentionCard).includes(String(attention.summary)));
});
