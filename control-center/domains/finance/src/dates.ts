import { FinanceValidationError } from "./errors.js";
import { UTC_DATETIME_PATTERN } from "./types.js";

export function parseUtc(value: string, field: string): Date {
  if (!UTC_DATETIME_PATTERN.test(value)) {
    throw new FinanceValidationError(
      "FINANCE_DATETIME_INVALID",
      `${field} must be RFC3339 UTC with a Z suffix`,
    );
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new FinanceValidationError(
      "FINANCE_DATETIME_INVALID",
      `${field} is not a valid UTC timestamp`,
    );
  }
  return date;
}

export function toUtcIso(date: Date): string {
  return date.toISOString();
}

export function compareUtc(a: string, b: string): number {
  return parseUtc(a, "a").getTime() - parseUtc(b, "b").getTime();
}

export function isInWindow(occurredAt: string, from: string, to: string): boolean {
  const t = parseUtc(occurredAt, "occurred_at").getTime();
  const start = parseUtc(from, "window.from").getTime();
  const end = parseUtc(to, "window.to").getTime();
  if (end < start) {
    throw new FinanceValidationError(
      "FINANCE_WINDOW_INVALID",
      "cash_in_window.to must be >= cash_in_window.from",
    );
  }
  return t >= start && t <= end;
}

export function ageSeconds(observedAt: string, asOf: string): number {
  const observed = parseUtc(observedAt, "observed_at").getTime();
  const asOfMs = parseUtc(asOf, "as_of").getTime();
  return Math.max(0, Math.floor((asOfMs - observed) / 1000));
}

export function daysBetween(from: string, to: string): number {
  const start = parseUtc(from, "from").getTime();
  const end = parseUtc(to, "to").getTime();
  return Math.floor((end - start) / 86_400_000);
}
