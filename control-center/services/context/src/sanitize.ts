import { invalid, payloadTooLarge } from "./errors.ts";
import { ACTOR_ID_PATTERN } from "./taxonomy.ts";
import { LIMITS } from "./types.ts";

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const ACTOR_ID_RE = new RegExp(`^${ACTOR_ID_PATTERN.slice(1, -1)}$`);

export function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

export function assertJsonSize(raw: string): void {
  if (utf8Bytes(raw) > LIMITS.jsonBytes) {
    throw payloadTooLarge(`JSON payload exceeds ${LIMITS.jsonBytes} bytes`);
  }
}

export function sanitizeLine(value: unknown, field: string, maxChars: number): string {
  if (typeof value !== "string") {
    throw invalid(`${field} must be a string`);
  }
  const stripped = value.replace(CONTROL_CHARS, "").replace(/\s+/g, " ").trim();
  if (stripped.length === 0) {
    throw invalid(`${field} must not be empty`);
  }
  if (stripped.length > maxChars) {
    throw invalid(`${field} exceeds ${maxChars} characters`);
  }
  if (stripped.includes("\u0000")) {
    throw invalid(`${field} contains a NUL byte`);
  }
  return stripped;
}

export function sanitizeMultiline(value: unknown, field: string, maxChars: number): string {
  if (typeof value !== "string") {
    throw invalid(`${field} must be a string`);
  }
  const stripped = value
    .replace(/\u0000/g, "")
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
  if (stripped.length === 0) {
    throw invalid(`${field} must not be empty`);
  }
  if (stripped.length > maxChars) {
    throw invalid(`${field} exceeds ${maxChars} characters`);
  }
  return stripped;
}

export function sanitizeActorId(value: unknown, field = "actor_id"): string {
  const id = sanitizeLine(value, field, LIMITS.actorIdChars);
  if (!ACTOR_ID_RE.test(id) || id.includes("@")) {
    throw invalid(`${field} must be an opaque id (no email or whitespace)`);
  }
  return id;
}

export function rejectUnknownKeys(obj: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const extra = Object.keys(obj).filter((k) => !allowed.includes(k));
  if (extra.length > 0) {
    throw invalid(`${label} has unknown fields: ${extra.sort().join(", ")}`);
  }
}
