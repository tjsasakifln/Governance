import type { Scope } from "../types.ts";
import type { RepoDomainMap } from "../scope.ts";
import { rowVisibleUnderQuery, snapshotKindToDomain } from "./scope.ts";
import type { OperationalReadResult, OperationalSnapshotRow } from "./types.ts";
import { operationalTruth, type OperationalTruth } from "@confenge/control-center-contracts";

export const COMMERCIAL_LIST_IDS = ["activity", "exceptions"] as const;
export type CommercialListId = (typeof COMMERCIAL_LIST_IDS)[number];

interface FacetSpec {
  readonly id: string;
  readonly fields: readonly string[];
}

interface ListSpec {
  readonly facets: readonly FacetSpec[];
  readonly timeFields: readonly string[];
  readonly stateFields: readonly string[];
  readonly priorityFields: readonly string[];
  readonly identityFields: readonly string[];
}

const SHARED_FACETS: readonly FacetSpec[] = [
  { id: "responsavel", fields: ["owner", "assignee", "actor_id", "responsible"] },
  { id: "prioridade", fields: ["priority", "severity"] },
];

const SPECS: Record<CommercialListId, ListSpec> = {
  activity: {
    facets: [
      { id: "condicao", fields: ["conditions"] },
      { id: "estado", fields: ["state", "status"] },
      { id: "tipo", fields: ["event", "kind"] },
      { id: "origem", fields: ["source", "provider", "channel"] },
      ...SHARED_FACETS,
    ],
    timeFields: ["at", "observed_at", "updated_at", "created_at"],
    stateFields: ["state", "status"],
    priorityFields: ["priority", "severity"],
    identityFields: ["source_id", "id", "canonical_id"],
  },
  exceptions: {
    facets: [
      { id: "estado", fields: ["status", "state"] },
      { id: "tipo", fields: ["kind", "code"] },
      { id: "origem", fields: ["source"] },
      ...SHARED_FACETS,
    ],
    timeFields: ["observed_at", "at", "detected_at", "opened_at"],
    stateFields: ["status", "state"],
    priorityFields: ["priority", "severity"],
    identityFields: ["id", "canonical_id", "source_id"],
  },
};

const PERIOD_HOURS: Readonly<Record<string, number | null>> = {
  all: null,
  "24h": 24,
  "7d": 24 * 7,
  "30d": 24 * 30,
};
const SORTS = new Set(["urgencia", "recentes", "antigos", "identificador"]);
const PAGE_SIZES = new Set([25, 50, 100]);
const TERMINAL_STATES = new Set(["resolved", "dismissed", "closed", "done", "completed", "won", "lost", "cancelled", "canceled"]);
const ACKNOWLEDGED_STATES = new Set(["acknowledged", "ack", "acked", "snoozed", "muted"]);
const PRIORITY_RANK: Readonly<Record<string, number>> = {
  critical: 0, crit: 0, p0: 0, blocker: 0, urgent: 0,
  high: 1, p1: 1, major: 1,
  medium: 2, med: 2, p2: 2, normal: 2,
  low: 3, p3: 3, minor: 3,
  info: 4,
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function rowsOf(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.map(asRecord).filter((row): row is Record<string, unknown> => row !== null)
    : [];
}

function fieldText(row: Record<string, unknown>, fields: readonly string[]): string {
  return fieldTexts(row, fields)[0] ?? "";
}

function fieldTexts(row: Record<string, unknown>, fields: readonly string[]): string[] {
  for (const field of fields) {
    const value = row[field];
    if (Array.isArray(value)) {
      const texts = value
        .map((item) => typeof item === "string" ? item.trim() : typeof item === "number" || typeof item === "boolean" ? String(item) : "")
        .filter(Boolean);
      if (texts.length > 0) return texts;
    }
    if (typeof value === "string" && value.trim() !== "") return [value.trim()];
    if (typeof value === "number" || typeof value === "boolean") return [String(value)];
  }
  return [];
}

function facetValues(rows: readonly Record<string, unknown>[], facet: FacetSpec): string[] {
  return [...new Set(rows.flatMap((row) => fieldTexts(row, facet.fields)).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "pt-BR"));
}

function collectText(value: unknown, depth: number, out: string[]): void {
  if (out.length >= 240 || value === null || value === undefined) return;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    out.push(String(value));
    return;
  }
  if (depth <= 0) return;
  if (Array.isArray(value)) {
    for (const child of value) collectText(child, depth - 1, out);
  } else if (typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) collectText(child, depth - 1, out);
  }
}

