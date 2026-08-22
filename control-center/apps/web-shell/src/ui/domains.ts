import { escapeHtml } from "../escape";
import { formatLocal } from "../datetime";
import { formatMoney } from "../money";
import type {
  AgentActivity,
  ClientStatus,
  CommercialSnapshot,
  Directive,
  EngineeringSnapshot,
  FinanceSnapshot,
  ServiceHealth,
} from "../types";
import { provenanceBlock } from "./provenance";
import {
  ABSENT_HELP,
  BLOCKED_HELP,
  agentStatusLabel,
  authorityLabel,
  availabilityLabel,
  clientLifecycleLabel,
  directiveKindLabel,
  directiveStatusLabel,
  exceptionKindLabel,
  freshnessLabel,
  healthLabel,
  helpTerm,
  hopStatusLabel,
  MEMORY_GROUP_TITLES,
  operatorActionLabel,
  operatorOutcomeLabel,
  providerMutationLabel,
  scopeLabel,
  statusPill,
  technicalDetails,
} from "./labels";

function fact(label: string, value: string, extra = ""): string {
  return `<div${extra}><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div>`;
}

function optionalCount(label: string, value: number | undefined): string {
  return typeof value === "number"
    ? fact(label, String(value))
    : fact(label, helpTerm("ausente", ABSENT_HELP), ` data-absent="true"`);
}

function optionalMoney(label: string, money: { amount_cents: number; currency: string } | undefined): string {
  return money ? moneyFact(label, money) : fact(label, helpTerm("ausente", ABSENT_HELP), ` data-absent="true"`);
}

function moneyFact(label: string, money: { amount_cents: number; currency: string }): string {
  return `
    <div class="money" data-amount-cents="${money.amount_cents}" data-currency="${escapeHtml(money.currency)}">
      <dt>${escapeHtml(label)}</dt>
      <dd>${escapeHtml(formatMoney(money))}</dd>
    </div>
  `;
}

function listFact(label: string, items: string[] | undefined): string {
  if (!items || items.length === 0) return "";
  return fact(label, escapeHtml(items.join(", ")));
}

function operationsOf(snapshot: CommercialSnapshot | undefined): Record<string, unknown> {
  return snapshot?.operations && typeof snapshot.operations === "object" ? snapshot.operations : {};
}

export const GROWTH_FUNNEL_HOPS = [
  "search_visibility",
  "click_session",
  "cta",
  "inbound_event",
  "lead",
  "qualified_lead",
  "opportunity",
  "commercial_proposal",
  "client_revenue",
] as const;

const GROWTH_HOP_LABELS: Record<(typeof GROWTH_FUNNEL_HOPS)[number], string> = {
  search_visibility: "Visibilidade de busca",
  click_session: "Clique/sessão",
  cta: "CTA",
  inbound_event: "Evento inbound",
  lead: "Lead",
  qualified_lead: "Lead qualificado",
  opportunity: "Oportunidade",
  commercial_proposal: "Proposta comercial",
  client_revenue: "Cliente/receita",
};

function hopStatusFor(hop: string, row: Record<string, unknown> | undefined): string {
  if (row && typeof row.status === "string" && row.status.length > 0) return row.status;
  if (hop === "search_visibility" || hop === "click_session") return "BLOCKED";
  return "UNKNOWN";
}

