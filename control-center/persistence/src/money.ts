import { ValidationError } from './errors.js';
import type { Money, SourceRef } from './types.js';

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

export function parseConfidence(value: string | number | null): number {
  if (value === null) {
    throw new ValidationError('confidence is required');
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

export function sourceColumns(source: SourceRef): {
  system: string;
  kind: string;
  locator: string;
  label: string | null;
} {
  return {
    system: source.system,
    kind: source.kind,
    locator: source.locator,
    label: source.label ?? null,
  };
}

export function mapSourceRef(row: {
  source_system: string;
  source_kind: string;
  source_locator: string;
  source_label: string | null;
}): SourceRef {
  const source: SourceRef = {
    system: row.source_system,
    kind: row.source_kind,
    locator: row.source_locator,
  };
  if (row.source_label) {
    source.label = row.source_label;
  }
  return source;
}

export function asTextArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  return [];
}

export function toUtcIso(value: Date): string {
  return value.toISOString();
}
