import { alertBody, alertDataAttributes } from "./alert-card";
import { escapeHtml } from "../escape";
import { formatMoney } from "../money";
import { sourcePresentationLabel } from "../provenance";
import { ownMapValue } from "../own-map";
import type { HojeSection, HojeViewModel } from "../hoje-compose";
import { WRITE_SHORTCUT_LABELS } from "../adapters/paths";
import { freshnessTone } from "../freshness-tone";
import { interactionDraftValue } from "../interaction-draft";
import {
  CONFIDENCE_HELP,
  confidenceWord,
  freshnessLabel,
  freshnessPill,
  helpTerm,
  severityLabel,
  statusPill,
  technicalDetails,
} from "./labels";
import {
  domainStateTone,
  type HojeDomainCard,
  type HojeDomainSummary,
  type HojeIntegration,
} from "../hoje-domains";
import { operationalTruthBlock, parseOperationalTruth } from "./operational-truth";
import type {
  FounderOperatingTruth,
  MorningFact,
  MorningException,
  MorningSource,
} from "../founder-operating-truth";

function rowCard(sectionId: string, row: HojeSection["rows"][number]): string {
  const tone = row.freshness_tone || freshnessTone(row.freshness_status);
  const money = row.money
    ? `<p class="money" data-amount-cents="${row.money.amount_cents}" data-currency="${escapeHtml(row.money.currency)}">${escapeHtml(formatMoney(row.money))}</p>`
    : "";
  if (row.alert) {
    // Alert rows get the actionable card: severity in Portuguese, impact,
    // origin, owner, age, deadline and "O que fazer agora" up front; the
    // engine formula behind a closed disclosure.
    return `
    <article class="card ${sectionId === "incidents" ? "attention" : "hoje-row"} alert-card" ${alertDataAttributes(row.alert)} data-freshness="${escapeHtml(row.freshness_status)}" data-tone="${escapeHtml(tone)}">
      <header>
        <h3>${escapeHtml(row.title)}</h3>
      </header>
      ${alertBody(row.alert, {
        source: row.source,
        observed_at: row.observed_at,
        freshness_status: row.freshness_status,
        confidence: row.confidence ?? 0,
      })}
      ${money}
    </article>
  `;
  }
  const severity = row.severity ? statusPill(row.severity, severityLabel(row.severity)) : "";
  const confidence =
    row.confidence !== undefined
      ? `${confidenceWord(row.confidence)} (${String(row.confidence).replace(".", ",")})`
      : "—";
  return `
    <article class="card ${sectionId === "incidents" ? "attention" : "hoje-row"}" data-id="${escapeHtml(row.id)}" data-freshness="${escapeHtml(row.freshness_status)}" data-tone="${escapeHtml(tone)}"${row.severity ? ` data-severity="${escapeHtml(row.severity)}"` : ""}>
      <header>
        <div class="kicker">${severity}${freshnessPill(row.freshness_status)} <span class="sr-only">${escapeHtml(freshnessLabel(row.freshness_status))}</span></div>
        <h3>${escapeHtml(row.title)}</h3>
      </header>
      <p>${escapeHtml(row.summary)}</p>
      ${money}
      <div class="prov-inline">
        <span>Origem: ${escapeHtml(sourcePresentationLabel(row.source))}</span>
        · Observado <time datetime="${escapeHtml(row.observed_at)}">${escapeHtml(row.observed_at_local)}</time>
        <span class="sr-only">UTC ${escapeHtml(row.observed_at)}</span>
        · ${helpTerm("confiança", CONFIDENCE_HELP)} ${escapeHtml(confidence)}
      </div>
      ${technicalDetails(
        [
          { term: "id", value: row.id },
          { term: "sistema", value: row.source.system },
          { term: "tipo_de_origem", value: row.source.kind },
          { term: "locator", value: row.source.locator },
          { term: "freshness_status", value: row.freshness_status },
          { term: "observed_at_utc", value: row.observed_at },
          { term: "severity", value: row.severity ?? "" },
          { term: "kind", value: row.kind ?? "" },
        ],
        "hoje-row",
      )}
    </article>
  `;
}