export function growthFunnelBlock(snapshot: CommercialSnapshot | undefined): string {
  const ops = operationsOf(snapshot);
  const growth = ops.growth && typeof ops.growth === "object" ? (ops.growth as Record<string, unknown>) : {};
  const fromContract = Array.isArray(growth.funnel_contract)
    ? growth.funnel_contract.map(String).filter((hop) => hop.length > 0)
    : [];
  const hops = fromContract.length > 0 ? fromContract : [...GROWTH_FUNNEL_HOPS];
  const scoreboard = growth.scoreboard && typeof growth.scoreboard === "object" ? (growth.scoreboard as Record<string, unknown>) : {};
  const stages = Array.isArray(scoreboard.stages) ? scoreboard.stages : [];
  const byId = new Map<string, Record<string, unknown>>();
  for (const item of stages) {
    const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const id = String(row.id ?? row.stage ?? "");
    if (id) byId.set(id, row);
  }
  const attribution =
    growth.attribution && typeof growth.attribution === "object" ? (growth.attribution as Record<string, unknown>) : {};
  const note = String(
    attribution.note ??
      "Etapa sem identificador durável fica como desconhecida ou bloqueada. Nenhum cruzamento entre sistemas é inventado. " +
        "As etapas de busca e clique seguem bloqueadas enquanto não houver ingestão de dados de busca.",
  );
  const organic =
    growth.organic_scoreboard && typeof growth.organic_scoreboard === "object"
      ? (growth.organic_scoreboard as Record<string, unknown>)
      : {};
  const organicConfigured = organic.configured === true;
  const organicWindows = Array.isArray(organic.windows) ? organic.windows : [];
  const organicBlock = organicConfigured
    ? `<article class="card" data-organic-scoreboard="true">
        <h3>Placar de crescimento orgânico (Warmbly)</h3>
        <p>${escapeHtml(String(organic.note ?? "Inteligência de crescimento orgânico mantida pelo Warmbly."))}</p>
        ${technicalDetails(
          [
            { term: "schema", value: String(organic.schema ?? "") },
            { term: "real_empty", value: organic.real_empty === undefined ? "" : String(organic.real_empty) },
            { term: "availability", value: String(organic.availability ?? "") },
          ],
          "organic-scoreboard",
        )}
        <div class="stack">${
          organicWindows.length === 0
            ? `<p class="banner empty">Placar orgânico presente e vazio.</p>`
            : organicWindows
                .slice(0, 4)
                .map((item) => {
                  const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
                  const slices = Array.isArray(row.by_source)
                    ? row.by_source
                    : Array.isArray(row.slices)
                      ? row.slices
                      : [];
                  const first = slices[0] && typeof slices[0] === "object" ? (slices[0] as Record<string, unknown>) : {};
                  const layers = Array.isArray(first.layers) ? first.layers : [];
                  return `<article class="card" data-organic-window="${escapeHtml(String(row.id ?? ""))}">
                    <h4>Janela ${escapeHtml(String(row.id ?? "—"))}</h4>
                    <ul>${layers
                      .map((layer) => {
                        const ly = layer && typeof layer === "object" ? (layer as Record<string, unknown>) : {};
                        const layerStatus = String(ly.status ?? "UNKNOWN");
                        return `<li data-organic-layer="${escapeHtml(String(ly.id ?? ""))}" data-layer-status="${escapeHtml(layerStatus)}">${escapeHtml(String(ly.id ?? "camada"))}: ${escapeHtml(availabilityLabel(layerStatus))} (${escapeHtml(String(ly.count ?? "—"))}/${escapeHtml(String(ly.denominator ?? "—"))})</li>`;
                      })
                      .join("")}</ul>
                  </article>`;
                })
                .join("")
        }</div>
      </article>`
    : `<p class="banner empty" data-organic-scoreboard="false" data-availability="${escapeHtml(String(organic.availability ?? "NO_DATA"))}">Placar orgânico do Warmbly ausente nesta observação (${escapeHtml(availabilityLabel(String(organic.availability ?? "NO_DATA")))}).</p>`;
  return `
    <section class="stack domain-crescimento" aria-labelledby="crescimento-funil" data-domain="growth">
      <h2 id="crescimento-funil">Funil de crescimento</h2>
      <p class="constraint">${escapeHtml(note)}</p>
      ${organicBlock}
      <ol class="growth-hops">
        ${hops
          .map((hop) => {
            const row = byId.get(hop);
            const status = hopStatusFor(hop, row);
            const absent = !row;
            const detail = row && row.observation ? String(row.observation) : absent ? "etapa ausente nesta observação" : "";
            const label =
              hop in GROWTH_HOP_LABELS ? GROWTH_HOP_LABELS[hop as (typeof GROWTH_FUNNEL_HOPS)[number]] : hop;
            const shown =
              status === "BLOCKED"
                ? helpTerm(hopStatusLabel(status), BLOCKED_HELP)
                : escapeHtml(hopStatusLabel(status));
            return `<li class="card" data-growth-hop="${escapeHtml(hop)}" data-hop-status="${escapeHtml(status)}"${absent ? ` data-absent="true"` : ""}>
              <h3>${escapeHtml(label)}</h3>
              <p>${shown}${detail ? ` · ${escapeHtml(detail)}` : ""}</p>
              ${technicalDetails(
                [
                  { term: "hop", value: hop },
                  { term: "status", value: status },
                ],
                "growth-hop",
              )}
            </li>`;
          })
          .join("")}
      </ol>
    </section>
  `;
}

function metricRate(value: unknown): string {
  const rec = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  if (!rec) return "—";
  if (rec.availability === "JOIN_UNPROVEN" || rec.omitted_reason === "durable_contact_to_deal_join_unavailable") {
    const den = typeof rec.denominator === "number" ? rec.denominator : "—";
    return `${helpTerm("cruzamento entre sistemas não comprovado", BLOCKED_HELP)} (base de ${den})`;
  }
  const num = rec.numerator;
  const den = rec.denominator;
  if (typeof num !== "number" || typeof den !== "number") return "—";
  if (den === 0) return `${num}/${den} (sem denominador)`;
  const pct = rec.ratio === null || rec.ratio === undefined ? "—" : `${Math.round(Number(rec.ratio) * 1000) / 10}%`;
  const tiny = rec.tiny_denominator === true ? " · amostra pequena, não é evidência estatística" : "";
  return `${pct} (${num}/${den})${tiny}`;
}

export function commercialSubnav(surface: string | null): string {
  const items = [
    ["visao", "Visão"],
    ["cohorts", "Coortes"],
    ["atividade", "Atividade"],
    ["pipeline", "Pipeline"],
    ["excecoes", "Exceções"],
  ] as const;
  const current = surface && surface.length > 0 ? surface : "visao";
  return `<nav class="subnav" aria-label="Superfícies comerciais">${items
    .map(
      ([id, label]) =>
        `<a href="#/comercial/${id}" data-surface="${id}" aria-current="${current === id ? "page" : "false"}">${label}</a>`,
    )
    .join("")}</nav>`;
}

