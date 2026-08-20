export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now(): Date {
    return new Date();
  },
};

export function frozenClock(isoUtc: string): Clock {
  const fixed = new Date(isoUtc);
  if (Number.isNaN(fixed.getTime())) {
    throw new Error(`invalid frozen clock: ${isoUtc}`);
  }
  return {
    now(): Date {
      return new Date(fixed.getTime());
    },
  };
}

export function toUtcIso(date: Date): string {
  return new Date(date.getTime()).toISOString();
}

export function parseUtcIso(value: string, field: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(value)) {
    throw new Error(`${field} must be an ISO-8601 UTC timestamp ending in Z`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${field} is not a valid timestamp`);
  }
  return parsed;
}