function matchesText(row: Record<string, unknown>, raw: string): boolean {
  const query = raw.trim().toLowerCase();
  if (!query) return true;
  const parts: string[] = [];
  collectText(row, 2, parts);
  return parts.join("\n").slice(0, 6000).toLowerCase().includes(query);
}

function timeOf(row: Record<string, unknown>, spec: ListSpec): number | null {
  const raw = fieldText(row, spec.timeFields);
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : parsed;
}

function stateRank(row: Record<string, unknown>, spec: ListSpec): number {
  const state = fieldText(row, spec.stateFields).toLowerCase();
  if (TERMINAL_STATES.has(state)) return 2;
  if (ACKNOWLEDGED_STATES.has(state)) return 1;
  return 0;
}

function priorityRank(row: Record<string, unknown>, spec: ListSpec): number {
  return PRIORITY_RANK[fieldText(row, spec.priorityFields).toLowerCase()] ?? 2;
}

function byTime(a: number | null, b: number | null, direction: 1 | -1): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return (a - b) * direction;
}

function sortRows(rows: readonly Record<string, unknown>[], spec: ListSpec, sort: string): Record<string, unknown>[] {
  return rows
    .map((row, index) => ({
      row,
      index,
      state: stateRank(row, spec),
      priority: priorityRank(row, spec),
      time: timeOf(row, spec),
      id: fieldText(row, spec.identityFields),
    }))
    .sort((a, b) => {
      const tie = a.id.localeCompare(b.id, "pt-BR") || a.index - b.index;
      if (sort === "recentes") return byTime(a.time, b.time, -1) || tie;
      if (sort === "antigos") return byTime(a.time, b.time, 1) || tie;
      if (sort === "identificador") return tie;
      return a.state - b.state || a.priority - b.priority || byTime(a.time, b.time, 1) || tie;
    })
    .map((entry) => entry.row);
}

function positiveInt(raw: string | undefined): number | null {
  if (!raw || !/^[0-9]{1,6}$/.test(raw)) return null;
  const value = Number.parseInt(raw, 10);
  return value > 0 ? value : null;
}

function latestCommercial(rows: readonly OperationalSnapshotRow[]): OperationalSnapshotRow | undefined {
  return rows
    .filter((row) => row.snapshot_kind !== "commercial-list-page" && snapshotKindToDomain(row.snapshot_kind) === "commercial")
    .sort((a, b) => b.observed_at.localeCompare(a.observed_at) || b.id.localeCompare(a.id))[0];
}

function listRows(
  bundle: OperationalReadResult,
  scope: Scope,
  repoDomains: RepoDomainMap,
  list: CommercialListId,
): { rows: Record<string, unknown>[]; declaredTotal: number; complete: boolean; generatedAt: string; truth: OperationalTruth } {
  const visible = bundle.operational_snapshots.filter((row) => rowVisibleUnderQuery(row.scope, scope, repoDomains));
  const main = latestCommercial(visible);
  const pages = visible
    .filter((row) => row.snapshot_kind === "commercial-list-page" && (!main || row.observed_at === main.observed_at))
    .map((row) => ({ row, payload: asRecord(row.payload) }))
    .filter((entry) => entry.payload?.list === list)
    .sort((a, b) => Number(a.payload?.page_index ?? 0) - Number(b.payload?.page_index ?? 0));
  if (pages.length > 0) {
    const rows = pages.flatMap((entry) => rowsOf(entry.payload?.items));
    const declaredTotal = Math.max(rows.length, Number(pages[0]?.payload?.declared_total ?? rows.length));
    const complete = pages.every((entry) => entry.payload?.complete === true) && rows.length === declaredTotal;
    const evidence = main ?? pages[0]?.row;
    const generatedAt = main?.generated_at ?? pages[0]?.row.generated_at ?? pages[0]?.row.observed_at ?? new Date(0).toISOString();
    return {
      rows,
      declaredTotal,
      complete,
      generatedAt,
      truth: operationalTruth({
        as_of: evidence?.observed_at ?? generatedAt,
        source: evidence?.source ?? { system: "control-center", kind: "operational-view", locator: `commercial/${list}` },
        confidence: evidence?.confidence ?? 0,
        freshness_status: evidence?.freshness_status ?? "UNKNOWN",
        presence: evidence ? "present" : "absent",
        value: rows.length,
        complete,
      }),
    };
  }
  const operations = asRecord(asRecord(main?.payload)?.operations) ?? {};
  const rows = rowsOf(operations[list]);
  const overview = asRecord(operations.overview) ?? {};
  const declared = list === "activity" ? overview.activity : overview.exceptions;
  const declaredTotal = typeof declared === "number" ? Math.max(rows.length, declared) : rows.length;
  const complete = rows.length === declaredTotal;
  const generatedAt = main?.generated_at ?? main?.observed_at ?? new Date(0).toISOString();
  return {
    rows,
    declaredTotal,
    complete,
    generatedAt,
    truth: operationalTruth({
      as_of: main?.observed_at ?? generatedAt,
      source: main?.source ?? { system: "control-center", kind: "operational-view", locator: `commercial/${list}` },
      confidence: main?.confidence ?? 0,
      freshness_status: main?.freshness_status ?? "UNKNOWN",
      presence: main ? "present" : "absent",
      value: rows.length,
      complete,
    }),
  };
}