export function commercialBlock(snapshot: CommercialSnapshot, surface: string | null = "visao"): string {
  const funnel = snapshot.funnel;
  const weighted =
    snapshot.pipeline_weighted && snapshot.pipeline_weighted.probability_reliable
      ? moneyFact("Pipeline ponderado (probabilidade confiável)", snapshot.pipeline_weighted)
      : fact("Pipeline ponderado", "omitido — probabilidade não confiável");
  const extra = snapshot.extra_historical
    ? fact(
        snapshot.extra_historical.label ?? "Extra histórica",
        escapeHtml(
          snapshot.extra_historical.note ??
            "Nunca tratada como oferta pública. Catálogo canônico permanece em Governance.",
        ),
        ` data-extra-historical="true" data-public-offer="false"`,
      )
    : fact("Extra histórica", "não é oferta pública", ` data-extra-historical="true" data-public-offer="false"`);
  const drift = snapshot.offer_version_drift
    ? fact(
        "Divergência de oferta/versão",
        escapeHtml(snapshot.offer_version_drift.detail ?? String(snapshot.offer_version_drift.count)),
      )
    : "";
  const current = surface && surface.length > 0 ? surface : "visao";
  const recorte = `
    <section class="compact domain-comercial" aria-labelledby="comercial-recorte" data-domain="commercial">
      <h2 id="comercial-recorte">Recorte comercial (somente leitura)</h2>
      <p class="authority">Autoridade do catálogo: ${escapeHtml(authorityLabel(snapshot.authority.catalog_authority))}. Operação comercial: ${escapeHtml(authorityLabel(snapshot.authority.commercial_runtime))}. Este recorte: ${escapeHtml(authorityLabel(snapshot.authority.this_document))}.</p>
      <dl class="facts">
        ${optionalCount("Novos leads", funnel?.new_leads)}
        ${optionalCount("Qualificados", funnel?.qualified)}
        ${optionalCount("Oportunidades", funnel?.opportunities)}
        ${optionalCount("Propostas", funnel?.proposals)}
        ${optionalCount("Clientes", funnel?.clients)}
        ${snapshot.pipeline_nominal ? moneyFact("Pipeline nominal", snapshot.pipeline_nominal) : ""}
        ${weighted}
        ${typeof snapshot.aging_count === "number" ? fact("Negócios envelhecidos", String(snapshot.aging_count)) : ""}
        ${typeof snapshot.missing_next_action_count === "number" ? fact("Sem próxima ação", String(snapshot.missing_next_action_count)) : ""}
        ${typeof snapshot.stalled_count === "number" ? fact("Estágio parado", String(snapshot.stalled_count)) : ""}
        ${drift}
        ${extra}
        ${optionalCount("Pipeline aberto", snapshot.pipeline_open_count)}
        ${optionalCount("Mensagens recebidas sem leitura", snapshot.inbound_unread_count)}
        ${optionalCount("Clientes em risco", snapshot.at_risk_client_count)}
      </dl>
      ${provenanceBlock(snapshot.provenance)}
    </section>`;
  return `
    ${commercialSubnav(current)}
    ${current === "visao" ? recorte : ""}
    ${commercialOps(snapshot, current)}
  `;
}

/**
 * Operator cockpit for the CONFENGE outbound kill switch.
 *
 * Three controls and nothing else: pause, resume, acknowledge. There is no send
 * control here and there must never be one — this surface can stop outbound and
 * let it flow again, and that is the whole of its authority.
 *
 * Every reading is rendered as observed-or-"—". `state` is tri-state because
 * Warmbly reporting nothing is not the same as Warmbly reporting "running", and
 * an operator who is told ACTIVE when nobody knows will make the wrong call.
 */
function dispatchPanel(ops: Record<string, unknown>): string {
  const d = ops.dispatch && typeof ops.dispatch === "object" ? (ops.dispatch as Record<string, unknown>) : {};
  const state = String(d.state ?? "UNKNOWN");
  const label =
    state === "PAUSED" ? "Pausado" : state === "ACTIVE" ? "Ativo" : "Desconhecido";
  const show = (v: unknown): string => (v === undefined || v === null || v === "" ? "—" : String(v));
  const window =
    d.window_start && d.window_end
      ? `${String(d.window_start)}–${String(d.window_end)} ${show(d.timezone)}`
      : "—";
  const inWindow =
    typeof d.in_send_window === "boolean" ? (d.in_send_window ? "dentro da janela" : "fora da janela") : "—";
  const volume =
    typeof d.sent_last_hour === "number" || typeof d.cap === "number"
      ? `${show(d.sent_last_hour)} / ${show(d.cap)}`
      : "—";
  const last = ops.last_operator_action && typeof ops.last_operator_action === "object"
    ? (ops.last_operator_action as Record<string, unknown>)
    : null;
  const lastBlock = last
    ? `<dl class="facts">
        ${fact("Última ação", escapeHtml(operatorActionLabel(show(last.action))))}
        ${fact("Resultado", escapeHtml(operatorOutcomeLabel(show(last.outcome))))}
        ${fact("Operador", escapeHtml(show(last.actor_id)))}
        ${fact("Quando", escapeHtml(show(last.recorded_at)))}
        ${fact("Motivo registrado", escapeHtml(show(last.reason)))}
      </dl>
      ${technicalDetails(
        [
          { term: "action", value: show(last.action) },
          { term: "outcome", value: show(last.outcome) },
          { term: "actor_id", value: show(last.actor_id) },
          { term: "recorded_at", value: show(last.recorded_at) },
        ],
        "last-operator-action",
      )}`
    // Absence of a recorded action is not "nobody acted": this ledger is
    // in-process and a restart empties it.
    : `<p class="constraint">Nenhuma ação de operador registrada nesta instância do Control Center. Um reinício do serviço esvazia este registro — ausência aqui não prova que ninguém agiu.</p>`;

  return `
    <section class="stack domain-dispatch" aria-labelledby="dispatch-title" data-domain="dispatch" data-dispatch-state="${escapeHtml(state)}">
      <h2 id="dispatch-title">Disparo de saída (Warmbly)</h2>
      <article class="card" data-dispatch-observed="${d.observed === true ? "true" : "false"}">
        <p class="kicker">${statusPill(state, label)}</p>
        <dl class="facts">
          ${fact("Estado do disparo", escapeHtml(label))}
          ${fact("Motivo da pausa", escapeHtml(show(d.pause_reason)))}
          ${fact("Janela comercial", escapeHtml(window))}
          ${fact("Agora", escapeHtml(inWindow))}
          ${fact("Próximo slot", escapeHtml(show(d.next_slot_at)))}
          ${fact("Enviados na última hora / teto", escapeHtml(volume))}
          ${fact("Aprovados na fila", escapeHtml(show(d.queued_approved)))}
        </dl>
        ${d.why ? `<p class="constraint">${escapeHtml(String(d.why))}</p>` : ""}
        ${technicalDetails(
          [
            { term: "dispatch_state", value: state },
            { term: "observed", value: d.observed === true ? "true" : "false" },
            { term: "in_send_window", value: typeof d.in_send_window === "boolean" ? String(d.in_send_window) : "" },
            { term: "next_slot_at", value: d.next_slot_at === undefined ? "" : String(d.next_slot_at) },
          ],
          "dispatch",
        )}
      </article>
      <article class="card">
        <h3>Última ação do operador</h3>
        ${lastBlock}
      </article>
      <article class="card">
        <h3>Controles</h3>
        <p class="constraint" data-operator-scope="warmbly-write">Estas três ações escrevem no Warmbly. Não existe controle de envio aqui: pausar, retomar e reconhecer é toda a autoridade desta superfície.</p>
        <form data-warmbly-dispatch="pause" class="operator-form">
          <label>Motivo <input name="reason" required minlength="2" maxlength="200" placeholder="por que está pausando" /></label>
          <button type="submit">PAUSAR OUTBOUND</button>
        </form>
        <form data-warmbly-dispatch="resume" class="operator-form" data-two-step="true">
          <label>Motivo <input name="reason" required minlength="2" maxlength="200" placeholder="por que está retomando" /></label>
          <p class="constraint">Retomar libera e-mail frio para empresas reais. Enviar uma vez pede a confirmação; enviar de novo, com o mesmo motivo, executa.</p>
          <button type="submit">RETOMAR OUTBOUND (dois passos)</button>
        </form>
        <form data-warmbly-dispatch="acknowledge" class="operator-form">
          <label>Alerta <input name="target_id" required minlength="1" maxlength="128" placeholder="id do lead" /></label>
          <label>Motivo <input name="reason" maxlength="200" placeholder="opcional" /></label>
          <button type="submit">RECONHECER ALERTA</button>
        </form>
      </article>
    </section>`;
}

