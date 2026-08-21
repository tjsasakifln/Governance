const PLACEHOLDER =
  /(\$\{[A-Z][A-Z0-9_]*\}|\{\$[A-Z][A-Z0-9_]*\}|\{\{\s*(secret|env|file)\b|file:\/\/|\/run\/secrets\/)/;

const LIVE_SECRET = [
  /\$argon2id?\$/,
  /\$2[aby]\$\d{2}\$[./A-Za-z0-9]{20,}/,
  /postgres(?:ql)?:\/\/[^\s:]+:[^@\s]+@/i,
  /redis:\/\/[^\s:]+:[^@\s]+@/i,
  /-----BEGIN ([A-Z ]+)?PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\./,
  /\bAKIA[0-9A-Z]{16}\b/,
  /nats:\/\/[^\s:]+:[^@\s]+@/i,
];

const SECRET_KEY =
  /(pass(word)?|secret|token|api[_-]?key|authorization|private[_-]?key|credential|jwt|encryption_key|dsn)$/i;

export function isPlaceholder(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return true;
  }
  return PLACEHOLDER.test(trimmed);
}

export function looksLikeLiveSecret(value: string): boolean {
  if (isPlaceholder(value)) {
    return false;
  }
  return LIVE_SECRET.some((re) => re.test(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export interface SecretFinding {
  readonly path: string;
  readonly message: string;
}

export function scanTextForSecrets(text: string, filePath: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined) {
      continue;
    }
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || trimmed.startsWith("//")) {
      continue;
    }
    if (looksLikeLiveSecret(line) && !isPlaceholder(line)) {
      findings.push({
        path: `${filePath}:${i + 1}`,
        message: "line looks like a live secret, hash, DSN, or key material",
      });
    }
  }
  return findings;
}

export function walkSecrets(node: unknown, path: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  if (Array.isArray(node)) {
    node.forEach((item, index) => {
      findings.push(...walkSecrets(item, `${path}[${index}]`));
    });
    return findings;
  }
  if (!isRecord(node)) {
    if (typeof node === "string" && looksLikeLiveSecret(node)) {
      findings.push({ path, message: "value looks like a live secret" });
    }
    return findings;
  }
  for (const [key, value] of Object.entries(node)) {
    const child = `${path}.${key}`;
    if (SECRET_KEY.test(key) && typeof value === "string") {
      if (!isPlaceholder(value) && value.trim() !== "argon2" && value.trim() !== "argon2id") {
        findings.push({
          path: child,
          message: `hardcoded ${key} is forbidden; inject via env or secret file`,
        });
      }
    }
    findings.push(...walkSecrets(value, child));
  }
  return findings;
}
