import { alertBody, alertDataAttributes } from "./alert-card";
import { escapeHtml } from "../escape";
import { formatMoney } from "../money";
import type { HojeSection, HojeViewModel } from "../hoje-compose";
import { WRITE_SHORTCUT_LABELS } from "../adapters/paths";
import { freshnessTone } from "../freshness-tone";
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
  const severity = row.severity ? `<span class="pill">${escapeHtml(row.severity)}</span>` : "";
  return `
    <article class="card ${sectionId === "incidents" ? "attention" : "hoje-row"}" data-id="${escapeHtml(row.id)}" data-freshness="${escapeHtml(row.freshness_status)}" data-tone="${escapeHtml(tone)}"${row.severity ? ` data-severity="${escapeHtml(row.severity)}"` : ""}>
      <header>
        <p class="kicker">${severity}<span class="pill pill-${escapeHtml(row.freshness_status.toLowerCase())}">${escapeHtml(row.freshness_status)}</span> <span class="sr-only">${escapeHtml(row.freshness_status)}</span></p>
        <h3>${escapeHtml(row.title)}</h3>
      </header>
      <p>${escapeHtml(row.summary)}</p>
      ${money}
      <p class="prov-inline">
        <span>${escapeHtml(row.source.system)} · ${escapeHtml(row.source.kind)}</span>
        · <time datetime="${escapeHtml(row.observed_at)}">${escapeHtml(row.observed_at_local)}</time>
        <span class="sr-only">UTC ${escapeHtml(row.observed_at)}</span>
        · confiança ${row.confidence !== undefined ? String(row.confidence).replace(".", ",") : "—"}
      </p>
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
    ? `${card.source.system} · ${card.source.kind}`
    : "origem não informada";
  const absence = card.absence_reason
    ? ` <span class="pill" data-absence-reason="${escapeHtml(card.absence_reason)}">${escapeHtml(card.absence_reason)}</span>`
    : "";
  return `
    <article class="card domain-card" data-domain-card="${escapeHtml(card.id)}" data-domain-state="${escapeHtml(card.state)}" data-freshness="${escapeHtml(card.freshness_status)}" data-tone="${escapeHtml(tone)}" data-presence="${escapeHtml(card.presence)}" data-action-count="${escapeHtml(String(card.action_count))}">
      <header>
        <p class="kicker">
          <span class="pill pill-state-${escapeHtml(card.state)}">${escapeHtml(card.state_label)}</span>
          <span class="pill pill-${escapeHtml(card.freshness_status.toLowerCase())}">${escapeHtml(card.freshness_status)}</span>${absence}
        </p>
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
      <p class="domain-link"><a href="${escapeHtml(card.href)}" data-domain-link="${escapeHtml(card.id)}">${escapeHtml(card.href_label)} (${escapeHtml(String(card.action_count))} item(ns))</a></p>
    </article>
  `;
}

/**
 * Integration rows carry `data-domain-state` rather than the card-level
 * `data-tone`: the tone is already implied by the state and the pill class,
 * and duplicating it here only creates a second place for the two to disagree.
 */
function integrationRow(row: HojeIntegration): string {
  return `<li data-integration="${escapeHtml(row.system)}" data-domain-state="${escapeHtml(row.state)}" data-freshness="${escapeHtml(row.freshness_status)}">
    <span class="pill pill-state-${escapeHtml(row.state)}">${escapeHtml(row.state_label)}</span>
    <strong>${escapeHtml(row.system)}</strong> — ${escapeHtml(row.detail)}
    <span class="prov-inline">última leitura ${escapeHtml(row.observed_at_local)}</span>
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