function commercialOps(snapshot: CommercialSnapshot, surface: string | null): string {
  const ops = operationsOf(snapshot);
  const current = surface && surface.length > 0 ? surface : "visao";
  const auto = ops.auto_send && typeof ops.auto_send === "object" ? (ops.auto_send as Record<string, unknown>) : {};
  const overview = ops.overview && typeof ops.overview === "object" ? (ops.overview as Record<string, unknown>) : {};
  const cohorts = ops.cohorts && typeof ops.cohorts === "object" ? (ops.cohorts as Record<string, unknown>) : {};
  const activity = Array.isArray(ops.activity) ? ops.activity : [];
  const pipeline = Array.isArray(ops.pipeline) ? ops.pipeline : [];
  const exceptions = Array.isArray(ops.exceptions) ? ops.exceptions : [];
  const availability = snapshot.availability ?? "UNKNOWN";
  let body = "";
  if (current === "cohorts") {
    const acquisition = Array.isArray(cohorts.acquisition) ? cohorts.acquisition : [];
    const inbound = cohorts.inbound_truth && typeof cohorts.inbound_truth === "object" ? (cohorts.inbound_truth as Record<string, unknown>) : {};
    body = `
      <section class="stack" aria-labelledby="cohorts-title">
        <h2 id="cohorts-title">Coortes</h2>
        <p class="constraint">${escapeHtml(String(cohorts.mixing_rule ?? "Coortes de aquisição e métricas de período são rotuladas em separado."))}</p>
        <div class="cards">${acquisition
          .map((item) => {
            const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
            return `<article class="card" data-cohort-window="${escapeHtml(String(row.window ?? ""))}">
              <h3>Janela ${escapeHtml(String(row.window))} · ${escapeHtml(String(row.kind))}</h3>
              <p>${escapeHtml(String(row.anchor_label ?? row.anchor_event ?? ""))}</p>
              <dl class="facts">
                ${fact("População", String(row.population ?? "—"))}
                ${fact("Contactados", String(row.contacted ?? "—"))}
                ${fact("Taxa de resposta", metricRate(row.reply_rate))}
                ${fact("Taxa de resposta qualificada", metricRate(row.qualified_reply_rate))}
                ${fact("Conversão em oportunidade", metricRate(row.opportunity_conversion))}
                ${fact("Conversão em fechamento", metricRate(row.win_conversion))}
              </dl>
            </article>`;
          })
          .join("")}</div>
        <article class="card">
          <h3>Origem das mensagens recebidas (Warmbly)</h3>
          <p>${escapeHtml(String(inbound.anchor_label ?? "Placar do Warmbly, quando presente. Não é coorte de aquisição."))}</p>
          <p>${inbound.configured === true ? "Configurado no Warmbly." : "Não configurado no Warmbly."}</p>
          ${technicalDetails(
            [
              { term: "configured", value: inbound.configured === undefined ? "" : String(inbound.configured) },
              { term: "schema", value: String(inbound.schema ?? "") },
            ],
            "inbound-truth",
          )}
        </article>
      </section>
      ${dispatchPanel(ops)}`;
  } else if (current === "atividade") {
    body = `<section aria-labelledby="atividade-title"><h2 id="atividade-title">Atividade recente</h2><div class="stack">${
      activity.length === 0
        ? `<p class="banner empty">Sem atividade observada neste recorte.</p>`
        : activity
            .map((item) => {
              const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
              return `<article class="card" data-activity-event="${escapeHtml(String(row.event ?? ""))}">
                <p class="kicker">${escapeHtml(String(row.at ?? ""))}</p>
                <h3>${escapeHtml(String(row.lead_or_account ?? row.source_id ?? "item"))}</h3>
                <p>${escapeHtml(String(row.evidence ?? row.state ?? ""))}</p>
                ${technicalDetails(
                  [
                    { term: "event", value: String(row.event ?? "") },
                    { term: "state", value: String(row.state ?? "") },
                    { term: "source_id", value: String(row.source_id ?? "") },
                  ],
                  "commercial-activity",
                )}
                <form data-operator-form="REVIEW_ACTIVITY" class="operator-form">
                  <input type="hidden" name="target_canonical_id" value="${escapeHtml(String(row.source_id ?? ""))}" />
                  <input type="hidden" name="target_source_id" value="${escapeHtml(String(row.source_id ?? ""))}" />
                  <label>Nota <textarea name="note" required minlength="2"></textarea></label>
                  <button type="submit">Validar atividade</button>
                </form>
              </article>`;
            })
            .join("")
    }</div></section>`;
  } else if (current === "pipeline") {
    body = `<section aria-labelledby="pipeline-title"><h2 id="pipeline-title">Pipeline ativo</h2><div class="stack">${
      pipeline.length === 0
        ? `<p class="banner empty">Sem negócios observados. Ausência não é zero.</p>`
        : pipeline
            .map((item) => {
              const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
              const value = row.value && typeof row.value === "object" ? (row.value as { amount_cents?: number; currency?: string }) : null;
              return `<article class="card" data-stale="${row.stale === true ? "true" : "false"}">
                <p class="kicker">${escapeHtml(String(row.stage ?? row.status ?? ""))} ${row.stale === true ? "· dado defasado" : ""}</p>
                <h3>${escapeHtml(String(row.display_name ?? row.id ?? "negócio"))}</h3>
                ${value && typeof value.amount_cents === "number" ? `<p class="money">${escapeHtml(formatMoney({ amount_cents: value.amount_cents, currency: value.currency ?? "BRL" }))}</p>` : ""}
                <dl class="facts">
                  ${fact("Próxima ação", escapeHtml(String(row.next_action ?? "ausente")))}
                  ${fact("Idade (segundos)", escapeHtml(String(row.age_seconds ?? "—")))}
                </dl>
                ${technicalDetails(
                  [
                    { term: "id", value: String(row.id ?? "") },
                    { term: "stage", value: String(row.stage ?? "") },
                    { term: "status", value: String(row.status ?? "") },
                  ],
                  "pipeline-deal",
                )}
              </article>`;
            })
            .join("")
    }</div></section>`;
  } else if (current === "excecoes") {
    body = `<section aria-labelledby="excecoes-ops-title"><h2 id="excecoes-ops-title">Exceções comerciais</h2>
      <p class="constraint" data-operator-scope="control-center-only">Reconhecer no Control Center é um registro de auditoria local. Isto não resolve a exceção no Warmbly.</p>
      <div class="stack">${
      exceptions.length === 0
        ? `<p class="banner empty">Nenhuma exceção observada.</p>`
        : exceptions
            .map((item) => {
              const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
              const kind = String(row.kind ?? "exception");
              return `<article class="card" data-exception-kind="${escapeHtml(kind)}">
                <p class="kicker">${statusPill(kind, exceptionKindLabel(kind))}</p>
                <h3>${escapeHtml(String(row.why ?? row.id ?? "exceção"))}</h3>
                <p>Recomendado: ${escapeHtml(String(row.recommended_next_action ?? "não determinado"))}</p>
                ${technicalDetails(
                  [
                    { term: "kind", value: kind },
                    { term: "canonical_id", value: String(row.canonical_id ?? "") },
                    { term: "source_id", value: String(row.source_id ?? row.id ?? "") },
                  ],
                  "commercial-exception",
                )}
                <form data-operator-form="ACKNOWLEDGE_EXCEPTION" class="operator-form">
                  <input type="hidden" name="target_canonical_id" value="${escapeHtml(String(row.canonical_id ?? row.id ?? ""))}" />
                  <input type="hidden" name="target_source_id" value="${escapeHtml(String(row.source_id ?? row.id ?? ""))}" />
                  <label>Nota <textarea name="note" required minlength="2"></textarea></label>
                  <button type="submit">Reconhecer no Control Center</button>
                </form>
              </article>`;
            })
            .join("")
    }</div></section>`;
  } else {
    body = `<section aria-labelledby="comercial-ops-title">
      <h2 id="comercial-ops-title">Operação agora</h2>
      <dl class="facts">
        ${fact("Disponibilidade da origem", escapeHtml(availabilityLabel(String(availability))), ` data-availability="${escapeHtml(String(availability))}"`)}
        ${fact("Envio automático", auto.enabled === true ? "observado ligado — o Control Center não liga envio" : "desligado")}
        ${fact("Exceções", escapeHtml(String(overview.exceptions ?? "—")))}
        ${fact("Trabalho em atraso", escapeHtml(String(overview.overdue_work ?? "—")))}
        ${fact("Mensagens recebidas a tratar", escapeHtml(String(overview.inbound_requiring_attention ?? "—")))}
        ${fact("Oportunidades a agir", escapeHtml(String(overview.opportunities_requiring_action ?? "—")))}
      </dl>
      ${technicalDetails([{ term: "availability", value: String(availability) }], "commercial-availability")}
    </section>`;
  }
  return body;
}

