import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryRuntime, mount } from "../src/app";
import { createMockAdapter } from "../src/adapters/index";
import { DESTINATIONS } from "../src/destinations";
import { CLIENT_FIXTURES } from "../src/fixtures/catalog";
import type { ClientStatus, CommercialSnapshot } from "../src/types";
import { clientCard, commercialBlock, growthFunnelBlock } from "../src/ui/domains";
import { renderShell } from "../src/ui/render";
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
  agentSessionStatusLabel,
  agentStatusLabel,
  attentionStatusLabel,
  authorizationStateLabel,
  authorityLabel,
  availabilityLabel,
  clientLifecycleLabel,
  commercialEventLabel,
  commercialStateLabel,
  confidenceWord,
  directiveKindLabel,
  directiveStatusLabel,
  dispatchStateLabel,
  exceptionKindLabel,
  freshnessLabel,
  goReviewVerdictLabel,
  healthLabel,
  helpTerm,
  hopStatusLabel,
  operatorActionLabel,
  operatorOutcomeLabel,
  pipelineStageLabel,
  priorityHorizonLabel,
  providerLabel,
  providerMutationLabel,
  severityLabel,
  routeClassLabel,
  scopeLabel,
  statusPill,
  technicalDetails,
  viewKindLabel,
} from "../src/ui/labels";

/**
 * Texto que o operador realmente lê: sem marcação, sem atributos, e **sem** o
 * conteúdo dos blocos `<details class="tech">`, que estão recolhidos por
 * padrão. É essa string que precisa estar em português — os `data-*` e o
 * detalhe técnico continuam com o token cru de propósito.
 */
