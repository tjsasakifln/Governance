const SECRET_KEY = /^(secret|token|password|authorization|api[_-]?key|cookie|credential|private[_-]?key)$/i;
const PII_KEY = /^(email|phone|cpf|cnpj|rg|address|full_name|remote-email)$/i;

export function isForbiddenPayloadKey(key: string): boolean {
  return SECRET_KEY.test(key) || PII_KEY.test(key);
}

export function stripForbiddenKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripForbiddenKeys(item));
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  const rec = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(rec)) {
    if (isForbiddenPayloadKey(key)) {
      continue;
    }
    out[key] = stripForbiddenKeys(child);
  }
  return out;
}

export function payloadHasForbiddenKeys(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => payloadHasForbiddenKeys(item));
  }
  if (value === null || typeof value !== "object") {
    return false;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (isForbiddenPayloadKey(key) || payloadHasForbiddenKeys(child)) {
      return true;
    }
  }
  return false;
}