export function financeBlock(snapshot: FinanceSnapshot): string {
  const mrr =
    snapshot.mrr && snapshot.mrr.applicable
      ? moneyFact("Receita recorrente mensal (aplicável)", snapshot.mrr)
      : fact("Receita recorrente mensal", "omitida — não aplicável");
  const runway =
    snapshot.runway && snapshot.runway.cash_reliable && snapshot.runway.expense_reliable
      ? fact("Fôlego de caixa", `${snapshot.runway.months} mês(es)`)
      : fact("Fôlego de caixa", "omitido — caixa e despesas não confiáveis");
  return `
    <section class="compact domain-financeiro" aria-labelledby="financeiro-recorte" data-domain="finance">
      <h2 id="financeiro-recorte">Recorte financeiro (somente leitura)</h2>
      <p class="constraint" role="note">Mutações de provedor: ${escapeHtml(providerMutationLabel(snapshot.provider_mutations))}. Este recorte é ${escapeHtml(authorityLabel("read_model_only"))}: sem cobrança, checkout, estorno, cancelamento ou escrita no Asaas.</p>
      ${technicalDetails(
        [
          { term: "schema_version", value: snapshot.schema_version },
          { term: "provider_mutations", value: snapshot.provider_mutations },
          { term: "read_model_only", value: String(snapshot.read_model_only) },
        ],
        "finance-authority",
      )}
      <dl class="facts">
        ${snapshot.contracted ? moneyFact("Contratado", snapshot.contracted) : fact("Contratado", helpTerm("ausente", ABSENT_HELP), ` data-absent="true"`)}
        ${snapshot.billed ? moneyFact("Faturado", snapshot.billed) : fact("Faturado", helpTerm("ausente", ABSENT_HELP), ` data-absent="true"`)}
        ${snapshot.paid ? moneyFact("Pago", snapshot.paid) : fact("Pago", helpTerm("ausente", ABSENT_HELP), ` data-absent="true"`)}
        ${snapshot.effectively_received ? moneyFact("Efetivamente recebido", snapshot.effectively_received) : fact("Efetivamente recebido", helpTerm("ausente", ABSENT_HELP), ` data-absent="true"`)}
        ${optionalMoney("Vencido", snapshot.overdue ?? snapshot.receivables_overdue)}
        ${optionalMoney("A receber", snapshot.receivable ?? snapshot.receivables_open)}
        ${snapshot.refunds ? moneyFact("Estornos", snapshot.refunds) : fact("Estornos", helpTerm("ausente", ABSENT_HELP), ` data-absent="true"`)}
        ${snapshot.chargebacks ? moneyFact("Contestações de pagamento", snapshot.chargebacks) : fact("Contestações de pagamento", helpTerm("ausente", ABSENT_HELP), ` data-absent="true"`)}
        ${mrr}
        ${runway}
        ${optionalMoney("Recebíveis abertos", snapshot.receivables_open)}
        ${optionalMoney("Recebíveis em atraso", snapshot.receivables_overdue)}
      </dl>
      ${provenanceBlock(snapshot.provenance)}
    </section>
  `;
}

