/**
 * Structured logs. Ids and counts only. No PII, no secrets, no payloads.
 */

export function logEvent(event: string, fields: Record<string, string | number | boolean | null>): void {
  const line = JSON.stringify({ event, ...fields });
  process.stderr.write(`${line}\n`);
}
