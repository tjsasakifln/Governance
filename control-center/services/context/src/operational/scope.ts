import {
  clientSlugFromScope,
  expandInheritedScopes,
  isLiteralScope,
  repoNameFromScope,
  type RepoDomainMap,
} from "../scope.ts";
import type { Scope } from "../types.ts";
import { OPERATIONAL_DOMAINS, type OperationalDomain } from "./types.ts";

/**
 * Company queries see literal company/domain rows, never repo:* or client:*
 * siblings. Parameterized queries see inherited ancestors plus that resource.
 */
export function operationalVisibleScopes(query: Scope, repoDomains: RepoDomainMap): readonly Scope[] {
  if (query === "company") {
    return ["company", "commercial", "finance", "clients", "infrastructure", "inbound"];
  }
  return expandInheritedScopes(query, repoDomains);
}

export function rowVisibleUnderQuery(rowScope: Scope, query: Scope, repoDomains: RepoDomainMap): boolean {
  const visible = operationalVisibleScopes(query, repoDomains);
  if (visible.includes(rowScope)) {
    return true;
  }
  if (query.startsWith("repo:") && rowScope === query) {
    return true;
  }
  if (query.startsWith("client:") && rowScope === query) {
    return true;
  }
  return false;
}

export function applicableDomains(query: Scope): readonly OperationalDomain[] {
  if (query === "company") {
    return OPERATIONAL_DOMAINS;
  }
  if (query === "commercial") {
    return ["commercial"];
  }
  if (query === "inbound") {
    return ["commercial", "pncp"];
  }
  if (query === "finance") {
    return ["finance"];
  }
  if (query === "clients") {
    return ["clients"];
  }
  if (query === "infrastructure") {
    return ["infrastructure", "pncp"];
  }
  if (repoNameFromScope(query)) {
    return ["engineering", "infrastructure"];
  }
  if (clientSlugFromScope(query)) {
    return ["commercial", "finance", "clients"];
  }
  if (isLiteralScope(query)) {
    return OPERATIONAL_DOMAINS;
  }
  return OPERATIONAL_DOMAINS;
}

export function snapshotKindToDomain(kind: string): OperationalDomain | null {
  const normalized = kind.trim().toLowerCase();
  if ((OPERATIONAL_DOMAINS as readonly string[]).includes(normalized)) {
    return normalized as OperationalDomain;
  }
  if (normalized === "founder-override" || normalized === "founder_override") {
    return null;
  }
  if (normalized.includes("warmbly") || normalized.includes("commercial")) {
    return "commercial";
  }
  if (normalized.includes("asaas") || normalized.includes("finance")) {
    return "finance";
  }
  if (normalized.includes("github") || normalized.includes("engineering") || normalized.includes("repo")) {
    return "engineering";
  }
  if (normalized.includes("infra")) {
    return "infrastructure";
  }
  if (normalized.includes("pncp")) {
    return "pncp";
  }
  if (normalized.includes("client")) {
    return "clients";
  }
  return null;
}

export function collectorNameToDomain(collectorName: string): OperationalDomain | null {
  const name = collectorName.toLowerCase();
  if (name.includes("pncp")) {
    return "pncp";
  }
  if (name.includes("infra")) {
    return "infrastructure";
  }
  if (name.includes("github") || name.includes("engineering") || name.includes("repo")) {
    return "engineering";
  }
  if (name.includes("asaas") || name.includes("finance")) {
    return "finance";
  }
  if (name.includes("client")) {
    return "clients";
  }
  if (name.includes("warmbly") || name.includes("commercial") || name.includes("inbound")) {
    return "commercial";
  }
  return null;
}
