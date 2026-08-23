import { ATTACK_IDS, type AttackId } from "./attacks.js";
import {
  asArray,
  asBoolean,
  asNumber,
  asRecord,
  asString,
  type QaRuntimePort,
} from "./adapters.js";
import { isForbiddenProviderOperation } from "./forbidden.js";
import type { AttackVerdict, VerdictState } from "./types.js";
import { isUtcZ, parseUtcMs, saoPauloCalendarDate, utcCalendarDate } from "./utc.js";

function verdict(
  attackId: AttackId,
  state: VerdictState,
  reason: string,
  evidence: Record<string, unknown> = {},
): AttackVerdict {
  return { attack_id: attackId, state, reason, evidence };
}

function unknownShape(attackId: AttackId, detail: string): AttackVerdict {
  return verdict(attackId, "UNKNOWN", `payload shape unusable: ${detail}`, {
    usable: false,
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return asRecord(value) !== null;
}

const HEALTHY_PRESENTATIONS = new Set(["healthy", "FRESH", "fresh", "ok", "saudável"]);
const STALE_OR_BAD = new Set(["STALE", "UNKNOWN", "ERROR", "stale", "unknown", "error"]);

/**
 * stale data mostrado como saudável
 * Fail when a record is presented as healthy/FRESH while freshness is not FRESH,
 * or while observed_at is outside the freshness window relative to as_of.
 */
export function evaluateStaleDataShownAsHealthy(payload: unknown): AttackVerdict {
  const id = "stale data mostrado como saudável";
  const rec = asRecord(payload);
  if (!rec) {
    return unknownShape(id, "expected object");
  }
  const asOf = asString(rec.as_of);
  const records = asArray(rec.records);
  if (!asOf || !records) {
    return unknownShape(id, "as_of and records[] required");
  }
  if (records.length === 0) {
    return verdict(id, "UNKNOWN", "no presentation sample was available to inspect", {
      inspected: 0,
      sample_status: "absent",
    });
  }
  const offenders: string[] = [];
  for (const item of records) {
    const row = asRecord(item);
    if (!row) {
      offenders.push("(malformed record)");
      continue;
    }
    const rowId = asString(row.id) ?? "(unnamed)";
    const freshness = asString(row.freshness_status) ?? "";
    const presented = asString(row.presented_as) ?? "";
    const health = asString(row.health_status) ?? "";
    const presentedHealthy =
      HEALTHY_PRESENTATIONS.has(presented) || HEALTHY_PRESENTATIONS.has(health);
    if (!presentedHealthy) {
      continue;
    }
    if (STALE_OR_BAD.has(freshness) || freshness !== "FRESH") {
      offenders.push(rowId);
      continue;
    }
    const windowSec = asNumber(row.freshness_window_seconds);
    const observed = asString(row.observed_at);
    if (windowSec !== null && observed) {
      const observedMs = Date.parse(observed);
      const asOfMs = Date.parse(asOf);
      if (!Number.isNaN(observedMs) && !Number.isNaN(asOfMs)) {
        if (asOfMs - observedMs > windowSec * 1000) {
          offenders.push(rowId);
        }
      }
    }
  }
  if (offenders.length > 0) {
    return verdict(id, "fail", "stale or expired observation presented as healthy", {
      offender_ids: offenders,
    });
  }
  return verdict(id, "pass", "no healthy presentation of stale/expired data", {
    inspected: records.length,
  });
}

/**
 * double counting financeiro
 * Money is integer cents + currency. Same source_payment_id must not feed a
 * reported total twice, nor sit in both open and overdue.
 */
export function evaluateDoubleCountingFinanceiro(payload: unknown): AttackVerdict {
  const id = "double counting financeiro";
  const rec = asRecord(payload);
  if (!rec) {
    return unknownShape(id, "expected object");
  }
  const lines = asArray(rec.lines);
  const reported = asRecord(rec.reported_totals);
  if (!lines || !reported) {
    return unknownShape(id, "lines[] and reported_totals required");
  }
  const bySource = new Map<string, Array<{ cents: number; currency: string; bucket: string }>>();
  const issues: string[] = [];
  let mixedCurrency = false;
  const currencies = new Set<string>();

  for (const item of lines) {
    const row = asRecord(item);
    if (!row) {
      issues.push("malformed line");
      continue;
    }
    const sourceId = asString(row.source_payment_id);
    const cents = asNumber(row.amount_cents);
    const currency = asString(row.currency);
    const bucket = asString(row.bucket) ?? "other";
    if (!sourceId || cents === null || !Number.isInteger(cents) || !currency) {
      issues.push("line missing source_payment_id / integer cents / currency");
      continue;
    }
    currencies.add(currency);
    const arr = bySource.get(sourceId) ?? [];
    arr.push({ cents, currency, bucket });
    bySource.set(sourceId, arr);
  }
  if (currencies.size > 1) {
    mixedCurrency = true;
    issues.push("mixed currencies in one ledger");
  }

  const duplicateIds: string[] = [];
  const openAndOverdue: string[] = [];
  for (const [sourceId, entries] of bySource.entries()) {
    if (entries.length > 1) {
      duplicateIds.push(sourceId);
    }
    const buckets = new Set(entries.map((e) => e.bucket));
    if (buckets.has("open") && buckets.has("overdue")) {
      openAndOverdue.push(sourceId);
    }
  }

  const sumUnique = (bucket: string): number => {
    let total = 0;
    for (const entries of bySource.values()) {
      const inBucket = entries.filter((e) => e.bucket === bucket);
      if (inBucket.length === 1) {
        const first = inBucket[0];
        if (first) {
          total += first.cents;
        }
      } else if (inBucket.length > 1) {
        const first = inBucket[0];
        if (first) {
          total += first.cents;
        }
      }
    }
    return total;
  };

  const reportedOpen = asNumber(reported.receivables_open_cents);
  const reportedOverdue = asNumber(reported.receivables_overdue_cents);

  const uniqueOpen = sumUnique("open");
  const uniqueOverdue = sumUnique("overdue");
  let rawOpen = 0;
  for (const item of lines) {
    const row = asRecord(item);
    if (!row || asString(row.bucket) !== "open") {
      continue;
    }
    rawOpen += asNumber(row.amount_cents) ?? 0;
  }

  const doubleCountedOpen =
    reportedOpen !== null && rawOpen === reportedOpen && uniqueOpen !== rawOpen;
  const reportedMatchesInflated =
    (reportedOpen !== null && reportedOpen === rawOpen && duplicateIds.length > 0) ||
    (reportedOverdue !== null && reportedOverdue !== uniqueOverdue && duplicateIds.length > 0);

  if (
    duplicateIds.length > 0 ||
    openAndOverdue.length > 0 ||
    mixedCurrency ||
    doubleCountedOpen ||
    reportedMatchesInflated ||
    issues.length > 0
  ) {
    const isAttack =
      duplicateIds.length > 0 ||
      openAndOverdue.length > 0 ||
      mixedCurrency ||
      doubleCountedOpen ||
      reportedMatchesInflated;
    if (isAttack) {
      return verdict(id, "fail", "financial amounts counted more than once", {
        duplicate_source_payment_ids: duplicateIds,
        open_and_overdue: openAndOverdue,
        mixed_currency: mixedCurrency,
        unique_open_cents: uniqueOpen,
        raw_open_cents: rawOpen,
        reported_open_cents: reportedOpen,
      });
    }
  }

  if (
    reportedOpen !== null &&
    reportedOpen !== uniqueOpen &&
    duplicateIds.length === 0
  ) {
    return verdict(id, "fail", "reported open total does not match unique source lines", {
      unique_open_cents: uniqueOpen,
      reported_open_cents: reportedOpen,
    });
  }
  if (
    reportedOverdue !== null &&
    reportedOverdue !== uniqueOverdue &&
    duplicateIds.length === 0
  ) {
    return verdict(id, "fail", "reported overdue total does not match unique source lines", {
      unique_overdue_cents: uniqueOverdue,
      reported_overdue_cents: reportedOverdue,
    });
  }

  return verdict(id, "pass", "ledger lines are unique per source_payment_id and match totals", {
    sources: bySource.size,
  });
}

/**
 * hypothesis promovida a fact
 * A hypothesis may become a fact only via human founder promotion with audit.
 * Agent-authored facts that originated as hypotheses, or hypotheses presented
 * as facts, fail.
 */
export function evaluateHypothesisPromotedToFact(payload: unknown): AttackVerdict {
  const id = "hypothesis promovida a fact";
  const rec = asRecord(payload);
  if (!rec) {
    return unknownShape(id, "expected object");
  }
  const directives = asArray(rec.directives);
  if (!directives) {
    return unknownShape(id, "directives[] required");
  }
  const offenders: string[] = [];
  for (const item of directives) {
    const d = asRecord(item);
    if (!d) {
      continue;
    }
    const dirId = asString(d.id) ?? "(unnamed)";
    const kind = asString(d.kind);
    const originKind = asString(d.origin_kind);
    const presentedAs = asString(d.presented_as) ?? asString(d.consumer_treats_as);
    const promotedBy = asRecord(d.promoted_by);
    const promotedKind = promotedBy ? asString(promotedBy.kind) : null;
    const audit = asArray(d.audit) ?? [];
    const humanPromotion = audit.some((entry) => {
      const e = asRecord(entry);
      if (!e) {
        return false;
      }
      const actor = asRecord(e.actor);
      const action = asString(e.action);
      return (
        actor !== null &&
        asString(actor.kind) === "human" &&
        (action === "promoted_to_fact" || action === "kind_changed")
      );
    });

    if (kind === "hypothesis" && (presentedAs === "fact" || presentedAs === "decision")) {
      offenders.push(dirId);
      continue;
    }
    if (kind === "fact" && originKind === "hypothesis") {
      const humanDidPromote = promotedKind === "human" && humanPromotion;
      if (!humanDidPromote) {
        offenders.push(dirId);
      }
    }
  }
  if (offenders.length > 0) {
    return verdict(id, "fail", "hypothesis treated or stored as fact without human promotion", {
      offender_ids: offenders,
    });
  }
  return verdict(id, "pass", "hypotheses remain hypotheses unless a human promoted them", {
    inspected: directives.length,
  });
}

/**
 * agent sobrescrevendo founder decision
 * Founder (human) decisions cannot be superseded, status-changed, or rewritten
 * by an agent.
 */
export function evaluateAgentOverwritingFounderDecision(payload: unknown): AttackVerdict {
  const id = "agent sobrescrevendo founder decision";
  const rec = asRecord(payload);
  if (!rec) {
    return unknownShape(id, "expected object");
  }
  const directives = asArray(rec.directives);
  if (!directives) {
    return unknownShape(id, "directives[] required");
  }

  const byId = new Map<string, Record<string, unknown>>();
  for (const item of directives) {
    const d = asRecord(item);
    if (!d) {
      continue;
    }
    const dirId = asString(d.id);
    if (dirId) {
      byId.set(dirId, d);
    }
  }

  function isFounderDecision(d: Record<string, unknown>): boolean {
    if (asString(d.kind) !== "decision") {
      return false;
    }
    const created = asRecord(d.created_by);
    if (!created) {
      return false;
    }
    const kind = asString(created.kind);
    const role = asString(created.role);
    return kind === "human" && (role === "founder" || role === "executive");
  }

  function actorIsAgent(actor: Record<string, unknown> | null): boolean {
    return actor !== null && asString(actor.kind) === "agent";
  }

  const offenders: string[] = [];
  for (const d of byId.values()) {
    const dirId = asString(d.id) ?? "(unnamed)";
    const created = asRecord(d.created_by);
    const supersedes = asArray(d.supersedes) ?? [];
    if (actorIsAgent(created) && asString(d.kind) === "decision") {
      for (const raw of supersedes) {
        const sid = asString(raw);
        if (!sid) {
          continue;
        }
        const target = byId.get(sid);
        if (target && isFounderDecision(target)) {
          offenders.push(dirId);
        }
      }
    }
    if (isFounderDecision(d)) {
      const audit = asArray(d.audit) ?? [];
      for (const entry of audit) {
        const e = asRecord(entry);
        if (!e) {
          continue;
        }
        const actor = asRecord(e.actor);
        const action = asString(e.action) ?? "";
        if (
          actorIsAgent(actor) &&
          (action === "updated" ||
            action === "status_changed" ||
            action === "superseded" ||
            action === "revoked" ||
            action === "rewritten")
        ) {
          offenders.push(dirId);
        }
      }
      const updatedBy = asRecord(d.updated_by);
      if (actorIsAgent(updatedBy)) {
        offenders.push(dirId);
      }
    }
  }

  const unique = [...new Set(offenders)];
  if (unique.length > 0) {
    return verdict(id, "fail", "agent mutated or superseded a founder decision", {
      offender_ids: unique,
    });
  }
  return verdict(id, "pass", "founder decisions were not overwritten by agents", {
    inspected: byId.size,
  });
}

/**
 * scope leakage entre cliente/repos
 * Agents receive only granted scopes. client:A must not include client:B or
 * repo:X. Parent literals (clients, company) do not grant parameterized children.
 */
export function evaluateScopeLeakage(payload: unknown): AttackVerdict {
  const id = "scope leakage entre cliente/repos";
  const rec = asRecord(payload);
  if (!rec) {
    return unknownShape(id, "expected object");
  }
  const granted = asArray(rec.granted_scopes);
  const resources = asArray(rec.resources);
  if (!granted || !resources) {
    return unknownShape(id, "granted_scopes[] and resources[] required");
  }
  const grantedSet = new Set(
    granted.map((s) => asString(s)).filter((s): s is string => s !== null),
  );
  const leaks: Array<{ id: string; scope: string }> = [];
  for (const item of resources) {
    const row = asRecord(item);
    if (!row) {
      continue;
    }
    const rid = asString(row.id) ?? "(unnamed)";
    const scopes: string[] = [];
    const primary = asString(row.scope);
    if (primary) {
      scopes.push(primary);
    }
    const embedded = asArray(row.embedded_scopes);
    if (embedded) {
      for (const e of embedded) {
        const s = asString(e);
        if (s) {
          scopes.push(s);
        }
      }
    }
    for (const scope of scopes) {
      if (!grantedSet.has(scope)) {
        leaks.push({ id: rid, scope });
      }
    }
  }
  if (leaks.length > 0) {
    return verdict(id, "fail", "resource scope not in granted_scopes", {
      leaks,
      granted_scopes: [...grantedSet],
    });
  }
  return verdict(id, "pass", "all resource scopes are within granted_scopes", {
    granted_count: grantedSet.size,
    resource_count: resources.length,
  });
}

/**
 * duplicated collector event
 * Idempotency: a second event with the same idempotency_key must be skipped,
 * not succeeded/applied again.
 */
export function evaluateDuplicatedCollectorEvent(payload: unknown): AttackVerdict {
  const id = "duplicated collector event";
  const rec = asRecord(payload);
  if (!rec) {
    return unknownShape(id, "expected object");
  }
  const events = asArray(rec.events);
  if (!events) {
    return unknownShape(id, "events[] required");
  }
  const appliedByKey = new Map<string, number>();
  for (const item of events) {
    const row = asRecord(item);
    if (!row) {
      continue;
    }
    const key = asString(row.idempotency_key);
    if (!key) {
      continue;
    }
    const status = asString(row.status);
    const applied = asBoolean(row.applied);
    const counts =
      applied === true || status === "succeeded" || status === "applied";
    if (counts) {
      appliedByKey.set(key, (appliedByKey.get(key) ?? 0) + 1);
    }
  }
  const duplicates = [...appliedByKey.entries()]
    .filter(([, n]) => n > 1)
    .map(([key, n]) => ({ idempotency_key: key, applied_count: n }));
  if (duplicates.length > 0) {
    return verdict(id, "fail", "collector idempotency key applied more than once", {
      duplicates,
    });
  }
  return verdict(id, "pass", "duplicate collector events were skipped, not re-applied", {
    inspected: events.length,
  });
}

/**
 * provider mutation acidental
 * Cobrança, checkout, refund, cancelamento, Asaas writes, commercial send
 * are forbidden. Collectors must remain read_only.
 */
export function evaluateProviderMutationAcidental(payload: unknown): AttackVerdict {
  const id = "provider mutation acidental";
  const rec = asRecord(payload);
  if (!rec) {
    return unknownShape(id, "expected object");
  }
  const operations = asArray(rec.operations) ?? [];
  const collectors = asArray(rec.collectors) ?? [];
  const snapshots = asArray(rec.finance_snapshots) ?? [];
  const hits: string[] = [];

  for (const item of operations) {
    const row = asRecord(item);
    const name = row ? asString(row.name) : asString(item);
    if (name && isForbiddenProviderOperation(name)) {
      hits.push(name);
    }
  }
  for (const item of collectors) {
    const row = asRecord(item);
    if (!row) {
      continue;
    }
    const readOnly = asBoolean(row.read_only);
    if (readOnly === false) {
      hits.push(`collector:${asString(row.name) ?? "unnamed"}:read_only=false`);
    }
  }
  for (const item of snapshots) {
    const row = asRecord(item);
    if (!row) {
      continue;
    }
    const mutations = asString(row.provider_mutations);
    if (mutations && mutations !== "forbidden") {
      hits.push(`finance_snapshot:provider_mutations=${mutations}`);
    }
    if (asBoolean(row.read_model_only) === false) {
      hits.push("finance_snapshot:read_model_only=false");
    }
  }

  if (hits.length > 0) {
    return verdict(id, "fail", "forbidden provider or commercial mutation attempted", {
      operations: hits,
    });
  }
  return verdict(id, "pass", "no forbidden provider mutations; collectors read-only", {
    operations_inspected: operations.length,
  });
}

const SECRET_KEY_RE =
  /(^|_)(secret|token|password|authorization|api_key|apikey|cookie|credential|private_key)(_|$)/i;

const PII_PATTERNS: Array<{ kind: string; re: RegExp }> = [
  { kind: "cpf", re: /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/ },
  { kind: "email", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/ },
  { kind: "sk_live", re: /\bsk_live_[A-Za-z0-9]+\b/ },
  { kind: "sk_test", re: /\bsk_test_[A-Za-z0-9]+\b/ },
  { kind: "github_pat", re: /\b(ghp_|github_pat_)[A-Za-z0-9_]+\b/ },
  { kind: "aws_key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { kind: "bearer", re: /\bBearer\s+\S+/i },
  { kind: "url_secret", re: /[?&](api[_-]?key|token|password|secret|authorization)=/i },
];

function keyLooksSecret(key: string): boolean {
  if (key === "idempotency_key" || key === "request_id" || key === "resource_id") {
    return false;
  }
  const n = key.toLowerCase().replace(/-/g, "_");
  return SECRET_KEY_RE.test(n);
}

function scanLeaks(value: unknown, path: string, hits: Array<{ path: string; kind: string }>): void {
  if (value === null || value === undefined) {
    return;
  }
  if (typeof value === "string") {
    for (const p of PII_PATTERNS) {
      if (p.re.test(value)) {
        hits.push({ path, kind: p.kind });
      }
    }
    return;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => {
      scanLeaks(item, `${path}[${i}]`, hits);
    });
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      const child = path ? `${path}.${k}` : k;
      if (keyLooksSecret(k)) {
        hits.push({ path: child, kind: "secret_key" });
      }
      scanLeaks(v, child, hits);
    }
  }
}

/**
 * secret/PII leakage
 * Never echo secret values in evidence — paths and kinds only.
 */
export function evaluateSecretPiiLeakage(payload: unknown): AttackVerdict {
  const id = "secret/PII leakage";
  const rec = asRecord(payload);
  if (!rec) {
    return unknownShape(id, "expected object");
  }
  const surfaces = rec.surfaces ?? rec;
  const hits: Array<{ path: string; kind: string }> = [];
  scanLeaks(surfaces, "surfaces", hits);
  if (hits.length > 0) {
    return verdict(id, "fail", "secret or PII present in log, URL, or payload surface", {
      leaked_paths: hits.map((h) => h.path),
      kinds: [...new Set(hits.map((h) => h.kind))],
    });
  }
  return verdict(id, "pass", "no secret keys or PII patterns on inspected surfaces", {
    inspected: true,
  });
}

/**
 * timezone boundary
 * Internal timestamps must be UTC with Z. Presented America/Sao_Paulo calendar
 * dates must match the instant converted to that zone, not the UTC date.
 */
export function evaluateTimezoneBoundary(payload: unknown): AttackVerdict {
  const id = "timezone boundary";
  const rec = asRecord(payload);
  if (!rec) {
    return unknownShape(id, "expected object");
  }
  const instants = asArray(rec.instants);
  if (!instants) {
    return unknownShape(id, "instants[] required");
  }
  const offenders: string[] = [];
  for (const item of instants) {
    const row = asRecord(item);
    if (!row) {
      continue;
    }
    const rowId = asString(row.id) ?? "(unnamed)";
    const observed = asString(row.observed_at) ?? asString(row.timestamp);
    if (!observed) {
      offenders.push(rowId);
      continue;
    }
    if (!isUtcZ(observed)) {
      offenders.push(rowId);
      continue;
    }
    const presented = asString(row.presented_calendar_date);
    if (presented) {
      const sp = saoPauloCalendarDate(observed);
      if (sp && presented !== sp) {
        offenders.push(rowId);
        continue;
      }
    }
    const classifiedUtc = asBoolean(row.classified_using_utc_calendar);
    if (classifiedUtc === true) {
      const utcDay = utcCalendarDate(observed);
      const spDay = saoPauloCalendarDate(observed);
      if (utcDay && spDay && utcDay !== spDay) {
        offenders.push(rowId);
      }
    }
  }
  if (offenders.length > 0) {
    return verdict(
      id,
      "fail",
      "timestamp is not UTC Z or calendar date ignores America/Sao_Paulo",
      { offender_ids: offenders },
    );
  }
  return verdict(id, "pass", "instants are UTC Z and presentation matches America/Sao_Paulo", {
    inspected: instants.length,
  });
}

const BAD_COMPONENT = new Set(["down", "error", "ERROR", "failed", "degraded", "unknown", "UNKNOWN"]);

/**
 * partial outage
 * Overall healthy/success is forbidden while a required source or check is
 * down, failed, or ERROR.
 */
export function evaluatePartialOutage(payload: unknown): AttackVerdict {
  const id = "partial outage";
  const rec = asRecord(payload);
  if (!rec) {
    return unknownShape(id, "expected object");
  }
  const overall = asString(rec.overall_status) ?? asString(rec.status) ?? "";
  const checks = asArray(rec.checks) ?? [];
  const sources = asArray(rec.required_sources) ?? [];
  const runs = asArray(rec.collector_runs) ?? [];
  const overallHealthy = HEALTHY_PRESENTATIONS.has(overall) || overall === "succeeded" || overall === "healthy";
  const bad: string[] = [];

  for (const item of checks) {
    const row = asRecord(item);
    if (!row) {
      continue;
    }
    const status = asString(row.status) ?? "";
    if (BAD_COMPONENT.has(status) || status === "down") {
      bad.push(asString(row.name) ?? "check");
    }
  }
  for (const item of sources) {
    const row = asRecord(item);
    if (!row) {
      continue;
    }
    const status = asString(row.status) ?? asString(row.freshness_status) ?? "";
    if (BAD_COMPONENT.has(status) || status === "failed") {
      bad.push(asString(row.name) ?? asString(row.system) ?? "source");
    }
  }
  for (const item of runs) {
    const row = asRecord(item);
    if (!row) {
      continue;
    }
    const status = asString(row.status);
    const err = row.error;
    if (status === "succeeded" && err !== undefined && err !== null) {
      bad.push(`collector:${asString(row.collector_name) ?? "unnamed"}:succeeded-with-error`);
    }
    if (status === "failed" && overallHealthy) {
      bad.push(`collector:${asString(row.collector_name) ?? "unnamed"}:failed`);
    }
  }

  if (overallHealthy && bad.length > 0) {
    return verdict(id, "fail", "overall status healthy while a component or source is out", {
      overall_status: overall,
      failed_components: bad,
    });
  }
  return verdict(id, "pass", "overall status reflects component failures", {
    overall_status: overall,
    failed_components: bad,
  });
}

const LIVE_SESSION = new Set(["open", "RUNNING", "running", "in_progress"]);
const DEFAULT_SESSION_TTL_SECONDS = 14400;

/**
 * stale RUNNING agent session
 * Architecture stores live sessions as status `open` (not RUNNING). A still-live
 * session past TTL is this attack.
 */
export function evaluateStaleRunningAgentSession(payload: unknown): AttackVerdict {
  const id = "stale RUNNING agent session";
  const rec = asRecord(payload);
  if (!rec) {
    return unknownShape(id, "expected object");
  }
  const asOf = asString(rec.as_of);
  const sessions = asArray(rec.sessions);
  if (!asOf || !sessions) {
    return unknownShape(id, "as_of and sessions[] required");
  }
  const asOfMs = Date.parse(asOf);
  if (Number.isNaN(asOfMs)) {
    return unknownShape(id, "as_of is not a parseable instant");
  }
  const stale: string[] = [];
  for (const item of sessions) {
    const row = asRecord(item);
    if (!row) {
      continue;
    }
    const sid = asString(row.id) ?? "(unnamed)";
    const status = asString(row.status) ?? "";
    const ended = row.ended_at;
    const live = LIVE_SESSION.has(status) && (ended === null || ended === undefined);
    if (!live) {
      continue;
    }
    const started = asString(row.started_at);
    if (!started) {
      stale.push(sid);
      continue;
    }
    const startedMs = Date.parse(started);
    if (Number.isNaN(startedMs)) {
      stale.push(sid);
      continue;
    }
    const ttl = asNumber(row.ttl_seconds) ?? DEFAULT_SESSION_TTL_SECONDS;
    if (asOfMs - startedMs > ttl * 1000) {
      stale.push(sid);
    }
  }
  if (stale.length > 0) {
    return verdict(id, "fail", "live/open agent session exceeded TTL (stale RUNNING)", {
      offender_ids: stale,
      default_ttl_seconds: DEFAULT_SESSION_TTL_SECONDS,
    });
  }
  return verdict(id, "pass", "no live agent session is past TTL", {
    inspected: sessions.length,
  });
}

/**
 * conflicting directives/supersession
 * Two active directives in the same scope+conflict_key without supersession,
 * or a listed supersedee that is still active, fail.
 */
export function evaluateConflictingDirectives(payload: unknown): AttackVerdict {
  const id = "conflicting directives/supersession";
  const rec = asRecord(payload);
  if (!rec) {
    return unknownShape(id, "expected object");
  }
  const directives = asArray(rec.directives);
  if (!directives) {
    return unknownShape(id, "directives[] required");
  }
  const parsed: Array<{
    id: string;
    scope: string;
    kind: string;
    status: string;
    conflict_key: string;
    supersedes: string[];
  }> = [];
  for (const item of directives) {
    const d = asRecord(item);
    if (!d) {
      continue;
    }
    const dirId = asString(d.id) ?? "";
    parsed.push({
      id: dirId,
      scope: asString(d.scope) ?? "",
      kind: asString(d.kind) ?? "",
      status: asString(d.status) ?? "",
      conflict_key: asString(d.conflict_key) ?? asString(d.title) ?? dirId,
      supersedes: (asArray(d.supersedes) ?? [])
        .map((s) => asString(s))
        .filter((s): s is string => s !== null),
    });
  }
  const byId = new Map(parsed.map((d) => [d.id, d]));
  const issues: string[] = [];

  for (const d of parsed) {
    for (const sid of d.supersedes) {
      const target = byId.get(sid);
      if (target && target.status === "active" && d.status === "active") {
        issues.push(`${d.id} supersedes ${sid} but ${sid} is still active`);
      }
      if (target && d.status === "active" && target.status !== "superseded" && target.status !== "revoked" && target.status !== "expired") {
        if (target.status === "active") {
          // already recorded
        } else if (d.supersedes.includes(sid) && target.status === "draft") {
          issues.push(`${d.id} supersedes ${sid} in non-superseded status ${target.status}`);
        }
      }
    }
  }

  const groups = new Map<string, typeof parsed>();
  for (const d of parsed) {
    if (d.status !== "active") {
      continue;
    }
    const key = `${d.scope}|${d.kind}|${d.conflict_key}`;
    const arr = groups.get(key) ?? [];
    arr.push(d);
    groups.set(key, arr);
  }
  for (const [key, group] of groups.entries()) {
    if (group.length < 2) {
      continue;
    }
    const ids = group.map((g) => g.id);
    const covered = new Set<string>();
    for (const g of group) {
      for (const s of g.supersedes) {
        covered.add(s);
      }
    }
    const unresolved = ids.filter((i) => !covered.has(i));
    if (unresolved.length > 1) {
      issues.push(`concurrent active directives without supersession: ${key}`);
    }
  }

  if (issues.length > 0) {
    return verdict(id, "fail", "conflicting active directives or broken supersession", {
      issues,
    });
  }
  return verdict(id, "pass", "active directives do not conflict; supersedees are not active", {
    inspected: parsed.length,
  });
}

const PRIVILEGED_ACTIONS = new Set([
  "read_company_directives",
  "write_directive",
  "grant_founder",
  "get_context",
  "list_all_memory",
  "admin",
]);

/**
 * auth bypass assumptions
 * Fail-closed: missing actor, unauthenticated privileged action, empty scopes
 * treated as allow-all, hardcoded/anonymous/default identity, assume_founder
 * without founder proof, or a password field in the identity payload.
 */
export function evaluateAuthBypassAssumptions(payload: unknown): AttackVerdict {
  const id = "auth bypass assumptions";
  const rec = asRecord(payload);
  if (!rec) {
    return unknownShape(id, "expected object");
  }
  const issues: string[] = [];
  const authenticated = asBoolean(rec.authenticated);
  const action = asString(rec.action) ?? "get_context";
  const actor = asRecord(rec.actor);
  const actorId = actor ? asString(actor.id) : null;
  const identitySource = asString(rec.identity_source);
  const assumeFounder = asBoolean(rec.assume_founder);
  const emptyMean = asString(rec.empty_scopes_mean);
  const granted = asArray(rec.granted_scopes);
  const password = rec.password;
  const hardcodedSecret = rec.hardcoded_password ?? rec.default_password;

  if (password !== undefined && password !== null && password !== "") {
    issues.push("password present on auth payload");
  }
  if (hardcodedSecret !== undefined && hardcodedSecret !== null) {
    issues.push("hardcoded password field present");
  }
  if (authenticated === false && PRIVILEGED_ACTIONS.has(action)) {
    issues.push("unauthenticated privileged action");
  }
  if (authenticated !== true && PRIVILEGED_ACTIONS.has(action)) {
    issues.push("privileged action without authenticated===true");
  }
  if (!actorId) {
    issues.push("missing actor id");
  }
  if (
    identitySource === "hardcoded" ||
    identitySource === "anonymous" ||
    identitySource === "default"
  ) {
    const grantedCount = granted?.length ?? 0;
    if (grantedCount > 0 || assumeFounder === true) {
      issues.push(`identity_source=${identitySource} granted access`);
    }
  }
  if (assumeFounder === true) {
    const role = actor ? asString(actor.role) : null;
    if (role !== "founder") {
      issues.push("assume_founder without founder actor");
    }
  }
  if (emptyMean === "allow-all") {
    issues.push("empty scopes treated as allow-all");
  }
  if (granted && granted.length === 0 && asString(rec.empty_scopes_policy) !== "deny") {
    if (PRIVILEGED_ACTIONS.has(action) && emptyMean !== "deny") {
      issues.push("empty granted_scopes without deny policy");
    }
  }

  if (issues.length > 0) {
    return verdict(id, "fail", "auth bypass assumption would grant access fail-open", {
      issues,
    });
  }
  return verdict(id, "pass", "auth is fail-closed with an opaque actor and explicit scopes", {
    action,
  });
}

const FRESHNESS_OK = new Set(["FRESH", "STALE", "UNKNOWN", "ERROR"]);

function provenanceComplete(p: Record<string, unknown> | null): string[] {
  const missing: string[] = [];
  if (!p) {
    return ["provenance"];
  }
  const source = p.source;
  if (typeof source === "string") {
    if (source.trim() === "") {
      missing.push("source");
    }
  } else {
    const s = asRecord(source);
    if (!s || !asString(s.system) || asString(s.system) === "") {
      missing.push("source.system");
    }
  }
  const observed = asString(p.observed_at);
  if (!observed) {
    missing.push("observed_at");
  }
  const freshness = asString(p.freshness_status);
  if (!freshness || !FRESHNESS_OK.has(freshness)) {
    missing.push("freshness_status");
  }
  const confidence = asNumber(p.confidence);
  if (confidence === null || confidence < 0 || confidence > 1) {
    missing.push("confidence");
  }
  return missing;
}

/**
 * missing provenance
 * Aggregated records must carry source, observed_at, freshness_status, and
 * confidence.
 */
export function evaluateMissingProvenance(payload: unknown): AttackVerdict {
  const id = "missing provenance";
  const rec = asRecord(payload);
  if (!rec) {
    return unknownShape(id, "expected object");
  }
  const records = asArray(rec.records);
  if (!records) {
    return unknownShape(id, "records[] required");
  }
  const offenders: Array<{ id: string; missing: string[] }> = [];
  for (const item of records) {
    const row = asRecord(item);
    if (!row) {
      continue;
    }
    const rid = asString(row.id) ?? "(unnamed)";
    const provenance = asRecord(row.provenance);
    let missing = provenanceComplete(provenance);
    if (missing.length === 1 && missing[0] === "provenance") {
      missing = provenanceComplete(row);
      if (missing.includes("provenance")) {
        missing = missing.filter((m) => m !== "provenance");
        const inline = provenanceComplete({
          source: row.source,
          observed_at: row.observed_at,
          freshness_status: row.freshness_status,
          confidence: row.confidence,
        });
        missing = inline;
      }
    }
    if (missing.length > 0) {
      offenders.push({ id: rid, missing });
    }
  }
  if (offenders.length > 0) {
    return verdict(id, "fail", "aggregated record missing required provenance fields", {
      offenders,
    });
  }
  return verdict(id, "pass", "all aggregated records carry source, observed_at, freshness_status, confidence", {
    inspected: records.length,
  });
}

export type EvaluatorFn = (payload: unknown) => AttackVerdict;

export const EVALUATORS: Record<AttackId, EvaluatorFn> = {
  "stale data mostrado como saudável": evaluateStaleDataShownAsHealthy,
  "double counting financeiro": evaluateDoubleCountingFinanceiro,
  "hypothesis promovida a fact": evaluateHypothesisPromotedToFact,
  "agent sobrescrevendo founder decision": evaluateAgentOverwritingFounderDecision,
  "scope leakage entre cliente/repos": evaluateScopeLeakage,
  "duplicated collector event": evaluateDuplicatedCollectorEvent,
  "provider mutation acidental": evaluateProviderMutationAcidental,
  "secret/PII leakage": evaluateSecretPiiLeakage,
  "timezone boundary": evaluateTimezoneBoundary,
  "partial outage": evaluatePartialOutage,
  "stale RUNNING agent session": evaluateStaleRunningAgentSession,
  "conflicting directives/supersession": evaluateConflictingDirectives,
  "auth bypass assumptions": evaluateAuthBypassAssumptions,
  "missing provenance": evaluateMissingProvenance,
};

export function evaluateAttack(attackId: AttackId, payload: unknown): AttackVerdict {
  return EVALUATORS[attackId](payload);
}

export function evaluateAttackViaPort(attackId: AttackId, port: QaRuntimePort): AttackVerdict {
  switch (attackId) {
    case "stale data mostrado como saudável":
      return evaluateStaleDataShownAsHealthy(port.loadFreshness(""));
    case "double counting financeiro":
      return evaluateDoubleCountingFinanceiro(port.loadLedger());
    case "hypothesis promovida a fact":
      return evaluateHypothesisPromotedToFact(port.loadDirectives());
    case "agent sobrescrevendo founder decision":
      return evaluateAgentOverwritingFounderDecision(port.loadDirectives());
    case "scope leakage entre cliente/repos":
      return evaluateScopeLeakage(port.loadAgentContext());
    case "duplicated collector event":
      return evaluateDuplicatedCollectorEvent(port.loadEvents());
    case "provider mutation acidental":
      return evaluateProviderMutationAcidental(port.loadAttemptedOperations());
    case "secret/PII leakage":
      return evaluateSecretPiiLeakage(port.loadSurfaces());
    case "timezone boundary":
      return evaluateTimezoneBoundary(port.loadInstants());
    case "partial outage":
      return evaluatePartialOutage(port.loadHealth());
    case "stale RUNNING agent session":
      return evaluateStaleRunningAgentSession(port.loadSessions());
    case "conflicting directives/supersession":
      return evaluateConflictingDirectives(port.loadDirectives());
    case "auth bypass assumptions":
      return evaluateAuthBypassAssumptions(port.loadAuthAttempt());
    case "missing provenance":
      return evaluateMissingProvenance(port.loadAggregates());
    default: {
      const _never: never = attackId;
      return unknownShape(_never, "no evaluator");
    }
  }
}

export function listedEvaluatorIds(): AttackId[] {
  return [...ATTACK_IDS];
}

export { isObject, parseUtcMs };
