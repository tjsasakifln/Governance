import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { createHttpAdapter } from "../src/adapters/index";
import { createMemoryRuntime, mount, paintShell } from "../src/app";
import { queryParamsOf, withQueryParams } from "../src/destinations";
import {
  ACTIVITY_LIST,
  DEFAULT_PAGE_SIZE,
  EXCEPTION_LIST,
  buildListView,
  clearListHref,
  facetValues,
  listHref,
  matchesQuery,
  parseListQuery,
  referenceMsOf,
  sortRows,
} from "../src/filter";
import { readContractFixture, recordingFetch } from "./helpers";

const here = dirname(fileURLToPath(import.meta.url));
const PROJECTOR = join(here, "../../../connectors/runner/src/projectors/commercial.ts");

const GENERATED_AT = "2026-08-20T17:40:00Z";
const GENERATED_MS = Date.parse(GENERATED_AT);

/**
 * Rows in exactly the shape `operationsFromWarmbly` emits. The field names are
 * pinned against the producer by the guard test below, so this generator cannot
 * quietly drift into a shape production never produces.
 */
function activityRows(count: number): Record<string, unknown>[] {
  const events = ["reply", "bounce", "meeting_booked"];
  const states = ["open", "acknowledged", "done"];
  return Array.from({ length: count }, (_, index) => {
    const ageHours = index * 6;
    return {
      at: new Date(GENERATED_MS - ageHours * 3600_000).toISOString(),
      lead_or_account: `Conta ${String(index).padStart(4, "0")}`,
      source_id: `lead-${String(index).padStart(4, "0")}`,
      event: events[index % events.length] as string,
      state: states[index % states.length] as string,
      evidence: index === 7 ? "assinatura de contrato pendente" : `evidência ${index}`,
    };
  });
}

function exceptionRows(count: number): Record<string, unknown>[] {
  const kinds = ["missing_version", "orphan"];
  const sources = ["warmbly.intel.exceptions", "warmbly.attention"];
  const statuses = ["open", "acknowledged", "resolved"];
  return Array.from({ length: count }, (_, index) => {
    const id = `exc-${String(index).padStart(4, "0")}`;
    return {
      id,
      canonical_id: `cc:attention-item:${id}`,
      source_id: id,
      why: `motivo ${index}`,
      kind: kinds[index % kinds.length] as string,
      recommended_next_action: index % 2 === 0 ? "revisar no Warmbly" : null,
      status: statuses[index % statuses.length] as string,
      source: sources[index % sources.length] as string,
      observed_at: new Date(GENERATED_MS - index * 6 * 3600_000).toISOString(),
      evidence: { note: `detalhe ${index}` },
    };
  });
}

function snapshotWith(operations: Record<string, unknown>): Record<string, unknown> {
  const base = readContractFixture("commercial-snapshot") as Record<string, unknown>;
  return { ...base, generated_at: GENERATED_AT, operations };
}

/**
 * Drives the real HTTP adapter end to end: fixture JSON over `fetch`, through
 * `createHttpAdapter` and its mapper, into `renderShell`. Nothing between the
 * wire and the HTML is stubbed, so the assertions are about what an operator
 * actually sees.
 */
async function renderAtAsync(hash: string, operations: Record<string, unknown>): Promise<string> {
  const snapshot = snapshotWith(operations);
  const { fetchImpl } = recordingFetch((url) => {
    if (url.split("?")[0]?.endsWith("/v1/domains/commercial")) return snapshot;
    return undefined;
  });
  const adapter = createHttpAdapter("http://127.0.0.1:8787", fetchImpl, {
    kind: "human",
    id: "founder-local",
  });
  const root = { innerHTML: "" };
  paintShell(root, adapter, hash);
  await new Promise((resolve) => setTimeout(resolve, 20));
  return root.innerHTML;
}


/* ------------------------------------------------------------------ *
 * Producer shape                                                      *
 * ------------------------------------------------------------------ */

