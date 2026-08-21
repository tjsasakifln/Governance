import { ValidationError } from "./errors.js";
import {
  ACTOR_ID_RE,
  ACTOR_KINDS,
  ATTENTION_SEVERITIES,
  ATTENTION_STATUSES,
  CURRENCY_RE,
  FORBIDDEN_SECRET_KEY_RE,
  FRESHNESS_STATUSES,
  OVERRIDE_ACTIONS,
  RESOURCE_ID_RE,
  SCOPE_RE,
  SIGNAL_CATEGORIES,
  SIGNAL_DOMAINS,
  SOURCE_KIND_RE,
  SOURCE_SYSTEM_RE,
  UTC_DATETIME_RE,
  type AttentionSeverity,
  type AttentionStatus,
  type FreshnessStatus,
  type OverrideAction,
  type SignalCategory,
  type SignalDomain,
} from "./taxonomy.js";
import type {
  ActorRef,
  AttentionSignal,
  EvidenceRef,
  FounderOverride,
  Money,
  Provenance,
  RankInput,
  ScoringConfigPatch,
  SourceRef,
  UnknownRankRequest,
} from "./types.js";
import { mergeScoringConfig } from "./default-config.js";

const TITLE_MAX = 200;
const SUMMARY_MAX = 2000;
const LOCATOR_MAX = 512;
const CORRELATION_MAX = 128;
const ACTION_MAX = 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertNoSecretKeys(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoSecretKeys(item, `${path}[${i}]`));
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_SECRET_KEY_RE.test(key)) {
      throw new ValidationError("forbidden secret-bearing key", `${path}.${key}`);
    }
    assertNoSecretKeys(child, `${path}.${key}`);
  }
}

function expectString(value: unknown, path: string, min = 1, max = 512): string {
  if (typeof value !== "string") {
    throw new ValidationError("expected string", path);
  }
  const trimmed = value.trim();
  if (trimmed.length < min || value.length > max) {
    throw new ValidationError(`string length must be ${min}..${max}`, path);
  }
  return value;
}

function expectInt(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new ValidationError(`expected integer in ${min}..${max}`, path);
  }
  return value;
}

function expectEnum<T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[],
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new ValidationError(`expected one of ${allowed.join("|")}`, path);
  }
  return value as T;
}

function parseSourceRef(value: unknown, path: string): SourceRef {
  if (!isRecord(value)) {
    throw new ValidationError("expected source object", path);
  }
  const system = expectString(value.system, `${path}.system`, 1, 64);
  if (!SOURCE_SYSTEM_RE.test(system)) {
    throw new ValidationError("invalid source.system", `${path}.system`);
  }
  const kind = expectString(value.kind, `${path}.kind`, 1, 64);
  if (!SOURCE_KIND_RE.test(kind)) {
    throw new ValidationError("invalid source.kind", `${path}.kind`);
  }
  const locator = expectString(value.locator, `${path}.locator`, 1, LOCATOR_MAX);
  const ref: SourceRef = { system, kind, locator };
  if (value.label !== undefined) {
    ref.label = expectString(value.label, `${path}.label`, 1, 128);
  }
  return ref;
}

function parseProvenance(value: unknown, path: string): Provenance {
  if (!isRecord(value)) {
    throw new ValidationError("expected provenance object", path);
  }
  const observed_at = expectString(value.observed_at, `${path}.observed_at`, 20, 40);
  if (!UTC_DATETIME_RE.test(observed_at)) {
    throw new ValidationError("observed_at must be UTC RFC3339 with Z", `${path}.observed_at`);
  }
  const freshness_status = expectEnum<FreshnessStatus>(
    value.freshness_status,
    `${path}.freshness_status`,
    FRESHNESS_STATUSES,
  );
  if (typeof value.confidence !== "number" || Number.isNaN(value.confidence) || value.confidence < 0 || value.confidence > 1) {
    throw new ValidationError("confidence must be a number in [0, 1]", `${path}.confidence`);
  }
  const provenance: Provenance = {
    source: parseSourceRef(value.source, `${path}.source`),
    observed_at,
    freshness_status,
    confidence: value.confidence,
  };
  if (value.freshness_window_seconds !== undefined) {
    provenance.freshness_window_seconds = expectInt(
      value.freshness_window_seconds,
      `${path}.freshness_window_seconds`,
      0,
      2_592_000,
    );
  }
  return provenance;
}

