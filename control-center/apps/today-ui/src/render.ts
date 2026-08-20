import { escapeHtml, escapeJsonForScript } from "./escape.js";
import { freshnessLabel } from "./freshness.js";
import { formatMoney } from "./money.js";
import type { BandView, HojeRow, HojeView } from "./types.js";

function tidyHtml(html: string): string {
  return html
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

function provenanceLine(row: HojeRow): string {
  const sourceLabel = row.source.label ?? `${row.source.system} · ${row.source.kind}`;
  const conf =
    row.confidence === undefined
      ? ""
      : `<span class="conf">confiança ${escapeHtml(row.confidence.toFixed(2).replace(".", ","))}</span>`;
  const tone = escapeHtml(row.freshness_tone);
  const status = escapeHtml(row.freshness_status);
  const label = escapeHtml(freshnessLabel(row.freshness_status));
  return `
    <p class="meta" data-freshness="${status}" data-tone="${tone}" data-source="${escapeHtml(row.source.system)}">
      <span class="src">${escapeHtml(sourceLabel)}</span>
      <time datetime="${escapeHtml(row.observed_at)}">${escapeHtml(row.observed_at_local)}</time>
      <span class="sr-only">UTC ${escapeHtml(row.observed_at)}</span>
      <span class="pill tone-${tone}" data-tone="${tone}">${status} · ${label}</span>
      ${conf}
    </p>`;
}

function renderRow(row: HojeRow): string {
  const override = row.founder_override_visible
    ? `<p class="override" data-founder-override="${escapeHtml(row.founder_override_action ?? "pin")}">Prioridade do founder: ${escapeHtml(row.founder_override_action ?? "pin")}</p>`
    : "";
  const money = row.money
    ? `<p class="money" data-amount-cents="${row.money.amount_cents}" data-currency="${escapeHtml(row.money.currency)}">${escapeHtml(formatMoney(row.money))}</p>`
    : "";
  const sev = row.severity ? `<span class="pill">${escapeHtml(row.severity)}</span>` : "";
  const kind = row.kind ? `<span class="pill">${escapeHtml(row.kind)}</span>` : "";
  return `
    <article class="row" data-id="${escapeHtml(row.id)}" data-tone="${escapeHtml(row.freshness_tone)}" data-founder-override-visible="${row.founder_override_visible ? "true" : "false"}">
      <header>
        <p class="kicker">${sev}${kind}</p>
        <h3>${escapeHtml(row.title)}</h3>
      </header>
      <p>${escapeHtml(row.summary)}</p>
      ${money}
      ${override}
      ${provenanceLine(row)}
    </article>`;
}

function renderBand(band: BandView): string {
  const compressed = band.compressed ? "true" : "false";
  const cls = band.compressed ? "band band-compressed" : "band";
  const summary = band.compressed_summary
    ? `<p class="ignore">${escapeHtml(band.compressed_summary)}</p>`
    : "";
  const rows =
    band.rows.length > 0
      ? `<div class="rows">${band.rows.map(renderRow).join("")}</div>`
      : "";
  const shortcuts =
    band.shortcuts.length > 0
      ? `<div class="shortcuts">${band.shortcuts
          .map(
            (s) => `
        <button type="button" class="shortcut" data-shortcut="${escapeHtml(s.kind)}" data-label="${escapeHtml(s.label)}">
          ${escapeHtml(s.label)}
        </button>
        <p class="hint">${escapeHtml(s.hint)}</p>`,
          )
          .join("")}
        <p id="registrar-feedback" class="feedback" hidden></p>
      </div>`
      : "";
  return `
    <section class="${cls}" data-band-id="${escapeHtml(band.id)}" data-band-label="${escapeHtml(band.label)}" data-compressed="${compressed}">
      <h2>${escapeHtml(band.label)}</h2>
      ${summary}
      ${rows}
      ${shortcuts}
    </section>`;
}

export function renderHojeMain(view: HojeView): string {
  const bands = view.bands.map(renderBand).join("");
  return tidyHtml(`
    <header class="top">
      <p class="brand">Control Center</p>
      <h1>HOJE</h1>
      <p class="headline">${escapeHtml(view.headline)}</p>
      <p class="as-of"><time datetime="${escapeHtml(view.generated_at)}">${escapeHtml(view.generated_at)}</time></p>
    </header>
    <main id="hoje" data-fixture="${escapeHtml(view.fixture_name)}" data-charts-emitted="false">
      ${bands}
    </main>`);
}

export function renderHojeDocument(view: HojeView, options?: { cssHref?: string; jsHref?: string }): string {
  const cssHref = options?.cssHref ?? "./hoje.css";
  const jsHref = options?.jsHref ?? "./hoje.js";
  return tidyHtml(`<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="color-scheme" content="dark" />
  <meta name="theme-color" content="#121418" />
  <meta name="description" content="Confenge Control Center — HOJE. Cockpit de exceções. Sem chat. Sem mutações financeiras." />
  <title>HOJE — Control Center</title>
  <link rel="stylesheet" href="${escapeHtml(cssHref)}" />
</head>
<body>
  <div id="root">
${renderHojeMain(view)}
  </div>
  <script type="application/json" id="hoje-view">${escapeJsonForScript(view)}</script>
  <script src="${escapeHtml(jsHref)}"></script>
</body>
</html>
`);
}

export function dumpViewJson(view: HojeView): string {
  return `${JSON.stringify(view, null, 2)}\n`;
}
