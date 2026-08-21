import { ValidationError } from './errors.js';

const SECRET_OR_PII_KEY =
  /(^|[_-])(password|passwd|secret|token|authorization|auth|api[_-]?key|private[_-]?key|cookie|session[_-]?id|ssn|cpf|cnpj|email|phone|telefone|credit[_-]?card|card[_-]?number|access[_-]?token|refresh[_-]?token)s?$/i;

const MAX_JSON_BYTES = 512 * 1024;

export function isSecretOrPiiKey(key: string): boolean {
  const normalized = key.trim();
  if (!normalized) {
    return false;
  }
  return SECRET_OR_PII_KEY.test(normalized);
}

function walkForSecrets(value: unknown, path: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const hit = walkForSecrets(value[i], `${path}[${i}]`);
      if (hit) {
        return hit;
      }
    }
    return null;
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (isSecretOrPiiKey(key)) {
        return path ? `${path}.${key}` : key;
      }
      const hit = walkForSecrets(child, path ? `${path}.${key}` : key);
      if (hit) {
        return hit;
      }
    }
  }
  return null;
}

export function assertSanitizedJson(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (value === undefined || value === null) {
    return {};
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(`${label}: payload must be a JSON object`);
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new ValidationError(`${label}: payload is not serializable JSON`);
  }
  if (serialized.length > MAX_JSON_BYTES) {
    throw new ValidationError(`${label}: payload exceeds ${MAX_JSON_BYTES} bytes`);
  }
  const hit = walkForSecrets(value, '');
  if (hit) {
    throw new ValidationError(`${label}: payload contains forbidden secret/PII key ${hit}`);
  }
  return value as Record<string, unknown>;
}

export function stripSecretOrPiiKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripSecretOrPiiKeys(item));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (isSecretOrPiiKey(key)) {
        continue;
      }
      out[key] = stripSecretOrPiiKeys(child);
    }
    return out;
  }
  return value;
}

export function sanitizeErrorMessage(message: string | null | undefined): string | null {
  if (!message) {
    return null;
  }
  const trimmed = message.replace(/\s+/g, ' ').trim().slice(0, 512);
  if (!trimmed) {
    return null;
  }
  return trimmed
    .replace(/(api[_-]?key|token|password|secret|authorization)\s*[:=]\s*\S+/gi, '$1=[redacted]')
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, 'postgres://[redacted]');
}

export function sanitizeErrorCode(code: string | null | undefined): string | null {
  if (!code) {
    return null;
  }
  const trimmed = code.trim().slice(0, 64);
  if (!trimmed) {
    return null;
  }
  if (isSecretOrPiiKey(trimmed)) {
    return 'sanitized_error';
  }
  return trimmed;
}