function shortcutForm(section: HojeSection): string {
  return section.shortcuts
    .map((shortcut) => {
      const label = ownMapValue(WRITE_SHORTCUT_LABELS, shortcut.kind) ?? "Atalho operacional";
      const draftKey = `shortcut:${shortcut.kind}`;
      return `
        <form class="shortcut-form" data-shortcut-form="${escapeHtml(shortcut.kind)}" data-draft-key="${escapeHtml(draftKey)}" data-interaction="today.directive" data-write-path="/v1/directives">
          <h3>${escapeHtml(label)}</h3>
          <p class="hint">${escapeHtml(shortcut.hint)}</p>
          <label>
            Título
            <input name="title" type="text" required maxlength="200" autocomplete="off" value="${escapeHtml(interactionDraftValue(draftKey, "title"))}" />
          </label>
          <label>
            Corpo
            <textarea name="body" required maxlength="8000" rows="3">${escapeHtml(interactionDraftValue(draftKey, "body"))}</textarea>
          </label>
          <button type="submit">${escapeHtml(label)}</button>
          ${technicalDetails(
            [
              { term: "endpoint", value: "POST /v1/directives" },
              { term: "shortcut_kind", value: shortcut.kind },
            ],
            "write-shortcut",
          )}
        </form>
      `;
    })
    .join("");
}

function pendingList(card: HojeDomainCard): string {
  if (card.pending.length === 0) {
    return `<p class="domain-empty">Nenhuma pendência listada. ${escapeHtml(card.state_reason)}</p>`;
  }
  return `<ul class="domain-pending">${card.pending
    .map(
      (item) =>
        `<li data-pending="${escapeHtml(item.label)}"><strong>${escapeHtml(String(item.count))}</strong> ${escapeHtml(item.label)}</li>`,
    )
    .join("")}</ul>`;
}

function domainCard(card: HojeDomainCard): string {
  const tone = domainStateTone(card.state);
  const confidence =
    card.confidence === null ? "sem leitura" : String(card.confidence).replace(".", ",");
  const source = card.source
    ? sourcePresentationLabel(card.source)
    : "origem não informada";
  const absenceLabels = {
    no_data: "sem dados",
    not_configured: "não configurado",
    upstream_error: "erro na origem",
  } as const;
  const absence = card.absence_reason
    ? ` ${statusPill(card.absence_reason, ownMapValue(absenceLabels, card.absence_reason) ?? "motivo não reconhecido")}`
    : "";
  return `
    <article class="card domain-card" data-domain-card="${escapeHtml(card.id)}" data-domain-state="${escapeHtml(card.state)}" data-freshness="${escapeHtml(card.freshness_status)}" data-tone="${escapeHtml(tone)}" data-presence="${escapeHtml(card.presence)}" data-action-count="${escapeHtml(String(card.action_count))}">
      <header>
        <div class="kicker">
          <span class="pill pill-state-${escapeHtml(card.state)}">${escapeHtml(card.state_label)}</span>
          ${freshnessPill(card.freshness_status)}${absence}
        </div>
        <h3>${escapeHtml(card.label)}</h3>
      </header>
      <p class="domain-reason">${escapeHtml(card.state_reason)}</p>
      ${card.truth === undefined ? "" : operationalTruthBlock(parseOperationalTruth(card.truth))}
      <p class="domain-indicator"><strong>Indicador:</strong> ${escapeHtml(card.indicator)}</p>
      ${pendingList(card)}
      <p class="prov-inline">
        <span>${escapeHtml(source)}</span>
        · última atualização ${
          card.observed_at
            ? `<time datetime="${escapeHtml(card.observed_at)}">${escapeHtml(card.observed_at_local)}</time>`
            : escapeHtml(card.observed_at_local)
        }
        · confiança ${escapeHtml(confidence)}
      </p>
      <p class="domain-link"><a href="${escapeHtml(card.href)}" data-domain-link="${escapeHtml(card.id)}">${escapeHtml(card.href_label)} (${escapeHtml(String(card.action_count))} sinal(is))</a></p>
      ${technicalDetails(
        card.source
          ? [
              { term: "sistema", value: card.source.system },
              { term: "tipo_de_origem", value: card.source.kind },
              { term: "locator", value: card.source.locator },
            ]
          : [],
        "hoje-domain-source",
      )}
    </article>
  `;
}

