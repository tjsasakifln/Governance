const SECRET_HEADER_NAMES = new Set([
  "authorization",
  "proxy-authorization",
  "x-api-key",
  "x-warmbly-key",
]);

const SECRET_KEY_NAMES = new Set([
  "authorization",
  "api_key",
  "apikey",
  "api-key",
  "token",
  "access_token",
  "refresh_token",
  "password",
  "secret",
  "warMBLY_API_TOKEN".toLowerCase(),
  "warmbly_api_token",
  "warmbly_api_key",
  "bearer",
]);

const SECRET_PATTERN =
  /(?:wmbly_[A-Za-z0-9+/=_-]{8,}|Bearer\s+[A-Za-z0-9._+/=-]{8,})/gi;

export function redactSecrets(value: string): string {
  return value.replace(SECRET_PATTERN, "[REDACTED]");
}

export function redactHeaders(
  headers: Record<string, string> | Headers | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) {
    return out;
  }
  const entries =
    headers instanceof Headers
      ? Array.from(headers.entries())
      : Object.entries(headers);
  for (const [key, raw] of entries) {
    if (SECRET_HEADER_NAMES.has(key.toLowerCase())) {
      out[key] = "[REDACTED]";
    } else {
      out[key] = redactSecrets(String(raw));
    }
  }
  return out;
}

export function redactUnknown(value: unknown): unknown {
  if (typeof value === "string") {
    return redactSecrets(value);
  }
  if (Array.isArray(value)) {
    return value.map(redactUnknown);
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (SECRET_KEY_NAMES.has(k.toLowerCase())) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = redactUnknown(v);
      }
    }
    return out;
  }
  return value;
}

export type StructuredLog = {
  level: "info" | "warn" | "error";
  msg: string;
  [key: string]: unknown;
};

export type Logger = (entry: StructuredLog) => void;

export function createStderrLogger(): Logger {
  return (entry) => {
    const safe = redactUnknown(entry);
    process.stderr.write(`${JSON.stringify(safe)}\n`);
  };
}

export function serializeLog(entry: StructuredLog): string {
  return JSON.stringify(redactUnknown(entry));
}
