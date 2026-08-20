import { FinanceValidationError } from "./errors.js";
import { CURRENCY_PATTERN, DEFAULT_CURRENCY, type Money } from "./types.js";

export function assertCurrency(value: string, field = "currency"): string {
  if (!CURRENCY_PATTERN.test(value)) {
    throw new FinanceValidationError(
      "FINANCE_CURRENCY_INVALID",
      `${field} must be ISO-4217 (three uppercase letters)`,
    );
  }
  return value;
}

export function assertCents(value: number, field = "amount_cents"): number {
  if (typeof value !== "number" || !Number.isInteger(value) || !Number.isSafeInteger(value)) {
    throw new FinanceValidationError(
      "FINANCE_MONEY_NOT_INTEGER",
      `${field} must be a safe integer number of cents`,
    );
  }
  return value;
}

export function assertNonNegativeCents(value: number, field = "amount_cents"): number {
  const cents = assertCents(value, field);
  if (cents < 0) {
    throw new FinanceValidationError(
      "FINANCE_MONEY_NEGATIVE",
      `${field} must be a non-negative integer number of cents`,
    );
  }
  return cents;
}

export function addCents(a: number, b: number): number {
  const sum = assertCents(a, "left") + assertCents(b, "right");
  if (!Number.isSafeInteger(sum)) {
    throw new FinanceValidationError(
      "FINANCE_MONEY_OVERFLOW",
      "cent sum exceeds Number.MAX_SAFE_INTEGER",
    );
  }
  return sum;
}

export function subCentsFloor(a: number, b: number): number {
  const diff = assertCents(a, "left") - assertCents(b, "right");
  if (!Number.isSafeInteger(diff)) {
    throw new FinanceValidationError(
      "FINANCE_MONEY_OVERFLOW",
      "cent difference exceeds safe integer range",
    );
  }
  return diff < 0 ? 0 : diff;
}

export function money(amount_cents: number, currency = DEFAULT_CURRENCY): Money {
  return {
    amount_cents: assertCents(amount_cents, "amount_cents"),
    currency: assertCurrency(currency),
  };
}

export function emptyMoney(currency = DEFAULT_CURRENCY): Money {
  return money(0, currency);
}
