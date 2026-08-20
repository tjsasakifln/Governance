import { ValidationError } from './errors.js';
import type { Money } from './types.js';

export function parseCents(value: string | number | null): number | null {
  if (value === null) {
    return null;
  }
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n < 0 || n > Number.MAX_SAFE_INTEGER) {
    throw new ValidationError('money cents must be a non-negative integer within safe range');
  }
  return n;
}

export function parseConfidence(value: string | number | null): number | null {
  if (value === null) {
    return null;
  }
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    throw new ValidationError('confidence must be between 0 and 1');
  }
  return n;
}

export function moneyFromColumns(
  amountCents: string | number | null,
  currency: string | null,
): Money | null {
  const cents = parseCents(amountCents);
  if (cents === null && currency === null) {
    return null;
  }
  if (cents === null || currency === null) {
    throw new ValidationError('money amount and currency must both be present or both absent');
  }
  return { amountCents: cents, currency };
}

export function moneyColumns(money: Money | null | undefined): {
  amountCents: number | null;
  currency: string | null;
} {
  if (!money) {
    return { amountCents: null, currency: null };
  }
  return { amountCents: money.amountCents, currency: money.currency };
}
