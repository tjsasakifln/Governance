import { UTC_DATETIME_PATTERN } from "./constants.js";
import { EngineeringError } from "./errors.js";

export type Clock = () => Date;

export function parseUtc(value: string): Date {
  if (!UTC_DATETIME_PATTERN.test(value)) {
    throw new EngineeringError(
      "invalid_input",
      "observed_at must be RFC3339 UTC with a Z suffix",
    );
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new EngineeringError("invalid_input", "observed_at is not a valid UTC timestamp");
  }
  return date;
}

export function toUtcIso(date: Date): string {
  return date.toISOString();
}

export function ageSeconds(fromIso: string | null | undefined, now: Date): number | null {
  if (!fromIso) {
    return null;
  }
  const from = new Date(fromIso);
  if (Number.isNaN(from.getTime())) {
    return null;
  }
  return Math.max(0, Math.floor((now.getTime() - from.getTime()) / 1000));
}

export function maxTimestamp(values: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  let bestMs = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!value) continue;
    const ms = Date.parse(value);
    if (Number.isNaN(ms)) continue;
    if (ms > bestMs) {
      bestMs = ms;
      best = new Date(ms).toISOString();
    }
  }
  return best;
}
