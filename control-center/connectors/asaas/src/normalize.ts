import { optionalAsaasDateToUtcIso } from "./dates.js";
import { moneyFromReais } from "./money.js";
import { entityDatesFromCharge, parseWebhookEvent } from "./parse.js";
import {
  chargeInBilledBucket,
  chargeInPaidBucket,
  chargeInReceivedBucket,
  mapChargeLifecycle,
  subscriptionIsActive,
  subscriptionIsCancelled,
} from "./status.js";
import { FINANCE_SNAPSHOT_SCHEMA } from "./types.js";
import type {
  AsaasEnvironment,
  ChargeLifecycle,
  FinanceEntity,
  FinanceSnapshot,
  FreshnessStatus,
  MoneyBucket,
  NormalizeInput,
  Observation,
  ParsedCharge,
  Provenance,
} from "./types.js";

function provenance(
  source: string,
  observedAt: string,
  freshness_status: FreshnessStatus,
  confidence?: number,
): Provenance {
  const p: Provenance = {
    source,
    observed_at: observedAt,
    freshness_status,
  };
  if (confidence !== undefined) {
    p.confidence = confidence;
  }
  return p;
}

function idempotencyKey(
  environment: AsaasEnvironment,
  kind: string,
  providerId: string,
): string {
  return `asaas:${environment}:${kind}:${providerId}`;
}

function emptyBucket(observedAt: string, source: string): MoneyBucket {
  return {
    cents: 0,
    currency: "BRL",
    provider_ids: [],
    provenance: provenance(source, observedAt, "fresh", 1),
  };
}

function bucketFrom(
  ids: string[],
  amounts: Map<string, number>,
  observedAt: string,
  source: string,
  freshness: FreshnessStatus,
): MoneyBucket {
  const unique = [...new Set(ids)].sort();
  let cents = 0;
  for (const id of unique) {
    cents += amounts.get(id) ?? 0;
  }
  return {
    cents,
    currency: "BRL",
    provider_ids: unique,
    provenance: provenance(source, observedAt, freshness, 1),
  };
}

function sortEntities(entities: FinanceEntity[]): FinanceEntity[] {
  return [...entities].sort((a, b) => a.provider_id.localeCompare(b.provider_id));
}

/**
 * Pure mapping: Asaas list + optional webhook DTOs → FinanceSnapshot.
 * List status is canonical. Webhooks never promote CONFIRMED → received.
 */
