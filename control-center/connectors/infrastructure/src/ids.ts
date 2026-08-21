import type { CheckKind } from "./types.js";

export function observationId(source: string, targetId: string, check: CheckKind): string {
  return `${source}:${targetId}:${check}`;
}

export function exceptionId(
  source: string,
  targetId: string,
  check: CheckKind,
  qualifier = "",
): string {
  return qualifier
    ? `exc:${source}:${targetId}:${check}:${qualifier}`
    : `exc:${source}:${targetId}:${check}`;
}

export function toUtcIso(date: Date): string {
  return date.toISOString();
}

export function parseUtcIso(value: string, label: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/.test(value)) {
    throw new Error(`${label} must be an ISO-8601 UTC timestamp ending in Z`);
  }
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new Error(`${label} is not a valid timestamp`);
  }
  return new Date(ms);
}

export function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
