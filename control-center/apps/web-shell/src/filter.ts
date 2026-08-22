import { withQueryParams } from "./destinations";

/**
 * Search, filter, sort and pagination for the long operational lists.
 *
 * Pure and dependency-free, in the same idiom as `apps/directives-ui/src/filter.ts`:
 * the rendering layer owns no state, every control is reflected in the URL, and
 * every parse validates-or-falls-back so a stale shared link degrades to a wider
 * recorte instead of an empty screen with an invisible filter on it.
 *
 * The rows are read-model rows (`Record<string, unknown>`) rather than a typed
 * shape on purpose: `operations.activity` and `operations.exceptions` are passed
 * through from the Warmbly projector unchanged, and the field names they carry
 * are asserted against the producer in `tests/list-filters.test.ts`. Typing them
 * is issue #67's work; this module must keep working either way, which is why
 * every facet declares a list of candidate field names.
 */

export interface FacetSpec {
  /** URL param name and form field name. */
  readonly id: string;
  readonly label: string;
  /** Candidate row fields, first one present wins. */
  readonly fields: readonly string[];
}

export interface SortSpec {
  readonly id: string;
  readonly label: string;
}

export interface ListSpec {
  readonly id: string;
  readonly facets: readonly FacetSpec[];
  readonly sorts: readonly SortSpec[];
  readonly defaultSort: string;
  readonly timeFields: readonly string[];
  readonly stateFields: readonly string[];
  readonly priorityFields: readonly string[];
  readonly identityFields: readonly string[];
}

export interface PeriodSpec {
  readonly id: string;
  readonly label: string;
  /** Window in hours measured back from the reference instant; null means no bound. */
  readonly hours: number | null;
}

export interface ListQuery {
  readonly q: string;
  readonly facets: Readonly<Record<string, string>>;
  readonly periodo: string;
  readonly ordem: string;
  readonly pagina: number;
  readonly porPagina: number;
}

export interface ListView {
  /** Rows observed before any filter. */
  readonly total: number;
  /** Rows that survived search + facets + period. */
  readonly matched: number;
  /** The current page of matched rows. */
  readonly items: readonly Record<string, unknown>[];
  readonly page: number;
  readonly pageCount: number;
  /** 1-based position of the first item on this page; 0 when nothing matched. */
  readonly rangeStart: number;
  readonly rangeEnd: number;
  /** True when at least one of search/facet/period is narrowing the list. */
  readonly filtered: boolean;
  readonly query: ListQuery;
}

export const PERIODS: readonly PeriodSpec[] = [
  { id: "all", label: "Todo o período observado", hours: null },
  { id: "24h", label: "Últimas 24 horas", hours: 24 },
  { id: "7d", label: "Últimos 7 dias", hours: 24 * 7 },
  { id: "30d", label: "Últimos 30 dias", hours: 24 * 30 },
];

export const PAGE_SIZES: readonly number[] = [25, 50, 100];
export const DEFAULT_PAGE_SIZE = 25;

const SORTS: readonly SortSpec[] = [
  { id: "urgencia", label: "Urgência (padrão)" },
  { id: "recentes", label: "Mais recentes primeiro" },
  { id: "antigos", label: "Mais antigos primeiro" },
  { id: "identificador", label: "Identificador (A→Z)" },
];

const SHARED_FACETS: readonly FacetSpec[] = [
  { id: "responsavel", label: "Responsável", fields: ["owner", "assignee", "actor_id", "responsible"] },
  { id: "prioridade", label: "Prioridade", fields: ["priority", "severity"] },
];

/**
 * Activity rows as `operationsFromWarmbly` emits them:
 * `{ at, lead_or_account, source_id, event, state, evidence }`.
 */
export const ACTIVITY_LIST: ListSpec = {
  id: "atividade",
  facets: [
    { id: "estado", label: "Estado", fields: ["state", "status"] },
    { id: "tipo", label: "Tipo de evento", fields: ["event", "kind"] },
    { id: "origem", label: "Origem", fields: ["source", "provider", "channel"] },
    ...SHARED_FACETS,
  ],
  sorts: SORTS,
  defaultSort: "urgencia",
  timeFields: ["at", "observed_at", "updated_at", "created_at"],
  stateFields: ["state", "status"],
  priorityFields: ["priority", "severity"],
  identityFields: ["source_id", "id", "canonical_id"],
};