/**
 * Integration rows carry `data-domain-state` rather than the card-level
 * `data-tone`: the tone is already implied by the state and the pill class,
 * and duplicating it here only creates a second place for the two to disagree.
 */
function integrationRow(row: HojeIntegration): string {
  return `<li data-integration="${escapeHtml(row.system)}" data-domain-state="${escapeHtml(row.state)}" data-freshness="${escapeHtml(row.freshness_status)}" data-integration-error="${escapeHtml(row.error_code ?? "")}">
    <span class="pill pill-state-${escapeHtml(row.state)}">${escapeHtml(row.state_label)}</span>
    <strong>${escapeHtml(row.system_label)}</strong> — ${escapeHtml(row.detail)}
    ${freshnessPill(row.freshness_status)}
    <div class="prov-inline">última leitura ${escapeHtml(row.observed_at_local)}</div>
    ${technicalDetails(
      [
        { term: "sistema", value: row.system },
        { term: "tipo_de_origem", value: row.source_kind },
        { term: "locator", value: row.source_locator },
        { term: "error_code", value: row.error_code ?? "" },
        { term: "error_message", value: row.error_message ?? "" },
      ],
      "hoje-integration",
    )}
  </li>`;
}

const MORNING_TOKEN_LABELS: Record<string, string> = {
  PAUSED_BY_KILL_SWITCH: "pausado pelo kill switch",
  BLOCKED_GAPS: "bloqueado por lacunas",
  HEALTHY_200: "saudável · HTTP 200",
  PAYMENT_CONFIRMED: "pagamento confirmado",
  WAITING_FOR_ELIGIBLE_BATCH: "aguardando novo lote elegível",
  WAITING_FOR_EXTRA_CLI_REFRESH: "aguardando atualização do extra-cli",
  GO: "rodando",
  NO_GO: "bloqueado",
  ACTIVE: "ativo",
  PAUSED: "pausado",
  UNKNOWN: "desconhecido",
  KNOWN: "conhecido",
  FRESH: "fresco",
  STALE: "defasado",
  ERROR: "erro de coleta",
  CAN_ACCEPT: "pode aceitar",
  CANNOT_ACCEPT: "não pode aceitar",
  OPEN: "aberto",
  BLOCKED: "bloqueado",
  PROVEN: "comprovado",
  MISSING: "ausente",
  MATCH: "conciliado",
  MISMATCH: "divergente",
};

function morningText(value: string): string {
  return value.replace(
    /\b(PAUSED_BY_KILL_SWITCH|WAITING_FOR_ELIGIBLE_BATCH|WAITING_FOR_EXTRA_CLI_REFRESH|BLOCKED_GAPS|HEALTHY_200|PAYMENT_CONFIRMED|NO_GO|ACTIVE|PAUSED|UNKNOWN|KNOWN|FRESH|STALE|ERROR|CAN_ACCEPT|CANNOT_ACCEPT|OPEN|BLOCKED|PROVEN|MISSING|MISMATCH|MATCH|GO)\b/g,
    (token) => MORNING_TOKEN_LABELS[token] ?? "estado não reconhecido",
  );
}

function morningValue(value: string | number | null): string {
  return value === null ? "desconhecido" : morningText(String(value));
}

function morningSource(source: MorningSource): string {
  return technicalDetails(
    [
      { term: "source", value: `${source.system}:${source.kind}:${source.locator}` },
      { term: "as_of", value: source.as_of ?? "UNKNOWN" },
      { term: "freshness", value: source.freshness },
    ],
    "founder-operating-source",
  );
}

const EXCEPTION_LABELS: Record<MorningException["bucket"], string> = {
  identity_recipient_conflict: "conflito de identidade/destinatário",
  stale_drift: "dado defasado ou drift",
  party_role_conflict: "conflito de papel da parte",
  outbound_reply_handoff: "handoff de resposta outbound",
  payment_provider_ambiguity: "ambiguidade de pagamento/provider",
  capacity_unknown: "capacidade desconhecida",
  delivery_blocker: "blocker de entrega",
  runtime_mismatch: "divergência de runtime",
  other: "outra exceção",
};

