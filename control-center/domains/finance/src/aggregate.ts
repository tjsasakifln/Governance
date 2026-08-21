import { FinanceValidationError } from "./errors.js";
import { addCents, assertCents, subCentsFloor } from "./money.js";
import { compareUtc, daysBetween, isInWindow, parseUtc, toUtcIso } from "./dates.js";
import { figure, minConfidence, snapshotId, AGGREGATOR_SOURCE } from "./provenance.js";
import { parseFinanceEvent } from "./validate.js";
import {
  DEFAULT_CURRENCY,
  DEFAULT_FRESHNESS_WINDOW_SECONDS,
  RELIABLE_EXPENSE_CONFIDENCE,
  SCHEMA_VERSION,
  type AggregateOptions,
  type ArAgingBucket,
  type ClientShare,
  type ContractsFinanceStub,
  type FinanceEvent,
  type FinanceReadModel,
  type IncompleteReason,
  type Runway,
} from "./types.js";

interface ObligationState {
  id: string;
  client_id: string;
  currency: string;
  billing_mode: FinanceEvent["billing_mode"];
  billing_cycle?: FinanceEvent["billing_cycle"];
  offer_code?: string;
  due_at: string | null;
  cancelled: boolean;
  contracted: number;
  invoiced: number;
  confirmed_paid: number;
  received_gross: number;
  refunded: number;
  charged_back: number;
  has_contract: boolean;
  has_invoice: boolean;
  events: FinanceEvent[];
}

function emptyObligation(event: FinanceEvent): ObligationState {
  return {
    id: event.obligation_id,
    client_id: event.client_id,
    currency: event.currency,
    billing_mode: event.billing_mode,
    billing_cycle: event.billing_cycle,
    offer_code: event.offer_code,
    due_at: event.due_at ?? null,
    cancelled: false,
    contracted: 0,
    invoiced: 0,
    confirmed_paid: 0,
    received_gross: 0,
    refunded: 0,
    charged_back: 0,
    has_contract: false,
    has_invoice: false,
    events: [],
  };
}

function dedupe(events: readonly FinanceEvent[]): FinanceEvent[] {
  const seen = new Set<string>();
  const out: FinanceEvent[] = [];
  const sorted = [...events].sort((a, b) => {
    const byTime = compareUtc(a.occurred_at, b.occurred_at);
    if (byTime !== 0) {
      return byTime;
    }
    return a.id.localeCompare(b.id);
  });
  for (const event of sorted) {
    if (seen.has(event.idempotency_key)) {
      continue;
    }
    seen.add(event.idempotency_key);
    out.push(parseFinanceEvent(event, `event:${event.id}`));
  }
  return out;
}

function applyEvent(state: ObligationState, event: FinanceEvent): void {
  state.events.push(event);
  if (event.due_at) {
    state.due_at = event.due_at;
  }
  if (event.billing_mode !== "UNKNOWN") {
    state.billing_mode = event.billing_mode;
  }
  if (event.billing_cycle) {
    state.billing_cycle = event.billing_cycle;
  }
  if (event.offer_code) {
    state.offer_code = event.offer_code;
  }
  switch (event.kind) {
    case "contract_signed":
      state.contracted = addCents(state.contracted, event.amount_cents);
      state.has_contract = true;
      break;
    case "invoice_issued":
      state.invoiced = addCents(state.invoiced, event.amount_cents);
      state.has_invoice = true;
      if (!state.has_contract) {
        state.contracted = addCents(state.contracted, event.amount_cents);
      }
      break;
    case "payment_confirmed":
      state.confirmed_paid = addCents(state.confirmed_paid, event.amount_cents);
      break;
    case "settlement_received":
      state.received_gross = addCents(state.received_gross, event.amount_cents);
      break;
    case "refund":
      state.refunded = addCents(state.refunded, event.amount_cents);
      break;
    case "chargeback":
      state.charged_back = addCents(state.charged_back, event.amount_cents);
      break;
    case "invoice_overdue":
      break;
    case "contract_cancelled":
      state.cancelled = true;
      break;
    case "manual_adjustment":
      applyAdjustment(state, event);
      break;
    case "expense":
    case "cash_balance":
      break;
  }
}

