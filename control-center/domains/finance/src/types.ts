/**
 * Local finance read-model contract.
 *
 * Richer than the sibling contracts-package FinanceSnapshot stub
 * (`receivables_open` / `receivables_overdue`). This package does not import
 * that package. Convergence mapping is documented in README.md.
 *
 * Stages are not aliases:
 *   contratada  — signed obligation
 *   faturada    — invoiced
 *   paga        — provider says paid (not caixa)
 *   efetivamente_recebida — settlement / cash in hand
 *   vencida     — invoiced, past due, still open
 *   a_receber   — invoiced, not settled (includes vencida)
 */

export const SCHEMA_VERSION = "control-center.finance.read-model.v1" as const;

export const FRESHNESS_STATUSES = ["FRESH", "STALE", "UNKNOWN", "ERROR"] as const;
export type FreshnessStatus = (typeof FRESHNESS_STATUSES)[number];

export const BILLING_MODES = ["ONE_TIME", "RECURRING", "UNKNOWN"] as const;
export type BillingMode = (typeof BILLING_MODES)[number];

export const BILLING_CYCLES = ["MONTHLY", "YEARLY", "WEEKLY", "NONE"] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

export const EVENT_KINDS = [
  "contract_signed",
  "invoice_issued",
  "payment_confirmed",
  "settlement_received",
  "invoice_overdue",
  "refund",
  "chargeback",
  "expense",
  "cash_balance",
  "manual_adjustment",
  "contract_cancelled",
] as const;
export type FinanceEventKind = (typeof EVENT_KINDS)[number];

export const ADJUSTMENT_TARGETS = [
  "contratada",
  "faturada",
  "paga",
  "recebida",
  "expense",
  "cash_balance",
] as const;
export type AdjustmentTarget = (typeof ADJUSTMENT_TARGETS)[number];

export const ACTOR_KINDS = ["human", "agent", "system"] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

export const AUDIT_OUTCOMES = ["success", "denied", "error"] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

export const INCOMPLETE_REASONS = [
  "empty_input",
  "paid_without_settlement",
  "invoice_without_contract",
  "unknown_billing_mode",
  "non_monthly_recurring_omitted",
  "missing_reliable_expenses",
  "missing_cash_balance",
  "missing_due_date",
  "mixed_currency_rejected",
  "refund_exceeds_received",
  "chargeback_exceeds_received",
  "manual_cash_assertion",
  "low_confidence_input",
] as const;
export type IncompleteReason = (typeof INCOMPLETE_REASONS)[number];

export const UTC_DATETIME_PATTERN =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})?Z$/;

export const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export const RESOURCE_ID_PATTERN = /^cc:[a-z][a-z0-9-]*:[A-Za-z0-9._~-]+$/;

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:~/-]+$/;

export const DEFAULT_CURRENCY = "BRL";

export const DEFAULT_FRESHNESS_WINDOW_SECONDS = 86_400;

export const RELIABLE_EXPENSE_CONFIDENCE = 0.8;

export interface SourceRef {
  system: string;
  kind: string;
  locator: string;
  label?: string;
}

export interface ActorRef {
  kind: ActorKind;
  id: string;
  display_name?: string;
}

export interface Money {
  amount_cents: number;
  currency: string;
}

export interface Provenance {
  source: SourceRef;
  observed_at: string;
  freshness_status: FreshnessStatus;
  confidence: number;
  freshness_window_seconds?: number;
}

export interface MoneyFigure {
  amount_cents: number;
  currency: string;
  source: SourceRef;
  observed_at: string;
  freshness_status: FreshnessStatus;
  confidence: number;
  incomplete: boolean;
  incomplete_reasons: IncompleteReason[];
}

export interface TimeWindow {
  from: string;
  to: string;
}

export interface FinanceEvent {
  id: string;
  idempotency_key: string;
  kind: FinanceEventKind;
  occurred_at: string;
  amount_cents: number;
  currency: string;
  client_id: string;
  obligation_id: string;
  billing_mode: BillingMode;
  settlement_proven: boolean;
  source: SourceRef;
  observed_at: string;
  freshness_status: FreshnessStatus;
  confidence: number;
  billing_cycle?: BillingCycle;
  offer_code?: string;
  invoice_id?: string;
  contract_id?: string;
  due_at?: string | null;
  adjustment_target?: AdjustmentTarget;
  notes?: string;
}

export interface AggregateOptions {
  as_of: string;
  cash_in_window: TimeWindow;
  freshness_window_seconds?: number;
  scope?: string;
  snapshot_id?: string;
}

