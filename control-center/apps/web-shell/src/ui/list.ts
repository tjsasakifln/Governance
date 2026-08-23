import { queryParamsOf } from "../destinations";
import { escapeHtml } from "../escape";
import {
  PAGE_SIZES,
  PERIODS,
  buildListView,
  clearListHref,
  facetValues,
  listHref,
  parseListQuery,
  referenceMsOf,
  remoteListResultOf,
  type FacetSpec,
  type ListSpec,
  type ListView,
} from "../filter";

export interface ListChromeInput {
  readonly spec: ListSpec;
  readonly rows: readonly Record<string, unknown>[];
  /** Current location, filters included. Every control is a rewrite of it. */
  readonly hash: string;
  /** Snapshot instant the relative date filter is measured back from. */
  readonly generatedAt?: string | undefined;
  readonly headingId: string;
  readonly heading: string;
  /** pt-BR noun for the count line, already pluralised, e.g. "atividade(s)". */
  readonly noun: string;
  /** Shown when the read model observed nothing at all. */
  readonly emptyData: string;
  readonly intro?: string;
  readonly card: (row: Record<string, unknown>) => string;
  /** Server-filtered bounded page. Omitted by the mock adapter. */
  readonly remote?: unknown;
  /** Coverage metadata used when talking to an older server without list pages. */
  readonly declaredTotal?: number;
  readonly complete?: boolean;
}

function option(value: string, label: string, selected: boolean): string {
  return `<option value="${escapeHtml(value)}"${selected ? " selected" : ""}>${escapeHtml(label)}</option>`;
}

function facetField(
  spec: ListSpec,
  facet: FacetSpec,
  values: readonly string[],
  current: string,
): string {
  const id = `${spec.id}-${facet.id}`;
  return `
    <div class="field">
      <label for="${escapeHtml(id)}">${escapeHtml(facet.label)}</label>
      <select id="${escapeHtml(id)}" name="${escapeHtml(facet.id)}">
        ${option("all", `Todos · ${facet.label}`, current === "all")}
        ${values.map((value) => option(value, value, current === value)).join("")}
      </select>
    </div>`;
}

function countText(view: ListView, noun: string): string {
  const coverage = view.complete
    ? `${view.total} ${noun}`
    : `${view.total} ${noun} pesquisáveis de ${view.declaredTotal} declarados pela origem`;
  const head = view.filtered
    ? view.complete
      ? `${view.matched} de ${view.total} ${noun} após busca/filtro`
      : `${view.matched} de ${view.total} ${noun} pesquisáveis após busca/filtro · ${view.declaredTotal} declarados pela origem`
    : coverage;
  if (view.matched === 0) return head;
  return `${head} · mostrando ${view.rangeStart}–${view.rangeEnd} · página ${view.page} de ${view.pageCount}`;
}

function pagination(view: ListView, hash: string, heading: string, listId: string): string {
  if (view.pageCount <= 1) return "";
  const prev =
    view.page > 1
      ? `<a class="page-step" rel="prev" href="${escapeHtml(listHref(hash, { pagina: view.page === 2 ? null : String(view.page - 1) }))}">← Anterior</a>`
      : `<span class="page-step" aria-disabled="true">← Anterior</span>`;
  const next =
    view.page < view.pageCount
      ? `<a class="page-step" rel="next" href="${escapeHtml(listHref(hash, { pagina: String(view.page + 1) }))}">Próxima →</a>`
      : `<span class="page-step" aria-disabled="true">Próxima →</span>`;
  return `
    <nav class="pagination" aria-label="Paginação · ${escapeHtml(heading)}" data-list-pagination="${escapeHtml(listId)}">
      ${prev}
      <p class="page-position">Página ${view.page} de ${view.pageCount} · ${view.matched} de ${view.total}</p>
      ${next}
    </nav>`;
}

/**
 * A long operational list with search, filters, sorting and pagination.
 *
 * All state lives in the URL, so a recorte is returnable and shareable and the
 * wholesale `root.innerHTML = renderShell(...)` repaint cannot lose it. The
 * paging controls are plain links for the same reason: they survive a repaint
 * with no handler attached to them at all.
 *
 * The empty state distinguishes the two cases that look identical on screen and
 * mean opposite things: nothing was observed, versus this filter matched none of
 * what was observed.
 */
