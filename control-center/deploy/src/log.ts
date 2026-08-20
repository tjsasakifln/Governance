export type LogLevel = "info" | "warn" | "error";

export type LogScalar = string | number | boolean | null;

export interface Logger {
  info(msg: string, fields?: Record<string, LogScalar>): void;
  warn(msg: string, fields?: Record<string, LogScalar>): void;
  error(msg: string, fields?: Record<string, LogScalar>): void;
}

const SECRET_KEY =
  /pass(word)?|secret|token|authorization|cookie|database_url|dsn|private[_-]?key|api[_-]?key|backup_key/i;

export function assertSafeLogFields(
  fields: Record<string, LogScalar> | undefined,
): void {
  if (!fields) {
    return;
  }
  for (const key of Object.keys(fields)) {
    if (SECRET_KEY.test(key)) {
      throw new Error("refusing to log a secret-bearing field name");
    }
  }
}

export function createLogger(
  service = "control-center-deploy",
  write?: (line: string, level: LogLevel) => void,
): Logger {
  const emit = (
    level: LogLevel,
    msg: string,
    fields?: Record<string, LogScalar>,
  ): void => {
    assertSafeLogFields(fields);
    const rec: Record<string, LogScalar> = {
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
    if (write) {
      write(line, level);
      return;
    }
    if (level === "error") {
      process.stderr.write(`${line}\n`);
    } else {
      process.stdout.write(`${line}\n`);
    }
  };
  return {
    info: (msg, fields) => emit("info", msg, fields),
    warn: (msg, fields) => emit("warn", msg, fields),
    error: (msg, fields) => emit("error", msg, fields),
  };
}

export const silentLogger: Logger = {
  info() {},
  warn() {},
  error() {},
};
