/** UTC RFC3339 with mandatory Z. Presentation may use America/Sao_Paulo. */
export const UTC_Z_PATTERN =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})?Z$/;

export const PRESENTATION_TIMEZONE = "America/Sao_Paulo";

export function isUtcZ(value: string): boolean {
  if (!UTC_Z_PATTERN.test(value)) {
    return false;
  }
  return !Number.isNaN(Date.parse(value));
}

export function parseUtcMs(value: string): number | null {
  if (!isUtcZ(value)) {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

export function saoPauloCalendarDate(utcInstant: string): string | null {
  const ms = Date.parse(utcInstant);
  if (Number.isNaN(ms)) {
    return null;
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PRESENTATION_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  if (!year || !month || !day) {
    return null;
  }
  return `${year}-${month}-${day}`;
}

export function utcCalendarDate(utcInstant: string): string | null {
  const ms = Date.parse(utcInstant);
  if (Number.isNaN(ms)) {
    return null;
  }
  return new Date(ms).toISOString().slice(0, 10);
}
