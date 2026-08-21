import { tokenEnvKeys } from "./auth.js";
import type { StructuredLogger } from "./types.js";

const SECRET_PATTERNS = [
  /ghp_[A-Za-z0-9_]{20,}/g,
  /gho_[A-Za-z0-9_]{20,}/g,
  /ghu_[A-Za-z0-9_]{20,}/g,
  /ghs_[A-Za-z0-9_]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

const REDACT_KEYS = new Set([
  "authorization",
  "token",
  "pat",
  "password",
  "secret",
  "private_key",
  "privatekey",
  "github_token",
  "github_pat",
  "gh_token",
  "github_app_private_key",
  "github_app_installation_token",
]);

export function createLogger(
  sink: (line: string) => void = (line) => console.log(line),
  now: () => Date = () => new Date(),
  extraSecrets: readonly string[] = [],
): StructuredLogger {
  return (event, fields) => {
    const redacted = redactValue(fields, extraSecrets);
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

export function collectEnvSecrets(env: NodeJS.Dict<string>): string[] {
  const secrets: string[] = [];
  for (const key of tokenEnvKeys()) {
    const value = env[key];
    if (typeof value === "string" && value.trim().length > 0) {
      secrets.push(value.trim());
    }
  }
  const privateKey = env.GITHUB_APP_PRIVATE_KEY;
  if (typeof privateKey === "string" && privateKey.trim().length > 0) {
    secrets.push(privateKey.trim());
  }
  return secrets;
}

export function redactValue(value: unknown, extraSecrets: readonly string[] = []): unknown {
  if (typeof value === "string") {
    return redactString(value, extraSecrets);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, extraSecrets));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (REDACT_KEYS.has(key.toLowerCase())) {
        out[key] = "[redacted]";
      } else {
        out[key] = redactValue(inner, extraSecrets);
      }
    }
    return out;
  }
  return value;
}

export function redactString(value: string, extraSecrets: readonly string[] = []): string {
  let next = value;
  for (const secret of extraSecrets) {
    if (secret.length > 0 && next.includes(secret)) {
      next = next.split(secret).join("[redacted]");
    }
  }
  for (const pattern of SECRET_PATTERNS) {
    next = next.replace(pattern, "[redacted]");
  }
  return next;
}

export function serializeForOutput(
  value: unknown,
  extraSecrets: readonly string[] = [],
): string {
  return JSON.stringify(redactValue(value, extraSecrets));
}
