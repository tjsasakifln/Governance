import { FinanceValidationError } from "./errors.js";
import { parseUtc } from "./dates.js";
import { assertCents, assertCurrency } from "./money.js";
import {
  ACTOR_KINDS,
  ADJUSTMENT_TARGETS,
  BILLING_CYCLES,
  BILLING_MODES,
  EVENT_KINDS,
  FRESHNESS_STATUSES,
  IDEMPOTENCY_KEY_PATTERN,
  RESOURCE_ID_PATTERN,
  type ActorKind,
  type ActorRef,
  type AdjustmentTarget,
  type BillingCycle,
  type BillingMode,
  type FinanceEvent,
  type FinanceEventKind,
  type FixtureDocument,
  type FreshnessStatus,
  type ManualAdjustmentInput,
  type SourceRef,
  type TimeWindow,
} from "./types.js";

const SECRET_KEY =
  /^(.*[_-])?(api[_-]?key|access[_-]?token|authorization|password|secret|token|cookie|credential|private[_-]?key)$/i;

const EVENT_KEYS = new Set([
  "id",
  "idempotency_key",
  "kind",
  "occurred_at",
  "amount_cents",
  "currency",
  "client_id",
  "obligation_id",
  "billing_mode",
  "settlement_proven",
  "source",
  "observed_at",
  "freshness_status",
  "confidence",
  "billing_cycle",
  "offer_code",
  "invoice_id",
  "contract_id",
  "due_at",
  "adjustment_target",
  "notes",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectSecretKeys(record: Record<string, unknown>, path: string): void {
  for (const key of Object.keys(record)) {
    if (SECRET_KEY.test(key)) {
      throw new FinanceValidationError(
        "FINANCE_SECRET_KEY_FORBIDDEN",
        `${path} contains a forbidden secret-bearing key`,
      );
    }
  }
}

function requireString(value: unknown, field: string, min = 1, max = 128): string {
  if (typeof value !== "string" || value.length < min || value.length > max) {
    throw new FinanceValidationError(
      "FINANCE_STRING_INVALID",
      `${field} must be a string of length ${min}..${max}`,
    );
  }
  return value;
}

function parseFreshness(value: unknown, field: string): FreshnessStatus {
  if (typeof value !== "string" || !(FRESHNESS_STATUSES as readonly string[]).includes(value)) {
    throw new FinanceValidationError(
      "FINANCE_FRESHNESS_INVALID",
      `${field} must be one of ${FRESHNESS_STATUSES.join(", ")}`,
    );
  }
  return value as FreshnessStatus;
}

function parseConfidence(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new FinanceValidationError(
      "FINANCE_CONFIDENCE_INVALID",
      `${field} must be a finite number in [0, 1]`,
    );
  }
  return value;
}

export function parseSourceRef(value: unknown, field: string): SourceRef {
  if (!isRecord(value)) {
    throw new FinanceValidationError("FINANCE_SOURCE_INVALID", `${field} must be an object`);
  }
  rejectSecretKeys(value, field);
  const system = requireString(value.system, `${field}.system`, 1, 64);
  if (!/^[a-z][a-z0-9-]*$/.test(system)) {
    throw new FinanceValidationError(
      "FINANCE_SOURCE_INVALID",
      `${field}.system must be lowercase kebab`,
    );
  }
  const kind = requireString(value.kind, `${field}.kind`, 1, 64);
  if (!/^[a-z][a-z0-9._-]*$/.test(kind)) {
    throw new FinanceValidationError(
      "FINANCE_SOURCE_INVALID",
      `${field}.kind must be lowercase kebab`,
    );
  }
  const locator = requireString(value.locator, `${field}.locator`, 1, 512);
  const source: SourceRef = { system, kind, locator };
  if (value.label !== undefined) {
    source.label = requireString(value.label, `${field}.label`, 1, 128);
  }
  return source;
}

export function parseActorRef(value: unknown, field: string): ActorRef {
  if (!isRecord(value)) {
    throw new FinanceValidationError("FINANCE_ACTOR_INVALID", `${field} must be an object`);
  }
  rejectSecretKeys(value, field);
  if (typeof value.kind !== "string" || !(ACTOR_KINDS as readonly string[]).includes(value.kind)) {
    throw new FinanceValidationError(
      "FINANCE_ACTOR_INVALID",
      `${field}.kind must be one of ${ACTOR_KINDS.join(", ")}`,
    );
  }
  const id = requireString(value.id, `${field}.id`, 1, 128);
  if (!/^[A-Za-z0-9._:@-]+$/.test(id)) {
    throw new FinanceValidationError("FINANCE_ACTOR_INVALID", `${field}.id has invalid characters`);
  }
  const actor: ActorRef = { kind: value.kind as ActorKind, id };
  if (value.display_name !== undefined) {
    actor.display_name = requireString(value.display_name, `${field}.display_name`, 1, 128);
  }
  return actor;
}

function parseKind(value: unknown): FinanceEventKind {
  if (typeof value !== "string" || !(EVENT_KINDS as readonly string[]).includes(value)) {
    throw new FinanceValidationError(
      "FINANCE_EVENT_KIND_INVALID",
      `kind must be one of ${EVENT_KINDS.join(", ")}`,
    );
  }
  return value as FinanceEventKind;
}

function parseBillingMode(value: unknown, field: string): BillingMode {
  if (typeof value !== "string" || !(BILLING_MODES as readonly string[]).includes(value)) {
    throw new FinanceValidationError(
      "FINANCE_BILLING_MODE_INVALID",
      `${field} must be one of ${BILLING_MODES.join(", ")}`,
    );
  }
  return value as BillingMode;
}

function parseBillingCycle(value: unknown, field: string): BillingCycle {
  if (typeof value !== "string" || !(BILLING_CYCLES as readonly string[]).includes(value)) {
    throw new FinanceValidationError(
      "FINANCE_BILLING_CYCLE_INVALID",
      `${field} must be one of ${BILLING_CYCLES.join(", ")}`,
    );
  }
  return value as BillingCycle;
}

function parseAdjustmentTarget(value: unknown, field: string): AdjustmentTarget {
  if (typeof value !== "string" || !(ADJUSTMENT_TARGETS as readonly string[]).includes(value)) {
    throw new FinanceValidationError(
      "FINANCE_ADJUSTMENT_TARGET_INVALID",
      `${field} must be one of ${ADJUSTMENT_TARGETS.join(", ")}`,
    );
  }
  return value as AdjustmentTarget;
}

export function parseTimeWindow(value: unknown, field: string): TimeWindow {
  if (!isRecord(value)) {
    throw new FinanceValidationError("FINANCE_WINDOW_INVALID", `${field} must be an object`);
  }
  const from = requireString(value.from, `${field}.from`, 20, 40);
  const to = requireString(value.to, `${field}.to`, 20, 40);
  parseUtc(from, `${field}.from`);
  parseUtc(to, `${field}.to`);
  if (parseUtc(to, `${field}.to`).getTime() < parseUtc(from, `${field}.from`).getTime()) {
    throw new FinanceValidationError(
      "FINANCE_WINDOW_INVALID",
      `${field}.to must be >= ${field}.from`,
    );
  }
  return { from, to };
}

export function parseFinanceEvent(value: unknown, path = "event"): FinanceEvent {
  if (!isRecord(value)) {
    throw new FinanceValidationError("FINANCE_EVENT_INVALID", `${path} must be an object`);
  }
  rejectSecretKeys(value, path);
  for (const key of Object.keys(value)) {
    if (!EVENT_KEYS.has(key)) {
      throw new FinanceValidationError(
        "FINANCE_EVENT_UNKNOWN_KEY",
        `${path} has unknown key ${key}`,
      );
    }
  }

  const id = requireString(value.id, `${path}.id`, 1, 128);
  if (!RESOURCE_ID_PATTERN.test(id)) {
    throw new FinanceValidationError(
      "FINANCE_EVENT_ID_INVALID",
      `${path}.id must match cc:<type>:<id>`,
    );
  }
  const idempotency_key = requireString(value.idempotency_key, `${path}.idempotency_key`, 1, 256);
  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotency_key)) {
    throw new FinanceValidationError(
      "FINANCE_IDEMPOTENCY_KEY_INVALID",
      `${path}.idempotency_key has invalid characters`,
    );
  }
  const kind = parseKind(value.kind);
  const occurred_at = requireString(value.occurred_at, `${path}.occurred_at`, 20, 40);
  parseUtc(occurred_at, `${path}.occurred_at`);
  if (typeof value.amount_cents !== "number") {
    throw new FinanceValidationError(
      "FINANCE_MONEY_NOT_INTEGER",
      `${path}.amount_cents must be a number`,
    );
  }
  const amount_cents = assertCents(value.amount_cents, `${path}.amount_cents`);
  if (kind !== "manual_adjustment" && amount_cents < 0) {
    throw new FinanceValidationError(
      "FINANCE_MONEY_NEGATIVE",
      `${path}.amount_cents must be non-negative for kind ${kind}`,
    );
  }
  const currency = assertCurrency(
    requireString(value.currency, `${path}.currency`, 3, 3),
    `${path}.currency`,
  );
  const client_id = requireString(value.client_id, `${path}.client_id`, 1, 64);
  const obligation_id = requireString(value.obligation_id, `${path}.obligation_id`, 1, 128);
  const billing_mode = parseBillingMode(value.billing_mode, `${path}.billing_mode`);
  if (typeof value.settlement_proven !== "boolean") {
    throw new FinanceValidationError(
      "FINANCE_SETTLEMENT_FLAG_INVALID",
      `${path}.settlement_proven must be boolean`,
    );
  }
  if (kind === "settlement_received" && value.settlement_proven !== true) {
    throw new FinanceValidationError(
      "FINANCE_SETTLEMENT_FLAG_INVALID",
      `${path}.settlement_proven must be true for settlement_received`,
    );
  }
  if (kind === "payment_confirmed" && value.settlement_proven === true) {
    throw new FinanceValidationError(
      "FINANCE_SETTLEMENT_FLAG_INVALID",
      `${path}.settlement_proven must be false for payment_confirmed (paid is not caixa)`,
    );
  }
  const source = parseSourceRef(value.source, `${path}.source`);
  const observed_at = requireString(value.observed_at, `${path}.observed_at`, 20, 40);
  parseUtc(observed_at, `${path}.observed_at`);
  const freshness_status = parseFreshness(value.freshness_status, `${path}.freshness_status`);
  const confidence = parseConfidence(value.confidence, `${path}.confidence`);

  const event: FinanceEvent = {
    id,
    idempotency_key,
    kind,
    occurred_at,
    amount_cents,
    currency,
    client_id,
    obligation_id,
    billing_mode,
    settlement_proven: value.settlement_proven,
    source,
    observed_at,
    freshness_status,
    confidence,
  };

  if (value.billing_cycle !== undefined) {
    event.billing_cycle = parseBillingCycle(value.billing_cycle, `${path}.billing_cycle`);
  }
  if (value.offer_code !== undefined) {
    event.offer_code = requireString(value.offer_code, `${path}.offer_code`, 1, 64);
  }
  if (value.invoice_id !== undefined) {
    event.invoice_id = requireString(value.invoice_id, `${path}.invoice_id`, 1, 128);
  }
  if (value.contract_id !== undefined) {
    event.contract_id = requireString(value.contract_id, `${path}.contract_id`, 1, 128);
  }
  if (value.due_at !== undefined) {
    if (value.due_at === null) {
      event.due_at = null;
    } else {
      const due = requireString(value.due_at, `${path}.due_at`, 20, 40);
      parseUtc(due, `${path}.due_at`);
      event.due_at = due;
    }
  }
  if (value.adjustment_target !== undefined) {
    event.adjustment_target = parseAdjustmentTarget(
      value.adjustment_target,
      `${path}.adjustment_target`,
    );
  }
  if (kind === "manual_adjustment" && event.adjustment_target === undefined) {
    throw new FinanceValidationError(
      "FINANCE_ADJUSTMENT_TARGET_INVALID",
      `${path}.adjustment_target is required for manual_adjustment`,
    );
  }
  if (value.notes !== undefined) {
    event.notes = requireString(value.notes, `${path}.notes`, 1, 512);
  }
  return event;
}

