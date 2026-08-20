import { SECRET_KEY_PATTERN } from "./constants.js";

export type StructuredLogger = (
  event: string,
  fields: Record<string, unknown>,
) => void;

function redact(value: unknown): unknown {
  if (typeof value === "string") {
    return value
      .replace(/ghp_[A-Za-z0-9_]{20,}/g, "[redacted]")
      .replace(/github_pat_[A-Za-z0-9_]{20,}/g, "[redacted]");
  }
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      if (SECRET_KEY_PATTERN.test(key)) {
        out[key] = "[redacted]";
      } else {
        out[key] = redact(inner);
      }
    }
    return out;
  }
  return value;
}

export function createLogger(
  sink: (line: string) => void = (line) => {
    process.stderr.write(`${line}\n`);
  },
  now: () => Date = () => new Date(),
): StructuredLogger {
  return (event, fields) => {
    const redacted = redact(fields);
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

export function silentLogger(): StructuredLogger {
  return () => undefined;
}
