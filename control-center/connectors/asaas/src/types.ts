export const FINANCE_SNAPSHOT_SCHEMA = "control-center.finance-snapshot.v1" as const;

export type AsaasEnvironment = "sandbox" | "production";

export type FreshnessStatus = "fresh" | "stale" | "absent" | "inconsistent";

export type EntityKind = "customer" | "charge" | "subscription" | "pix" | "receivable";

/**
 * Charge lifecycle after the founder rule: CONFIRMED is paid, not received,
 * and is never labeled receita/revenue.
 */
export type ChargeLifecycle =
  | "pending"
  | "paid"
  | "received"
  | "overdue"
  | "refunded"
  | "cancelled"
  | "chargeback"
  | "other";

export type ObservationKind =
  | "inconsistency"
  | "duplicate"
  | "absence"
  | "freshness"
  | "info";

export interface Money {
  cents: number;
  currency: "BRL";
}

export interface Provenance {
  source: string;
  observed_at: string;
  freshness_status: FreshnessStatus;
  confidence?: number;
}

export interface FinanceEntity {
  kind: EntityKind;
  provider_id: string;
  idempotency_key: string;
  lifecycle?: ChargeLifecycle;
  provider_status?: string;
  amount?: Money;
  dates: {
    created_at?: string;
    due_at?: string;
    paid_at?: string;
    received_at?: string;
    credit_at?: string;
    cancelled_at?: string;
    refunded_at?: string;
    effective_at?: string;
  };
  external_reference?: string | null;
  customer_id?: string | null;
  subscription_id?: string | null;
  pix_id?: string | null;
  deleted?: boolean;
  provenance: Provenance;
}

export interface MoneyBucket {
  cents: number;
  currency: "BRL";
  provider_ids: string[];
  provenance: Provenance;
}

export interface Observation {
  kind: ObservationKind;
  code: string;
  message: string;
  provider_ids: string[];
  provenance: Provenance;
}

export type BalanceView =
  | {
      omitted: false;
      available: Money;
      provenance: Provenance;
    }
  | {
      omitted: true;
      reason: string;
      provenance: Provenance;
    };

export interface FinanceSnapshot {
  schema_version: typeof FINANCE_SNAPSHOT_SCHEMA;
  source: "asaas";
  environment: AsaasEnvironment;
  collected_at: string;
  observed_at: string;
  freshness_status: FreshnessStatus;
  confidence?: number;
  provenance: Provenance;
  buckets: {
    contracted: MoneyBucket;
    billed: MoneyBucket;
    paid: MoneyBucket;
    received: MoneyBucket;
  };
  entities: {
    customers: FinanceEntity[];
    charges: FinanceEntity[];
    subscriptions: FinanceEntity[];
    pix: FinanceEntity[];
    receivables: FinanceEntity[];
  };
  balance: BalanceView;
  observations: Observation[];
}

export interface AsaasConfig {
  environment: AsaasEnvironment;
  baseUrl: string;
  apiKey: string;
  userAgent: string;
}

export interface HttpRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string | undefined;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  bodyText: string;
}

export interface HttpTransport {
  request(req: HttpRequest): Promise<HttpResponse>;
}

export type QueryValue = string | number | boolean | undefined;

export interface CollectOptions {
  config: AsaasConfig;
  transport: HttpTransport;
  webhookEvents?: unknown[];
  now?: Date;
  logSink?: (record: Record<string, unknown>) => void;
}

export interface ParsedListPage {
  object?: string;
  hasMore: boolean;
  totalCount?: number;
  limit: number;
  offset: number;
  data: unknown[];
}

export interface ParsedCustomer {
  id: string;
  dateCreated?: string;
  externalReference?: string | null;
}

export interface ParsedCharge {
  id: string;
  status: string;
  valueReais: number;
  netValueReais?: number;
  billingType?: string;
  dateCreated?: string;
  dueDate?: string;
  paymentDate?: string;
  clientPaymentDate?: string;
  creditDate?: string;
  estimatedCreditDate?: string;
  externalReference?: string | null;
  customer?: string | null;
  subscription?: string | null;
  pixTransaction?: string | null;
  deleted: boolean;
}

export interface ParsedSubscription {
  id: string;
  status: string;
  valueReais: number;
  dateCreated?: string;
  nextDueDate?: string;
  externalReference?: string | null;
  customer?: string | null;
  billingType?: string;
  cycle?: string;
  deleted: boolean;
}

export interface ParsedPixTransaction {
  id: string;
  status: string;
  type?: string;
  valueReais: number;
  dateCreated?: string;
  effectiveDate?: string;
  endToEndIdentifier?: string | null;
  payment?: string | null;
}

export interface ParsedReceivable {
  id: string;
  type?: string;
  valueReais: number;
  date?: string;
  paymentId?: string | null;
}

export interface ParsedBalance {
  balanceReais: number;
}

export interface NormalizeInput {
  environment: AsaasEnvironment;
  observedAt: string;
  customers: ParsedCustomer[];
  charges: ParsedCharge[];
  subscriptions: ParsedSubscription[];
  pix: ParsedPixTransaction[];
  receivables?: ParsedReceivable[];
  balance?: ParsedBalance | { omitted: true; reason: string; httpStatus?: number };
  webhookEvents?: unknown[];
}
