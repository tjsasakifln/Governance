/** Structured logs without PII, secrets, headers, DSNs, or URL query strings. */

export type LogLevel = "info" | "warn" | "error";

function stripUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "<invalid-url>";
  }
}

export function logEvent(
  level: LogLevel,
  event: string,
  fields: Record<string, unknown> = {},
): void {
  const safe: Record<string, unknown> = { level, event };
  for (const [key, value] of Object.entries(fields)) {
    const lowered = key.toLowerCase();
    if (
      lowered.includes("authorization") ||
      lowered.includes("secret") ||
      lowered.includes("password") ||
      lowered.includes("token") ||
      lowered.includes("dsn") ||
      lowered.includes("header")
    ) {
      continue;
    }
    if (lowered.includes("url") && typeof value === "string") {
      safe[key] = stripUrl(value);
      continue;
    }
    safe[key] = value;
  }
  const line = JSON.stringify(safe);
  if (level === "error") {
    console.error(line);
  } else {
    console.error(line);
  }
}