test("the fields the list filters read are the fields the Warmbly projector emits", () => {
  const source = readFileSync(PROJECTOR, "utf8");
  // Object-literal keys, shorthand (`at,`) or explicit (`status: ...`).
  const emits = (key: string): boolean => new RegExp(`\\n\\s+${key}[,:]`).test(source);

  const ACTIVITY_KEYS = ["at", "lead_or_account", "source_id", "event", "state", "evidence"];
  const EXCEPTION_KEYS = [
    "id",
    "canonical_id",
    "source_id",
    "why",
    "kind",
    "recommended_next_action",
    "status",
    "source",
    "observed_at",
    "evidence",
  ];
  for (const key of [...ACTIVITY_KEYS, ...EXCEPTION_KEYS]) {
    assert.equal(emits(key), true, `the projector no longer emits ${key}`);
  }

  // The primary field of every facet and of every ordering key must be one the
  // producer actually emits, or the control would render a select that can
  // never match and an ordering that never fires.
  const primary = (spec: typeof ACTIVITY_LIST): string[] => [
    spec.facets[0]?.fields[0] ?? "",
    spec.facets[1]?.fields[0] ?? "",
    spec.timeFields[0] ?? "",
    spec.stateFields[0] ?? "",
    spec.identityFields[0] ?? "",
  ];
  for (const field of primary(ACTIVITY_LIST)) {
    assert.ok(ACTIVITY_KEYS.includes(field), `atividade reads ${field}, which the projector never emits`);
  }
  for (const field of primary(EXCEPTION_LIST)) {
    assert.ok(EXCEPTION_KEYS.includes(field), `exceções lê ${field}, which the projector never emits`);
  }
  // The `origem` facet only exists on exceptions today; activity has no source.
  assert.equal(EXCEPTION_LIST.facets[2]?.fields[0], "source");
  assert.equal(emits("source"), true);
});

/* ------------------------------------------------------------------ *
 * Pure filter logic                                                   *
 * ------------------------------------------------------------------ */

test("search matches free text and identifiers, case-insensitively", () => {
  const rows = activityRows(30);
  const target = rows[7] as Record<string, unknown>;
  assert.equal(matchesQuery(target, "LEAD-0007"), true, "identifier search must be case-insensitive");
  assert.equal(matchesQuery(target, "assinatura de contrato"), true, "free-text search must reach the body");
  assert.equal(matchesQuery(target, "conta 0007"), true);
  assert.equal(matchesQuery(target, "não existe"), false);
  assert.equal(matchesQuery(target, "   "), true, "an empty query must not hide anything");
});

test("search reaches nested evidence but stops at the depth limit", () => {
  const row = { id: "x", evidence: { note: "duplicidade de contato" }, deep: { a: { b: "escondido" } } };
  assert.equal(matchesQuery(row, "duplicidade"), true);
  assert.equal(matchesQuery(row, "escondido"), false);
});

test("facet options come from the observed rows, and an unknown value falls back to all", () => {
  const rows = exceptionRows(9);
  const estado = EXCEPTION_LIST.facets[0];
  assert.ok(estado);
  assert.deepEqual(facetValues(rows, estado), ["acknowledged", "open", "resolved"]);
  const parsed = parseListQuery({ estado: "open" }, EXCEPTION_LIST, rows);
  assert.equal(parsed.facets.estado, "open");
  const bogus = parseListQuery({ estado: "inventado" }, EXCEPTION_LIST, rows);
  assert.equal(
    bogus.facets.estado,
    "all",
    "a shared link naming a value no row carries must widen, not render an empty list under an invisible filter",
  );
});

test("facets, search and period compose, and the count separates matched from total", () => {
  const rows = exceptionRows(30);
  const query = parseListQuery({ estado: "open", tipo: "missing_version" }, EXCEPTION_LIST, rows);
  const view = buildListView(rows, EXCEPTION_LIST, query, GENERATED_MS);
  assert.equal(view.total, 30);
  assert.equal(view.matched, 5, "open ∧ missing_version is every 6th row of 30");
  assert.equal(view.filtered, true);
  for (const row of view.items) {
    assert.equal(row.status, "open");
    assert.equal(row.kind, "missing_version");
  }
});

