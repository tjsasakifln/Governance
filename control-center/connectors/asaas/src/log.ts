export type LogSink = (record: Record<string, unknown>) => void;

const SECRET_KEY =
  /^(.*[_-])?(api[_-]?key|access[_-]?token|authorization|password|secret|token)$/i;
const AACT_VALUE = /\$aact_[A-Za-z0-9+/=._-]+/gi;

export interface Logger {
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
  records: readonly Record<string, unknown>[];
}

function redactString(value: string, apiKey: string): string {
  let out = value;
  if (apiKey !== "") {
    out = out.split(apiKey).join("[redacted]");
  }
  out = out.replace(AACT_VALUE, "[redacted]");
  return out;
}

export function redactDeep(value: unknown, apiKey: string): unknown {
  if (typeof value === "string") {
    return redactString(value, apiKey);
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return value;
  }
  if (value === undefined) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactDeep(item, apiKey));
  }
  if (typeof value === "object") {
    const rec = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rec)) {
      if (SECRET_KEY.test(k)) {
        out[k] = "[redacted]";
        continue;
      }
      out[k] = redactDeep(v, apiKey);
    }
    return out;
  }
  return String(value);
}

export function createLogger(apiKey: string, sink?: LogSink): Logger {
  const records: Record<string, unknown>[] = [];
  const emit = (
    level: string,
    event: string,
    fields: Record<string, unknown> | undefined,
  ): void => {
    const rec = redactDeep(
      {
        level,
        event,
        ts: new Date().toISOString(),
        ...(fields ?? {}),
      },
      apiKey,
    ) as Record<string, unknown>;
    records.push(rec);
    if (sink) {
      sink(rec);
    }
  };
  return {
    info: (event, fields) => emit("info", event, fields),
    warn: (event, fields) => emit("warn", event, fields),
    error: (event, fields) => emit("error", event, fields),
    records,
  };
}

export function recordsContainSecret(
  records: readonly Record<string, unknown>[],
  apiKey: string,
): boolean {
  const blob = JSON.stringify(records);
  if (apiKey !== "" && blob.includes(apiKey)) {
    return true;
  }
  if (/\$aact_/i.test(blob)) {
    return true;
  }
  if (/"access_token"\s*:\s*"(?!\[redacted\])/i.test(blob)) {
    return true;
  }
  return false;
}
