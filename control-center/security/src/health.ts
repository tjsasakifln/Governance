import { HEALTH_BODY_KEYS, HEALTH_STATUS_OK, PUBLIC_HEALTH_PATHS } from "./constants.js";
import type { HealthBodyInspection, PathClass } from "./types.js";

const LEAK_KEY =
  /^(user|email|name|group|groups|identity|token|secret|password|dsn|database|postgres|redis|nats|session|cookie|upstream|error|stack|version|uptime|clients|queue)$/i;

function stripQuery(pathname: string): string {
  const q = pathname.indexOf("?");
  return q >= 0 ? pathname.slice(0, q) : pathname;
}

export function normalizeRequestPath(raw: string): string {
  const withoutQuery = stripQuery(raw);
  let decoded = withoutQuery;
  try {
    decoded = decodeURIComponent(withoutQuery);
  } catch {
    decoded = withoutQuery;
  }
  if (decoded.includes("\0") || decoded.includes("..")) {
    return decoded;
  }
  const collapsed = decoded.replace(/\/{2,}/g, "/");
  if (collapsed.length > 1 && collapsed.endsWith("/")) {
    return collapsed.slice(0, -1);
  }
  return collapsed.length === 0 ? "/" : collapsed;
}

export function classifyPath(pathname: string): PathClass {
  const normalized = normalizeRequestPath(pathname);
  for (const allowed of PUBLIC_HEALTH_PATHS) {
    if (normalized === allowed) {
      return "public_health";
    }
  }
  return "protected";
}

export function isPublicUnauthenticatedPath(pathname: string): boolean {
  return classifyPath(pathname) === "public_health";
}

export function healthPayload(): { status: "ok" } {
  return { status: HEALTH_STATUS_OK };
}

export function inspectHealthBody(body: unknown): HealthBodyInspection {
  const leaks: string[] = [];
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, leaks: ["health body must be a flat object"] };
  }
  const record = body as Record<string, unknown>;
  const keys = Object.keys(record);
  const allowed = new Set<string>(HEALTH_BODY_KEYS);
  for (const key of keys) {
    if (!allowed.has(key)) {
      leaks.push(`unexpected key ${key}`);
    }
    if (LEAK_KEY.test(key)) {
      leaks.push(`key ${key} leaks state or identity`);
    }
  }
  const status = record.status;
  if (status !== HEALTH_STATUS_OK) {
    leaks.push("status must be the literal ok");
  }
  for (const [key, value] of Object.entries(record)) {
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      leaks.push(`key ${key} is not a scalar`);
    }
    if (typeof value === "string") {
      if (/(postgres|redis|nats|password|token|secret|dsn|mongodb|\buser\b)/i.test(value)) {
        leaks.push(`value of ${key} looks like operational state or a secret`);
      }
    }
  }
  return { ok: leaks.length === 0, leaks };
}

export function isHealthBodySafe(body: unknown): boolean {
  return inspectHealthBody(body).ok;
}