test("the period filter is measured from the snapshot instant, not the wall clock", () => {
  const rows = activityRows(40); // 6h apart, so 40 rows span 234h
  const reference = referenceMsOf(rows, ACTIVITY_LIST, GENERATED_AT);
  assert.equal(reference, GENERATED_MS);
  const day = buildListView(
    rows,
    ACTIVITY_LIST,
    parseListQuery({ periodo: "24h", por_pagina: "100" }, ACTIVITY_LIST, rows),
    reference,
  );
  assert.equal(day.matched, 5, "0h,6h,12h,18h,24h back are inside a 24h window");
  const week = buildListView(
    rows,
    ACTIVITY_LIST,
    parseListQuery({ periodo: "7d", por_pagina: "100" }, ACTIVITY_LIST, rows),
    reference,
  );
  assert.equal(week.matched, 29);
  const all = buildListView(
    rows,
    ACTIVITY_LIST,
    parseListQuery({ por_pagina: "100" }, ACTIVITY_LIST, rows),
    reference,
  );
  assert.equal(all.matched, 40);
});

test("a row with no observable timestamp is excluded by a period filter, never silently counted in", () => {
  const rows = [{ id: "a", observed_at: GENERATED_AT }, { id: "b" }];
  const view = buildListView(
    rows,
    EXCEPTION_LIST,
    parseListQuery({ periodo: "24h" }, EXCEPTION_LIST, rows),
    GENERATED_MS,
  );
  assert.equal(view.total, 2);
  assert.equal(view.matched, 1);
});

test("the default sort is urgency: unresolved first, then oldest", () => {
  const rows = [
    { id: "c", status: "resolved", observed_at: "2026-08-01T00:00:00Z" },
    { id: "a", status: "open", observed_at: "2026-08-19T00:00:00Z" },
    { id: "b", status: "open", observed_at: "2026-08-02T00:00:00Z" },
    { id: "d", status: "acknowledged", observed_at: "2026-08-03T00:00:00Z" },
  ];
  const urgent = sortRows(rows, EXCEPTION_LIST, EXCEPTION_LIST.defaultSort).map((row) => row.id);
  assert.deepEqual(urgent, ["b", "a", "d", "c"]);
  const recent = sortRows(rows, EXCEPTION_LIST, "recentes").map((row) => row.id);
  assert.deepEqual(recent, ["a", "d", "b", "c"]);
  const oldest = sortRows(rows, EXCEPTION_LIST, "antigos").map((row) => row.id);
  assert.deepEqual(oldest, ["c", "b", "d", "a"]);
});

test("an unrecognised state is treated as open, never as resolved", () => {
  const rows = [
    { id: "a", status: "resolved", observed_at: "2026-08-01T00:00:00Z" },
    { id: "b", status: "quem_sabe", observed_at: "2026-08-01T00:00:00Z" },
    { id: "c", observed_at: "2026-08-01T00:00:00Z" },
  ];
  assert.deepEqual(
    sortRows(rows, EXCEPTION_LIST, "urgencia").map((row) => row.id),
    ["b", "c", "a"],
  );
});

test("ties are broken by identifier, so the order is total and not merely stable", () => {
  const at = "2026-08-10T00:00:00Z";
  const rows = [
    { id: "c", status: "open", observed_at: at },
    { id: "a", status: "open", observed_at: at },
    { id: "b", status: "open", observed_at: at },
  ];
  for (const ordem of ["urgencia", "recentes", "antigos", "identificador"]) {
    assert.deepEqual(
      sortRows(rows, EXCEPTION_LIST, ordem).map((row) => row.id),
      ["a", "b", "c"],
      `${ordem} left equal rows in input order instead of a total order`,
    );
  }
});

test("sorting is a total order, so pagination neither drops nor repeats an item", () => {
  const rows = exceptionRows(53);
  const seen = new Set<string>();
  const query = parseListQuery({}, EXCEPTION_LIST, rows);
  const pages = buildListView(rows, EXCEPTION_LIST, query, GENERATED_MS).pageCount;
  assert.equal(pages, 3);
  for (let page = 1; page <= pages; page += 1) {
    const view = buildListView(
      rows,
      EXCEPTION_LIST,
      parseListQuery({ pagina: String(page) }, EXCEPTION_LIST, rows),
      GENERATED_MS,
    );
    for (const row of view.items) seen.add(String(row.id));
  }
  assert.equal(seen.size, 53);
});