export function normalizeToFinanceSnapshot(input: NormalizeInput): FinanceSnapshot {
  const observedAt = input.observedAt;
  const observations: Observation[] = [];
  const environment = input.environment;

  const chargesById = new Map<string, ParsedCharge>();
  const chargeSeenCount = new Map<string, number>();
  for (const charge of input.charges) {
    const n = (chargeSeenCount.get(charge.id) ?? 0) + 1;
    chargeSeenCount.set(charge.id, n);
    if (n === 1) {
      chargesById.set(charge.id, charge);
    } else {
      observations.push({
        kind: "duplicate",
        code: "charge_list_duplicate",
        message: "Duplicate charge in list payload collapsed to one entity",
        provider_ids: [charge.id],
        provenance: provenance("asaas.payments.list", observedAt, "fresh", 1),
      });
    }
  }

  const webhookByPayment = new Map<string, string[]>();
  for (const raw of input.webhookEvents ?? []) {
    const event = parseWebhookEvent(raw);
    if (!event?.payment) {
      continue;
    }
    const payId = event.payment.id;
    const events = webhookByPayment.get(payId) ?? [];
    events.push(event.event);
    webhookByPayment.set(payId, events);

    const listed = chargesById.get(payId);
    if (!listed) {
      observations.push({
        kind: "freshness",
        code: "webhook_without_list",
        message:
          "Webhook payment is not in the GET list; excluded from money buckets",
        provider_ids: [payId],
        provenance: provenance("asaas.webhook", observedAt, "stale", 0.4),
      });
      continue;
    }

    const webhookLifecycle = mapChargeLifecycle(
      event.payment.status,
      event.payment.deleted,
      event.event,
    );
    const listLifecycle = mapChargeLifecycle(listed.status, listed.deleted);
    if (webhookLifecycle !== listLifecycle) {
      observations.push({
        kind: "inconsistency",
        code: "list_webhook_status_mismatch",
        message: `List status ${listed.status} disagrees with webhook ${event.event} (${event.payment.status}); list remains canonical; CONFIRMED is not received`,
        provider_ids: [payId],
        provenance: provenance("asaas.payments.list+webhook", observedAt, "inconsistent", 0.4),
      });
    }

    if (events.filter((e) => e === event.event).length > 1) {
      observations.push({
        kind: "duplicate",
        code: "webhook_duplicate",
        message: "Duplicate webhook for the same payment collapsed to one entity",
        provider_ids: [payId],
        provenance: provenance("asaas.webhook", observedAt, "fresh", 1),
      });
    }
  }

  const chargeEntities: FinanceEntity[] = [];
  const billedIds: string[] = [];
  const paidIds: string[] = [];
  const receivedIds: string[] = [];
  const chargeAmounts = new Map<string, number>();
  const oneOffContractedIds: string[] = [];

  for (const charge of chargesById.values()) {
    const lifecycle = mapChargeLifecycle(charge.status, charge.deleted);
    const money = moneyFromReais(charge.valueReais);
    chargeAmounts.set(charge.id, money.cents);
    const webhookEvents = webhookByPayment.get(charge.id) ?? [];
    const mismatched = webhookEvents.some((eventName) => {
      const raw = (input.webhookEvents ?? [])
        .map((e) => parseWebhookEvent(e))
        .find((e) => e?.payment?.id === charge.id && e.event === eventName);
      if (!raw?.payment) {
        return false;
      }
      return (
        mapChargeLifecycle(raw.payment.status, raw.payment.deleted, raw.event) !==
        lifecycle
      );
    });
    const freshness: FreshnessStatus = mismatched ? "inconsistent" : "fresh";
    const entity: FinanceEntity = {
      kind: "charge",
      provider_id: charge.id,
      idempotency_key: idempotencyKey(environment, "charge", charge.id),
      lifecycle,
      provider_status: charge.status,
      amount: money,
      dates: entityDatesFromCharge(charge),
      external_reference: charge.externalReference ?? null,
      customer_id: charge.customer ?? null,
      subscription_id: charge.subscription ?? null,
      pix_id: charge.pixTransaction ?? null,
      deleted: charge.deleted,
      provenance: provenance("asaas.payments.list", observedAt, freshness, 1),
    };
    chargeEntities.push(entity);

    if (chargeInBilledBucket(lifecycle, charge.deleted)) {
      billedIds.push(charge.id);
    }
    if (chargeInPaidBucket(lifecycle) && !charge.deleted) {
      paidIds.push(charge.id);
    }
    if (chargeInReceivedBucket(lifecycle) && !charge.deleted) {
      receivedIds.push(charge.id);
    }
    if (
      !charge.deleted &&
      !charge.subscription &&
      (lifecycle === "pending" ||
        lifecycle === "paid" ||
        lifecycle === "received" ||
        lifecycle === "overdue")
    ) {
      oneOffContractedIds.push(charge.id);
    }
  }

  const customerEntities: FinanceEntity[] = [];
  const customerSeen = new Set<string>();
  for (const customer of input.customers) {
    if (customerSeen.has(customer.id)) {
      observations.push({
        kind: "duplicate",
        code: "customer_list_duplicate",
        message: "Duplicate customer in list payload collapsed to one entity",
        provider_ids: [customer.id],
        provenance: provenance("asaas.customers.list", observedAt, "fresh", 1),
      });
      continue;
    }
    customerSeen.add(customer.id);
    customerEntities.push({
      kind: "customer",
      provider_id: customer.id,
      idempotency_key: idempotencyKey(environment, "customer", customer.id),
      dates: { created_at: optionalAsaasDateToUtcIso(customer.dateCreated) },
      external_reference: customer.externalReference ?? null,
      provenance: provenance("asaas.customers.list", observedAt, "fresh", 1),
    });
  }

  const subscriptionEntities: FinanceEntity[] = [];
  const contractedSubIds: string[] = [];
  const subAmounts = new Map<string, number>();
  const subSeen = new Set<string>();
  for (const sub of input.subscriptions) {
    if (subSeen.has(sub.id)) {
      observations.push({
        kind: "duplicate",
        code: "subscription_list_duplicate",
        message: "Duplicate subscription in list payload collapsed to one entity",
        provider_ids: [sub.id],
        provenance: provenance("asaas.subscriptions.list", observedAt, "fresh", 1),
      });
      continue;
    }
    subSeen.add(sub.id);
    const cancelled = subscriptionIsCancelled(sub.status, sub.deleted);
    const lifecycle: ChargeLifecycle = cancelled ? "cancelled" : "pending";
    const money = moneyFromReais(sub.valueReais);
    subAmounts.set(sub.id, money.cents);
    subscriptionEntities.push({
      kind: "subscription",
      provider_id: sub.id,
      idempotency_key: idempotencyKey(environment, "subscription", sub.id),
      lifecycle,
      provider_status: sub.status,
      amount: money,
      dates: {
        created_at: optionalAsaasDateToUtcIso(sub.dateCreated),
        due_at: optionalAsaasDateToUtcIso(sub.nextDueDate),
      },
      external_reference: sub.externalReference ?? null,
      customer_id: sub.customer ?? null,
      deleted: sub.deleted,
      provenance: provenance("asaas.subscriptions.list", observedAt, "fresh", 1),
    });
    if (subscriptionIsActive(sub.status, sub.deleted)) {
      contractedSubIds.push(sub.id);
    }
  }

  const pixEntities: FinanceEntity[] = [];
  const pixSeen = new Set<string>();
  for (const pix of input.pix) {
    if (pixSeen.has(pix.id)) {
      observations.push({
        kind: "duplicate",
        code: "pix_list_duplicate",
        message: "Duplicate PIX transaction collapsed to one entity",
        provider_ids: [pix.id],
        provenance: provenance("asaas.pix.transactions.list", observedAt, "fresh", 1),
      });
      continue;
    }
    pixSeen.add(pix.id);
    pixEntities.push({
      kind: "pix",
      provider_id: pix.id,
      idempotency_key: idempotencyKey(environment, "pix", pix.id),
      provider_status: pix.status,
      amount: moneyFromReais(pix.valueReais),
      dates: {
        created_at: optionalAsaasDateToUtcIso(pix.dateCreated),
        effective_at: optionalAsaasDateToUtcIso(pix.effectiveDate),
      },
      external_reference: pix.endToEndIdentifier ?? null,
      pix_id: pix.id,
      provenance: provenance("asaas.pix.transactions.list", observedAt, "fresh", 1),
    });
  }

  const receivableEntities: FinanceEntity[] = [];
  const recvSeen = new Set<string>();
  for (const recv of input.receivables ?? []) {
    if (recvSeen.has(recv.id)) {
      continue;
    }
    recvSeen.add(recv.id);
    receivableEntities.push({
      kind: "receivable",
      provider_id: recv.id,
      idempotency_key: idempotencyKey(environment, "receivable", recv.id),
      provider_status: recv.type,
      amount: moneyFromReais(recv.valueReais),
      dates: { effective_at: optionalAsaasDateToUtcIso(recv.date) },
      provenance: provenance(
        "asaas.financialTransactions.list",
        observedAt,
        "fresh",
        1,
      ),
    });
  }

  const contractedChargeAmounts = new Map<string, number>();
  for (const id of oneOffContractedIds) {
    contractedChargeAmounts.set(id, chargeAmounts.get(id) ?? 0);
  }
  const contractedIds = [...contractedSubIds, ...oneOffContractedIds];
  const contractedAmounts = new Map<string, number>([
    ...subAmounts,
    ...contractedChargeAmounts,
  ]);

  let snapshotFreshness: FreshnessStatus = "fresh";
  if (observations.some((o) => o.kind === "inconsistency")) {
    snapshotFreshness = "inconsistent";
  }

  let balance: FinanceSnapshot["balance"];
  if (!input.balance) {
    balance = {
      omitted: true,
      reason: "not_requested",
      provenance: provenance("asaas.finance.balance", observedAt, "absent", 0),
    };
  } else if ("omitted" in input.balance) {
    observations.push({
      kind: "absence",
      code: "balance_unavailable",
      message: `GET /v3/finance/balance omitted (${input.balance.reason}); not invented`,
      provider_ids: [],
      provenance: provenance("asaas.finance.balance", observedAt, "absent", 0),
    });
    balance = {
      omitted: true,
      reason: input.balance.reason,
      provenance: provenance("asaas.finance.balance", observedAt, "absent", 0),
    };
  } else {
    balance = {
      omitted: false,
      available: moneyFromReais(input.balance.balanceReais),
      provenance: provenance("asaas.finance.balance", observedAt, "fresh", 1),
    };
  }

  const snapshot: FinanceSnapshot = {
    schema_version: FINANCE_SNAPSHOT_SCHEMA,
    source: "asaas",
    environment,
    collected_at: observedAt,
    observed_at: observedAt,
    freshness_status: snapshotFreshness,
    confidence: snapshotFreshness === "fresh" ? 1 : 0.6,
    provenance: provenance("asaas", observedAt, snapshotFreshness, snapshotFreshness === "fresh" ? 1 : 0.6),
    buckets: {
      contracted: contractedIds.length
        ? bucketFrom(
            contractedIds,
            contractedAmounts,
            observedAt,
            "asaas.buckets.contracted",
            snapshotFreshness,
          )
        : emptyBucket(observedAt, "asaas.buckets.contracted"),
      billed: billedIds.length
        ? bucketFrom(billedIds, chargeAmounts, observedAt, "asaas.buckets.billed", snapshotFreshness)
        : emptyBucket(observedAt, "asaas.buckets.billed"),
      paid: paidIds.length
        ? bucketFrom(paidIds, chargeAmounts, observedAt, "asaas.buckets.paid", snapshotFreshness)
        : emptyBucket(observedAt, "asaas.buckets.paid"),
      received: receivedIds.length
        ? bucketFrom(
            receivedIds,
            chargeAmounts,
            observedAt,
            "asaas.buckets.received",
            snapshotFreshness,
          )
        : emptyBucket(observedAt, "asaas.buckets.received"),
    },
    entities: {
      customers: sortEntities(customerEntities),
      charges: sortEntities(chargeEntities),
      subscriptions: sortEntities(subscriptionEntities),
      pix: sortEntities(pixEntities),
      receivables: sortEntities(receivableEntities),
    },
    balance,
    observations,
  };

  return snapshot;
}

