import { alertBody, alertDataAttributes } from "./alert-card";
import { escapeHtml } from "../escape";
import { formatMoney } from "../money";
import { sourcePresentationLabel } from "../provenance";
import type { HojeSection, HojeViewModel } from "../hoje-compose";
import { WRITE_SHORTCUT_LABELS } from "../adapters/paths";
import { freshnessTone } from "../freshness-tone";
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
      const label = WRITE_SHORTCUT_LABELS[shortcut.kind];
      return `
        <form class="shortcut-form" data-shortcut-form="${escapeHtml(shortcut.kind)}" data-write-path="/v1/directives">
          <h3>${escapeHtml(label)}</h3>
          <p class="hint">${escapeHtml(shortcut.hint)}</p>
          <label>
            Título
            <input name="title" type="text" required maxlength="200" autocomplete="off" />
          </label>
          <label>
            Corpo
            <textarea name="body" required maxlength="8000" rows="3"></textarea>
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
    ? ` ${statusPill(card.absence_reason, absenceLabels[card.absence_reason])}`
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
    <span class="prov-inline">última leitura ${escapeHtml(row.observed_at_local)}</span>
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
          `<li class="card priority" data-rank="${escapeHtml(row.kind?.replace("rank-", "") ?? "")}" data-id="${escapeHtml(row.id)}">${rowCard(section.id, row)}</li>`,
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
