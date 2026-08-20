import { DEFAULT_CURRENCY, type Money } from "./contracts.ts";

const CURRENCY_RE = /^[A-Z]{3}$/;

/**
 * Convert Warmbly major-unit money to integer cents without silent rounding.
 * Exact 2-decimal amounts (including IEEE noise around 0.01) succeed.
 * 10.001, NaN, Infinity, and unsafe integers fail closed as null.
 */
export function majorUnitsToCentsExact(value: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  if (value < 0) {
    return null;
  }
  const scaled = value * 100;
  const nearest = Math.round(scaled);
  if (Math.abs(scaled - nearest) > 1e-6) {
    return null;
  }
  if (!Number.isSafeInteger(nearest) || nearest < 0) {
    return null;
  }
  return nearest;
}

export function integerCents(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return null;
  }
  if (!Number.isSafeInteger(value)) {
    return null;
  }
  return value;
}

export function normalizeCurrency(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim().toUpperCase();
  if (!CURRENCY_RE.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export function moneyOrNull(
  amountCents: number | null,
  currency: string | null,
): Money | null {
  if (amountCents === null) {
    return null;
  }
  return {
    amount_cents: amountCents,
    currency: currency ?? DEFAULT_CURRENCY,
  };
}

/**
 * Weighted cents = amount_cents × probability. Fail closed unless the product
 * is an integer number of cents (fixtures use 0.25 / 0.5 / 1 so this is exact).
 */
export function weightedCentsExact(
  amountCents: number,
  probability: number,
): number | null {
  if (
    !Number.isInteger(amountCents) ||
    amountCents < 0 ||
    !Number.isFinite(probability) ||
    probability < 0 ||
    probability > 1
  ) {
    return null;
  }
  const product = amountCents * probability;
  const nearest = Math.round(product);
  if (Math.abs(product - nearest) > 1e-8) {
    return null;
  }
  if (!Number.isSafeInteger(nearest) || nearest < 0) {
    return null;
  }
  return nearest;
}
