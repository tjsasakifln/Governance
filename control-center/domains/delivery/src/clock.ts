import { invariant } from "./errors.js";

export interface BusinessCalendar {
  version: string;
  time_zone: string;
  holidays: readonly string[];
}

interface CivilDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function civilParts(instant: Date, timeZone: string): CivilDateTime {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const values = Object.fromEntries(
    formatter
      .formatToParts(instant)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  const { year, month, day, hour, minute, second } = values;
  invariant(
    year !== undefined && month !== undefined && day !== undefined &&
      hour !== undefined && minute !== undefined && second !== undefined,
    "INVALID_COMMAND",
    `cannot resolve civil time for ${timeZone}`,
  );
  return { year, month, day, hour, minute, second };
}

function civilKey(value: Pick<CivilDateTime, "year" | "month" | "day">): string {
  return `${String(value.year).padStart(4, "0")}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`;
}

function addCivilDays(value: CivilDateTime, days: number): CivilDateTime {
  const shifted = new Date(Date.UTC(value.year, value.month - 1, value.day + days, value.hour, value.minute, value.second));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  };
}

/** Convert a civil time to its UTC instant without relying on the host timezone. */
function civilToInstant(value: CivilDateTime, timeZone: string): Date {
  const civilAsUtc = Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute, value.second);
  let candidate = civilAsUtc;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const observed = civilParts(new Date(candidate), timeZone);
    const observedAsUtc = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second,
    );
    const correction = civilAsUtc - observedAsUtc;
    if (correction === 0) {
      return new Date(candidate);
    }
    candidate += correction;
  }
  const resolved = new Date(candidate);
  invariant(
    JSON.stringify(civilParts(resolved, timeZone)) === JSON.stringify(value),
    "INVALID_COMMAND",
    `civil time does not exist in ${timeZone}: ${civilKey(value)}`,
  );
  return resolved;
}

function isBusinessDay(value: CivilDateTime, calendar: BusinessCalendar): boolean {
  if (calendar.holidays.includes(civilKey(value))) {
    return false;
  }
  const noon = civilToInstant({ ...value, hour: 12, minute: 0, second: 0 }, calendar.time_zone);
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: calendar.time_zone,
    weekday: "short",
  }).format(noon);
  return weekday !== "Sat" && weekday !== "Sun";
}

export function addBusinessDays(
  startedAt: string,
  businessDays: number,
  calendar: BusinessCalendar,
): string {
  invariant(Number.isInteger(businessDays) && businessDays > 0, "INVALID_COMMAND", "business_days must be a positive integer");
  invariant(calendar.version.trim() !== "", "MISSING_AUTHORITY", "business calendar version is required");
  invariant(calendar.time_zone.trim() !== "", "MISSING_AUTHORITY", "business calendar timezone is required");
  const start = new Date(startedAt);
  invariant(Number.isFinite(start.getTime()) && startedAt.endsWith("Z"), "INVALID_COMMAND", "started_at must be UTC RFC3339");
  let cursor = civilParts(start, calendar.time_zone);
  let remaining = businessDays;
  while (remaining > 0) {
    cursor = addCivilDays(cursor, 1);
    if (isBusinessDay(cursor, calendar)) {
      remaining -= 1;
    }
  }
  return civilToInstant(cursor, calendar.time_zone).toISOString();
}
