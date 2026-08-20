const UTC_RE =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})?Z$/;

export function isUtcDateTime(value: unknown): value is string {
  return typeof value === "string" && UTC_RE.test(value);
}

export function toUtcIso(date: Date): string {
  return date.toISOString();
}

export function parseUtc(value: string | null | undefined): Date | null {
  if (!value || typeof value !== "string") {
    return null;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  return d;
}

export function parseUtcOrNull(value: unknown): Date | null {
  if (typeof value !== "string") {
    return null;
  }
  return parseUtc(value);
}
