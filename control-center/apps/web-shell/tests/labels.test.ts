import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryRuntime, mount } from "../src/app";
import { createMockAdapter } from "../src/adapters/index";
import { DESTINATIONS } from "../src/destinations";
import type { CommercialSnapshot } from "../src/types";
import { commercialBlock } from "../src/ui/domains";
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
  availabilityLabel,
  confidenceWord,
  exceptionKindLabel,
  freshnessLabel,
  helpTerm,
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
    .replace(/<span class="term-help-text"[^>]*>[\s\S]*?<\/span>/g, " ")
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

test("a code the backend never enumerated survives untranslated instead of being invented", () => {
  assert.equal(exceptionKindLabel("missing_version"), "versão de oferta ausente");
  assert.equal(exceptionKindLabel("some_code_warmbly_just_invented"), "some_code_warmbly_just_invented");
  assert.equal(availabilityLabel("BLOCKED_BY_SECRET"), "bloqueado por credencial ausente");
  assert.equal(availabilityLabel("A_BRAND_NEW_CODE"), "A_BRAND_NEW_CODE");
});

test("scope keeps its identifier and gains a Portuguese word", () => {
  assert.equal(scopeLabel("company"), "empresa");
  assert.equal(scopeLabel("infrastructure"), "infraestrutura");
  assert.equal(scopeLabel("client:acme-industria"), "cliente acme-industria");
  assert.equal(scopeLabel("repo:tjsasakifln/Governance"), "repositório tjsasakifln/Governance");
  assert.equal(scopeLabel("weird:thing"), "weird:thing");
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
            company: "Empresa Exemplo",
            status: "open",
            stage_name: "qualified",
            updated_at: observedAt,
            next_action: "Preparar proposta",
            value: 1000,
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
            id: "lead-1",
            name: "Contato recebido",
            status: "NEW",
            updated_at: observedAt,
          },
        ],
      },
      attention: [
        {
          id: "attention-1",
          kind: "overdue_task",
          status: "open",
          why: "Prazo vencido",
          detected_at: observedAt,
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
  assert.match(visibleText(activity), /novo contato/);
  assert.doesNotMatch(visibleText(activity), /\b(?:overdue_task|in_progress|open|NEW)\b/);
  assert.match(pipeline, /data-stage="qualified"/);
  assert.match(pipeline, /stage=qualified/);
  assert.match(visibleText(pipeline), /qualificado/);
  assert.doesNotMatch(visibleText(pipeline), /\b(?:qualified|open)\b/);
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
