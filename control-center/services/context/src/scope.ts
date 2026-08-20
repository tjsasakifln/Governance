import { invalid } from "./errors.ts";
import { sanitizeScopePart } from "./sanitize.ts";
import type { Scope } from "./types.ts";

const SCOPE_KEYS = ["company", "domain", "resource"] as const;

export function parseScope(raw: unknown): Scope {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw invalid("scope must be an object");
  }
  const obj = raw as Record<string, unknown>;
  const extra = Object.keys(obj).filter((k) => !SCOPE_KEYS.includes(k as (typeof SCOPE_KEYS)[number]));
  if (extra.length > 0) {
    throw invalid(`scope has unknown fields: ${extra.sort().join(", ")}`);
  }
  if (typeof obj.company !== "string") {
    throw invalid("scope.company is required");
  }
  const scope: Scope = { company: sanitizeScopePart(obj.company, "scope.company") };
  if (obj.domain !== undefined) {
    scope.domain = sanitizeScopePart(obj.domain, "scope.domain");
  }
  if (obj.resource !== undefined) {
    if (scope.domain === undefined) {
      throw invalid("scope.resource requires scope.domain");
    }
    scope.resource = sanitizeScopePart(obj.resource, "scope.resource");
  }
  return scope;
}

export function scopeKey(scope: Scope): string {
  const parts = [scope.company];
  if (scope.domain) {
    parts.push(scope.domain);
  }
  if (scope.resource) {
    parts.push(scope.resource);
  }
  return parts.join("/");
}

export function sortScope(scope: Scope): Scope {
  const out: Scope = { company: scope.company };
  if (scope.domain !== undefined) {
    out.domain = scope.domain;
  }
  if (scope.resource !== undefined) {
    out.resource = scope.resource;
  }
  return out;
}

/**
 * Controlled inheritance: a directive is visible under a query when the
 * directive's scope is the query itself or an ancestor (company → domain →
 * resource). Descendants and siblings are never returned.
 */
export function scopeVisibleUnderQuery(directiveScope: Scope, query: Scope): boolean {
  if (directiveScope.company !== query.company) {
    return false;
  }
  if (directiveScope.domain === undefined) {
    return true;
  }
  if (query.domain !== directiveScope.domain) {
    return false;
  }
  if (directiveScope.resource === undefined) {
    return true;
  }
  return query.resource === directiveScope.resource;
}
