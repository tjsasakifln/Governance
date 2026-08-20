import type { Money } from "../contracts/snapshot.ts";

const DEFAULT_CURRENCY = "BRL";

/**
 * Warmbly deal.value is a major-unit float (e.g. 1500.50 BRL).
 * Control Center persists integer cents + currency.
 */
export function majorUnitsToCents(value: number, currency?: string): Money {
  if (!Number.isFinite(value)) {
    throw new Error("deal value is not a finite number");
  }
  return {
    amount_cents: Math.round(value * 100),
    currency: (currency && currency.trim()) || DEFAULT_CURRENCY,
  };
}

export function sumOpenDealValue(
  deals: Array<{ status: string; value?: number | null; currency?: string }>,
): Money | undefined {
  const open = deals.filter((d) => d.status.toLowerCase() === "open" && d.value != null);
  if (open.length === 0) {
    return undefined;
  }
  const currencies = new Set(open.map((d) => (d.currency && d.currency.trim()) || DEFAULT_CURRENCY));
  if (currencies.size !== 1) {
    return undefined;
  }
  const currency = [...currencies][0] ?? DEFAULT_CURRENCY;
  let cents = 0;
  for (const d of open) {
    cents += majorUnitsToCents(d.value as number, currency).amount_cents;
  }
  return { amount_cents: cents, currency };
}