export interface CashInFigure extends MoneyFigure {
  window: TimeWindow;
}

export interface MrrFigure extends MoneyFigure {
  omitted: false;
}

export interface ArAgingBucket {
  key: "current" | "d1_30" | "d31_60" | "d61_90" | "d91_plus" | "unknown";
  amount_cents: number;
  obligation_count: number;
}

export interface ArAging {
  currency: string;
  source: SourceRef;
  observed_at: string;
  freshness_status: FreshnessStatus;
  confidence: number;
  incomplete: boolean;
  incomplete_reasons: IncompleteReason[];
  buckets: ArAgingBucket[];
}

export interface ClientShare {
  client_id: string;
  amount_cents: number;
  share_bps: number;
}

export interface ClientConcentration {
  basis: "a_receber";
  currency: string;
  source: SourceRef;
  observed_at: string;
  freshness_status: FreshnessStatus;
  confidence: number;
  incomplete: boolean;
  incomplete_reasons: IncompleteReason[];
  clients: ClientShare[];
  top_share_bps: number;
}

export type Runway =
  | {
      omitted: true;
      reason: "missing_reliable_expenses" | "missing_cash_balance" | "non_positive_burn";
      incomplete: true;
      source: SourceRef;
      observed_at: string;
      freshness_status: FreshnessStatus;
      confidence: number;
    }
  | {
      omitted: false;
      months: number;
      cash_balance_cents: number;
      monthly_burn_cents: number;
      currency: string;
      incomplete: boolean;
      incomplete_reasons: IncompleteReason[];
      source: SourceRef;
      observed_at: string;
      freshness_status: FreshnessStatus;
      confidence: number;
    };

export interface FinanceReadModel {
  schema_version: typeof SCHEMA_VERSION;
  id: string;
  scope: string;
  generated_at: string;
  as_of: string;
  read_model_only: true;
  provider_mutations: "forbidden";
  currency: string;
  figures: {
    receita_contratada: MoneyFigure;
    receita_faturada: MoneyFigure;
    receita_paga: MoneyFigure;
    efetivamente_recebida: MoneyFigure;
    vencida: MoneyFigure;
    a_receber: MoneyFigure;
  };
  cash_in: CashInFigure;
  mrr: MrrFigure;
  ar_aging: ArAging;
  concentracao: ClientConcentration;
  runway: Runway;
  incomplete_data: boolean;
  incomplete_reasons: IncompleteReason[];
  provenance: Provenance;
  adjustments_applied: number;
  event_count: number;
}

export interface FixtureDocument {
  id: string;
  as_of: string;
  cash_in_window: TimeWindow;
  freshness_window_seconds?: number;
  events: FinanceEvent[];
}

export interface ManualAdjustmentInput {
  idempotency_key: string;
  target: AdjustmentTarget;
  amount_cents: number;
  currency: string;
  reason: string;
  created_by: ActorRef;
  effective_at: string;
  source: SourceRef;
  observed_at: string;
  freshness_status: FreshnessStatus;
  confidence: number;
  obligation_id: string;
  client_id: string;
  billing_mode?: BillingMode;
  billing_cycle?: BillingCycle;
  offer_code?: string;
  provider_mutation?: "forbidden";
}

export interface ManualAdjustmentRecord {
  id: string;
  event: FinanceEvent;
  created_by: ActorRef;
  reason: string;
  created_at: string;
}

export interface AuditRecord {
  id: string;
  at: string;
  actor: ActorRef;
  action: "manual_adjustment_appended" | "manual_adjustment_denied";
  resource_type: "ManualAdjustment";
  resource_id: string | null;
  scope: "finance";
  outcome: AuditOutcome;
  detail: {
    target?: AdjustmentTarget;
    amount_cents?: number;
    currency?: string;
    reason?: string;
    idempotency_key: string;
    provider_mutation: "forbidden";
    denied_code?: string;
  };
}

export interface AdjustmentResult {
  record: ManualAdjustmentRecord;
  audit: AuditRecord;
  duplicate: boolean;
}

export interface FinanceObservationPort {
  listEvents(): Promise<FinanceEvent[]>;
  appendAdjustment(input: ManualAdjustmentInput): Promise<AdjustmentResult>;
}

export interface ContractsStubMoney {
  amount_cents: number;
  currency: string;
}

/** Mapping to the sibling contracts-package stub. Local only. */
export interface ContractsFinanceStub {
  schema_version: "control-center.finance-snapshot.v1";
  receivables_open: ContractsStubMoney;
  receivables_overdue: ContractsStubMoney;
}
