export type LogLevel = "info" | "warn" | "error";

export interface Logger {
  info(msg: string, fields?: Record<string, string | number | boolean | null>): void;
  warn(msg: string, fields?: Record<string, string | number | boolean | null>): void;
  error(msg: string, fields?: Record<string, string | number | boolean | null>): void;
}

const SECRET_KEY = /pass(word)?|secret|token|authorization|cookie|database_url|dsn|private[_-]?key|api[_-]?key/i;

function assertSafeFields(fields: Record<string, string | number | boolean | null> | undefined): void {
  if (!fields) {
    return;
  }
  for (const key of Object.keys(fields)) {
    if (SECRET_KEY.test(key)) {
      throw new Error("refusing to log a secret-bearing field name");
    }
  }
}

export function createLogger(service = "control-center-context"): Logger {
  const write = (
    level: LogLevel,
    msg: string,
    fields?: Record<string, string | number | boolean | null>,
  ): void => {
    assertSafeFields(fields);
    const rec: Record<string, string | number | boolean | null> = {
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
    const line = JSON.stringify(rec);
    if (level === "error") {
      process.stderr.write(`${line}\n`);
    } else {
      process.stdout.write(`${line}\n`);
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
