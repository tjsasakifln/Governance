import { randomUUID } from "node:crypto";
import { invalid } from "./errors.ts";
import { ID_TYPE_PATTERN, RESOURCE_ID_PATTERN } from "./taxonomy.ts";
import { LIMITS } from "./types.ts";

const RESOURCE_ID_RE = new RegExp(RESOURCE_ID_PATTERN);
const ID_TYPE_RE = new RegExp(ID_TYPE_PATTERN);

export interface IdGenerator {
  next(type: string): string;
}

export function isResourceId(value: unknown): value is string {
  return typeof value === "string" && value.length <= LIMITS.resourceIdChars && RESOURCE_ID_RE.test(value);
}

export function assertResourceId(value: unknown, field: string): string {
  if (!isResourceId(value)) {
    throw invalid(`${field} must be a canonical resource id (cc:<type-kebab>:<ulid-or-slug>)`);
  }
  return value;
}

export function makeResourceId(type: string, slug: string): string {
  if (!ID_TYPE_RE.test(type)) {
    throw invalid(`resource id type must match ${ID_TYPE_PATTERN}`);
  }
  if (slug.length === 0 || !/^[A-Za-z0-9._~-]+$/.test(slug)) {
    throw invalid("resource id slug is invalid");
  }
  const id = `cc:${type}:${slug}`;
  if (!isResourceId(id)) {
    throw invalid("resource id exceeds canonical constraints");
  }
  return id;
}

export const cryptoIds: IdGenerator = {
  next(type: string): string {
    return makeResourceId(type, randomUUID());
  },
};

export function sequentialIds(prefix: string): IdGenerator {
  let n = 0;
  return {
    next(type: string): string {
      n += 1;
      return makeResourceId(type, `${prefix}-${String(n).padStart(4, "0")}`);
    },
  };
}
