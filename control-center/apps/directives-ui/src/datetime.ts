import { UTC_DATETIME_PATTERN } from "./contract.ts";

export const PRESENTATION_TIME_ZONE = "America/Sao_Paulo";

export function toUtcDateTime(date: Date): string {
  const iso = date.toISOString();
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?Z$/.exec(iso);
  if (!match) {
    throw new Error("clock produced a non-UTC timestamp");
  }
  return `${match[1]}Z`;
}

export function parseUtcDateTime(value: string, field: string): Date {
  if (!UTC_DATETIME_PATTERN.test(value)) {
    throw new Error(`${field} must be UTC RFC3339 with a Z suffix`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${field} is not a valid instant`);
  }
  return date;
}

export function formatLocal(value: string, timeZone = PRESENTATION_TIME_ZONE): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const formatted = new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return `${formatted} (${timeZone})`;
}

export function frozenClock(iso: string): { now(): Date } {
  const date = parseUtcDateTime(iso, "clock");
  return {
    now() {
      return new Date(date.getTime());
    },
  };
}

export function systemClock(): { now(): Date } {
  return {
    now() {
      return new Date();
    },
  };
}