test("pagination reports total and position, and clamps a page past the end", () => {
  const rows = exceptionRows(53);
  const first = buildListView(rows, EXCEPTION_LIST, parseListQuery({}, EXCEPTION_LIST, rows), GENERATED_MS);
  assert.equal(first.query.porPagina, DEFAULT_PAGE_SIZE);
  assert.equal(first.items.length, 25);
  assert.equal(first.page, 1);
  assert.equal(first.pageCount, 3);
  assert.equal(first.rangeStart, 1);
  assert.equal(first.rangeEnd, 25);
  const last = buildListView(
    rows,
    EXCEPTION_LIST,
    parseListQuery({ pagina: "3" }, EXCEPTION_LIST, rows),
    GENERATED_MS,
  );
  assert.equal(last.rangeStart, 51);
  assert.equal(last.rangeEnd, 53);
  const overshoot = buildListView(
    rows,
    EXCEPTION_LIST,
    parseListQuery({ pagina: "99" }, EXCEPTION_LIST, rows),
    GENERATED_MS,
  );
  assert.equal(overshoot.page, 3, "a page past the end must clamp, not render an empty list");
  const sized = buildListView(
    rows,
    EXCEPTION_LIST,
    parseListQuery({ por_pagina: "50" }, EXCEPTION_LIST, rows),
    GENERATED_MS,
  );
  assert.equal(sized.items.length, 50);
  assert.equal(sized.pageCount, 2);
});

test("a page size the list does not offer falls back to the default", () => {
  const rows = exceptionRows(53);
  assert.equal(parseListQuery({ por_pagina: "9999" }, EXCEPTION_LIST, rows).porPagina, DEFAULT_PAGE_SIZE);
  assert.equal(parseListQuery({ por_pagina: "abc" }, EXCEPTION_LIST, rows).porPagina, DEFAULT_PAGE_SIZE);
  assert.equal(parseListQuery({ pagina: "0" }, EXCEPTION_LIST, rows).pagina, 1);
  assert.equal(parseListQuery({ ordem: "aleatorio" }, EXCEPTION_LIST, rows).ordem, "urgencia");
  assert.equal(parseListQuery({ periodo: "sempre" }, EXCEPTION_LIST, rows).periodo, "all");
});

/* ------------------------------------------------------------------ *
 * URL state                                                           *
 * ------------------------------------------------------------------ */

test("filter state round-trips through the URL and leaves foreign params alone", () => {
  const base = "#/comercial/excecoes?view=stale";
  const withFilters = listHref(base, { q: "orphan", estado: "open", ordem: "recentes" });
  const params = queryParamsOf(withFilters);
  assert.equal(params.q, "orphan");
  assert.equal(params.estado, "open");
  assert.equal(params.ordem, "recentes");
  assert.equal(params.view, "stale", "an unrelated param must survive a filter change");
  assert.ok(withFilters.startsWith("#/comercial/excecoes?"));
  const cleared = clearListHref(withFilters);
  assert.equal(cleared, "#/comercial/excecoes?view=stale");
});

test("changing any filter resets to page one; paging keeps the filter", () => {
  const filtered = "#/comercial/excecoes?estado=open&pagina=4";
  assert.equal(queryParamsOf(listHref(filtered, { estado: "acknowledged" })).pagina, undefined);
  const paged = listHref(filtered, { pagina: "5" });
  assert.equal(queryParamsOf(paged).pagina, "5");
  assert.equal(queryParamsOf(paged).estado, "open");
});

test("withQueryParams drops a param set to empty and keeps the path", () => {
  assert.equal(withQueryParams("#/comercial/atividade?q=a&estado=open", { q: null }), "#/comercial/atividade?estado=open");
  assert.equal(withQueryParams("#/comercial/atividade?q=a", { q: "" }), "#/comercial/atividade");
});

/* ------------------------------------------------------------------ *
 * Rendered surface — the operator boundary                            *
 * ------------------------------------------------------------------ */