export function engineeringBlock(snapshot: EngineeringSnapshot): string {
  const hypo = snapshot.active_work_without_evidence
    ? fact(
        "Trabalho ativo sem evidência",
        escapeHtml(snapshot.active_work_without_evidence.detail ?? "permanece hipótese"),
        ` data-hypothesis="true"`,
      )
    : "";
  return `
    <section class="compact domain-engenharia" aria-labelledby="engenharia-recorte" data-domain="engineering">
      <h2 id="engenharia-recorte">Recorte de engenharia</h2>
      <dl class="facts">
        ${snapshot.repository ? fact("Repositório", escapeHtml(snapshot.repository)) : ""}
        ${snapshot.default_branch ? fact("Branch padrão", escapeHtml(snapshot.default_branch)) : ""}
        <div><dt>Pull requests abertos</dt><dd>${snapshot.open_pr_count}</dd></div>
        <div><dt>Integração contínua</dt><dd>${snapshot.failing_check_count} falhando${snapshot.ci?.status ? ` · ${escapeHtml(snapshot.ci.status)}` : ""}</dd></div>
        ${typeof snapshot.p0_count === "number" || typeof snapshot.p1_count === "number" ? fact("Prioridade 0 / prioridade 1", `P0 ${snapshot.p0_count ?? 0} · P1 ${snapshot.p1_count ?? 0}`) : ""}
        ${snapshot.aging ? fact("Itens envelhecidos", `${snapshot.aging.count ?? 0}${typeof snapshot.aging.oldest_days === "number" ? ` · mais antigo há ${snapshot.aging.oldest_days} dia(s)` : ""}`) : ""}
        ${listFact("Bloqueios", snapshot.blockers)}
        ${snapshot.last_evidence ? fact("Última evidência", escapeHtml(snapshot.last_evidence)) : ""}
        ${hypo}
        <div><dt>Verificações falhando</dt><dd>${snapshot.failing_check_count}</dd></div>
        <div><dt>Incidentes abertos</dt><dd>${snapshot.open_incident_count}</dd></div>
        ${listFact("Lista de permissões", snapshot.allowlist)}
      </dl>
      ${
        snapshot.repos && snapshot.repos.length > 0
          ? `<div class="stack">${snapshot.repos
              .map((repo) => {
                const name = String(repo.repository ?? repo.full_name ?? "repo");
                return `<article class="card">
                  <h3>${escapeHtml(name)}</h3>
                  <dl class="facts">
                    ${fact("Pull requests abertos", String(repo.open_pr_count ?? "—"))}
                    ${fact("Rascunho / prontos", `${repo.draft_pr_count ?? "—"} / ${repo.ready_pr_count ?? "—"}`)}
                    ${fact("Verificações falhando", String(repo.failing_check_count ?? "—"))}
                    ${fact("Última atividade", String(repo.last_activity_at ?? "—"))}
                  </dl>
                  <p><a href="https://github.com/${escapeHtml(name)}" rel="noreferrer">Abrir no GitHub</a></p>
                </article>`;
              })
              .join("")}</div>`
          : ""
      }
      ${provenanceBlock(snapshot.provenance)}
    </section>
  `;
}

