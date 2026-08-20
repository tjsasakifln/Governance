/**
 * Structured logs without PII/secrets. Payloads are never dumped.
 */

const FORBIDDEN_LOG_KEYS =
  /^(secret|token|password|authorization|api[_-]?key|cookie|credential|private[_-]?key|database_url|email)$/i;

export interface LogFields {
  event: string;
  correlation_id?: string;
  status?: string;
  actor_kind?: string;
  action?: string;
  revision?: number;
  [key: string]: string | number | boolean | undefined;
}

export type LogSink = (line: string) => void;

export function structuredLog(fields: LogFields, sink: LogSink = defaultSink): void {
  const safe: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) {
      continue;
    }
    if (FORBIDDEN_LOG_KEYS.test(key)) {
      continue;
    }
    safe[key] = value;
  }
  sink(JSON.stringify({ ts: new Date().toISOString(), ...safe }));
}

function defaultSink(line: string): void {
  if (process.env.AGENT_ACTIVITY_LOG === "1" || process.env.AGENT_ACTIVITY_LOG === "true") {
    process.stderr.write(`${line}\n`);
  }
}
