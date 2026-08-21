import { UTC_DATETIME_PATTERN } from "./contract.js";
import { LedgerError } from "./errors.js";

const UTC_RE = new RegExp(UTC_DATETIME_PATTERN);

export type Clock = () => Date;

export function frozenClock(at: Date): Clock {
  const ms = at.getTime();
  return () => new Date(ms);
}

export function systemClock(): Clock {
  return () => new Date();
}

export function toUtcIso(date: Date): string {
  return date.toISOString();
}

export function isUtcDateTime(value: string): boolean {
  return UTC_RE.test(value);
}

export function parseUtc(iso: string): Date {
  if (!isUtcDateTime(iso)) {
    throw new LedgerError(
      "invalid_input",
      `timestamp must be UTC RFC3339 ending in Z, got ${iso}`,
    );
  }
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    throw new LedgerError("invalid_input", `unparseable timestamp: ${iso}`);
  }
  return new Date(ms);
}

export function resolveClock(now?: Date | Clock): Clock {
  if (typeof now === "function") {
    return now;
  }
  if (now instanceof Date) {
    return frozenClock(now);
  }
  return systemClock();
}

export function utcDayWindow(date: string): { from: string; to: string } {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)) {
    throw new LedgerError("invalid_input", `date must be YYYY-MM-DD UTC, got ${date}`);
  }
  const from = `${date}T00:00:00.000Z`;
  const start = parseUtc(from);
  const next = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { from, to: toUtcIso(next) };
}
