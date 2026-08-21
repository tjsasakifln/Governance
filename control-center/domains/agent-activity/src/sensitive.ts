/**
 * Fail-closed denylist for secrets, government IDs, payment instruments,
 * and extra PII. Actor ids are opaque handles, not emails.
 */

export const FORBIDDEN_KEY_REGEX =
  /^(secret|token|password|authorization|api[_-]?key|cookie|credential|private[_-]?key|cpf|cnpj|rg|ssn|pan|card[_-]?number|cvv|credit[_-]?card|email|e-mail|phone|telefone|endereco|address|account[_-]?number)$/i;

const CPF_LIKE = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/;
const PAN_LIKE = /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/;
const SECRET_INLINE = /(password|token|secret|api[_-]?key)\s*[=:]/i;

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
    if (CPF_LIKE.test(value) || PAN_LIKE.test(value) || SECRET_INLINE.test(value)) {
      hits.push({ path, reason: "value" });
    }
  }
}
