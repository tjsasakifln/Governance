const REDACT_KEYS = new Set([
  "authorization",
  "auth_token",
  "token",
  "password",
  "secret",
  "api_key",
  "apikey",
  "CONFENGE_MCP_AUTH_TOKEN",
]);

export interface LogFields {
  [key: string]: unknown;
}

export interface Logger {
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

export interface LoggerOptions {
  write?: (line: string) => void;
  now?: () => string;
}

export function redact(value: unknown, extraSecrets: string[] = []): unknown {
  return redactInner(value, extraSecrets.filter((s) => s.length > 0));
}

function redactInner(value: unknown, extraSecrets: string[]): unknown {
  if (typeof value === "string") {
    return extraSecrets.reduce((acc, secret) => acc.split(secret).join("[REDACTED]"), value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactInner(item, extraSecrets));
  }
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (REDACT_KEYS.has(key) || REDACT_KEYS.has(key.toLowerCase())) {
        out[key] = "[REDACTED]";
      } else {
        out[key] = redactInner(nested, extraSecrets);
      }
    }
    return out;
  }
  return value;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const write = options.write ?? ((line: string) => process.stderr.write(`${line}\n`));
  const now = options.now ?? (() => new Date().toISOString());

  const emit = (level: string, msg: string, fields?: LogFields): void => {
    const payload = redact({
      ts: now(),
      level,
      msg,
      service: "confenge-control-center-mcp",
      ...(fields ?? {}),
    });
    write(JSON.stringify(payload));
  };

  return {
    info: (msg, fields) => emit("info", msg, fields),
    warn: (msg, fields) => emit("warn", msg, fields),
    error: (msg, fields) => emit("error", msg, fields),
  };
}