export function snapshotStableView(snapshot: FinanceSnapshot): unknown {
  const { collected_at: _c, observed_at: _o, provenance: _p, ...rest } = snapshot;
  return {
    ...rest,
    buckets: {
      contracted: stripTime(snapshot.buckets.contracted),
      billed: stripTime(snapshot.buckets.billed),
      paid: stripTime(snapshot.buckets.paid),
      received: stripTime(snapshot.buckets.received),
    },
    entities: {
      customers: snapshot.entities.customers.map(stripEntityTime),
      charges: snapshot.entities.charges.map(stripEntityTime),
      subscriptions: snapshot.entities.subscriptions.map(stripEntityTime),
      pix: snapshot.entities.pix.map(stripEntityTime),
      receivables: snapshot.entities.receivables.map(stripEntityTime),
    },
    observations: snapshot.observations.map((o) => ({
      kind: o.kind,
      code: o.code,
      message: o.message,
      provider_ids: o.provider_ids,
      freshness_status: o.provenance.freshness_status,
    })),
    balance:
      snapshot.balance.omitted === true
        ? { omitted: true, reason: snapshot.balance.reason }
        : { omitted: false, available: snapshot.balance.available },
  };
}

function stripTime(bucket: MoneyBucket): unknown {
  return {
    cents: bucket.cents,
    currency: bucket.currency,
    provider_ids: bucket.provider_ids,
  };
}

function stripEntityTime(entity: FinanceEntity): unknown {
  return {
    kind: entity.kind,
    provider_id: entity.provider_id,
    idempotency_key: entity.idempotency_key,
    lifecycle: entity.lifecycle,
    provider_status: entity.provider_status,
    amount: entity.amount,
    dates: entity.dates,
    external_reference: entity.external_reference,
    customer_id: entity.customer_id,
    subscription_id: entity.subscription_id,
    pix_id: entity.pix_id,
    deleted: entity.deleted,
    freshness_status: entity.provenance.freshness_status,
  };
}
