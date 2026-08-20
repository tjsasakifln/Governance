const SECRET_KEY =
  /^(.*[_-])?(api[_-]?key|access[_-]?token|authorization|password|secret|token|cookie|credential|private[_-]?key)$/i;

const PII_KEY = /^(email|phone|first_name|last_name|full_name|person|contact_name)$/i;

export type LogSink = (record: Record<string, unknown>) => void;

function redact(value: unknown): unknown {
  if (typeof value === "string") {
    return value;
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return value;
  }
  if (value === undefined) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (typeof value === "object") {
    const rec = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rec)) {
      if (SECRET_KEY.test(k) || PII_KEY.test(k)) {
        out[k] = "[redacted]";
        continue;
      }
      out[k] = redact(v);
    }
    return out;
  }
  return String(value);
}

export function logStructured(
  level: "info" | "warn" | "error",
  event: string,
  fields: Record<string, unknown> = {},
  sink: LogSink = (record) => {
    process.stderr.write(`${JSON.stringify(record)}\n`);
  },
): void {
  const rec = redact({
    level,
    event,
    ts: new Date().toISOString(),
    ...fields,
  }) as Record<string, unknown>;
  sink(rec);
}
