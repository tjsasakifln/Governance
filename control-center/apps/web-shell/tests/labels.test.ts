import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryRuntime, mount } from "../src/app";
import { createMockAdapter } from "../src/adapters/index";
import { DESTINATIONS } from "../src/destinations";
import {
  AGENT_ACTIVITY_PRESENTATION_STATUSES,
  AGENT_SESSION_STATUSES,
  ATTENTION_SEVERITIES,
  ATTENTION_STATUSES,
  CLIENT_LIFECYCLES,
  DIRECTIVE_KINDS,
  DIRECTIVE_STATUSES,
  FRESHNESS_STATUSES,
  HEALTH_STATUSES,
  PRIORITY_HORIZONS,
} from "../src/types";
import {
  AGENT_SESSION_STATUS_LABELS,
  AGENT_STATUS_LABELS,
  ATTENTION_STATUS_LABELS,
  CLIENT_LIFECYCLE_LABELS,
  DIRECTIVE_KIND_LABELS,
  DIRECTIVE_STATUS_LABELS,
  HEALTH_LABELS,
  MEMORY_GROUP_TITLES,
  PRIORITY_HORIZON_LABELS,
  SEVERITY_LABELS,
  availabilityLabel,
  agentSessionStatusLabel,
  agentStatusLabel,
  attentionStatusLabel,
  authorityLabel,
  clientLifecycleLabel,
  commercialEventLabel,
  commercialStateLabel,
  confidenceWord,
  directiveKindLabel,
  directiveStatusLabel,
  exceptionKindLabel,
  freshnessLabel,
  healthLabel,
  helpTerm,
  hopStatusLabel,
  operatorActionLabel,
  operatorOutcomeLabel,
  pipelineStageLabel,
  priorityHorizonLabel,
  providerMutationLabel,
  severityLabel,
  scopeLabel,
  statusPill,
  technicalDetails,
} from "../src/ui/labels";

/**
 * Texto que o operador realmente lê: sem marcação, sem atributos, e **sem** o
 * conteúdo dos blocos `<details class="tech">`, que estão recolhidos por
 * padrão. É essa string que precisa estar em português — os `data-*` e o
 * detalhe técnico continuam com o token cru de propósito.
 */
