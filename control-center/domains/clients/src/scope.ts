import { CLIENT_SLUG_PATTERN } from "./contract.js";
import { ClientOpsError } from "./errors.js";

const CLIENT_SLUG_RE = new RegExp(CLIENT_SLUG_PATTERN);

export type ParsedScope =
  | { kind: "all" }
  | { kind: "client"; clientSlug: string };

const ALL_SCOPES = new Set(["all", "clients", "company"]);

/**
 * Query scope. `client:<slug>` never dumps other clients.
 * `clients` / `company` / `all` / omitted mean every client in this store
 * (this domain's universe — not whole-company memory).
 */
export function parseScope(input: string | undefined): ParsedScope {
  if (input === undefined || input.trim() === "") {
    return { kind: "all" };
  }
  const trimmed = input.trim();
  if (ALL_SCOPES.has(trimmed)) {
    return { kind: "all" };
  }
  if (trimmed.startsWith("client:")) {
    const slug = trimmed.slice("client:".length);
    if (!CLIENT_SLUG_RE.test(slug)) {
      throw new ClientOpsError("invalid_scope", `invalid client scope: ${input}`);
    }
    return { kind: "client", clientSlug: slug };
  }
  throw new ClientOpsError("invalid_scope", `invalid scope: ${input}`);
}

export function formatClientScope(slug: string): string {
  if (!CLIENT_SLUG_RE.test(slug)) {
    throw new ClientOpsError("invalid_scope", `invalid client slug: ${slug}`);
  }
  return `client:${slug}`;
}

export function matchesScope(clientSlug: string, scope: ParsedScope): boolean {
  if (scope.kind === "all") {
    return true;
  }
  return scope.clientSlug === clientSlug;
}