/**
 * Exception rows as `mergeExceptions` emits them:
 * `{ id, canonical_id, source_id, why, kind, recommended_next_action, status, source, observed_at, evidence }`.
 */
export const EXCEPTION_LIST: ListSpec = {
  id: "excecoes",
  facets: [
    { id: "estado", label: "Estado", fields: ["status", "state"] },
    { id: "tipo", label: "Tipo", fields: ["kind", "code"] },
    { id: "origem", label: "Origem", fields: ["source"] },
    ...SHARED_FACETS,
  ],
  sorts: SORTS,
  defaultSort: "urgencia",
  timeFields: ["observed_at", "at", "detected_at", "opened_at"],
  stateFields: ["status", "state"],
  priorityFields: ["priority", "severity"],
  identityFields: ["id", "canonical_id", "source_id"],
};

/** Every param this module owns. Anything else in the query string is left alone. */
export const LIST_PARAM_IDS: readonly string[] = [
  "q",
  "estado",
  "tipo",
  "origem",
  "responsavel",
  "prioridade",
  "periodo",
  "ordem",
  "pagina",
  "por_pagina",
];

/** Form field names the shell reads back when a control changes. */
export const LIST_FORM_FIELDS: readonly string[] = LIST_PARAM_IDS.filter((id) => id !== "pagina");

export const LIST_SPECS: readonly ListSpec[] = [ACTIVITY_LIST, EXCEPTION_LIST];

export function listSpecById(id: string): ListSpec | undefined {
  return LIST_SPECS.find((spec) => spec.id === id);
}

/**
 * Values that mean "not narrowed" for this list. The shell drops them from the
 * URL so a shared link carries only the choices the operator actually made.
 */
export function defaultParamValues(spec: ListSpec | undefined): Readonly<Record<string, string>> {
  return {
    periodo: "all",
    ordem: spec?.defaultSort ?? "urgencia",
    por_pagina: String(DEFAULT_PAGE_SIZE),
  };
}

const MAX_HAYSTACK_PARTS = 240;
const MAX_HAYSTACK_CHARS = 6000;

function collectText(value: unknown, depth: number, out: string[]): void {
  if (out.length >= MAX_HAYSTACK_PARTS) return;
  if (value === null || value === undefined) return;
  if (typeof value === "string") {
    out.push(value);
    return;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    out.push(String(value));
    return;
  }
  if (depth <= 0) return;
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, depth - 1, out);
    return;
  }
  if (typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectText(item, depth - 1, out);
    }
  }
}

/** Lowercased search corpus for one row: every primitive down to two levels. */
export function haystackOf(row: Record<string, unknown>): string {
  const parts: string[] = [];
  collectText(row, 2, parts);
  return parts.join("\n").slice(0, MAX_HAYSTACK_CHARS).toLowerCase();
}

export function matchesQuery(row: Record<string, unknown>, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  return haystackOf(row).includes(q);
}

function primitiveText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

/** First non-empty primitive among the candidate fields, or "" when none is present. */
export function fieldText(row: Record<string, unknown>, fields: readonly string[]): string {
  for (const field of fields) {
    const text = primitiveText(row[field]);
    if (text !== "") return text;
  }
  return "";
}

