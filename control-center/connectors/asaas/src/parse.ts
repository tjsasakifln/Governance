import { optionalAsaasDateToUtcIso } from "./dates.js";
import type {
  ParsedBalance,
  ParsedCharge,
  ParsedCustomer,
  ParsedListPage,
  ParsedPixTransaction,
  ParsedReceivable,
  ParsedSubscription,
} from "./types.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function asNullableString(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }
  return asString(value);
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) {
      return n;
    }
  }
  return undefined;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  return fallback;
}

export function parseListPage(raw: unknown): ParsedListPage {
  if (!isRecord(raw)) {
    throw new Error("asaas.list.not_object");
  }
  const dataRaw = raw.data;
  const data = Array.isArray(dataRaw) ? dataRaw : [];
  return {
    object: asString(raw.object),
    hasMore: asBoolean(raw.hasMore, false),
    totalCount: asNumber(raw.totalCount),
    limit: asNumber(raw.limit) ?? data.length,
    offset: asNumber(raw.offset) ?? 0,
    data,
  };
}

/**
 * Drop PII (name, email, cpfCnpj, phones). Snapshot keeps ids and
 * externalReference only.
 */
export function parseCustomer(raw: unknown): ParsedCustomer | null {
  if (!isRecord(raw)) {
    return null;
  }
  const id = asString(raw.id);
  if (!id) {
    return null;
  }
  return {
    id,
    dateCreated: asString(raw.dateCreated),
    externalReference: asNullableString(raw.externalReference),
  };
}

export function parseCharge(raw: unknown): ParsedCharge | null {
  if (!isRecord(raw)) {
    return null;
  }
  const id = asString(raw.id);
  const status = asString(raw.status);
  const valueReais = asNumber(raw.value);
  if (!id || !status || valueReais === undefined) {
    return null;
  }
  return {
    id,
    status,
    valueReais,
    netValueReais: asNumber(raw.netValue),
    billingType: asString(raw.billingType),
    dateCreated: asString(raw.dateCreated),
    dueDate: asString(raw.dueDate),
    paymentDate: asString(raw.paymentDate),
    clientPaymentDate: asString(raw.clientPaymentDate),
    creditDate: asString(raw.creditDate),
    estimatedCreditDate: asString(raw.estimatedCreditDate),
    externalReference: asNullableString(raw.externalReference),
    customer: asNullableString(raw.customer),
    subscription: asNullableString(raw.subscription),
    pixTransaction: asNullableString(raw.pixTransaction),
    deleted: asBoolean(raw.deleted, false),
  };
}

export function parseSubscription(raw: unknown): ParsedSubscription | null {
  if (!isRecord(raw)) {
    return null;
  }
  const id = asString(raw.id);
  const status = asString(raw.status);
  const valueReais = asNumber(raw.value);
  if (!id || !status || valueReais === undefined) {
    return null;
  }
  return {
    id,
    status,
    valueReais,
    dateCreated: asString(raw.dateCreated),
    nextDueDate: asString(raw.nextDueDate),
    externalReference: asNullableString(raw.externalReference),
    customer: asNullableString(raw.customer),
    billingType: asString(raw.billingType),
    cycle: asString(raw.cycle),
    deleted: asBoolean(raw.deleted, false),
  };
}

export function parsePixTransaction(raw: unknown): ParsedPixTransaction | null {
  if (!isRecord(raw)) {
    return null;
  }
  const id = asString(raw.id);
  const status = asString(raw.status) ?? "UNKNOWN";
  const valueReais = asNumber(raw.value);
  if (!id || valueReais === undefined) {
    return null;
  }
  return {
    id,
    status,
    type: asString(raw.type),
    valueReais,
    dateCreated: asString(raw.dateCreated),
    effectiveDate: asString(raw.effectiveDate),
    endToEndIdentifier: asNullableString(raw.endToEndIdentifier),
    payment: asNullableString(raw.payment),
  };
}

export function parseReceivable(raw: unknown): ParsedReceivable | null {
  if (!isRecord(raw)) {
    return null;
  }
  const id = asString(raw.id);
  const valueReais = asNumber(raw.value);
  if (!id || valueReais === undefined) {
    return null;
  }
  return {
    id,
    type: asString(raw.type),
    valueReais,
    date: asString(raw.date),
    paymentId: asNullableString(raw.paymentId ?? raw.payment),
  };
}

export function parseBalance(raw: unknown): ParsedBalance | null {
  if (!isRecord(raw)) {
    return null;
  }
  const balanceReais = asNumber(raw.balance);
  if (balanceReais === undefined) {
    return null;
  }
  return { balanceReais };
}

export interface ParsedWebhookEvent {
  id?: string;
  event: string;
  dateCreated?: string;
  payment?: ParsedCharge;
}

export function parseWebhookEvent(raw: unknown): ParsedWebhookEvent | null {
  if (!isRecord(raw)) {
    return null;
  }
  const event = asString(raw.event);
  if (!event) {
    return null;
  }
  const payment = raw.payment !== undefined ? parseCharge(raw.payment) : undefined;
  return {
    id: asString(raw.id),
    event,
    dateCreated: asString(raw.dateCreated),
    payment: payment ?? undefined,
  };
}

export function entityDatesFromCharge(charge: ParsedCharge): FinanceEntityDates {
  return {
    created_at: optionalAsaasDateToUtcIso(charge.dateCreated),
    due_at: optionalAsaasDateToUtcIso(charge.dueDate),
    paid_at: optionalAsaasDateToUtcIso(charge.paymentDate ?? charge.clientPaymentDate),
    received_at: optionalAsaasDateToUtcIso(charge.creditDate),
    credit_at: optionalAsaasDateToUtcIso(
      charge.creditDate ?? charge.estimatedCreditDate,
    ),
  };
}

type FinanceEntityDates = {
  created_at?: string;
  due_at?: string;
  paid_at?: string;
  received_at?: string;
  credit_at?: string;
  cancelled_at?: string;
  refunded_at?: string;
  effective_at?: string;
};
