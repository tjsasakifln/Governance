import { looksLikeSecretKey } from "./contract.ts";

export type LogFields = Record<string, string | number | boolean | null>;

const FORBIDDEN_FIELD_NAMES = new Set([
  "body",
  "title",
  "password",
  "token",
  "secret",
  "authorization",
  "cookie",
  "credential",
]);

export function sanitizeLogFields(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (looksLikeSecretKey(key) || FORBIDDEN_FIELD_NAMES.has(key.toLowerCase())) {
      continue;
    }
    out[key] = value;
  }
  return out;
}

export function logEvent(event: string, fields: LogFields = {}): string {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    event,
    ...sanitizeLogFields(fields),
  });
  return line;
}
