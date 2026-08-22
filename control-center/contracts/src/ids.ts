import {
  CLIENT_SLUG_PATTERN,
  ID_TYPE_BY_RESOURCE,
  MIN_CLIENT_SLUG_LENGTH,
  RESERVED_CLIENT_SLUG_PATTERN,
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
