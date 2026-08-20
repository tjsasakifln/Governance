const REDACT_KEYS = new Set([
  "authorization",
  "token",
  "password",
  "secret",
  "private_key",
  "privatekey",
  "api_key",
  "apikey",
  "cookie",
  "credential",
  "github_token",
  "github_pat",
]);

const SECRET_PATTERNS = [
  /ghp_[A-Za-z0-9_]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

export type StructuredLogger = (
  event: string,
  fields?: Record<string, unknown>,
) => void;

export function createLogger(
  sink: (line: string) => void = (line) => process.stderr.write(`${line}\n`),
  now: () => Date = () => new Date(),
): StructuredLogger {
  return (event, fields = {}) => {
    const redacted = redactValue(fields);
    const payload =
      redacted !== null && typeof redacted === "object" && !Array.isArray(redacted)
        ? (redacted as Record<string, unknown>)
        : { fields: redacted };
    sink(
      JSON.stringify({
        ts: now().toISOString(),
        event,
        ...payload,
      }),
    );
  };
}

export function redactValue(value: unknown): unknown {
  if (typeof value === "string") {
    return redactString(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (REDACT_KEYS.has(key.toLowerCase())) {
        out[key] = "[redacted]";
      } else {
        out[key] = redactValue(inner);
      }
    }
    return out;
  }
  return value;
}

export function redactString(value: string): string {
  let next = value;
  for (const pattern of SECRET_PATTERNS) {
    next = next.replace(pattern, "[redacted]");
  }
  return next;
}
