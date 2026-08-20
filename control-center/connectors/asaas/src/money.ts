import { AsaasConnectorError } from "./errors.js";
import type { Money } from "./types.js";

const CURRENCY = "BRL" as const;

export function reaisToCents(reais: number): number {
  if (typeof reais !== "number" || !Number.isFinite(reais)) {
    throw new AsaasConnectorError(
      "asaas.money.invalid_reais",
      "Asaas amount is not a finite number",
    );
  }
  const cents = Math.round(reais * 100);
  if (!Number.isSafeInteger(cents)) {
    throw new AsaasConnectorError(
      "asaas.money.unsafe_cents",
      "Asaas amount cannot be represented as integer cents",
    );
  }
  return cents;
}

export function moneyFromReais(reais: number): Money {
  return { cents: reaisToCents(reais), currency: CURRENCY };
}

export function emptyMoney(): Money {
  return { cents: 0, currency: CURRENCY };
}