function applyAdjustment(state: ObligationState, event: FinanceEvent): void {
  const target = event.adjustment_target;
  const amount = event.amount_cents;
  switch (target) {
    case "contratada":
      state.contracted = addCents(state.contracted, amount);
      state.has_contract = true;
      break;
    case "faturada":
      state.invoiced = addCents(state.invoiced, amount);
      state.has_invoice = true;
      break;
    case "paga":
      state.confirmed_paid = addCents(state.confirmed_paid, amount);
      break;
    case "recebida":
      state.received_gross = addCents(state.received_gross, amount);
      break;
    default:
      break;
  }
}

function netReceived(state: ObligationState): number {
  return subCentsFloor(state.received_gross, addCents(state.refunded, state.charged_back));
}

function grossPaid(state: ObligationState): number {
  return state.confirmed_paid > state.received_gross ? state.confirmed_paid : state.received_gross;
}

function netPaid(state: ObligationState): number {
  return subCentsFloor(grossPaid(state), addCents(state.refunded, state.charged_back));
}

/**
 * Open AR: invoiced minus settled minus refunded (refund closes the bill).
 * Chargeback reinstates AR because netReceived drops while refunded stays 0.
 */
function openAr(state: ObligationState): number {
  if (state.cancelled) {
    return 0;
  }
  return subCentsFloor(state.invoiced, addCents(netReceived(state), state.refunded));
}

function isOverdue(state: ObligationState, asOf: string): boolean {
  if (openAr(state) <= 0) {
    return false;
  }
  if (!state.due_at) {
    return false;
  }
  return daysBetween(state.due_at, asOf) > 0;
}

function agingKey(state: ObligationState, asOf: string): ArAgingBucket["key"] {
  if (openAr(state) <= 0) {
    return "current";
  }
  if (!state.due_at) {
    return "unknown";
  }
  const days = daysBetween(state.due_at, asOf);
  if (days <= 0) {
    return "current";
  }
  if (days <= 30) {
    return "d1_30";
  }
  if (days <= 60) {
    return "d31_60";
  }
  if (days <= 90) {
    return "d61_90";
  }
  return "d91_plus";
}

function uniqueReasons(reasons: readonly IncompleteReason[]): IncompleteReason[] {
  return [...new Set(reasons)];
}