export function parseFixtureDocument(value: unknown): FixtureDocument {
  if (!isRecord(value)) {
    throw new FinanceValidationError("FINANCE_FIXTURE_INVALID", "fixture must be an object");
  }
  rejectSecretKeys(value, "fixture");
  const id = requireString(value.id, "fixture.id", 1, 128);
  const as_of = requireString(value.as_of, "fixture.as_of", 20, 40);
  parseUtc(as_of, "fixture.as_of");
  const cash_in_window = parseTimeWindow(value.cash_in_window, "fixture.cash_in_window");
  if (!Array.isArray(value.events)) {
    throw new FinanceValidationError("FINANCE_FIXTURE_INVALID", "fixture.events must be an array");
  }
  const events = value.events.map((event, index) => parseFinanceEvent(event, `events[${index}]`));
  const doc: FixtureDocument = { id, as_of, cash_in_window, events };
  if (value.freshness_window_seconds !== undefined) {
    if (
      typeof value.freshness_window_seconds !== "number" ||
      !Number.isInteger(value.freshness_window_seconds) ||
      value.freshness_window_seconds < 0
    ) {
      throw new FinanceValidationError(
        "FINANCE_FRESHNESS_WINDOW_INVALID",
        "freshness_window_seconds must be a non-negative integer",
      );
    }
    doc.freshness_window_seconds = value.freshness_window_seconds;
  }
  return doc;
}