function visibleText(html: string): string {
  return html
    .replace(/<details class="tech"[\s\S]*?<\/details>/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replace(/\s+/g, " ");
}

function mountedHtml(hash: string): string {
  const root = { innerHTML: "" };
  const handle = mount(root, createMockAdapter(), createMemoryRuntime(hash));
  try {
    return root.innerHTML;
  } finally {
    handle.unmount();
  }
}

const COMMERCIAL_SURFACES = ["visao", "cohorts", "atividade", "pipeline", "excecoes"] as const;

function everyMainRouteHtml(): { hash: string; html: string }[] {
  const hashes = [
    ...DESTINATIONS.map((item) => `#/${item.id}`),
    ...COMMERCIAL_SURFACES.map((surface) => `#/comercial/${surface}`),
    "#/clientes/acme-industria",
  ];
  return hashes.map((hash) => ({ hash, html: mountedHtml(hash) }));
}

test("every taxonomy value has a Portuguese label and no label is left blank", () => {
  const tables: [readonly string[], Record<string, string>][] = [
    [FRESHNESS_STATUSES, Object.fromEntries(FRESHNESS_STATUSES.map((s) => [s, freshnessLabel(s)]))],
    [AGENT_ACTIVITY_PRESENTATION_STATUSES, AGENT_STATUS_LABELS],
    [AGENT_SESSION_STATUSES, AGENT_SESSION_STATUS_LABELS],
    [HEALTH_STATUSES, HEALTH_LABELS],
    [CLIENT_LIFECYCLES, CLIENT_LIFECYCLE_LABELS],
    [ATTENTION_SEVERITIES, SEVERITY_LABELS],
    [ATTENTION_STATUSES, ATTENTION_STATUS_LABELS],
    [PRIORITY_HORIZONS, PRIORITY_HORIZON_LABELS],
    [DIRECTIVE_KINDS, DIRECTIVE_KIND_LABELS],
    [DIRECTIVE_KINDS, MEMORY_GROUP_TITLES],
    [DIRECTIVE_STATUSES, DIRECTIVE_STATUS_LABELS],
  ];
  for (const [values, table] of tables) {
    for (const value of values) {
      const label = table[value];
      assert.ok(label !== undefined && label.length > 0, `sem rótulo para ${value}`);
      // "lead" é o mesmo termo nos dois idiomas; o resto tem de mudar.
      if (value !== "lead") {
        assert.notEqual(label, value, `rótulo de ${value} continua sendo o token cru`);
      }
    }
  }
});

test("unknown backend codes stay technical and receive an honest authored fallback", () => {
  assert.equal(exceptionKindLabel("missing_version"), "versão de oferta ausente");
  assert.equal(exceptionKindLabel("some_code_warmbly_just_invented"), "tipo não reconhecido");
  assert.equal(availabilityLabel("BLOCKED_BY_SECRET"), "bloqueado por credencial ausente");
  assert.equal(availabilityLabel("A_BRAND_NEW_CODE"), "disponibilidade não reconhecida");
});

test("label catalogues fail closed for future and Object.prototype tokens", () => {
  const cases: Array<[(value: string) => string, string]> = [
    [agentStatusLabel, "estado do agente não reconhecido"],
    [agentSessionStatusLabel, "estado da sessão não reconhecido"],
    [healthLabel, "estado de saúde não reconhecido"],
    [clientLifecycleLabel, "ciclo do cliente não reconhecido"],
    [severityLabel, "gravidade não reconhecida"],
    [attentionStatusLabel, "estado de atenção não reconhecido"],
    [priorityHorizonLabel, "horizonte não reconhecido"],
    [directiveKindLabel, "tipo de diretiva não reconhecido"],
    [directiveStatusLabel, "estado da diretiva não reconhecido"],
    [availabilityLabel, "disponibilidade não reconhecida"],
    [authorityLabel, "autoridade não reconhecida"],
    [providerMutationLabel, "regra de mutação não reconhecida"],
    [exceptionKindLabel, "tipo não reconhecido"],
    [operatorActionLabel, "ação não reconhecida"],
    [operatorOutcomeLabel, "resultado não reconhecido"],
    [commercialEventLabel, "estado não reconhecido"],
    [commercialStateLabel, "estado não reconhecido"],
    [pipelineStageLabel, "estado não reconhecido"],
    [hopStatusLabel, "estado não reconhecido"],
    [scopeLabel, "escopo não reconhecido"],
  ];
  for (const poisoned of ["FUTURE_TOKEN", "constructor", "toString", "__proto__"]) {
    assert.equal(freshnessLabel(poisoned as never), "atualização não reconhecida");
    for (const [label, fallback] of cases) assert.equal(label(poisoned), fallback);
  }
});

test("scope keeps its identifier and gains a Portuguese word", () => {
  assert.equal(scopeLabel("company"), "empresa");
  assert.equal(scopeLabel("infrastructure"), "infraestrutura");
  assert.equal(scopeLabel("client:acme-industria"), "cliente acme-industria");
  assert.equal(scopeLabel("repo:tjsasakifln/Governance"), "repositório tjsasakifln/Governance");
  assert.equal(scopeLabel("weird:thing"), "escopo não reconhecido");
});

test("confidence is spoken as a word, without hiding the number", () => {
  assert.equal(confidenceWord(0.95), "alta");
  assert.equal(confidenceWord(0.5), "média");
  assert.equal(confidenceWord(0.2), "baixa");
  assert.equal(confidenceWord(0), "nenhuma");
});

test("technicalDetails is collapsed, copyable, escaped, and drops empty rows", () => {
  const html = technicalDetails(
    [
      { term: "id", value: "cc:client-status:acme" },
      { term: "vazio", value: "" },
      { term: "xss", value: `<img src=x onerror="alert(1)">` },
    ],
    "amostra",
  );
  assert.match(html, /^<details class="tech" data-tech="amostra">/);
  assert.match(html, /<summary>Detalhe técnico<\/summary>/);
  assert.match(html, /<pre class="tech-copy"/);
  assert.match(html, /id=cc:client-status:acme/);
  assert.doesNotMatch(html, /vazio/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img/);
  assert.equal(technicalDetails([{ term: "só", value: "" }]), "");
});

test("helpTerm carries the explanation in title and data-help, escaped", () => {
  const html = helpTerm("confiança", `1 < 2 & "aspas"`);
  assert.match(html, /data-help="1 &lt; 2 &amp; &quot;aspas&quot;"/);
  assert.match(html, /title="1 &lt; 2 &amp; &quot;aspas&quot;"/);
  assert.match(html, />confiança</);
  assert.match(html, /^<details class="term-help">/);
  assert.match(html, /<summary[^>]*class="term"/);
  assert.match(html, /role="note"/);
});

test("statusPill shows the Portuguese label and keeps the raw token in data-raw", () => {
  const html = statusPill("BLOCKED_BY_SECRET", "bloqueado por credencial ausente");
  assert.match(html, /data-raw="BLOCKED_BY_SECRET"/);
  assert.match(html, />bloqueado por credencial ausente</);
  assert.doesNotMatch(visibleText(html), /BLOCKED_BY_SECRET/);
});

/**
 * O critério de aceite da issue #63 é observável exatamente aqui: numa rota
 * principal, o texto que o operador lê não pode conter enum cru nem nome de
 * implementação. Se os rótulos forem revertidos, este teste falha em cada
 * rota — é o que o torna útil.
 */
test("no main route shows a raw enum or an implementation name in its visible text", () => {
  const forbidden = [
    "FRESH",
    "STALE",
    "UNKNOWN",
    "RUNNING",
    "DONE",
    "PARTIAL",
    "BLOCKED",
    "FAILED",
    "NO_DATA",
    "NOT_CONFIGURED",
    "BLOCKED_BY_SECRET",
    "UPSTREAM_ERROR",
    "JOIN_UNPROVEN",
    "read_model",
    "residual_work",
    "Decisions",
    "Directives",
    "Hypotheses",
    "Constraints",
    "Missing next action",
    "Stalled stage",
    "Offer/version drift",
    "Chargebacks",
    "Refunds",
    "Runway",
    "Due date",
    "Blockers",
    "Allowlist",
    "Agent/provider",
    "Repo/scope",
    "Goal/campaign",
    "Partial outage",
    "Auto-send",
    "Overdue",
    "Reply rate",
    "Organic scoreboard",
    "Inbound truth",
  ];
  for (const { hash, html } of everyMainRouteHtml()) {
    const text = visibleText(html);
    for (const token of forbidden) {
      assert.equal(text.includes(token), false, `${hash} mostra "${token}" ao operador: ${text.slice(0, 400)}`);
    }
  }
});

test("what left the surface is still in the page: data attributes and the collapsed block keep it", () => {
  const infra = mountedHtml("#/infra");
  assert.match(infra, /data-freshness="ERROR"/);
  assert.match(infra, /data-status="degraded"/);
  assert.match(infra, /freshness_status=ERROR/);
  assert.match(infra, /<pre class="tech-copy"/);

  const agentes = mountedHtml("#/agentes");
  assert.match(agentes, /data-status="RUNNING"/);
  assert.match(agentes, /presentation_status=RUNNING/);

  const clientes = mountedHtml("#/clientes");
  assert.match(clientes, /data-client-source="asaas"/);
  assert.match(clientes, /data-source-status="UNKNOWN"/);
  assert.match(clientes, /client_slug=acme-industria/);

  const memoria = mountedHtml("#/memoria");
  assert.match(memoria, /data-memory-kind="decision"/);
  assert.match(memoria, /kind=decision/);
});

test("the concepts the issue names as unavoidable carry contextual help wherever they show", () => {
  const hoje = mountedHtml("#/hoje");
  assert.match(hoje, /data-help="Atualização é há quanto tempo o dado foi observado[^"]*"/);
  assert.match(hoje, /data-help="Confiança é quanto o dado merece crédito[^"]*"/);
  const crescimento = mountedHtml("#/crescimento");
  assert.match(crescimento, /data-help="Bloqueado é medição impedida[^"]*"/);
  const clientes = mountedHtml("#/clientes");
  assert.match(clientes, /data-help="Ausente é dado que não chegou[^"]*"/);
});
