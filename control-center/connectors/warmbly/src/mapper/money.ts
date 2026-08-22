import type { Money } from "../contracts/snapshot.ts";

/**
 * The CONFENGE catalog is contracted in BRL and Governance is its authority.
 *
 * This is the *contractual* currency, not a convenience default: an amount
 * that arrives with no currency at all is denominated in it, but an amount
 * that arrives carrying a different code is never rewritten into it and never
 * summed with it. Conversion would need an explicit rate with a source and a
 * date; the Control Center has none, so it does not convert.
 */
export const CATALOG_CURRENCY = "BRL";

const ISO_4217 = /^[A-Z]{3}$/;

/** Trim + uppercase. Anything that is not an ISO-4217 alpha code is rejected. */
export function normalizeCurrency(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const code = raw.trim().toUpperCase();
  return ISO_4217.test(code) ? code : undefined;
}

/**
 * Resolve the currency of one observed amount.
 *
 * Absent (undefined / null / empty string) resolves to the contractual
 * catalog currency. Present-but-unreadable fails closed as `undefined` so the
 * caller withholds the amount instead of denominating it in a guess.
 */
export function resolveCurrency(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) {
    return CATALOG_CURRENCY;
  }
  if (typeof raw === "string" && raw.trim() === "") {
    return CATALOG_CURRENCY;
  }
  return normalizeCurrency(raw);
}

/**
 * Warmbly deal.value is a major-unit float (e.g. 1500.50 BRL).
 * Control Center persists integer cents + currency.
 */
export function majorUnitsToCents(value: number, currency?: string): Money {
  if (!Number.isFinite(value)) {
    throw new Error("deal value is not a finite number");
  }
  const code = resolveCurrency(currency);
  if (!code) {
    throw new Error(`deal currency ${JSON.stringify(currency)} is not an ISO-4217 code`);
  }
  return {
    amount_cents: Math.round(value * 100),
    currency: code,
  };
}

export type OpenDealInput = { status: string; value?: number | null; currency?: string };

export type OpenDealTotals = {
  /** One total per observed currency, sorted by code. Never summed across codes. */
  totals: Money[];
  /** Open deals whose currency could not be read as ISO-4217; excluded from every total. */
  unreadable_currency: number;
  /** Currency codes observed that are not the contractual catalog currency. */
  foreign_currencies: string[];
};

function isOpen(deal: OpenDealInput): boolean {
  return deal.status.toLowerCase() === "open" && deal.value != null;
}

/**
 * Per-currency totals for the open pipeline.
 *
 * Amounts in different currencies are kept apart rather than added: the
 * Control Center has no rate source, so a merged total would be an invented
 * number. A deal whose currency is present but unreadable is dropped from the
 * totals and counted, so the caller can raise it instead of silently
 * absorbing it into the catalog currency.
 */
export function openDealTotals(deals: readonly OpenDealInput[]): OpenDealTotals {
  const byCurrency = new Map<string, number>();
  let unreadable = 0;
  for (const deal of deals) {
    if (!isOpen(deal)) {
      continue;
    }
    const currency = resolveCurrency(deal.currency);
    if (!currency) {
      unreadable += 1;
      continue;
    }
    const cents = Math.round((deal.value as number) * 100);
    if (!Number.isFinite(cents)) {
      unreadable += 1;
      continue;
    }
    byCurrency.set(currency, (byCurrency.get(currency) ?? 0) + cents);
  }
  const totals = [...byCurrency.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([currency, amount_cents]) => ({ amount_cents, currency }));
  return {
    totals,
    unreadable_currency: unreadable,
    foreign_currencies: totals.map((m) => m.currency).filter((code) => code !== CATALOG_CURRENCY),
  };
}

/**
 * Per-currency totals a `deals_summary` declared for itself.
 *
 * Only used when there are no per-deal rows to group. Entries whose currency
 * is not ISO-4217 are dropped rather than folded into the catalog currency.
 */
export function summaryTotalsByCurrency(summary: {
  open_value_by_currency?: Array<{ currency?: string; value?: number }>;
}): Money[] {
  const rows = summary.open_value_by_currency;
  if (!Array.isArray(rows)) {
    return [];
  }
  const byCurrency = new Map<string, number>();
  for (const row of rows) {
    if (!row || typeof row.value !== "number" || !Number.isFinite(row.value)) {
      continue;
    }
    const currency = resolveCurrency(row.currency);
    if (!currency) {
      continue;
    }
    byCurrency.set(currency, (byCurrency.get(currency) ?? 0) + Math.round(row.value * 100));
  }
  return [...byCurrency.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([currency, amount_cents]) => ({ amount_cents, currency }));
}

/**
 * Single-currency open pipeline total, or `undefined` when the deals mix
 * currencies (see `openDealTotals` for the per-currency breakdown).
 */
export function sumOpenDealValue(deals: readonly OpenDealInput[]): Money | undefined {
  const { totals } = openDealTotals(deals);
  return totals.length === 1 ? totals[0] : undefined;
}
