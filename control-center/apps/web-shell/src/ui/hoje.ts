import { escapeHtml } from "../escape";
import { formatMoney } from "../money";
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

function rowCard(sectionId: string, row: HojeSection["rows"][number]): string {
  const tone = row.freshness_tone || freshnessTone(row.freshness_status);
  const money = row.money
    ? `<p class="money" data-amount-cents="${row.money.amount_cents}" data-currency="${escapeHtml(row.money.currency)}">${escapeHtml(formatMoney(row.money))}</p>`
    : "";
  const severity = row.severity ? statusPill(row.severity, severityLabel(row.severity)) : "";
  const confidence =
    row.confidence !== undefined
      ? `${confidenceWord(row.confidence)} (${String(row.confidence).replace(".", ",")})`
      : "—";
  return `
    <article class="card ${sectionId === "incidents" ? "attention" : "hoje-row"}" data-id="${escapeHtml(row.id)}" data-freshness="${escapeHtml(row.freshness_status)}" data-tone="${escapeHtml(tone)}"${row.severity ? ` data-severity="${escapeHtml(row.severity)}"` : ""}>
      <header>
        <p class="kicker">${severity}${freshnessPill(row.freshness_status)} <span class="sr-only">${escapeHtml(freshnessLabel(row.freshness_status))}</span></p>
        <h3>${escapeHtml(row.title)}</h3>
      </header>
      <p>${escapeHtml(row.summary)}</p>
      ${money}
      <p class="prov-inline">
        <span>Origem: ${escapeHtml(row.source.system)}</span>
        · Observado <time datetime="${escapeHtml(row.observed_at)}">${escapeHtml(row.observed_at_local)}</time>
        <span class="sr-only">UTC ${escapeHtml(row.observed_at)}</span>
        · ${helpTerm("confiança", CONFIDENCE_HELP)} ${escapeHtml(confidence)}
      </p>
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

function renderSection(section: HojeSection): string {
  let body: string;
  if (section.id === "shortcuts") {
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
