import type { DestinationPage } from "./adapters/contract";
import type { Provenance } from "./types";

export function collectProvenance(page: DestinationPage): Provenance[] {
  const items: Provenance[] = [];
  for (const row of page.attention) items.push(row.provenance);
  for (const row of page.priorities) items.push(row.provenance);
  if (page.commercial) items.push(page.commercial.provenance);
  if (page.finance) items.push(page.finance.provenance);
  if (page.engineering) items.push(page.engineering.provenance);
  if (page.clients) {
    for (const row of page.clients) items.push(row.provenance);
  }
  if (page.health) {
    for (const row of page.health) items.push(row.provenance);
  }
  return items;
}

export function pageIsEmpty(page: DestinationPage): boolean {
  return (
    page.attention.length === 0 &&
    page.priorities.length === 0 &&
    page.commercial === undefined &&
    page.finance === undefined &&
    page.engineering === undefined &&
    (page.clients?.length ?? 0) === 0 &&
    (page.health?.length ?? 0) === 0 &&
    (page.directives?.length ?? 0) === 0 &&
    (page.sessions?.length ?? 0) === 0
  );
}

export function pageIsStale(page: DestinationPage): boolean {
  const provenances = collectProvenance(page);
  return provenances.length > 0 && provenances.every((item) => item.freshness_status === "STALE");
}