test("Exceções renders search, filters, sorting, a count and pagination over the real adapter", async () => {
  const html = await renderAtAsync("#/comercial/excecoes", { exceptions: exceptionRows(53) });
  assert.match(html, /data-list="excecoes"/);
  assert.match(html, /data-list-total="53"/);
  assert.match(html, /data-list-pages="3"/);
  assert.match(html, /<input\s+id="excecoes-q"[\s\S]*?type="search"/);
  assert.match(html, /<select id="excecoes-estado" name="estado">/);
  assert.match(html, /<select id="excecoes-tipo" name="tipo">/);
  assert.match(html, /<select id="excecoes-origem" name="origem">/);
  assert.match(html, /<select id="excecoes-ordem" name="ordem">/);
  assert.match(html, /<select id="excecoes-periodo" name="periodo">/);
  assert.match(html, /53 exceção\(ões\) observada\(s\) · mostrando 1–25 · página 1 de 3/);
  assert.match(html, /data-list-pagination="excecoes"/);
  assert.match(html, /rel="next" href="#\/comercial\/excecoes\?pagina=2"/);
  assert.equal(/rel="prev"/.test(html), false, "page 1 must not offer a previous page link");
  // The operator forms the queue is built around survive the new chrome.
  assert.match(html, /data-operator-form="ACKNOWLEDGE_EXCEPTION"/);
  assert.match(html, /data-operator-scope="control-center-only"/);
  const cards = html.match(/data-exception-id="/g) ?? [];
  assert.equal(cards.length, 25, "a page must render exactly one page of cards");
});

test("page two of Exceções shows the next slice and both direction links", async () => {
  const html = await renderAtAsync("#/comercial/excecoes?pagina=2", { exceptions: exceptionRows(53) });
  assert.match(html, /data-list-page="2"/);
  assert.match(html, /mostrando 26–50 · página 2 de 3/);
  assert.match(html, /rel="prev" href="#\/comercial\/excecoes"/);
  assert.match(html, /rel="next" href="#\/comercial\/excecoes\?pagina=3"/);
});

test("a search in the URL narrows Atividade and the count says so", async () => {
  const html = await renderAtAsync("#/comercial/atividade?q=lead-0042", { activity: activityRows(60) });
  assert.match(html, /data-list="atividade"/);
  assert.match(html, /data-list-total="60"/);
  assert.match(html, /data-list-matched="1"/);
  assert.match(html, /1 de 60 atividade\(s\) observada\(s\) após busca\/filtro/);
  assert.match(html, /data-activity-id="lead-0042"/);
  assert.equal(/data-activity-id="lead-0041"/.test(html), false);
  assert.match(html, /value="lead-0042"/, "the search box must echo the query it is showing");
});

test("an empty result says whether there is no data or the filter matched nothing", async () => {
  const noData = await renderAtAsync("#/comercial/atividade", { activity: [] });
  assert.match(noData, /data-list-empty="no-data"/);
  assert.match(noData, /Sem atividade observada neste recorte/);
  assert.equal(/data-list-empty="no-match"/.test(noData), false);

  const noMatch = await renderAtAsync("#/comercial/atividade?q=zzz-nada", { activity: activityRows(12) });
  assert.match(noMatch, /data-list-empty="no-match"/);
  assert.match(noMatch, /Nenhum dos 12 .* observados corresponde a esta busca\/filtro/);
  assert.match(noMatch, /Limpar filtros/);
  assert.equal(/data-list-empty="no-data"/.test(noMatch), false);
});

test("facets the read model does not carry are named as absent instead of rendered empty", async () => {
  const html = await renderAtAsync("#/comercial/excecoes", { exceptions: exceptionRows(4) });
  assert.match(html, /data-list-unavailable-facets="responsavel,prioridade"/);
  assert.match(html, /o read model observado não traz esse campo/);
  assert.equal(/name="responsavel"/.test(html), false);
});

test("a hostile hash cannot inject markup through the filter links or the search box", async () => {
  const hostile = `#/comercial/atividade?q=${encodeURIComponent('"><img src=x onerror=alert(1)>')}`;
  const html = await renderAtAsync(hostile, { activity: activityRows(3) });
  // No tag and no attribute boundary survives: the payload is only ever text.
  assert.equal(/<img/i.test(html), false, "the query must never re-enter the DOM as a tag");
  assert.equal(html.includes('value=""><img'), false, "the payload must not break out of the value attribute");
  assert.match(html, /value="&quot;&gt;&lt;img src=x onerror=alert\(1\)&gt;"/, "it must appear as inert text");
  // The generated links carry it percent-encoded, never raw.
  assert.equal(/href="[^"]*<[^"]*"/.test(html), false, "no link may carry a raw angle bracket");
});

/* ------------------------------------------------------------------ *
 * Binding: the control must survive the wholesale repaint             *
 * ------------------------------------------------------------------ */

class FakeFilterForm {
  readonly listeners = new Map<string, (event: Event) => void>();
  readonly fields: Record<string, { value: string }> = {
    q: { value: "" },
    estado: { value: "all" },
    tipo: { value: "all" },
    origem: { value: "all" },
    periodo: { value: "all" },
    ordem: { value: "urgencia" },
    por_pagina: { value: "25" },
  };
  addEventListener(type: string, listener: (event: Event) => void): void {
    this.listeners.set(type, listener);
  }
  getAttribute(name: string): string | null {
    return name === "data-list-filters" ? "excecoes" : null;
  }
  querySelector(selector: string): { value: string } | null {
    const name = selector.replace(/[[\]'"]/g, "").replace("name=", "");
    return this.fields[name] ?? null;
  }
  fire(type: string): void {
    const listener = this.listeners.get(type);
    if (!listener) throw new Error(`filter form was never bound for ${type}`);
    listener({ preventDefault(): void {} } as unknown as Event);
  }
}

function repaintingRoot(): {
  root: { innerHTML: string; querySelectorAll(selector: string): FakeFilterForm[] };
  current(): FakeFilterForm;
  paints: () => number;
} {
  let form = new FakeFilterForm();
  let paints = 0;
  const root = {
    get innerHTML(): string {
      return "";
    },
    set innerHTML(_next: string) {
      paints += 1;
      form = new FakeFilterForm();
    },
    querySelectorAll(selector: string): FakeFilterForm[] {
      return selector === "[data-list-filters]" ? [form] : [];
    },
  };
  return { root, current: () => form, paints: () => paints };
}

test("a filter change navigates, and the control is still live after the repaint it caused", async () => {
  const snapshot = snapshotWith({ exceptions: exceptionRows(53) });
  const { fetchImpl } = recordingFetch((url) =>
    url.split("?")[0]?.endsWith("/v1/domains/commercial") ? snapshot : undefined,
  );
  const adapter = createHttpAdapter("http://127.0.0.1:8787", fetchImpl, {
    kind: "human",
    id: "founder-local",
  });
  const dom = repaintingRoot();
  const runtime = createMemoryRuntime("#/comercial/excecoes");
  const handle = mount(dom.root as never, adapter as never, runtime);
  try {
    await new Promise((resolve) => setTimeout(resolve, 20));

    dom.current().fields.estado = { value: "open" };
    dom.current().fire("change");
    assert.equal(runtime.getHash(), "#/comercial/excecoes?estado=open");
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Second interaction, on the form the repaint minted. A handler parked on
    // the form that navigated would be gone by now.
    dom.current().fields.estado = { value: "open" };
    dom.current().fields.q = { value: "motivo 6" };
    dom.current().fire("submit");
    assert.equal(runtime.getHash(), "#/comercial/excecoes?estado=open&q=motivo+6");

    await new Promise((resolve) => setTimeout(resolve, 20));
    // Clearing a select back to "all" must remove the param, not pin "all".
    dom.current().fields.estado = { value: "all" };
    dom.current().fields.q = { value: "" };
    dom.current().fire("change");
    assert.equal(runtime.getHash(), "#/comercial/excecoes");
  } finally {
    handle.unmount();
  }
});

test("a filter change resets the page, so narrowing never lands on an empty page", async () => {
  const snapshot = snapshotWith({ exceptions: exceptionRows(53) });
  const { fetchImpl } = recordingFetch((url) =>
    url.split("?")[0]?.endsWith("/v1/domains/commercial") ? snapshot : undefined,
  );
  const adapter = createHttpAdapter("http://127.0.0.1:8787", fetchImpl, {
    kind: "human",
    id: "founder-local",
  });
  const dom = repaintingRoot();
  const runtime = createMemoryRuntime("#/comercial/excecoes?pagina=3");
  const handle = mount(dom.root as never, adapter as never, runtime);
  try {
    await new Promise((resolve) => setTimeout(resolve, 20));
    dom.current().fields.q = { value: "motivo 1" };
    dom.current().fire("submit");
    assert.equal(queryParamsOf(runtime.getHash()).pagina, undefined);
    assert.equal(queryParamsOf(runtime.getHash()).q, "motivo 1");
  } finally {
    handle.unmount();
  }
});