function parseMoney(value: unknown, path: string): Money {
  if (!isRecord(value)) {
    throw new ValidationError("expected money object", path);
  }
  const amount_cents = expectInt(value.amount_cents, `${path}.amount_cents`, -1_000_000_000_000, 1_000_000_000_000);
  const currency = expectString(value.currency, `${path}.currency`, 3, 3);
  if (!CURRENCY_RE.test(currency)) {
    throw new ValidationError("currency must be ISO-4217 (A-Z{3})", `${path}.currency`);
  }
  return { amount_cents, currency };
}

function parseEvidenceRef(value: unknown, path: string): EvidenceRef {
  if (!isRecord(value)) {
    throw new ValidationError("expected evidence ref object", path);
  }
  const ref: EvidenceRef = { source: parseSourceRef(value.source, `${path}.source`) };
  if (value.note !== undefined) {
    ref.note = expectString(value.note, `${path}.note`, 1, 256);
  }
  return ref;
}

function parseActor(value: unknown, path: string): ActorRef {
  if (!isRecord(value)) {
    throw new ValidationError("expected actor object", path);
  }
  const kind = expectEnum(value.kind, `${path}.kind`, ACTOR_KINDS);
  const id = expectString(value.id, `${path}.id`, 1, 128);
  if (!ACTOR_ID_RE.test(id)) {
    throw new ValidationError("invalid actor id", `${path}.id`);
  }
  const actor: ActorRef = { kind, id };
  if (value.display_name !== undefined) {
    actor.display_name = expectString(value.display_name, `${path}.display_name`, 1, 128);
  }
  return actor;
}

export function parseSignal(value: unknown, path: string): AttentionSignal {
  if (!isRecord(value)) {
    throw new ValidationError("expected signal object", path);
  }
  assertNoSecretKeys(value, path);
  const id = expectString(value.id, `${path}.id`, 6, 128);
  if (!RESOURCE_ID_RE.test(id)) {
    throw new ValidationError("id must match cc:<type>:<slug>", `${path}.id`);
  }
  const scope = expectString(value.scope, `${path}.scope`, 2, 128);
  if (!SCOPE_RE.test(scope)) {
    throw new ValidationError("invalid scope", `${path}.scope`);
  }
  const correlation_key = expectString(value.correlation_key, `${path}.correlation_key`, 1, CORRELATION_MAX);
  if (!Array.isArray(value.evidence_refs) || value.evidence_refs.length < 1 || value.evidence_refs.length > 32) {
    throw new ValidationError("evidence_refs must be a non-empty array of at most 32", `${path}.evidence_refs`);
  }
  const signal: AttentionSignal = {
    id,
    title: expectString(value.title, `${path}.title`, 1, TITLE_MAX),
    summary: expectString(value.summary, `${path}.summary`, 1, SUMMARY_MAX),
    category: expectEnum<SignalCategory>(value.category, `${path}.category`, SIGNAL_CATEGORIES),
    domain: expectEnum<SignalDomain>(value.domain, `${path}.domain`, SIGNAL_DOMAINS),
    scope,
    impact: expectInt(value.impact, `${path}.impact`, 0, 100),
    urgency: expectInt(value.urgency, `${path}.urgency`, 0, 100),
    severity: expectEnum<AttentionSeverity>(value.severity, `${path}.severity`, ATTENTION_SEVERITIES),
    status: expectEnum<AttentionStatus>(value.status, `${path}.status`, ATTENTION_STATUSES),
    correlation_key,
    evidence_refs: value.evidence_refs.map((ref, i) => parseEvidenceRef(ref, `${path}.evidence_refs[${i}]`)),
    provenance: parseProvenance(value.provenance, `${path}.provenance`),
  };
  if (value.money !== undefined) {
    signal.money = parseMoney(value.money, `${path}.money`);
  }
  if (value.recommended_action !== undefined) {
    signal.recommended_action = expectString(
      value.recommended_action,
      `${path}.recommended_action`,
      1,
      ACTION_MAX,
    );
  }
  if (value.related_ids !== undefined) {
    if (!Array.isArray(value.related_ids) || value.related_ids.length > 32) {
      throw new ValidationError("related_ids must be an array of at most 32", `${path}.related_ids`);
    }
    signal.related_ids = value.related_ids.map((rid, i) => {
      const s = expectString(rid, `${path}.related_ids[${i}]`, 6, 128);
      if (!RESOURCE_ID_RE.test(s)) {
        throw new ValidationError("invalid related id", `${path}.related_ids[${i}]`);
      }
      return s;
    });
  }
  return signal;
}