function morningExceptionRow(item: MorningException): string {
  return `<article class="card" data-morning-exception="${escapeHtml(item.bucket)}" data-severity="${escapeHtml(item.severity)}">
    <p class="kicker">${escapeHtml(EXCEPTION_LABELS[item.bucket])} · ${escapeHtml(severityLabel(item.severity))}</p>
    <h4>${escapeHtml(item.reason)}</h4>
    <dl class="facts">
      <dt>Owner</dt><dd>${escapeHtml(item.owner)}</dd>
      <dt>Idade</dt><dd>${escapeHtml(item.age_seconds === null ? "desconhecida" : `${item.age_seconds}s`)}</dd>
      <dt>Próxima ação</dt><dd>${escapeHtml(morningText(item.next_action))}</dd>
      <dt>Atualização</dt><dd>${escapeHtml(morningText(item.source.freshness))}</dd>
      <dt>Evidência</dt><dd>${escapeHtml(morningText(item.evidence.join(" · ")))}</dd>
    </dl>
    ${morningSource(item.source)}
  </article>`;
}

function morningFacts(items: ReadonlyArray<readonly [string, string | number | null]>): string {
  return `<dl class="facts">${items.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(morningValue(value))}</dd>`).join("")}</dl>`;
}

function morningCard(
  id: string,
  title: string,
  facts: ReadonlyArray<readonly [string, string | number | null]>,
  source?: MorningSource,
  attributes = "",
): string {
  return `<article class="card" data-morning-domain="${id}"${attributes}><h3>${title}</h3>${morningFacts(facts)}${source ? morningSource(source) : ""}</article>`;
}

type RunwayFact = MorningFact<string | number>;

function runwayValue(fact: RunwayFact, suffix = ""): string {
  if (fact.value === null) return "DESCONHECIDO";
  const value = typeof fact.value === "number"
    ? new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(fact.value)
    : morningText(fact.value);
  return `${value}${suffix}`;
}

function runwayFact(metric: string, label: string, fact: RunwayFact, suffix = ""): string {
  return `<details class="runway-fact" data-runway-metric="${escapeHtml(metric)}" data-freshness="${escapeHtml(fact.source.freshness)}">
    <summary><span>${escapeHtml(label)}</span><strong>${escapeHtml(runwayValue(fact, suffix))}</strong></summary>
    <dl class="runway-readback">
      <dt>source</dt><dd>${escapeHtml(`${fact.source.system}:${fact.source.kind}:${fact.source.locator}`)}</dd>
      <dt>as_of</dt><dd>${escapeHtml(fact.source.as_of ?? "UNKNOWN")}</dd>
      <dt>freshness</dt><dd>${escapeHtml(fact.source.freshness)}</dd>
    </dl>
    ${fact.note ? `<p class="hint">${escapeHtml(fact.note)}</p>` : ""}
    <a href="${escapeHtml(fact.href)}">Abrir denominador e registros</a>
  </details>`;
}

function runwayGroup(
  id: string,
  title: string,
  facts: ReadonlyArray<readonly [string, string, RunwayFact, string?]>,
): string {
  return `<details class="runway-group" data-runway-group="${escapeHtml(id)}">
    <summary>${escapeHtml(title)}</summary>
    <div class="runway-facts">${facts.map(([metric, label, fact, suffix]) => runwayFact(metric, label, fact, suffix)).join("")}</div>
  </details>`;
}

function outboundRunwayBlock(truth: FounderOperatingTruth): string {
  const runway = truth.outbound_runway;
  const action = truth.primary_action;
  const transportTone = runway.transport.state.value === "GO" ? "go"
    : runway.transport.state.value === "PAUSED" ? "paused"
      : runway.transport.state.value === "NO_GO" ? "no-go" : "unknown";
  const reservoirSignal = runway.runway.reservoir_below_1000 === true
    ? `<span class="pill runway-low">reservoir abaixo de 1 mil</span>`
    : runway.runway.reservoir_below_1000 === false
      ? `<span class="pill">reservoir ≥ 1 mil</span>` : "";
  const blocker = runway.health.queue_fill_blocker.value;
  const headline = [
    ["Tem outbound rodando?", runway.transport.state, ""],
    ["Leads prontos", runway.runway.ready_reservoir, ""],
    ["Na fila agora", runway.runway.current_queued, ""],
    ["Munição estimada", runway.runway.estimated_days, " dias"],
  ] as const;
  const stages = [
    ["Target", runway.stock.target_confirmed],
    ["Destinatário", runway.stock.recipient_attributed],
    ["Elegível", runway.stock.eligible_current],
    ["Preparado", runway.stock.prepared],
    ["Aprovado delegado", runway.stock.delegated_approved],
    ["Queued", runway.stock.queued_reserved],
    ["Sent", runway.stock.sent],
  ] as const;
  const groups = [
    runwayGroup("transport", "Transporte", [
      ["transport-state", "Estado", runway.transport.state],
      ["runtime-sha", "Runtime SHA", runway.transport.runtime_sha],
      ["policy-version", "Policy version", runway.transport.policy_version],
      ["source-run-freshness", "Freshness do source run", runway.transport.source_run_freshness],
    ]),
    runwayGroup("stock", "Estoque", [
      ["target-confirmed", "TARGET_CONFIRMED", runway.stock.target_confirmed],
      ["recipient-attributed", "Destinatário atribuído", runway.stock.recipient_attributed],
      ["eligible-current", "Elegíveis atuais", runway.stock.eligible_current],
      ["prepared", "Preparados", runway.stock.prepared],
      ["delegated-approved", "Aprovados delegados", runway.stock.delegated_approved],
      ["human-approved", "Aprovados humanos", runway.stock.human_approved],
      ["queued-reserved", "QUEUED / reservados", runway.stock.queued_reserved],
      ["hold-exceptions", "HOLD / exceções", runway.stock.hold_exceptions],
      ["sent", "SENT", runway.stock.sent],
      ["attempted", "Tentados", runway.stock.attempted],
      ["provider-accepted", "Aceitos pelo provider", runway.stock.provider_accepted],
      ["delivered", "Delivered", runway.stock.delivered],
      ["replies", "Respostas", runway.stock.replies],
      ["suppressed", "Suprimidos", runway.stock.suppressed],
    ]),
    runwayGroup("runway", "Munição", [
      ["current-queued", "Fila atual", runway.runway.current_queued],
      ["furthest-due-at", "Último due_at", runway.runway.furthest_due_at],
      ["estimated-days", "Munição estimada", runway.runway.estimated_days, " dias"],
      ["slots-next-24h", "Slots reais · 24h", runway.runway.slots_next_24h],
      ["slots-next-7d", "Slots reais · 7d", runway.runway.slots_next_7d],
      ["ready-reservoir", "Reservoir pronto", runway.runway.ready_reservoir],
      ["source-feed-age", "Idade do source feed", runway.runway.source_feed_age_seconds, "s"],
      ["next-replenishment", "Próxima reposição", runway.runway.next_replenishment_state],
    ]),
    runwayGroup("health", "Health", [
      ["mailboxes-healthy", "Mailboxes saudáveis", runway.health.mailboxes_healthy],
      ["mailboxes-blocked", "Mailboxes bloqueadas", runway.health.mailboxes_blocked],
      ["mailboxes-unknown", "Mailboxes desconhecidas", runway.health.mailboxes_unknown],
      ["provider-errors", "Erros do provider", runway.health.provider_errors],
      ["bounces", "Bounces factuais", runway.health.bounces],
      ["complaints", "Complaints factuais", runway.health.complaints],
      ["stale-retired", "Stale retirados", runway.health.stale_retired],
      ["queue-fill-blocker", "Blocker do preenchimento", runway.health.queue_fill_blocker],
    ]),
  ].join("");

  return `<article class="card outbound-runway" data-morning-domain="outbound" data-outbound-runway="true" data-transport-state="${escapeHtml(runway.transport.state.value ?? "UNKNOWN")}" data-transport-tone="${transportTone}" data-integrity-state="${escapeHtml(runway.integrity.state)}">
    <header class="runway-title">
      <div><p class="kicker">Munição outbound · somente leitura</p><h3>Temos munição e transporte?</h3></div>
      <div>${reservoirSignal}<span class="pill">run ${escapeHtml(morningText(runway.integrity.source_run_match))}</span></div>
    </header>
    <div class="runway-headline">${headline.map(([label, fact, suffix]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(runwayValue(fact, suffix))}</strong></div>`).join("")}</div>
    <p class="runway-blocker"><strong>O que impede mais volume:</strong> ${escapeHtml(blocker === null ? "DESCONHECIDO" : morningText(blocker))}</p>
    <ol class="runway-stages" aria-label="Conservação do denominador outbound">${stages.map(([label, fact]) => `<li><span>${escapeHtml(label)}</span><strong>${escapeHtml(runwayValue(fact))}</strong></li>`).join("")}</ol>
    <div class="runway-groups">${groups}</div>
    <section class="runway-action" data-morning-domain="next-human-action" aria-labelledby="runway-action-title">
      <h4 id="runway-action-title">Ação humana</h4>
      ${action
        ? `<div><strong>${escapeHtml(action.label)}</strong><p>${escapeHtml(morningText(action.reason))}</p><span>Owner: ${escapeHtml(action.owner)}</span></div><a class="button" data-runway-primary-action="true" href="${escapeHtml(action.href)}">Abrir contexto</a>`
        : `<p class="domain-empty">Nenhuma ação primária é segura com as leituras atuais. UNKNOWN permanece visível.</p>`}
    </section>
  </article>`;
}

function founderOperatingTruthBlock(truth: FounderOperatingTruth): string {
  const data = truth.data;
  const web = truth.inbound_web;
  const delivery = truth.delivery_finance;
  const cards = [
    outboundRunwayBlock(truth),
    morningCard("data", "Dados", [
      ["Feed atual", data.current_feed], ["Run atual", data.current_run], ["Atualização", morningText(data.source.freshness)],
      ["Cobertura do target", data.target_coverage], ["Blocker", data.blocker],
    ], data.source),
    morningCard("inbound-web", "Inbound / Web", [
      ["Deploy identity", web.deploy_identity], ["Lead SLA", web.lead_sla_state], ["GSC readiness", web.gsc_readiness],
      ["Saúde da superfície pública", web.public_surface_health],
    ], web.source),
    morningCard("delivery-finance", "Delivery / Finance", [
      ["Work Orders ativos", delivery.active_work_orders], ["Policy ceiling", delivery.policy_ceiling],
      ["Capacidade alocada", `${morningValue(delivery.staffed_capacity)} · ${morningText(delivery.staffed_capacity_state)}`],
      ["Committed / available", `${morningValue(delivery.committed)} / ${morningValue(delivery.available)}`],
      ["Atualização / admissão", `${morningText(delivery.capacity_freshness)} / ${morningText(delivery.admission)}`],
      ["Checkout / Asaas", `${morningText(delivery.checkout_gate)} / ${morningText(delivery.asaas_gate)}`], ["Exceções", delivery.exceptions],
    ], delivery.source, ` data-capacity-state="${escapeHtml(delivery.staffed_capacity_state)}"`),
  ].join("");
  const exceptionDetails = truth.exceptions.length === 0
    ? `<p class="domain-empty">Nenhuma exceção observada. Ausência de fila não substitui freshness das origens.</p>`
    : `<details class="tech" data-morning-exceptions="${truth.exceptions.length}"><summary>Abrir fila de exceções (${truth.exceptions.length})</summary><div class="cards">${truth.exceptions.map(morningExceptionRow).join("")}</div></details>`;
  return `<section class="stack founder-operating-truth" aria-labelledby="founder-operating-title" data-founder-operating-truth="true" data-primary-action-count="${truth.primary_action ? "1" : "0"}">
    <header>
      <p class="kicker">Verdade operacional · somente leitura</p>
      <h2 id="founder-operating-title">Control Center para a manhã</h2>
      <details class="founder-constraints"><summary>Limites de interpretação</summary><p class="constraint">Configurado não significa provado. Aprovado não significa enviado. Pagamento confirmado não significa receita recebida. Teto de política não significa capacidade alocada.</p></details>
    </header>
    <div class="cards domain-grid">${cards}</div>
    ${exceptionDetails}
  </section>`;
}

function domainSummaryBlock(summary: HojeDomainSummary): string {
  const total = summary.action_total;
  const totalText = total === null ? "indisponível" : String(total);
  const totalSuffix =
    total === null
      ? " — total de sinais para triagem indisponível."
      : " sinal(is) operacional(is) exigem triagem agora.";
  const unmapped =
    summary.unmapped.length === 0
      ? ""
      : `<p class="domain-unmapped">Alertas em origens sem card próprio: ${summary.unmapped
          .map(
            (row) =>
              `<a href="${escapeHtml(row.href)}" data-unmapped-domain="${escapeHtml(row.domain)}">${escapeHtml(row.domain)} (${escapeHtml(String(row.count))})</a>`,
          )
          .join(" · ")}</p>`;
  const integrations =
    summary.integrations.length === 0
      ? `<p class="domain-empty" data-integrations="0">Faltam dados: nenhuma observação de origem chegou nesta leitura. Não significa que as integrações estejam sãs.</p>`
      : `<ul class="domain-integrations">${summary.integrations.map(integrationRow).join("")}</ul>`;
  return `
    ${founderOperatingTruthBlock(summary.founder_truth)}
    <p class="domain-total" data-action-total="${escapeHtml(total === null ? "unknown" : totalText)}">
      <strong>${escapeHtml(totalText)}</strong>${escapeHtml(totalSuffix)}
      <span class="hint">${escapeHtml(summary.action_total_note)}</span>
    </p>
    ${unmapped}
    <div class="cards domain-grid">${summary.cards.map(domainCard).join("")}</div>
    <section class="domain-outbound" aria-labelledby="hoje-outbound" data-outbound-state="${escapeHtml(summary.outbound.state)}" data-outbound-observed="${summary.outbound.observed ? "true" : "false"}">
      <h3 id="hoje-outbound">Warmbly / disparo de saída</h3>
      <p><span class="pill pill-outbound">${escapeHtml(summary.outbound.label)}</span> ${escapeHtml(summary.outbound.detail)}</p>
      <p class="domain-link"><a href="${escapeHtml(summary.outbound.href)}" data-domain-link="outbound">Abrir controles do disparo</a></p>
    </section>
    <section class="domain-integrations-block" aria-labelledby="hoje-integracoes">
      <h3 id="hoje-integracoes">Integrações críticas</h3>
      ${integrations}
    </section>
  `;
}

function renderSection(section: HojeSection): string {
  let body: string;
  if (section.id === "domains") {
    body = section.summary
      ? domainSummaryBlock(section.summary)
      : `<p class="kpi-summary">Faltam dados: o panorama por domínio não pôde ser montado nesta leitura.</p>`;
  } else if (section.id === "shortcuts") {
    body = `<div class="shortcut-grid">${shortcutForm(section)}</div>`;
  } else if (section.compressed) {
    body = `<p class="kpi-summary">${escapeHtml(section.compressed_summary ?? "")}</p>`;
  } else if (section.id === "top3") {
    body = `<ol class="priorities">${section.rows
      .map(
        (row) =>
          `<li class="card priority" data-operational-component="priority" data-rank="${escapeHtml(row.kind?.replace("rank-", "") ?? "")}" data-id="${escapeHtml(row.id)}">${rowCard(section.id, row)}</li>`,
      )
      .join("")}</ol>`;
  } else {
    body = `<div class="stack">${section.rows.map((row) => rowCard(section.id, row)).join("")}</div>`;
  }
  return `
    <section class="band" data-band="${escapeHtml(section.id)}" data-compressed="${section.compressed ? "true" : "false"}" aria-labelledby="hoje-${escapeHtml(section.id)}">
      <h2 id="hoje-${escapeHtml(section.id)}">${escapeHtml(section.title)}</h2>
      ${body}
    </section>
  `;
}

export function renderHoje(view: HojeViewModel): string {
  return view.sections.map(renderSection).join("");
}

export function hojeSectionTitlesInOrder(html: string): string[] {
  const matches = [...html.matchAll(/data-band="[^"]+"[^>]*>\s*<h2[^>]*>([^<]+)<\/h2>/g)];
  return matches.map((m) => m[1] ?? "");
}