export function aggregateFinanceReadModel(
  rawEvents: readonly FinanceEvent[],
  options: AggregateOptions,
): FinanceReadModel {
  parseUtc(options.as_of, "as_of");
  const windowSeconds = options.freshness_window_seconds ?? DEFAULT_FRESHNESS_WINDOW_SECONDS;
  if (!Number.isInteger(windowSeconds) || windowSeconds < 0) {
    throw new FinanceValidationError(
      "FINANCE_FRESHNESS_WINDOW_INVALID",
      "freshness_window_seconds must be a non-negative integer",
    );
  }
  const events = dedupe(rawEvents);
  const generatedAt = toUtcIso(new Date());
  const snapshotReasons: IncompleteReason[] = [];

  if (events.length === 0) {
    snapshotReasons.push("empty_input");
  }

  const currencies = new Set(events.map((event) => event.currency));
  if (currencies.size > 1) {
    throw new FinanceValidationError(
      "FINANCE_MIXED_CURRENCY",
      "refusing to sum mixed currencies; FX is out of scope",
    );
  }
  const currency = events[0]?.currency ?? DEFAULT_CURRENCY;

  const byObligation = new Map<string, ObligationState>();
  let adjustmentsApplied = 0;

  for (const event of events) {
    if (event.kind === "expense" || event.kind === "cash_balance") {
      continue;
    }
    if (event.kind === "manual_adjustment") {
      adjustmentsApplied += 1;
      if (event.adjustment_target === "expense" || event.adjustment_target === "cash_balance") {
        continue;
      }
    }
    const current = byObligation.get(event.obligation_id) ?? emptyObligation(event);
    if (current.currency !== event.currency) {
      throw new FinanceValidationError(
        "FINANCE_MIXED_CURRENCY",
        `obligation ${event.obligation_id} mixes currencies`,
      );
    }
    applyEvent(current, event);
    byObligation.set(event.obligation_id, current);
  }

  const states = [...byObligation.values()];

  let contratada = 0;
  let faturada = 0;
  let paga = 0;
  let recebida = 0;
  let vencida = 0;
  let aReceber = 0;
  let mrr = 0;

  const contratadaEvents: FinanceEvent[] = [];
  const faturadaEvents: FinanceEvent[] = [];
  const pagaEvents: FinanceEvent[] = [];
  const recebidaEvents: FinanceEvent[] = [];
  const vencidaEvents: FinanceEvent[] = [];
  const arEvents: FinanceEvent[] = [];
  const mrrEvents: FinanceEvent[] = [];

  const contratadaReasons: IncompleteReason[] = [];
  const faturadaReasons: IncompleteReason[] = [];
  const pagaReasons: IncompleteReason[] = [];
  const recebidaReasons: IncompleteReason[] = [];
  const vencidaReasons: IncompleteReason[] = [];
  const arReasons: IncompleteReason[] = [];
  const mrrReasons: IncompleteReason[] = [];

  for (const state of states) {
    if (state.cancelled) {
      continue;
    }
    contratada = addCents(contratada, state.contracted);
    faturada = addCents(faturada, state.invoiced);
    const paid = netPaid(state);
    const received = netReceived(state);
    paga = addCents(paga, paid);
    recebida = addCents(recebida, received);
    const ar = openAr(state);
    aReceber = addCents(aReceber, ar);
    if (isOverdue(state, options.as_of)) {
      vencida = addCents(vencida, ar);
      vencidaEvents.push(...state.events);
    }

    if (state.has_invoice && !state.has_contract) {
      contratadaReasons.push("invoice_without_contract");
      snapshotReasons.push("invoice_without_contract");
    }
    if (state.refunded > state.received_gross) {
      recebidaReasons.push("refund_exceeds_received");
      snapshotReasons.push("refund_exceeds_received");
    }
    if (state.charged_back > state.received_gross) {
      recebidaReasons.push("chargeback_exceeds_received");
      snapshotReasons.push("chargeback_exceeds_received");
    }
    if (paid > received) {
      pagaReasons.push("paid_without_settlement");
      snapshotReasons.push("paid_without_settlement");
    }
    if (ar > 0 && !state.due_at) {
      arReasons.push("missing_due_date");
      vencidaReasons.push("missing_due_date");
      snapshotReasons.push("missing_due_date");
    }
    if (state.billing_mode === "UNKNOWN") {
      mrrReasons.push("unknown_billing_mode");
      snapshotReasons.push("unknown_billing_mode");
    }

    if (state.billing_mode === "RECURRING") {
      if (state.billing_cycle === "MONTHLY") {
        mrr = addCents(mrr, state.contracted > 0 ? state.contracted : state.invoiced);
        mrrEvents.push(...state.events);
      } else {
        mrrReasons.push("non_monthly_recurring_omitted");
        snapshotReasons.push("non_monthly_recurring_omitted");
      }
    }

    contratadaEvents.push(...state.events.filter((e) => e.kind === "contract_signed" || (e.kind === "invoice_issued" && !state.has_contract) || (e.kind === "manual_adjustment" && e.adjustment_target === "contratada")));
    faturadaEvents.push(...state.events.filter((e) => e.kind === "invoice_issued" || (e.kind === "manual_adjustment" && e.adjustment_target === "faturada")));
    pagaEvents.push(...state.events.filter((e) => e.kind === "payment_confirmed" || e.kind === "settlement_received" || e.kind === "refund" || e.kind === "chargeback" || (e.kind === "manual_adjustment" && e.adjustment_target === "paga")));
    recebidaEvents.push(...state.events.filter((e) => e.kind === "settlement_received" || e.kind === "refund" || e.kind === "chargeback" || (e.kind === "manual_adjustment" && e.adjustment_target === "recebida")));
    if (ar > 0) {
      arEvents.push(...state.events);
    }
  }

  const manualCash = events.filter(
    (event) => event.kind === "manual_adjustment" && event.adjustment_target === "recebida",
  );
  if (manualCash.length > 0) {
    recebidaReasons.push("manual_cash_assertion");
    snapshotReasons.push("manual_cash_assertion");
  }

  let cashIn = 0;
  const cashInEvents: FinanceEvent[] = [];
  for (const event of events) {
    const inWindow = isInWindow(event.occurred_at, options.cash_in_window.from, options.cash_in_window.to);
    if (!inWindow) {
      continue;
    }
    if (event.kind === "settlement_received") {
      cashIn = addCents(cashIn, event.amount_cents);
      cashInEvents.push(event);
    } else if (event.kind === "refund" || event.kind === "chargeback") {
      cashIn = addCents(cashIn, -event.amount_cents);
      cashInEvents.push(event);
    } else if (event.kind === "manual_adjustment" && event.adjustment_target === "recebida") {
      cashIn = addCents(cashIn, event.amount_cents);
      cashInEvents.push(event);
    }
  }

  const bucketOrder: ArAgingBucket["key"][] = [
    "current",
    "d1_30",
    "d31_60",
    "d61_90",
    "d91_plus",
    "unknown",
  ];
  const agingMap = new Map<ArAgingBucket["key"], ArAgingBucket>();
  for (const key of bucketOrder) {
    agingMap.set(key, { key, amount_cents: 0, obligation_count: 0 });
  }
  for (const state of states) {
    const ar = openAr(state);
    if (ar <= 0 || state.cancelled) {
      continue;
    }
    const key = agingKey(state, options.as_of);
    const bucket = agingMap.get(key);
    if (!bucket) {
      continue;
    }
    bucket.amount_cents = addCents(bucket.amount_cents, ar);
    bucket.obligation_count += 1;
  }

  const clientAr = new Map<string, number>();
  for (const state of states) {
    const ar = openAr(state);
    if (ar <= 0) {
      continue;
    }
    clientAr.set(state.client_id, addCents(clientAr.get(state.client_id) ?? 0, ar));
  }
  const clientShares: ClientShare[] = [...clientAr.entries()]
    .map(([client_id, amount_cents]) => {
      const share_bps = aReceber === 0 ? 0 : Math.floor((amount_cents * 10_000) / aReceber);
      return { client_id, amount_cents, share_bps };
    })
    .sort((a, b) => b.amount_cents - a.amount_cents || a.client_id.localeCompare(b.client_id));
  const topShare = clientShares[0]?.share_bps ?? 0;

  const expenses = events.filter((event) => {
    if (event.kind === "expense") {
      return event.confidence >= RELIABLE_EXPENSE_CONFIDENCE;
    }
    return event.kind === "manual_adjustment" && event.adjustment_target === "expense" && event.confidence >= RELIABLE_EXPENSE_CONFIDENCE;
  });
  const balances = events.filter((event) => {
    if (event.kind === "cash_balance") {
      return true;
    }
    return event.kind === "manual_adjustment" && event.adjustment_target === "cash_balance";
  });

  const figureAsOf = options.as_of;
  let runway: Runway;
  if (expenses.length === 0) {
    snapshotReasons.push("missing_reliable_expenses");
    runway = {
      omitted: true,
      reason: "missing_reliable_expenses",
      incomplete: true,
      source: AGGREGATOR_SOURCE,
      observed_at: figureAsOf,
      freshness_status: "UNKNOWN",
      confidence: 0,
    };
  } else if (balances.length === 0) {
    snapshotReasons.push("missing_cash_balance");
    runway = {
      omitted: true,
      reason: "missing_cash_balance",
      incomplete: true,
      source: AGGREGATOR_SOURCE,
      observed_at: figureAsOf,
      freshness_status: "UNKNOWN",
      confidence: minConfidence(expenses.map((e) => e.confidence), 0),
    };
  } else {
    const latestBalance = [...balances].sort((a, b) => compareUtc(b.occurred_at, a.occurred_at))[0];
    if (!latestBalance) {
      snapshotReasons.push("missing_cash_balance");
      runway = {
        omitted: true,
        reason: "missing_cash_balance",
        incomplete: true,
        source: AGGREGATOR_SOURCE,
        observed_at: figureAsOf,
        freshness_status: "UNKNOWN",
        confidence: 0,
      };
    } else {
      const windowStartMs = parseUtc(options.as_of, "as_of").getTime() - 30 * 86_400_000;
      const recent = expenses.filter(
        (event) => parseUtc(event.occurred_at, "occurred_at").getTime() >= windowStartMs,
      );
      const burnEvents = recent.length > 0 ? recent : expenses;
      let burn = 0;
      for (const event of burnEvents) {
        burn = addCents(burn, event.amount_cents);
      }
      if (burn <= 0) {
        runway = {
          omitted: true,
          reason: "non_positive_burn",
          incomplete: true,
          source: AGGREGATOR_SOURCE,
          observed_at: figureAsOf,
          freshness_status: "UNKNOWN",
          confidence: 0,
        };
      } else {
        const months = Math.floor(latestBalance.amount_cents / burn);
        runway = {
          omitted: false,
          months: assertCents(months, "runway.months"),
          cash_balance_cents: latestBalance.amount_cents,
          monthly_burn_cents: burn,
          currency,
          incomplete: false,
          incomplete_reasons: [],
          source: latestBalance.source,
          observed_at: latestBalance.observed_at,
          freshness_status: latestBalance.freshness_status,
          confidence: minConfidence(
            [latestBalance.confidence, ...burnEvents.map((e) => e.confidence)],
            0,
          ),
        };
      }
    }
  }

  const lowConfidence = events.some((event) => event.confidence < 0.5);
  if (lowConfidence) {
    snapshotReasons.push("low_confidence_input");
  }

  const reasons = uniqueReasons(snapshotReasons);
  const incompleteData = reasons.length > 0;

  const receita_contratada = figure(
    contratada,
    currency,
    figureAsOf,
    windowSeconds,
    contratadaEvents,
    uniqueReasons(contratadaReasons),
    generatedAt,
  );
  const receita_faturada = figure(
    faturada,
    currency,
    figureAsOf,
    windowSeconds,
    faturadaEvents,
    uniqueReasons(faturadaReasons),
    generatedAt,
  );
  const receita_paga = figure(
    paga,
    currency,
    figureAsOf,
    windowSeconds,
    pagaEvents,
    uniqueReasons(pagaReasons),
    generatedAt,
  );
  const efetivamente_recebida = figure(
    recebida,
    currency,
    figureAsOf,
    windowSeconds,
    recebidaEvents,
    uniqueReasons(recebidaReasons),
    generatedAt,
  );
  const vencidaFigure = figure(
    vencida,
    currency,
    figureAsOf,
    windowSeconds,
    vencidaEvents,
    uniqueReasons(vencidaReasons),
    generatedAt,
  );
  const aReceberFigure = figure(
    aReceber,
    currency,
    figureAsOf,
    windowSeconds,
    arEvents,
    uniqueReasons(arReasons),
    generatedAt,
  );
  const cashInFigure = {
    ...figure(cashIn, currency, figureAsOf, windowSeconds, cashInEvents, uniqueReasons(recebidaReasons), generatedAt),
    window: options.cash_in_window,
  };
  const mrrFigure = {
    ...figure(mrr, currency, figureAsOf, windowSeconds, mrrEvents, uniqueReasons(mrrReasons), generatedAt),
    omitted: false as const,
  };

  const agingEvents = arEvents;
  const agingFigureBase = figure(aReceber, currency, figureAsOf, windowSeconds, agingEvents, uniqueReasons(arReasons), generatedAt);

  const id = options.snapshot_id ?? snapshotId("finance", options.as_of);

  return {
    schema_version: SCHEMA_VERSION,
    id,
    scope: options.scope ?? "finance",
    generated_at: generatedAt,
    as_of: options.as_of,
    read_model_only: true,
    provider_mutations: "forbidden",
    currency,
    figures: {
      receita_contratada,
      receita_faturada,
      receita_paga,
      efetivamente_recebida,
      vencida: vencidaFigure,
      a_receber: aReceberFigure,
    },
    cash_in: cashInFigure,
    mrr: mrrFigure,
    ar_aging: {
      currency,
      source: agingFigureBase.source,
      observed_at: agingFigureBase.observed_at,
      freshness_status: agingFigureBase.freshness_status,
      confidence: agingFigureBase.confidence,
      incomplete: agingFigureBase.incomplete,
      incomplete_reasons: agingFigureBase.incomplete_reasons,
      buckets: bucketOrder.map((key) => agingMap.get(key) ?? { key, amount_cents: 0, obligation_count: 0 }),
    },
    concentracao: {
      basis: "a_receber",
      currency,
      source: agingFigureBase.source,
      observed_at: agingFigureBase.observed_at,
      freshness_status: agingFigureBase.freshness_status,
      confidence: agingFigureBase.confidence,
      incomplete: agingFigureBase.incomplete,
      incomplete_reasons: agingFigureBase.incomplete_reasons,
      clients: clientShares,
      top_share_bps: topShare,
    },
    runway,
    incomplete_data: incompleteData,
    incomplete_reasons: reasons,
    provenance: {
      source: AGGREGATOR_SOURCE,
      observed_at: generatedAt,
      freshness_status: events.length === 0 ? "UNKNOWN" : "FRESH",
      confidence: events.length === 0 ? 0 : minConfidence(events.map((e) => e.confidence), 0),
      freshness_window_seconds: windowSeconds,
    },
    adjustments_applied: adjustmentsApplied,
    event_count: events.length,
  };
}

