import { GetOnlyAsaasClient } from "./http-client.js";
import { createLogger } from "./log.js";
import { normalizeToFinanceSnapshot } from "./normalize.js";
import { AsaasHttpError } from "./errors.js";
import {
  parseBalance,
  parseCharge,
  parseCustomer,
  parseListPage,
  parsePixTransaction,
  parseReceivable,
  parseSubscription,
} from "./parse.js";
import type {
  CollectOptions,
  FinanceSnapshot,
  ParsedBalance,
  ParsedCharge,
  ParsedCustomer,
  ParsedPixTransaction,
  ParsedReceivable,
  ParsedSubscription,
} from "./types.js";

const PAGE_LIMIT = 100;
const PAGE_GUARD = 1000;

interface ListResult<T> {
  items: T[];
  dropped: number;
}

async function listAll<T>(
  client: GetOnlyAsaasClient,
  path: string,
  parseItem: (raw: unknown) => T | null,
): Promise<ListResult<T>> {
  const items: T[] = [];
  let dropped = 0;
  let offset = 0;
  let pages = 0;
  for (;;) {
    const raw = await client.getJson(path, { offset, limit: PAGE_LIMIT });
    const page = parseListPage(raw);
    pages += 1;
    for (const row of page.data) {
      const parsed = parseItem(row);
      if (parsed) {
        items.push(parsed);
      } else {
        dropped += 1;
      }
    }
    if (!page.hasMore) {
      break;
    }
    offset += page.limit || PAGE_LIMIT;
    if (pages >= PAGE_GUARD) {
      throw new Error(`asaas.list.pagination_guard:${path}`);
    }
  }
  return { items, dropped };
}

async function optionalGet<T>(
  client: GetOnlyAsaasClient,
  path: string,
  parse: (raw: unknown) => T | null,
): Promise<
  | { value: T; omitted?: undefined }
  | { value?: undefined; omitted: { reason: string; httpStatus?: number } }
> {
  try {
    const raw = await client.getJson(path);
    const value = parse(raw);
    if (!value) {
      return { omitted: { reason: "unparseable_response" } };
    }
    return { value };
  } catch (err) {
    if (err instanceof AsaasHttpError && (err.status === 401 || err.status === 403)) {
      return {
        omitted: { reason: `http_${err.status}`, httpStatus: err.status },
      };
    }
    throw err;
  }
}

export async function collectFinanceSnapshot(
  options: CollectOptions,
): Promise<FinanceSnapshot> {
  const now = options.now ?? new Date();
  const observedAt = now.toISOString();
  const logger = createLogger(options.config.apiKey, options.logSink);
  const client = new GetOnlyAsaasClient(options.config, options.transport, logger);

  logger.info("asaas.collect.start", {
    environment: options.config.environment,
    baseUrl: options.config.baseUrl,
  });

  const customersResult = await listAll(client, "/v3/customers", parseCustomer);
  const chargesResult = await listAll(client, "/v3/payments", parseCharge);
  const subscriptionsResult = await listAll(
    client,
    "/v3/subscriptions",
    parseSubscription,
  );
  const pixResult = await listAll(client, "/v3/pix/transactions", parsePixTransaction);
  const customers: ParsedCustomer[] = customersResult.items;
  const charges: ParsedCharge[] = chargesResult.items;
  const subscriptions: ParsedSubscription[] = subscriptionsResult.items;
  const pix: ParsedPixTransaction[] = pixResult.items;

  const balanceResult = await optionalGet(client, "/v3/finance/balance", parseBalance);
  const receivablesResult = await optionalGetList(client, "/v3/financialTransactions", parseReceivable);

  const balance:
    | ParsedBalance
    | { omitted: true; reason: string; httpStatus?: number } = balanceResult.omitted
    ? { omitted: true, reason: balanceResult.omitted.reason, httpStatus: balanceResult.omitted.httpStatus }
    : balanceResult.value
      ? balanceResult.value
      : { omitted: true, reason: "missing" };

  const snapshot = normalizeToFinanceSnapshot({
    environment: options.config.environment,
    observedAt,
    customers,
    charges,
    subscriptions,
    pix,
    receivables: receivablesResult.items,
    balance,
    webhookEvents: options.webhookEvents ?? [],
  });

  if (receivablesResult.omitted) {
    snapshot.observations.push({
      kind: "absence",
      code: "receivables_unavailable",
      message: `GET /v3/financialTransactions omitted (${receivablesResult.omitted.reason}); not invented`,
      provider_ids: [],
      provenance: {
        source: "asaas.financialTransactions.list",
        observed_at: observedAt,
        freshness_status: "absent",
        confidence: 0,
      },
    });
  }

  noteDroppedRows(snapshot, observedAt, [
    { path: "/v3/customers", dropped: customersResult.dropped },
    { path: "/v3/payments", dropped: chargesResult.dropped },
    { path: "/v3/subscriptions", dropped: subscriptionsResult.dropped },
    { path: "/v3/pix/transactions", dropped: pixResult.dropped },
    {
      path: "/v3/financialTransactions",
      dropped: receivablesResult.items ? receivablesResult.dropped ?? 0 : 0,
    },
  ]);

  logger.info("asaas.collect.done", {
    environment: options.config.environment,
    charges: snapshot.entities.charges.length,
    customers: snapshot.entities.customers.length,
    subscriptions: snapshot.entities.subscriptions.length,
    pix: snapshot.entities.pix.length,
    freshness_status: snapshot.freshness_status,
    paid_cents: snapshot.buckets.paid.cents,
    received_cents: snapshot.buckets.received.cents,
  });

  return snapshot;
}

async function optionalGetList<T>(
  client: GetOnlyAsaasClient,
  path: string,
  parseItem: (raw: unknown) => T | null,
): Promise<{
  items?: T[];
  dropped?: number;
  omitted?: { reason: string; httpStatus?: number };
}> {
  try {
    const listed = await listAll(client, path, parseItem);
    return { items: listed.items, dropped: listed.dropped };
  } catch (err) {
    if (err instanceof AsaasHttpError && (err.status === 401 || err.status === 403)) {
      return { omitted: { reason: `http_${err.status}`, httpStatus: err.status } };
    }
    throw err;
  }
}

function noteDroppedRows(
  snapshot: FinanceSnapshot,
  observedAt: string,
  rows: Array<{ path: string; dropped: number }>,
): void {
  for (const row of rows) {
    if (row.dropped <= 0) {
      continue;
    }
    snapshot.observations.push({
      kind: "inconsistency",
      code: "list_row_unparseable",
      message: `${row.dropped} ${row.path} row(s) omitted; not counted in buckets`,
      provider_ids: [],
      provenance: {
        source: `asaas${row.path}`,
        observed_at: observedAt,
        freshness_status: "inconsistent",
        confidence: 0.4,
      },
    });
    snapshot.freshness_status = "inconsistent";
    snapshot.provenance = {
      ...snapshot.provenance,
      freshness_status: "inconsistent",
      confidence: 0.6,
    };
  }
}
