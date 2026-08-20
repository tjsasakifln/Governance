export type LogLevel = "info" | "warn" | "error";

export interface Logger {
  info(event: string, fields?: Record<string, string | number | boolean | null>): void;
  warn(event: string, fields?: Record<string, string | number | boolean | null>): void;
  error(event: string, fields?: Record<string, string | number | boolean | null>): void;
}

const SECRET_KEY =
  /^(.*[_-])?(api[_-]?key|access[_-]?token|authorization|password|secret|token|cookie|credential|private[_-]?key)$/i;

function assertSafeFields(
  fields: Record<string, string | number | boolean | null> | undefined,
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

export function createLogger(service = "control-center-finance"): Logger {
  const write = (
    level: LogLevel,
    event: string,
    fields?: Record<string, string | number | boolean | null>,
  ): void => {
    assertSafeFields(fields);
    const rec: Record<string, string | number | boolean | null> = {
      level,
      event,
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
    info: (event, fields) => write("info", event, fields),
    warn: (event, fields) => write("warn", event, fields),
    error: (event, fields) => write("error", event, fields),
  };
}

export const silentLogger: Logger = {
  info() {},
  warn() {},
  error() {},
};