export interface CommercialListResponse {
  readonly schema_version: "control-center.commercial-list.v1";
  readonly list: CommercialListId;
  readonly generated_at: string;
  readonly loaded_total: number;
  readonly declared_total: number;
  readonly complete: boolean;
  readonly truth: OperationalTruth;
  readonly matched: number;
  readonly items: readonly Record<string, unknown>[];
  readonly page: number;
  readonly page_count: number;
  readonly page_size: number;
  readonly range_start: number;
  readonly range_end: number;
  readonly filtered: boolean;
  readonly facet_values: Readonly<Record<string, readonly string[]>>;
  readonly unavailable_facets: readonly string[];
  readonly query: {
    readonly q: string;
    readonly facets: Readonly<Record<string, string>>;
    readonly periodo: string;
    readonly ordem: string;
    readonly pagina: number;
    readonly porPagina: number;
  };
}

export function buildCommercialListResponse(
  bundle: OperationalReadResult,
  scope: Scope,
  repoDomains: RepoDomainMap,
  list: CommercialListId,
  params: Readonly<Record<string, string>>,
): CommercialListResponse {
  const source = listRows(bundle, scope, repoDomains, list);
  const spec = SPECS[list];
  const facet_values: Record<string, string[]> = {};
  const facets: Record<string, string> = {};
  for (const facet of spec.facets) {
    const values = facetValues(source.rows, facet);
    facet_values[facet.id] = values;
    const raw = params[facet.id] ?? "all";
    facets[facet.id] = values.includes(raw) ? raw : "all";
  }
  const periodo = params.periodo && params.periodo in PERIOD_HOURS ? params.periodo : "all";
  const ordem = params.ordem && SORTS.has(params.ordem) ? params.ordem : "urgencia";
  const pagina = positiveInt(params.pagina) ?? 1;
  const requestedSize = positiveInt(params.por_pagina);
  const pageSize = requestedSize !== null && PAGE_SIZES.has(requestedSize) ? requestedSize : 25;
  const q = params.q ?? "";
  const reference = Date.parse(source.generatedAt);
  const hours = PERIOD_HOURS[periodo] ?? null;
  const matchedRows = sortRows(
    source.rows.filter((row) => {
      if (!matchesText(row, q)) return false;
      for (const facet of spec.facets) {
        const wanted = facets[facet.id] ?? "all";
        if (wanted !== "all" && !fieldTexts(row, facet.fields).includes(wanted)) return false;
      }
      if (hours === null || Number.isNaN(reference)) return true;
      const at = timeOf(row, spec);
      return at !== null && at >= reference - hours * 3600_000 && at <= reference + 3600_000;
    }),
    spec,
    ordem,
  );
  const matched = matchedRows.length;
  const pageCount = Math.max(1, Math.ceil(matched / pageSize));
  const page = Math.min(pagina, pageCount);
  const offset = (page - 1) * pageSize;
  const items = matchedRows.slice(offset, offset + pageSize);
  const filtered = q.trim() !== "" || periodo !== "all" || Object.values(facets).some((value) => value !== "all");
  return {
    schema_version: "control-center.commercial-list.v1",
    list,
    generated_at: source.generatedAt,
    loaded_total: source.rows.length,
    declared_total: source.declaredTotal,
    complete: source.complete,
    truth: source.truth,
    matched,
    items,
    page,
    page_count: pageCount,
    page_size: pageSize,
    range_start: matched === 0 ? 0 : offset + 1,
    range_end: matched === 0 ? 0 : offset + items.length,
    filtered,
    facet_values,
    unavailable_facets: spec.facets.filter((facet) => facet_values[facet.id]?.length === 0).map((facet) => facet.id),
    query: { q, facets, periodo, ordem, pagina: page, porPagina: pageSize },
  };
}