function parseOverride(value: unknown, path: string): FounderOverride {
  if (!isRecord(value)) {
    throw new ValidationError("expected override object", path);
  }
  assertNoSecretKeys(value, path);
  const at = expectString(value.at, `${path}.at`, 20, 40);
  if (!UTC_DATETIME_RE.test(at)) {
    throw new ValidationError("override.at must be UTC RFC3339 with Z", `${path}.at`);
  }
  if (!Array.isArray(value.target_ids) || value.target_ids.length < 1 || value.target_ids.length > 16) {
    throw new ValidationError("target_ids must be a non-empty array of at most 16", `${path}.target_ids`);
  }
  return {
    actor: parseActor(value.actor, `${path}.actor`),
    at,
    action: expectEnum<OverrideAction>(value.action, `${path}.action`, OVERRIDE_ACTIONS),
    target_ids: value.target_ids.map((id, i) => {
      const s = expectString(id, `${path}.target_ids[${i}]`, 6, 128);
      if (!RESOURCE_ID_RE.test(s)) {
        throw new ValidationError("invalid target id", `${path}.target_ids[${i}]`);
      }
      return s;
    }),
  };
}

function parsePartialConfig(value: unknown, path: string): ScoringConfigPatch {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    throw new ValidationError("expected config object", path);
  }
  assertNoSecretKeys(value, path);
  return value as ScoringConfigPatch;
}

export function parseRankRequest(value: unknown): RankInput {
  if (!isRecord(value)) {
    throw new ValidationError("request must be an object", "$");
  }
  assertNoSecretKeys(value, "$");
  const req = value as UnknownRankRequest & Record<string, unknown>;
  if (!Array.isArray(req.signals)) {
    throw new ValidationError("signals must be an array", "$.signals");
  }
  if (req.signals.length > 500) {
    throw new ValidationError("signals exceeds 500", "$.signals");
  }
  const signals = req.signals.map((s, i) => parseSignal(s, `$.signals[${i}]`));
  const seen = new Set<string>();
  for (const signal of signals) {
    if (seen.has(signal.id)) {
      throw new ValidationError(`duplicate signal id ${signal.id}`, "$.signals");
    }
    seen.add(signal.id);
  }
  let clock_now: string;
  if (req.now === undefined) {
    clock_now = new Date().toISOString();
  } else {
    clock_now = expectString(req.now, "$.now", 20, 40);
    if (!UTC_DATETIME_RE.test(clock_now)) {
      throw new ValidationError("now must be UTC RFC3339 with Z", "$.now");
    }
  }
  const config = mergeScoringConfig(parsePartialConfig(req.config, "$.config"));
  let override: FounderOverride | null = null;
  if (req.override !== undefined && req.override !== null) {
    override = parseOverride(req.override, "$.override");
  }
  return { signals, config, clock_now, override };
}