/** Distinct values a facet actually takes in the observed rows, sorted for a stable select. */
export function facetValues(
  rows: readonly Record<string, unknown>[],
  facet: FacetSpec,
): string[] {
  const set = new Set<string>();
  for (const row of rows) {
    const value = fieldText(row, facet.fields);
    if (value !== "") set.add(value);
  }
  return [...set].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

export function matchesFacets(
  row: Record<string, unknown>,
  spec: ListSpec,
  facets: Readonly<Record<string, string>>,
): boolean {
  for (const facet of spec.facets) {
    const wanted = facets[facet.id] ?? "all";
    if (wanted === "all") continue;
    if (fieldText(row, facet.fields) !== wanted) return false;
  }
  return true;
}

function timeMsOf(row: Record<string, unknown>, spec: ListSpec): number | null {
  const raw = fieldText(row, spec.timeFields);
  if (raw === "") return null;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : parsed;
}

export function periodById(id: string): PeriodSpec {
  return PERIODS.find((period) => period.id === id) ?? (PERIODS[0] as PeriodSpec);
}

/**
 * Reference instant for the relative date filter.
 *
 * Anchored on the snapshot's `generated_at` rather than `Date.now()`: "last 24h"
 * has to mean 24h of *observed* data, and a wall clock would make the same URL
 * render a different recorte a day later — and make every test flaky.
 */
export function referenceMsOf(
  rows: readonly Record<string, unknown>[],
  spec: ListSpec,
  generatedAt: string | undefined,
): number | null {
  if (generatedAt) {
    const parsed = Date.parse(generatedAt);
    if (!Number.isNaN(parsed)) return parsed;
  }
  let newest: number | null = null;
  for (const row of rows) {
    const ms = timeMsOf(row, spec);
    if (ms !== null && (newest === null || ms > newest)) newest = ms;
  }
  return newest;
}

export function withinPeriod(
  row: Record<string, unknown>,
  spec: ListSpec,
  periodo: string,
  referenceMs: number | null,
): boolean {
  const period = periodById(periodo);
  if (period.hours === null) return true;
  if (referenceMs === null) return true;
  const ms = timeMsOf(row, spec);
  // A row with no observable timestamp is not known to be inside the window.
  if (ms === null) return false;
  return ms >= referenceMs - period.hours * 3600_000 && ms <= referenceMs + 3600_000;
}

const TERMINAL_STATES = new Set([
  "resolved",
  "dismissed",
  "closed",
  "done",
  "completed",
  "won",
  "lost",
  "cancelled",
  "canceled",
]);

const ACKNOWLEDGED_STATES = new Set(["acknowledged", "ack", "acked", "snoozed", "muted"]);

const PRIORITY_RANK: Readonly<Record<string, number>> = {
  critical: 0,
  crit: 0,
  p0: 0,
  blocker: 0,
  urgent: 0,
  high: 1,
  p1: 1,
  major: 1,
  medium: 2,
  med: 2,
  p2: 2,
  normal: 2,
  low: 3,
  p3: 3,
  minor: 3,
  info: 4,
};

function stateRank(row: Record<string, unknown>, spec: ListSpec): number {
  const raw = fieldText(row, spec.stateFields).toLowerCase();
  if (TERMINAL_STATES.has(raw)) return 2;
  if (ACKNOWLEDGED_STATES.has(raw)) return 1;
  // Absent or unrecognised is not "resolved": it stays at the top of the queue.
  return 0;
}

function priorityRank(row: Record<string, unknown>, spec: ListSpec): number {
  const raw = fieldText(row, spec.priorityFields).toLowerCase();
  return PRIORITY_RANK[raw] ?? 2;
}

export function identityOf(row: Record<string, unknown>, spec: ListSpec): string {
  return fieldText(row, spec.identityFields);
}

function byTime(a: number | null, b: number | null, direction: 1 | -1): number {
  if (a === null && b === null) return 0;
  // Rows with no timestamp sort last in both directions rather than pretending
  // to be the oldest or the newest thing in the queue.
  if (a === null) return 1;
  if (b === null) return -1;
  return (a - b) * direction;
}

/**
 * Sorts a copy of `rows`. Every comparator ends on the identifier so the order
 * is total: pagination over a partially ordered list silently drops and repeats
 * items between pages.
 */
export function sortRows(
  rows: readonly Record<string, unknown>[],
  spec: ListSpec,
  ordem: string,
): Record<string, unknown>[] {
  const decorated = rows.map((row) => ({
    row,
    state: stateRank(row, spec),
    priority: priorityRank(row, spec),
    time: timeMsOf(row, spec),
    id: identityOf(row, spec),
  }));
  const tie = (a: (typeof decorated)[number], b: (typeof decorated)[number]): number =>
    a.id.localeCompare(b.id, "pt-BR");
  decorated.sort((a, b) => {
    if (ordem === "recentes") return byTime(a.time, b.time, -1) || tie(a, b);
    if (ordem === "antigos") return byTime(a.time, b.time, 1) || tie(a, b);
    if (ordem === "identificador") return tie(a, b);
    // Urgency: unresolved before acknowledged before terminal, then the highest
    // declared priority, then the oldest — an open item that has been sitting
    // there longest is the one the operator is late on.
    return (
      a.state - b.state ||
      a.priority - b.priority ||
      byTime(a.time, b.time, 1) ||
      tie(a, b)
    );
  });
  return decorated.map((entry) => entry.row);
}

function parsePositiveInt(raw: string | undefined): number | null {
  if (raw === undefined || !/^[0-9]{1,6}$/.test(raw)) return null;
  const value = Number.parseInt(raw, 10);
  return value >= 1 ? value : null;
}

/**
 * Reads the URL params into a query, validating each one against what this list
 * can actually honour. A facet value that no observed row carries falls back to
 * "all" rather than rendering an empty list under an invisible filter.
 */
export function parseListQuery(
  params: Readonly<Record<string, string>>,
  spec: ListSpec,
  rows: readonly Record<string, unknown>[],
): ListQuery {
  const facets: Record<string, string> = {};
  for (const facet of spec.facets) {
    const raw = params[facet.id] ?? "all";
    facets[facet.id] = facetValues(rows, facet).includes(raw) ? raw : "all";
  }
  const periodoRaw = params.periodo ?? "all";
  const ordemRaw = params.ordem ?? spec.defaultSort;
  const porPaginaRaw = parsePositiveInt(params.por_pagina);
  return {
    q: params.q ?? "",
    facets,
    periodo: PERIODS.some((period) => period.id === periodoRaw) ? periodoRaw : "all",
    ordem: spec.sorts.some((sort) => sort.id === ordemRaw) ? ordemRaw : spec.defaultSort,
    pagina: parsePositiveInt(params.pagina) ?? 1,
    porPagina:
      porPaginaRaw !== null && PAGE_SIZES.includes(porPaginaRaw) ? porPaginaRaw : DEFAULT_PAGE_SIZE,
  };
}

export function isNarrowed(query: ListQuery): boolean {
  if (query.q.trim() !== "") return true;
  if (query.periodo !== "all") return true;
  return Object.values(query.facets).some((value) => value !== "all");
}

export function filterRows(
  rows: readonly Record<string, unknown>[],
  spec: ListSpec,
  query: ListQuery,
  referenceMs: number | null,
): Record<string, unknown>[] {
  return rows.filter(
    (row) =>
      matchesQuery(row, query.q) &&
      matchesFacets(row, spec, query.facets) &&
      withinPeriod(row, spec, query.periodo, referenceMs),
  );
}

export function buildListView(
  rows: readonly Record<string, unknown>[],
  spec: ListSpec,
  query: ListQuery,
  referenceMs: number | null,
): ListView {
  const matchedRows = sortRows(filterRows(rows, spec, query, referenceMs), spec, query.ordem);
  const matched = matchedRows.length;
  const pageCount = Math.max(1, Math.ceil(matched / query.porPagina));
  const page = Math.min(Math.max(1, query.pagina), pageCount);
  const offset = (page - 1) * query.porPagina;
  const items = matchedRows.slice(offset, offset + query.porPagina);
  return {
    total: rows.length,
    matched,
    items,
    page,
    pageCount,
    rangeStart: matched === 0 ? 0 : offset + 1,
    rangeEnd: matched === 0 ? 0 : offset + items.length,
    filtered: isNarrowed(query),
    query,
  };
}

/**
 * Link that applies `patch` to the current location. Changing any filter resets
 * to page 1: keeping page 7 while narrowing to three results is how a list ends
 * up looking empty when it is not.
 */
export function listHref(hash: string, patch: Readonly<Record<string, string | null>>): string {
  const next: Record<string, string | null> = { ...patch };
  if (!("pagina" in patch)) next.pagina = null;
  return withQueryParams(hash, next);
}

/** Link that drops every param this module owns, keeping the rest (e.g. `view`). */
export function clearListHref(hash: string): string {
  const patch: Record<string, string | null> = {};
  for (const id of LIST_PARAM_IDS) patch[id] = null;
  return withQueryParams(hash, patch);
}