function visibleText(html: string): string {
  let collapsed = html;
  let prior: string;
  do {
    prior = collapsed;
    collapsed = collapsed.replace(
      /<details\b[^>]*>((?:(?!<details\b)[\s\S])*?)<\/details>/gi,
      (_whole, body: string) => body.match(/<summary\b[^>]*>([\s\S]*?)<\/summary>/i)?.[1] ?? " ",
    );
  } while (collapsed !== prior);
  return collapsed
    .replace(/<[^>]*>/g, " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replace(/\s+/g, " ");
}

/** Detecta a serialização inválida que faria o parser HTML fechar `<p>` implicitamente. */
function hasDetailsInsideParagraph(html: string): boolean {
  let insideParagraph = false;
  for (const match of html.matchAll(/<\/?p\b[^>]*>|<details\b[^>]*>/gi)) {
    const token = match[0].toLowerCase();
    if (token.startsWith("</p")) {
      insideParagraph = false;
    } else if (token.startsWith("<p")) {
      insideParagraph = true;
    } else if (insideParagraph) {
      return true;
    }
  }
  return false;
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

test("a new commercial exception code is hidden behind an honest fallback", () => {
  assert.equal(exceptionKindLabel("missing_version"), "versão de oferta ausente");
  assert.equal(exceptionKindLabel("some_code_warmbly_just_invented"), "tipo não reconhecido");
  assert.equal(availabilityLabel("BLOCKED_BY_SECRET"), "bloqueado por credencial ausente");
  assert.equal(availabilityLabel("A_BRAND_NEW_CODE"), "disponibilidade não reconhecida");
});

test("every enum label helper hides future tokens behind an authored fallback", () => {
  assert.equal(freshnessLabel("FUTURE_FRESHNESS" as never), "atualização não reconhecida");
  const cases: Array<[string, (value: string) => string, string]> = [
    ["FUTURE_AGENT", agentStatusLabel, "estado do agente não reconhecido"],
    ["FUTURE_SESSION", agentSessionStatusLabel, "estado da sessão não reconhecido"],
    ["FUTURE_HEALTH", healthLabel, "estado de saúde não reconhecido"],
    ["FUTURE_LIFECYCLE", clientLifecycleLabel, "ciclo do cliente não reconhecido"],
    ["FUTURE_SEVERITY", severityLabel, "gravidade não reconhecida"],
    ["FUTURE_ATTENTION", attentionStatusLabel, "estado de atenção não reconhecido"],
    ["FUTURE_HORIZON", priorityHorizonLabel, "horizonte não reconhecido"],
    ["FUTURE_DIRECTIVE_KIND", directiveKindLabel, "tipo de diretiva não reconhecido"],
    ["FUTURE_DIRECTIVE_STATUS", directiveStatusLabel, "estado da diretiva não reconhecido"],
    ["FUTURE_AVAIL", availabilityLabel, "disponibilidade não reconhecida"],
    ["FUTURE_AUTHORITY", authorityLabel, "autoridade não reconhecida"],
    ["FUTURE_MUTATION", providerMutationLabel, "regra de mutação não reconhecida"],
    ["FUTURE_VIEW", viewKindLabel, "estado da vista não reconhecido"],
    ["FUTURE_ACTION", operatorActionLabel, "ação não reconhecida"],
    ["FUTURE_OUTCOME", operatorOutcomeLabel, "resultado não reconhecido"],
    ["FUTURE_HOP", hopStatusLabel, "estado não reconhecido"],
  ];
  for (const [raw, label, expected] of cases) {
    assert.equal(label(raw), expected, `${raw} perdeu o fallback autoral`);
    assert.doesNotMatch(label(raw), new RegExp(raw));
  }
});

test("label catalogues treat Object.prototype names as unknown external tokens", () => {
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
    [viewKindLabel, "estado da vista não reconhecido"],
    [operatorActionLabel, "ação não reconhecida"],
    [operatorOutcomeLabel, "resultado não reconhecido"],
    [commercialEventLabel, "estado não reconhecido"],
    [commercialStateLabel, "estado não reconhecido"],
    [pipelineStageLabel, "estado não reconhecido"],
    [routeClassLabel, "classe de rota não reconhecida"],
    [providerLabel, "provedor não reconhecido"],
    [authorizationStateLabel, "estado não reconhecido"],
    [goReviewVerdictLabel, "veredito não reconhecido"],
    [dispatchStateLabel, "estado não reconhecido"],
    [hopStatusLabel, "estado não reconhecido"],
    [scopeLabel, "escopo não reconhecido"],
  ];
  for (const poisoned of ["constructor", "toString", "__proto__"]) {
    assert.equal(freshnessLabel(poisoned as never), "atualização não reconhecida");
    for (const [label, fallback] of cases) {
      assert.equal(label(poisoned), fallback, `${label.name} aceitou a propriedade herdada ${poisoned}`);
    }
  }
});

test("future availability and funnel status stay raw only in attributes and technical details", () => {
  const snapshot = {
    operations: {
      growth: {
        funnel_contract: ["lead", "FUTURE_HOP_ID", "constructor", "toString", "__proto__"],
        scoreboard: {
          stages: [
            { id: "lead", status: "FUTURE_HOP" },
            { id: "FUTURE_HOP_ID", status: "PRESENT" },
            { id: "constructor", status: "constructor" },
            { id: "toString", status: "toString" },
            { id: "__proto__", status: "__proto__" },
          ],
        },
        attribution: { note: "FUTURE_ATTRIBUTION" },
        organic_scoreboard: {
          configured: true,
          availability: "FUTURE_AVAIL",
          schema: "FUTURE_SCHEMA",
          note: "FUTURE_NOTE",
          windows: [
            {
              id: "FUTURE_WINDOW",
              by_source: [
                {
                  layers: [
                    {
                      id: "LEAD_VALID",
                      status: "UNKNOWN",
                      count: 0,
                      denominator: 0,
                      observation: "no ingest",
                    },
                    {
                      id: "FUTURE_LAYER",
                      status: "FUTURE_AVAIL",
                      count: 1,
                      denominator: 2,
                      observation: "FUTURE_OBSERVATION",
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    },
  } as unknown as CommercialSnapshot;
  const html = growthFunnelBlock(snapshot);
  const shown = visibleText(html);
  assert.match(shown, /disponibilidade não reconhecida/);
  assert.match(shown, /estado não reconhecido/);
  assert.match(shown, /Etapa não reconhecida/);
  assert.match(shown, /camada não reconhecida/);
  assert.match(shown, /Leads válidos/);
  assert.match(shown, /sem ingestão observada/);
  assert.match(shown, /Nota do placar orgânico não reconhecida/);
  assert.match(shown, /Nota de atribuição não reconhecida/);
  assert.match(shown, /Janela não reconhecida/);
  assert.match(shown, /observação não reconhecida/);
  assert.doesNotMatch(shown, /FUTURE_(?:AVAIL|HOP|LAYER|NOTE|ATTRIBUTION|WINDOW|OBSERVATION|SCHEMA)/);
  assert.doesNotMatch(shown, /constructor|toString|__proto__/);
  assert.doesNotMatch(shown, /LEAD_VALID|no ingest/);
  assert.match(html, /data-organic-layer="FUTURE_LAYER"/);
  assert.match(html, /data-organic-layer="LEAD_VALID"/);
  assert.match(html, /data-layer-status="FUTURE_AVAIL"/);
  assert.match(html, /layer_id=FUTURE_LAYER/);
  assert.match(html, /note=FUTURE_NOTE/);
  assert.match(html, /attribution_note=FUTURE_ATTRIBUTION/);
  assert.match(html, /data-hop-status="FUTURE_HOP"/);
  assert.match(html, /data-growth-hop="FUTURE_HOP_ID"/);
  assert.match(html, /status=FUTURE_HOP/);
  assert.match(html, /data-growth-hop="constructor"/);
  assert.match(html, /data-growth-hop="toString"/);
  assert.match(html, /data-growth-hop="__proto__"/);
});

test("scope keeps its identifier and gains a Portuguese word", () => {
  assert.equal(scopeLabel("company"), "empresa");
  assert.equal(scopeLabel("infrastructure"), "infraestrutura");
  assert.equal(scopeLabel("client:acme-industria"), "cliente acme-industria");
  assert.equal(scopeLabel("repo:tjsasakifln/Governance"), "repositório tjsasakifln/Governance");
  assert.equal(scopeLabel("weird:thing"), "escopo não reconhecido");
  assert.equal(scopeLabel("FUTURE_SCOPE"), "escopo não reconhecido");
});

test("client cards keep unknown scopes raw only in data and technical details", () => {
  const fixture = CLIENT_FIXTURES[0];
  assert.ok(fixture);
  for (const scope of ["FUTURE_SCOPE", "future_namespace:item"]) {
    const html = clientCard({ ...fixture, scope } as ClientStatus);
    assert.match(visibleText(html), /escopo não reconhecido/);
    assert.doesNotMatch(visibleText(html), new RegExp(scope));
    assert.match(html, new RegExp(`data-scope="${scope}"`));
    assert.match(html, new RegExp(`scope=${scope}`));
  }
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

test("helpTerm exposes escaped contextual help through native keyboard and touch semantics", () => {
  const html = helpTerm("confiança", `1 < 2 & "aspas"`);
  assert.match(html, /^<details class="term-help"><summary class="term"/);
  assert.match(html, /data-help="1 &lt; 2 &amp; &quot;aspas&quot;"/);
  assert.match(html, /title="1 &lt; 2 &amp; &quot;aspas&quot;"/);
  assert.match(html, /<span class="term-help-text" role="note">1 &lt; 2 &amp; &quot;aspas&quot;<\/span><\/details>$/);
  assert.match(html, /abrir ajuda contextual/);
  assert.doesNotMatch(html, /tabindex="-1"/);
  assert.match(html, />confiança</);
});

test("productive commercial routes label the actual activity and pipeline shapes emitted by the projector", async () => {
  const projectorUrl = new URL(
    "../../../connectors/runner/src/projectors/project.ts",
    import.meta.url,
  ).href;
  const projector = (await import(projectorUrl)) as {
    projectCollector(envelope: Record<string, unknown>): Array<{ snapshot_kind: string; payload: Record<string, unknown> }>;
  };
  const observedAt = "2026-08-22T12:00:00Z";
  const projected = projector.projectCollector({
    collector: "warmbly",
    freshness_status: "FRESH",
    observed_at: observedAt,
    confidence: 0.9,
    source: { system: "warmbly", kind: "snapshot", locator: "operations" },
    payload: {
      operations: {
        deals: [
          {
            id: "deal-1",
            name: "Empresa Exemplo",
            status: "open",
            stage_name: "qualified",
            updated_at: observedAt,
            next_action: "Preparar proposta",
            value: 1000,
            currency: "BRL",
          },
          {
            id: "deal-future-stage",
            name: "Empresa em estágio futuro",
            status: "open",
            stage_name: "future_stage",
            updated_at: observedAt,
            next_action: "Interpretar estágio",
            value: 500,
            currency: "BRL",
          },
        ],
        tasks: [
          {
            id: "task-1",
            title: "Retornar ao contato",
            status: "in_progress",
            updated_at: observedAt,
          },
        ],
        inbound: [
          {
            lead_id: "lead-1",
            company: "Contato recebido",
            status: "do_not_contact",
          },
        ],
      },
      attention: [
        {
          id: "attention-1",
          kind: "overdue_task",
          title: "Retorno atrasado",
          why: "Prazo vencido",
          severity: "high",
          entity_ref: { type: "task", id: "task-1" },
          commercial_state: "in_progress",
          provenance: {
            source: { system: "warmbly", kind: "commercial", locator: "tasks" },
            observed_at: observedAt,
            freshness_status: "FRESH",
            confidence: 0.9,
          },
        },
        {
          id: "attention-2",
          kind: "confenge_attention",
          title: "Conta exige revisão",
          why: "Revisar próximo passo",
          severity: "high",
          entity_ref: { type: "account", id: "account-1" },
          commercial_state: "needs_attention",
          provenance: {
            source: { system: "warmbly", kind: "commercial", locator: "attention" },
            observed_at: observedAt,
            freshness_status: "FRESH",
            confidence: 0.9,
          },
        },
        {
          id: "attention-future",
          kind: "future_signal",
          title: "Evento futuro",
          why: "Requer interpretação humana",
          severity: "high",
          entity_ref: { type: "account", id: "account-2" },
          commercial_state: "needs_attention",
          provenance: {
            source: { system: "warmbly", kind: "commercial", locator: "attention" },
            observed_at: observedAt,
            freshness_status: "FRESH",
            confidence: 0.9,
          },
        },
        {
          id: "attention-future-state",
          kind: "confenge_attention",
          title: "Estado futuro",
          why: "Requer interpretação humana",
          severity: "high",
          entity_ref: { type: "account", id: "account-3" },
          commercial_state: "future_state",
          provenance: {
            source: { system: "warmbly", kind: "commercial", locator: "attention" },
            observed_at: observedAt,
            freshness_status: "FRESH",
            confidence: 0.9,
          },
        },
      ],
    },
  });
  const commercial = projected.find((item) => item.snapshot_kind === "commercial");
  assert.ok(commercial, "o projetor deveria produzir o recorte comercial");
  const snapshot = {
    ...commercial.payload,
    schema_version: "control-center.commercial-snapshot.v1",
    id: "cc:commercial:company",
    scope: "commercial",
    generated_at: observedAt,
    provenance: {
      source: { system: "warmbly", kind: "snapshot", locator: "operations" },
      observed_at: observedAt,
      freshness_status: "FRESH",
      confidence: 0.9,
    },
    authority: {
      catalog_authority: "governance",
      commercial_runtime: "warmbly",
      this_document: "read_model",
    },
  } as unknown as CommercialSnapshot;

  const activity = commercialBlock(snapshot, "atividade");
  const pipeline = commercialBlock(snapshot, "pipeline");
  assert.match(activity, /data-activity-event="overdue_task"/);
  assert.match(activity, /event=overdue_task/);
  assert.match(visibleText(activity), /tarefa atrasada/);
  assert.match(visibleText(activity), /em andamento/);
  assert.match(visibleText(activity), /contato proibido/);
  assert.match(visibleText(activity), /exige atenção/);
  assert.match(visibleText(activity), /estado não reconhecido/);
  assert.doesNotMatch(
    visibleText(activity),
    /\b(?:overdue_task|in_progress|do_not_contact|needs_attention|future_signal|future_state)\b/,
  );
  assert.match(activity, /event=do_not_contact/);
  assert.match(activity, /state=needs_attention/);
  assert.match(activity, /event=future_signal/);
  assert.match(activity, /state=future_state/);
  assert.match(pipeline, /data-stage="qualified"/);
  assert.match(pipeline, /stage=qualified/);
  assert.match(pipeline, /data-stage="future_stage"/);
  assert.match(pipeline, /stage=future_stage/);
  assert.match(visibleText(pipeline), /qualificado/);
  assert.match(visibleText(pipeline), /estado não reconhecido/);
  assert.doesNotMatch(visibleText(pipeline), /\b(?:qualified|future_stage|open)\b/);
});

test("statusPill shows the Portuguese label and keeps the raw token in data-raw", () => {
  const html = statusPill("BLOCKED_BY_SECRET", "bloqueado por credencial ausente");
  assert.match(html, /data-raw="BLOCKED_BY_SECRET"/);
  assert.match(html, />bloqueado por credencial ausente</);
  assert.doesNotMatch(visibleText(html), /BLOCKED_BY_SECRET/);
});

test("an authored read error is not exposed as the operator-facing banner", () => {
  const html = renderShell({
    destination: "hoje",
    viewKind: "error",
    view: {
      kind: "error",
      code: "CONTEXT_UNAVAILABLE",
      message: "context payload is not an object at /internal/read-model",
    },
    mockScenario: "http",
    adapterMode: "http",
  });
  assert.match(visibleText(html), /Não foi possível carregar este recorte\./);
  assert.doesNotMatch(visibleText(html), /context payload|internal\/read-model/);
  assert.match(html, /mensagem_original=context payload is not an object at \/internal\/read-model/);
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
  assert.doesNotMatch(hoje, /<span[^>]+data-help=/);
  assert.equal(
    [...hoje.matchAll(/data-help=/g)].length,
    [...hoje.matchAll(/<summary[^>]+data-help=/g)].length,
    "toda ajuda contextual deve estar num summary nativo acionável",
  );
  const crescimento = mountedHtml("#/crescimento");
  assert.match(crescimento, /data-help="Bloqueado é medição impedida[^"]*"/);
  const clientes = mountedHtml("#/clientes");
  assert.match(clientes, /data-help="Ausente é dado que não chegou[^"]*"/);
});

test("contextual disclosures are never serialized inside a paragraph", () => {
  for (const { hash, html } of everyMainRouteHtml()) {
    assert.equal(hasDetailsInsideParagraph(html), false, `${hash} contém <details> dentro de <p>`);
  }
  const hoje = mountedHtml("#/hoje");
  assert.match(hoje, /<div class="kicker">[\s\S]*?<details class="term-help freshness-help">/);
  assert.match(hoje, /<div class="prov-inline">[\s\S]*?<details class="term-help">/);
  const crescimento = mountedHtml("#/crescimento");
  assert.match(crescimento, /<div class="help-line"><details class="term-help">/);
});
