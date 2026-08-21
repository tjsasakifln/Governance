import { FORBIDDEN_SECRET_KEY_RE } from "./taxonomy.js";

export type LogLevel = "info" | "warn" | "error";

export type LogFields = Record<string, string | number | boolean | null>;

export interface Logger {
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

function assertSafeFields(fields: LogFields | undefined): void {
  if (!fields) {
    return;
  }
  for (const key of Object.keys(fields)) {
    if (FORBIDDEN_SECRET_KEY_RE.test(key)) {
      throw new Error("refusing to log a secret-bearing field name");
    }
  }
}

export function createLogger(service = "control-center-attention"): Logger {
  const write = (level: LogLevel, msg: string, fields?: LogFields): void => {
    assertSafeFields(fields);
    const rec: LogFields = {
      level,
      msg,
      service,
      ts: new Date().toISOString(),
    };
    if (fields) {
      for (const [k, v] of Object.entries(fields)) {
        rec[k] = v;
      }
    }
    const line = `${JSON.stringify(rec)}\n`;
    if (level === "error") {
      process.stderr.write(line);
    } else {
      process.stderr.write(line);
    }
  };
  return {
    info: (msg, fields) => write("info", msg, fields),
    warn: (msg, fields) => write("warn", msg, fields),
    error: (msg, fields) => write("error", msg, fields),
  };
}

export const silentLogger: Logger = {
  info() {},
  warn() {},
  error() {},
};