export function toContractsStub(snapshot: FinanceReadModel): ContractsFinanceStub {
  return {
    schema_version: "control-center.finance-snapshot.v1",
    receivables_open: {
      amount_cents: snapshot.figures.a_receber.amount_cents,
      currency: snapshot.currency,
    },
    receivables_overdue: {
      amount_cents: snapshot.figures.vencida.amount_cents,
      currency: snapshot.currency,
    },
  };
}

export function assertIntegerCents(snapshot: FinanceReadModel): void {
  const figures = [
    snapshot.figures.receita_contratada,
    snapshot.figures.receita_faturada,
    snapshot.figures.receita_paga,
    snapshot.figures.efetivamente_recebida,
    snapshot.figures.vencida,
    snapshot.figures.a_receber,
    snapshot.cash_in,
    snapshot.mrr,
  ];
  for (const item of figures) {
    assertCents(item.amount_cents, "figure.amount_cents");
  }
  for (const bucket of snapshot.ar_aging.buckets) {
    assertCents(bucket.amount_cents, "aging.amount_cents");
  }
  for (const client of snapshot.concentracao.clients) {
    assertCents(client.amount_cents, "concentration.amount_cents");
  }
  if (!snapshot.runway.omitted) {
    assertCents(snapshot.runway.months, "runway.months");
    assertCents(snapshot.runway.cash_balance_cents, "runway.cash_balance_cents");
    assertCents(snapshot.runway.monthly_burn_cents, "runway.monthly_burn_cents");
  }
}
