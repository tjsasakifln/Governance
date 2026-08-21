import { isDirectiveKind, isDirectiveStatus, isScope } from "./contract.ts";
import type { Directive, DirectiveFilter, DirectiveKind, DirectiveStatus } from "./types.ts";

export const EMPTY_FILTER: DirectiveFilter = {
  query: "",
  kind: "all",
  scope: "all",
  status: "all",
};

export function parseKindFilter(value: string): DirectiveKind | "all" {
  if (value === "all" || value === "") return "all";
  if (!isDirectiveKind(value)) return "all";
  return value;
}

export function parseStatusFilter(value: string): DirectiveStatus | "all" {
  if (value === "all" || value === "") return "all";
  if (!isDirectiveStatus(value)) return "all";
  return value;
}

export function parseScopeFilter(value: string): string | "all" {
  if (value === "all" || value === "") return "all";
  if (!isScope(value)) return "all";
  return value;
}

export function matchesQuery(record: Directive, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  const tags = record.tags ?? [];
  const hay = [record.title, record.body, record.id, record.scope, record.kind, record.status, ...tags]
    .join("\n")
    .toLowerCase();
  return hay.includes(q);
}

export function matchesFilter(record: Directive, filter: DirectiveFilter): boolean {
  if (filter.kind !== "all" && record.kind !== filter.kind) return false;
  if (filter.scope !== "all" && record.scope !== filter.scope) return false;
  if (filter.status !== "all" && record.status !== filter.status) return false;
  return matchesQuery(record, filter.query);
}

export function filterDirectives(
  records: readonly Directive[],
  filter: DirectiveFilter,
): Directive[] {
  return records.filter((record) => matchesFilter(record, filter));
}

export function uniqueScopes(records: readonly Directive[]): string[] {
  const set = new Set<string>();
  for (const record of records) {
    set.add(record.scope);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}
