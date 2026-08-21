import { HUGE_BODY_KEYS, SECRET_KEY_PATTERN } from "./constants.js";

export function canonicalize(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }
  if (typeof value === "object") {
    const rec = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(rec).sort()) {
      if (SECRET_KEY_PATTERN.test(key) || HUGE_BODY_KEYS.has(key)) {
        continue;
      }
      const inner = canonicalize(rec[key]);
      if (inner !== undefined) {
        out[key] = inner;
      }
    }
    return out;
  }
  return String(value);
}

export function serializeReadModel(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function serializeReadModelPretty(value: unknown): string {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

export function serializedContainsSecretKey(serialized: string): boolean {
  return /"(secret|token|password|authorization|api[_-]?key|cookie|credential|private[_-]?key|pat|github_pat|github_token)"\s*:/i.test(
    serialized,
  );
}
