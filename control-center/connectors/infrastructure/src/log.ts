const SECRET_KEY = /pass(word)?|secret|token|api[_-]?key|authorization|private[_-]?key|ssh|credential|cookie/i;

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEY.test(k) ? "[redacted]" : redact(v);
    }
    return out;
  }
  if (typeof value === "string" && /BEGIN [A-Z ]*PRIVATE KEY/.test(value)) {
    return "[redacted]";
  }
  return value;
}

export function logEvent(event: string, fields: Readonly<Record<string, unknown>> = {}): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    event,
    ...((redact(fields) as Record<string, unknown>) ?? {}),
  });
  process.stderr.write(`${line}\n`);
}