const ADJUSTMENT_KEYS = new Set([
  "idempotency_key",
  "target",
  "amount_cents",
  "currency",
  "reason",
  "created_by",
  "effective_at",
  "source",
  "observed_at",
  "freshness_status",
  "confidence",
  "obligation_id",
  "client_id",
  "billing_mode",
  "billing_cycle",
  "offer_code",
  "provider_mutation",
]);

export function parseManualAdjustmentInput(value: unknown): ManualAdjustmentInput {
  if (!isRecord(value)) {
    throw new FinanceValidationError(
      "FINANCE_ADJUSTMENT_INVALID",
      "manual adjustment must be an object",
    );
  }
  rejectSecretKeys(value, "adjustment");
  for (const key of Object.keys(value)) {
    if (!ADJUSTMENT_KEYS.has(key)) {
      throw new FinanceValidationError(
        "FINANCE_ADJUSTMENT_UNKNOWN_KEY",
        `adjustment has unknown key ${key}`,
      );
    }
  }
  if (value.provider_mutation !== undefined && value.provider_mutation !== "forbidden") {
    throw new FinanceValidationError(
      "FINANCE_PROVIDER_MUTATION_FORBIDDEN",
      "manual adjustments must not request a provider mutation",
    );
  }
  const idempotency_key = requireString(value.idempotency_key, "idempotency_key", 1, 256);
  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotency_key)) {
    throw new FinanceValidationError(
      "FINANCE_IDEMPOTENCY_KEY_INVALID",
      "idempotency_key has invalid characters",
    );
  }
  if (typeof value.amount_cents !== "number") {
    throw new FinanceValidationError("FINANCE_MONEY_NOT_INTEGER", "amount_cents must be a number");
  }
  const input: ManualAdjustmentInput = {
    idempotency_key,
    target: parseAdjustmentTarget(value.target, "target"),
    amount_cents: assertCents(value.amount_cents, "amount_cents"),
    currency: assertCurrency(requireString(value.currency, "currency", 3, 3), "currency"),
    reason: requireString(value.reason, "reason", 1, 512),
    created_by: parseActorRef(value.created_by, "created_by"),
    effective_at: requireString(value.effective_at, "effective_at", 20, 40),
    source: parseSourceRef(value.source, "source"),
    observed_at: requireString(value.observed_at, "observed_at", 20, 40),
    freshness_status: parseFreshness(value.freshness_status, "freshness_status"),
    confidence: parseConfidence(value.confidence, "confidence"),
    obligation_id: requireString(value.obligation_id, "obligation_id", 1, 128),
    client_id: requireString(value.client_id, "client_id", 1, 64),
    provider_mutation: "forbidden",
  };
  parseUtc(input.effective_at, "effective_at");
  parseUtc(input.observed_at, "observed_at");
  if (value.billing_mode !== undefined) {
    input.billing_mode = parseBillingMode(value.billing_mode, "billing_mode");
  }
  if (value.billing_cycle !== undefined) {
    input.billing_cycle = parseBillingCycle(value.billing_cycle, "billing_cycle");
  }
  if (value.offer_code !== undefined) {
    input.offer_code = requireString(value.offer_code, "offer_code", 1, 64);
  }
  return input;
}
