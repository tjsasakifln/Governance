import type { ChargeLifecycle } from "./types.js";

const RECEIVED_STATUSES = new Set(["RECEIVED", "RECEIVED_IN_CASH"]);
const PAID_STATUSES = new Set(["CONFIRMED", "RECEIVED", "RECEIVED_IN_CASH"]);
const REFUNDED_STATUSES = new Set([
  "REFUNDED",
  "REFUND_REQUESTED",
  "REFUND_IN_PROGRESS",
]);
const CHARGEBACK_STATUSES = new Set([
  "CHARGEBACK_REQUESTED",
  "CHARGEBACK_DISPUTE",
  "AWAITING_CHARGEBACK_REVERSAL",
]);

export function isDeletedCharge(
  deleted: boolean,
  status: string,
  webhookEvent?: string,
): boolean {
  if (deleted) {
    return true;
  }
  if (webhookEvent === "PAYMENT_DELETED") {
    return true;
  }
  return status.toUpperCase() === "DELETED";
}

export function mapChargeLifecycle(
  status: string,
  deleted: boolean,
  webhookEvent?: string,
): ChargeLifecycle {
  if (isDeletedCharge(deleted, status, webhookEvent)) {
    return "cancelled";
  }
  const upper = status.toUpperCase();
  if (RECEIVED_STATUSES.has(upper)) {
    return "received";
  }
  if (upper === "CONFIRMED") {
    return "paid";
  }
  if (upper === "OVERDUE") {
    return "overdue";
  }
  if (REFUNDED_STATUSES.has(upper)) {
    return "refunded";
  }
  if (CHARGEBACK_STATUSES.has(upper)) {
    return "chargeback";
  }
  if (upper === "PENDING" || upper === "AWAITING_RISK_ANALYSIS") {
    return "pending";
  }
  return "other";
}

export function chargeInBilledBucket(
  lifecycle: ChargeLifecycle,
  deleted: boolean,
): boolean {
  if (deleted || lifecycle === "cancelled") {
    return false;
  }
  return true;
}

export function chargeInPaidBucket(lifecycle: ChargeLifecycle): boolean {
  return lifecycle === "paid" || lifecycle === "received";
}

export function chargeInReceivedBucket(lifecycle: ChargeLifecycle): boolean {
  return lifecycle === "received";
}

export function subscriptionIsCancelled(status: string, deleted: boolean): boolean {
  if (deleted) {
    return true;
  }
  const upper = status.toUpperCase();
  return upper === "INACTIVE" || upper === "EXPIRED" || upper === "DELETED";
}

export function subscriptionIsActive(status: string, deleted: boolean): boolean {
  return !subscriptionIsCancelled(status, deleted) && status.toUpperCase() === "ACTIVE";
}

export function paidStatuses(): ReadonlySet<string> {
  return PAID_STATUSES;
}

export function receivedStatuses(): ReadonlySet<string> {
  return RECEIVED_STATUSES;
}