function sourcePresence(label: string, key: string, value: string | undefined): string {
  const status = value && value.length > 0 ? value : "UNKNOWN";
  const absent =
    status === "UNKNOWN" ||
    status === "NO_DATA" ||
    status === "NOT_CONFIGURED" ||
    status === "BLOCKED_BY_SECRET";
  // `data-client-source` e `data-absent` seguem com o enum cru; só o texto muda.
  const shown = absent
    ? helpTerm(availabilityLabel(status), status === "BLOCKED_BY_SECRET" ? BLOCKED_HELP : ABSENT_HELP)
    : escapeHtml(availabilityLabel(status));
  return fact(
    label,
    shown,
    ` data-client-source="${escapeHtml(key)}" data-source-status="${escapeHtml(status)}"${absent ? ` data-absent="true"` : ""}`,
  );
}

export function clientCard(item: ClientStatus): string {
  const money = item.open_receivables
    ? `<p class="money" data-amount-cents="${item.open_receivables.amount_cents}" data-currency="${escapeHtml(item.open_receivables.currency)}">${escapeHtml(formatMoney(item.open_receivables))}</p>`
    : "";
  const due = item.due_date
    ? `<time datetime="${escapeHtml(item.due_date)}">${escapeHtml(formatLocal(item.due_date))}</time>`
    : "";
  const sources = item.sources ?? {};
  return `
    <article class="card client" data-lifecycle="${escapeHtml(item.lifecycle)}" data-id="${escapeHtml(item.id)}">
      <header>
        <p class="kicker">${statusPill(item.lifecycle, clientLifecycleLabel(item.lifecycle))} <span class="scope" data-scope="${escapeHtml(item.scope)}">${escapeHtml(scopeLabel(item.scope))}</span></p>
        <h3>${escapeHtml(item.display_name)}</h3>
      </header>
      ${item.notes ? `<p>${escapeHtml(item.notes)}</p>` : ""}
      ${money}
      <dl class="facts">
        <div><dt>Cliente</dt><dd>${escapeHtml(item.display_name)}</dd></div>
        ${item.health ? fact("Saúde", escapeHtml(clientLifecycleLabel(item.health))) : fact("Saúde", escapeHtml(clientLifecycleLabel(item.lifecycle)))}
        ${listFact("Compromissos", item.commitments)}
        ${item.owner ? fact("Responsável", escapeHtml(item.owner)) : ""}
        ${due ? fact("Vencimento", due) : ""}
        ${listFact("Entregáveis", item.deliverables)}
        ${listFact("Bloqueios", item.blockers)}
        ${item.next_action ? fact("Próxima ação", escapeHtml(item.next_action)) : ""}
        ${item.evidence ? fact("Evidência", escapeHtml(item.evidence)) : ""}
        ${sourcePresence("Warmbly", "warmbly", sources.warmbly)}
        ${sourcePresence("Asaas", "asaas", sources.asaas)}
        ${sourcePresence("Governance", "governance", sources.governance)}
      </dl>
      ${technicalDetails(
        [
          { term: "id", value: item.id },
          { term: "client_slug", value: item.client_slug ?? "" },
          { term: "scope", value: item.scope },
          { term: "lifecycle", value: item.lifecycle },
          { term: "schema_version", value: item.schema_version },
        ],
        "client",
      )}
      ${provenanceBlock(item.provenance)}
    </article>
  `;
}

function checkLine(label: string, value: { status?: string; detail?: string } | undefined): string {
  if (!value) return "";
  const status = value.status ? healthLabel(value.status) : "";
  return fact(
    label,
    escapeHtml([status, value.detail].filter(Boolean).join(" · ")),
    value.status ? ` data-check-status="${escapeHtml(value.status)}"` : "",
  );
}

export function healthCard(item: ServiceHealth): string {
  const tone = item.status === "healthy" && item.provenance.freshness_status === "FRESH" ? "green" : "not-green";
  return `
    <article class="card health" data-status="${escapeHtml(item.status)}" data-id="${escapeHtml(item.id)}" data-tone="${tone}" data-partial-outage="${item.partial_outage === true ? "true" : "false"}">
      <header>
        <p class="kicker">${statusPill(item.status, healthLabel(item.status))} <span class="sr-only">${escapeHtml(healthLabel(item.status))}</span> <span class="scope" data-scope="${escapeHtml(item.scope)}">${escapeHtml(scopeLabel(item.scope))}</span></p>
        <h3>${escapeHtml(item.service_name)}</h3>
      </header>
      ${item.message ? `<p>${escapeHtml(item.message)}</p>` : ""}
      ${item.latency_ms !== undefined ? `<p>Latência observada: ${item.latency_ms} ms</p>` : ""}
      ${item.partial_outage ? `<p class="constraint">Indisponibilidade parcial</p>` : ""}
      <dl class="facts">
        ${checkLine("Resposta HTTP", item.http)}
        ${checkLine("Certificado TLS", item.tls)}
        ${checkLine("Contêiner Docker", item.docker)}
        ${checkLine("Backup", item.backup)}
        ${item.disk ? fact("Disco", escapeHtml(item.disk.detail ?? `${item.disk.used_pct ?? "?"}%`)) : ""}
        ${item.memory ? fact("Memória", escapeHtml(item.memory.detail ?? `${item.memory.used_pct ?? "?"}%`)) : ""}
        ${
          item.pncp_freshness
            ? fact(
                "Atualização do PNCP",
                escapeHtml(
                  `${freshnessLabel(item.pncp_freshness.freshness_status)}${item.pncp_freshness.detail ? ` · ${item.pncp_freshness.detail}` : ""}`,
                ),
                ` data-pncp-freshness="${escapeHtml(item.pncp_freshness.freshness_status)}"`,
              )
            : ""
        }
      </dl>
      ${technicalDetails(
        [
          { term: "id", value: item.id },
          { term: "service_name", value: item.service_name },
          { term: "status", value: item.status },
          { term: "scope", value: item.scope },
          { term: "partial_outage", value: item.partial_outage === undefined ? "" : String(item.partial_outage) },
        ],
        "service-health",
      )}
      ${provenanceBlock(item.provenance)}
    </article>
  `;
}

