import { invalid } from "./errors.ts";
import {
  DOMAIN_LITERALS,
  REPO_NAME_PATTERN,
  SCOPE_LITERALS,
  SCOPE_PATTERN,
  type DomainLiteral,
  type ScopeLiteral,
} from "./taxonomy.ts";
import { LIMITS, type Scope } from "./types.ts";

const SCOPE_RE = new RegExp(SCOPE_PATTERN);
const REPO_NAME_RE = new RegExp(`^${REPO_NAME_PATTERN.slice(1, -1)}$`);

export type RepoDomainMap = Readonly<Record<string, DomainLiteral>>;

export function isScope(value: unknown): value is Scope {
  return (
    typeof value === "string" &&
    value.length >= 2 &&
    value.length <= LIMITS.scopeChars &&
    SCOPE_RE.test(value)
  );
}

export function parseScope(raw: unknown): Scope {
  if (raw !== null && typeof raw === "object") {
    throw invalid("scope must be a string; object {company,domain,resource} is not accepted");
  }
  if (typeof raw !== "string") {
    throw invalid("scope must be a string");
  }
  if (raw.length < 2 || raw.length > LIMITS.scopeChars) {
    throw invalid(`scope must be between 2 and ${LIMITS.scopeChars} characters`);
  }
  if (!SCOPE_RE.test(raw)) {
    throw invalid("scope is not a v1 Control Center scope");
  }
  return raw;
}

export function isLiteralScope(value: string): value is ScopeLiteral {
  return (SCOPE_LITERALS as readonly string[]).includes(value);
}

export function isDomainLiteral(value: string): value is DomainLiteral {
  return (DOMAIN_LITERALS as readonly string[]).includes(value);
}

export function repoNameFromScope(scope: Scope): string | null {
  if (!scope.startsWith("repo:")) {
    return null;
  }
  const name = scope.slice("repo:".length);
  return REPO_NAME_RE.test(name) ? name : null;
}

export function clientSlugFromScope(scope: Scope): string | null {
  if (!scope.startsWith("client:")) {
    return null;
  }
  return scope.slice("client:".length);
}

export function parseRepoDomainMap(raw: unknown): RepoDomainMap {
  if (raw === undefined || raw === null) {
    return {};
  }
  if (typeof raw === "string") {
    const out: Record<string, DomainLiteral> = {};
    const trimmed = raw.trim();
    if (trimmed === "") {
      return {};
    }
    for (const part of trimmed.split(",")) {
      const item = part.trim();
      if (item === "") {
        continue;
      }
      const sep = item.lastIndexOf(":");
      if (sep <= 0 || sep === item.length - 1) {
        throw invalid("CONTROL_CENTER_REPO_DOMAINS entries must be repo:domain");
      }
      const name = item.slice(0, sep);
      const domain = item.slice(sep + 1);
      assignRepoDomain(out, name, domain);
    }
    return out;
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw invalid("repo domain map must be an object or CSV string");
  }
  const out: Record<string, DomainLiteral> = {};
  for (const [name, domain] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof domain !== "string") {
      throw invalid("repo domain map values must be domain literals");
    }
    assignRepoDomain(out, name, domain);
  }
  return out;
}

function assignRepoDomain(out: Record<string, DomainLiteral>, name: string, domain: string): void {
  if (!REPO_NAME_RE.test(name)) {
    throw invalid(`repo name is invalid: ${name}`);
  }
  if (!isDomainLiteral(domain)) {
    throw invalid(`repo domain must be one of: ${DOMAIN_LITERALS.join(", ")}`);
  }
  out[name] = domain;
}

/**
 * Controlled inheritance: a query receives the query scope plus explicit
 * ancestors. Never descendants, never siblings.
 *
 * - `company` → {company}
 * - domain literal → {company, that domain}
 * - `repo:x` → {company, configured domain for x, repo:x}
 * - `client:y` → {company, clients, client:y}
 */
export function expandInheritedScopes(query: Scope, repoDomains: RepoDomainMap): readonly Scope[] {
  if (query === "company") {
    return ["company"];
  }
  if (isLiteralScope(query)) {
    return ["company", query];
  }
  const repoName = repoNameFromScope(query);
  if (repoName !== null) {
    const domain = repoDomains[repoName];
    if (domain) {
      return ["company", domain, query];
    }
    return ["company", query];
  }
  if (clientSlugFromScope(query) !== null) {
    return ["company", "clients", query];
  }
  return ["company", query];
}

export function scopeVisibleUnderQuery(
  directiveScope: Scope,
  query: Scope,
  repoDomains: RepoDomainMap,
): boolean {
  return expandInheritedScopes(query, repoDomains).includes(directiveScope);
}
