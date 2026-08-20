/**
 * Fail-closed denylist for secrets, government IDs, payment instruments,
 * and extra PII. Allowed identity is slug + non-sensitive display name.
 */

export const FORBIDDEN_KEY_REGEX =
  /^(secret|token|password|authorization|api[_-]?key|cookie|credential|private[_-]?key|cpf|cnpj|rg|ssn|pan|card[_-]?number|cvv|credit[_-]?card|email|e-mail|phone|telefone|endereco|address|account[_-]?number)$/i;

const CPF_LIKE = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/;
const PAN_LIKE = /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/;

export interface SensitiveHit {
  path: string;
  reason: "key" | "value";
}

export function findSensitiveHits(value: unknown, path = "$"): SensitiveHit[] {
  const hits: SensitiveHit[] = [];
  walk(value, path, hits);
  return hits;
}

function walk(value: unknown, path: string, hits: SensitiveHit[]): void {
  if (value === null || value === undefined) {
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      walk(value[i], `${path}[${i}]`, hits);
    }
    return;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const childPath = `${path}.${key}`;
      if (FORBIDDEN_KEY_REGEX.test(key)) {
        hits.push({ path: childPath, reason: "key" });
      }
      walk(child, childPath, hits);
    }
    return;
  }
  if (typeof value === "string") {
    if (CPF_LIKE.test(value) || PAN_LIKE.test(value)) {
      hits.push({ path, reason: "value" });
    }
  }
}

export function collectKeys(value: unknown): string[] {
  const keys = new Set<string>();
  collect(value, keys);
  return [...keys].sort();
}

function collect(value: unknown, keys: Set<string>): void {
  if (value === null || value === undefined) {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collect(item, keys);
    }
    return;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      keys.add(key);
      collect(child, keys);
    }
  }
}
