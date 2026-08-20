import {
  CLIENT_SLUG_PATTERN,
  ID_TYPE_BY_RESOURCE,
  RESOURCE_ID_PATTERN,
  RESOURCE_TYPE_NAMES,
  SCOPE_LITERALS,
  SCOPE_PATTERN,
  type ResourceTypeName,
} from "./taxonomy.js";

const RESOURCE_ID_RE = new RegExp(RESOURCE_ID_PATTERN);
const SCOPE_RE = new RegExp(SCOPE_PATTERN);
const CLIENT_SLUG_RE = new RegExp(CLIENT_SLUG_PATTERN);
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
