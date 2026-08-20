import { UTC_DATETIME_PATTERN } from "./contract.js";
import { ClientOpsError } from "./errors.js";

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
    throw new ClientOpsError(
      "invalid_input",
      `timestamp must be UTC RFC3339 ending in Z, got ${iso}`,
    );
  }
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    throw new ClientOpsError("invalid_input", `unparseable timestamp: ${iso}`);
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
