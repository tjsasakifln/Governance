import {
  CLIENT_KEY_FIELDS,
  CLIENT_KEY_FIELD_BASIS,
  CLIENT_NAME_FIELDS,
  CLIENT_SLUG_PATTERN,
  ID_TYPE_BY_RESOURCE,
  MIN_CLIENT_SLUG_LENGTH,
  RESERVED_CLIENT_SLUG_PATTERN,
  type ClientIdentityBasis,
  type ClientIdentityReasonCode,
  RESOURCE_ID_PATTERN,
  RESOURCE_TYPE_NAMES,
  SCOPE_LITERALS,
  SCOPE_PATTERN,
  type ResourceTypeName,
} from "./taxonomy.js";

const RESOURCE_ID_RE = new RegExp(RESOURCE_ID_PATTERN);
const SCOPE_RE = new RegExp(SCOPE_PATTERN);
const CLIENT_SLUG_RE = new RegExp(CLIENT_SLUG_PATTERN);
const RESERVED_CLIENT_SLUG_RE = new RegExp(RESERVED_CLIENT_SLUG_PATTERN);
const ID_TYPES = new Set(Object.values(ID_TYPE_BY_RESOURCE));

export function isResourceId(value: unknown): value is string {
  return typeof value === "string" && RESOURCE_ID_RE.test(value);
}

export function isScope(value: unknown): value is string {
  return typeof value === "string" && SCOPE_RE.test(value);
}

export function isClientSlug(value: unknown): value is string {
  return typeof value === "string" && CLIENT_SLUG_RE.test(value);
}

/** True when the slug is a placeholder token rather than a client identity. */
export function isReservedClientSlug(value: unknown): boolean {
  return typeof value === "string" && RESERVED_CLIENT_SLUG_RE.test(value.trim().toLowerCase());
}

/**
 * Minimum client identity: a well-formed slug, long enough to be an identifier,
 * and not one of the reserved placeholder tokens.
 */
export function isIdentifiedClientSlug(value: unknown): value is string {
  return (
    isClientSlug(value) &&
    value.length >= MIN_CLIENT_SLUG_LENGTH &&
    !isReservedClientSlug(value)
  );
}

/** Normalize any raw string the way a slug would be derived, without judging it. */
function normalizeSlugCandidate(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Fail-closed slug derivation. Returns `null` whenever the raw value cannot
 * carry an identity (absent, non-string, sanitizes to nothing, or reduces to a
 * reserved placeholder). It never invents a plausible-looking slug: callers must
 * route a `null` to the data-quality queue instead of publishing a client.
 */
export function clientSlugFrom(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const candidate = normalizeSlugCandidate(raw);
  return isIdentifiedClientSlug(candidate) ? candidate : null;
}

/**
 * A client identity resolved from a source record, or the reasons it could not be.
 *
 * `slug === null` means the record has no client identity. There is no third
 * state and no fallback slug: callers route it to the data-quality queue.
 */
export interface ResolvedClientIdentity {
  slug: string | null;
  display_name: string | null;
  basis: ClientIdentityBasis | null;
  reasons: ClientIdentityReasonCode[];
}

function fieldString(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/**
 * Resolve the client identity of a source record — the one place that decides
 * what a client is.
 *
 * A client is a company / account / organization, so only client-level fields
 * are consulted: an explicit account key first, then the company name. The
 * record's own primary key is deliberately NOT consulted. In a deal stream that
 * key is a *deal* id: using it mints one "client" per deal, gives two deals for
 * one company two different client slugs, and dresses a deal id up as a client
 * identity. That is the substitution this function exists to prevent.
 */
export function resolveClientIdentity(row: Record<string, unknown>): ResolvedClientIdentity {
  const reasons: ClientIdentityReasonCode[] = [];

  let rawKey: string | null = null;
  let basis: ClientIdentityBasis | null = null;
  for (const field of CLIENT_KEY_FIELDS) {
    const value = fieldString(row, field);
    if (value !== null) {
      rawKey = value;
      basis = CLIENT_KEY_FIELD_BASIS[field];
      break;
    }
  }

  let name: string | null = null;
  for (const field of CLIENT_NAME_FIELDS) {
    const value = fieldString(row, field);
    if (value !== null && !isPlaceholderDisplayName(value)) {
      name = value;
      break;
    }
  }

  // No account key: the company name is the only client-level identifier left.
  if (rawKey === null && name !== null) {
    rawKey = name;
    basis = "company_name";
  }

  if (rawKey === null) {
    reasons.push("missing_client_key");
  }

  const slug = clientSlugFrom(rawKey);
  if (rawKey !== null && slug === null) {
    reasons.push(
      isReservedClientSlug(normalizeSlugCandidate(rawKey))
        ? "reserved_placeholder_slug"
        : "unusable_client_key",
    );
  }

  if (name === null) {
    const anyName = CLIENT_NAME_FIELDS.map((field) => fieldString(row, field)).find(
      (value) => value !== null,
    );
    reasons.push(anyName === undefined ? "missing_display_name" : "placeholder_display_name");
  }

  return {
    slug,
    display_name: name,
    basis: slug !== null ? basis : null,
    reasons,
  };
}

/**
 * True when a display name carries no identity — absent, too short, or a
 * placeholder word such as "Cliente" or "unknown".
 */
export function isPlaceholderDisplayName(value: unknown): boolean {
  if (typeof value !== "string") {
    return true;
  }
  const trimmed = value.trim();
  if (trimmed.length < MIN_CLIENT_SLUG_LENGTH) {
    return true;
  }
  return isReservedClientSlug(normalizeSlugCandidate(trimmed));
}

export function parseResourceId(
  value: string,
): { prefix: "cc"; type: string; id: string } | null {
  if (!isResourceId(value)) {
    return null;
  }
  const parts = value.split(":");
  const prefix = parts[0];
  const type = parts[1];
  const id = parts.slice(2).join(":");
  if (prefix !== "cc" || type === undefined || id.length === 0) {
    return null;
  }
  return { prefix: "cc", type, id };
}

export function resourceIdTypeIsKnown(type: string): boolean {
  return ID_TYPES.has(type);
}

export function expectedIdType(resource: ResourceTypeName): string {
  return ID_TYPE_BY_RESOURCE[resource];
}

export function clientScope(slug: string): string {
  if (!isClientSlug(slug)) {
    throw new Error(`invalid client slug: ${slug}`);
  }
  return `client:${slug}`;
}

export function repoScope(name: string): string {
  const scope = `repo:${name}`;
  if (!isScope(scope) || !scope.startsWith("repo:")) {
    throw new Error(`invalid repo name: ${name}`);
  }
  return scope;
}

export function isLiteralScope(value: string): boolean {
  return (SCOPE_LITERALS as readonly string[]).includes(value);
}

export function isResourceTypeName(value: string): value is ResourceTypeName {
  return (RESOURCE_TYPE_NAMES as readonly string[]).includes(value);
}
