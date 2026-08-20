import { UTC_DATETIME_RE } from "./taxonomy.js";
import type { UtcDateTime } from "./types.js";
import { ValidationError } from "./errors.js";

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export function frozenClock(iso: UtcDateTime): Clock {
  if (!UTC_DATETIME_RE.test(iso)) {
    throw new ValidationError("clock freeze must be UTC RFC3339 with Z", "now");
  }
  const frozen = new Date(iso);
  if (Number.isNaN(frozen.getTime())) {
    throw new ValidationError("clock freeze is not a valid date", "now");
  }
  return {
    now: () => new Date(frozen.getTime()),
  };
}

/** Internally always UTC. Presentation layers may convert to America/Sao_Paulo. */
export function toUtcDateTime(date: Date): UtcDateTime {
  return date.toISOString();
}