export function renderFilteredList(input: ListChromeInput): string {
  const { spec, rows, hash, heading, headingId, noun } = input;
  const params = queryParamsOf(hash);
  const remote = remoteListResultOf(input.remote, spec);
  const query = remote?.view.query ?? parseListQuery(params, spec, rows);
  const referenceMs = referenceMsOf(rows, spec, input.generatedAt);
  const localView = buildListView(rows, spec, query, referenceMs);
  const declaredTotal = Math.max(rows.length, input.declaredTotal ?? rows.length);
  const view = remote?.view ?? {
    ...localView,
    declaredTotal,
    complete: input.complete ?? declaredTotal === rows.length,
  };
  const clearHref = clearListHref(hash);

  const available = spec.facets
    .map((facet) => ({ facet, values: remote?.facetValues[facet.id] ?? facetValues(rows, facet) }))
    .filter((entry) => entry.values.length > 0);
  const unavailable = remote
    ? spec.facets.filter((facet) => remote.unavailableFacets.includes(facet.id))
    : spec.facets.filter((facet) => !available.some((entry) => entry.facet.id === facet.id));

  const filters = `
    <form class="filters" data-list-filters="${escapeHtml(spec.id)}" aria-label="Busca e filtros · ${escapeHtml(heading)}">
      <div class="field grow">
        <label for="${escapeHtml(spec.id)}-q">Buscar</label>
        <input
          id="${escapeHtml(spec.id)}-q"
          name="q"
          type="search"
          value="${escapeHtml(query.q)}"
          autocomplete="off"
          placeholder="texto ou identificador"
        />
      </div>
      ${available
        .map((entry) =>
          facetField(spec, entry.facet, entry.values, query.facets[entry.facet.id] ?? "all"),
        )
        .join("")}
      <div class="field">
        <label for="${escapeHtml(spec.id)}-periodo">Período</label>
        <select id="${escapeHtml(spec.id)}-periodo" name="periodo">
          ${PERIODS.map((period) => option(period.id, period.label, query.periodo === period.id)).join("")}
        </select>
      </div>
      <div class="field">
        <label for="${escapeHtml(spec.id)}-ordem">Ordenar por</label>
        <select id="${escapeHtml(spec.id)}-ordem" name="ordem">
          ${spec.sorts.map((sort) => option(sort.id, sort.label, query.ordem === sort.id)).join("")}
        </select>
      </div>
      <div class="field">
        <label for="${escapeHtml(spec.id)}-por_pagina">Por página</label>
        <select id="${escapeHtml(spec.id)}-por_pagina" name="por_pagina">
          ${PAGE_SIZES.map((size) => option(String(size), String(size), query.porPagina === size)).join("")}
        </select>
      </div>
      <div class="field actions">
        <button type="submit">Aplicar</button>
        <a class="clear-filters" href="${escapeHtml(clearHref)}">Limpar filtros</a>
      </div>
    </form>`;

  const emptyState =
    view.total === 0
      ? `<p class="banner empty" data-list-empty="no-data" role="status">${escapeHtml(input.emptyData)}</p>`
      : view.matched === 0
        ? `<p class="banner empty" data-list-empty="no-match" role="status">Nenhum dos ${view.total} ${escapeHtml(noun)} observados corresponde a esta busca/filtro. Os dados estão presentes; o recorte é que não encontrou nada. <a href="${escapeHtml(clearHref)}">Limpar filtros</a>.</p>`
        : "";

  const unavailableNote =
    unavailable.length === 0
      ? ""
      : `<p class="constraint" data-list-unavailable-facets="${escapeHtml(unavailable.map((facet) => facet.id).join(","))}">Sem filtro por ${escapeHtml(
          unavailable.map((facet) => facet.label.toLowerCase()).join(" e "),
        )}: o read model observado não traz esse campo. Ausência de filtro não é ausência de casos.</p>`;

  const reference =
    query.periodo === "all" || referenceMs === null
      ? ""
      : `<p class="constraint">Período medido a partir de ${escapeHtml(new Date(referenceMs).toISOString())} (instante do snapshot), não do relógio local.</p>`;

  const coverageWarning = view.complete
    ? ""
    : `<p class="banner stale" data-list-incomplete="true" role="status">A origem declarou ${view.declaredTotal} ${escapeHtml(noun)}, mas esta coleta tornou ${view.total} pesquisáveis. A busca e a contagem abaixo não fingem cobrir os ${view.declaredTotal - view.total} itens ausentes; aguarde uma coleta completa.</p>`;

  return `
    <section class="list-surface" aria-labelledby="${escapeHtml(headingId)}" data-list="${escapeHtml(spec.id)}" data-list-total="${view.total}" data-list-matched="${view.matched}" data-list-page="${view.page}" data-list-pages="${view.pageCount}" data-list-sort="${escapeHtml(view.query.ordem)}">
      <h2 id="${escapeHtml(headingId)}">${escapeHtml(heading)}</h2>
      ${input.intro ?? ""}
      ${filters}
      <p class="count" role="status" data-list-count="${view.matched}">${escapeHtml(countText(view, noun))}</p>
      ${coverageWarning}
      ${unavailableNote}
      ${reference}
      <div class="stack">${view.items.map((row) => input.card(row)).join("")}</div>
      ${emptyState}
      ${pagination(view, hash, heading, spec.id)}
    </section>`;
}
