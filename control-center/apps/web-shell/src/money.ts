import type { Money } from "./types";

const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export function isMoney(value: Money): boolean {
  return Number.isInteger(value.amount_cents) && CURRENCY_PATTERN.test(value.currency);
}

/**
 * Integer cents + ISO-4217 currency. Never a float.
 * Presentation uses pt-BR grouping; the model stays cents.
 */
export function formatMoney(value: Money): string {
  if (!isMoney(value)) {
    throw new Error("Money must be integer cents plus ISO-4217 currency");
  }
  const negative = value.amount_cents < 0;
  const abs = Math.abs(value.amount_cents);
  const major = Math.floor(abs / 100);
  const minor = String(abs % 100).padStart(2, "0");
  const grouped = major.toLocaleString("pt-BR");
  const sign = negative ? "-" : "";
  return `${sign}${value.currency} ${grouped},${minor}`;
}