export function directiveCard(item: Directive): string {
  const expires = item.expires_at ?? "sem expiração";
  const supersedes = item.supersedes?.join(", ") ?? "nenhuma";
  const kindLabel = directiveKindLabel(item.kind);
  const actor = item.created_by.display_name ?? item.created_by.id;
  return `
    <article class="card directive" data-kind="${escapeHtml(item.kind)}" data-status="${escapeHtml(item.status)}" data-id="${escapeHtml(item.id)}">
      <header>
        <p class="kicker">${statusPill(item.kind, kindLabel)} ${statusPill(item.status, directiveStatusLabel(item.status))} <span class="scope" data-scope="${escapeHtml(item.scope)}">${escapeHtml(scopeLabel(item.scope))}</span></p>
        <h3>${escapeHtml(item.title)}</h3>
      </header>
      <p>${escapeHtml(item.body)}</p>
      <dl class="facts">
        <div><dt>Vigente desde</dt><dd><time datetime="${escapeHtml(item.effective_from)}">${escapeHtml(item.effective_from)}</time></dd></div>
        <div><dt>Expira</dt><dd>${escapeHtml(expires)}</dd></div>
        <div><dt>Substitui</dt><dd>${escapeHtml(supersedes)}</dd></div>
        <div><dt>Revisões / substituições</dt><dd>${escapeHtml(supersedes)}</dd></div>
        <div><dt>Criado por</dt><dd>${escapeHtml(actor)}</dd></div>
      </dl>
      <p class="audit">Auditoria: ${item.audit.length} evento(s). Origem do dado no recorte de memória.</p>
      ${technicalDetails(
        [
          { term: "id", value: item.id },
          { term: "kind", value: item.kind },
          { term: "status", value: item.status },
          { term: "scope", value: item.scope },
          { term: "schema_version", value: item.schema_version },
          { term: "created_by", value: item.created_by.id },
        ],
        "directive",
      )}
    </article>
  `;
}

export function activityCard(item: AgentActivity): string {
  const statusLabel = agentStatusLabel(item.presentation_status);
  const staleRunning =
    item.presentation_status === "RUNNING" && item.provenance.freshness_status === "STALE"
      ? `<p class="constraint" data-stale-running="true">Em execução com observação defasada continua em execução — não vira concluído.</p>`
      : "";
  return `
    <article class="card session activity" data-status="${escapeHtml(item.presentation_status)}" data-raw-status="${escapeHtml(item.status)}" data-id="${escapeHtml(item.id)}">
      <header>
        <p class="kicker">${statusPill(item.presentation_status, statusLabel)} <span class="sr-only">${escapeHtml(statusLabel)}</span> <span class="scope" data-scope="${escapeHtml(item.scope)}">${escapeHtml(scopeLabel(item.scope))}</span></p>
        <h3>${escapeHtml(item.agent_id)}${item.provider ? ` · ${escapeHtml(item.provider)}` : ""}</h3>
      </header>
      <p>${escapeHtml(item.summary)}</p>
      ${staleRunning}
      <dl class="facts">
        <div><dt>Agente / provedor</dt><dd>${escapeHtml(item.agent_id)}${item.provider ? ` / ${escapeHtml(item.provider)}` : ""}</dd></div>
        <div><dt>Repositório / escopo</dt><dd>${escapeHtml(item.repo ?? item.scope)}</dd></div>
        <div><dt>Objetivo / campanha</dt><dd>${escapeHtml(item.goal)}${item.campaign ? ` · ${escapeHtml(item.campaign)}` : ""}</dd></div>
        ${listFact("Evidência", item.evidence_refs)}
        ${listFact("Bloqueios", item.blockers)}
        ${listFact("Trabalho residual", item.residual_work)}
      </dl>
      ${technicalDetails(
        [
          { term: "id", value: item.id },
          { term: "agent_id", value: item.agent_id },
          { term: "presentation_status", value: item.presentation_status },
          { term: "status", value: item.status },
          { term: "scope", value: item.scope },
          { term: "schema_version", value: item.schema_version },
        ],
        "agent-activity",
      )}
      ${provenanceBlock(item.provenance)}
    </article>
  `;
}

export function memoriaGroups(directives: Directive[]): string {
  const kinds = [
    "decision",
    "directive",
    "fact",
    "constraint",
    "priority",
    "risk",
    "hypothesis",
  ] as const;
  const labels = MEMORY_GROUP_TITLES;
  return kinds
    .map((kind) => {
      const rows = directives.filter((item) => item.kind === kind);
      if (rows.length === 0) return "";
      return `<section aria-labelledby="memoria-${kind}" data-memory-kind="${kind}"><h2 id="memoria-${kind}">${labels[kind]}</h2><div class="stack">${rows.map(directiveCard).join("")}</div></section>`;
    })
    .join("");
}
