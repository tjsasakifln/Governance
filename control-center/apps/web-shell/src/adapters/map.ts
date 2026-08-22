import {
  isIdentifiedClientSlug,
  isPlaceholderDisplayName,
} from "@confenge/control-center-contracts/ids";
import { CLIENT_IDENTITY_REQUIRED_ACTION } from "@confenge/control-center-contracts/taxonomy";
import { composeHoje, type HojeComposeInput, type HojeViewModel } from "../hoje-compose";
import { getDestination, type DestinationId } from "../destinations";
import type {
  ActorRef,
  AgentActivity,
  AgentActivityPresentationStatus,
  AttentionItem,
  ClientIdentityException,
  ClientStatus,
  CommercialSnapshot,
  Directive,
  EngineeringSnapshot,
  FinanceSnapshot,
  FreshnessStatus,
  Money,
  PriorityRecommendation,
  Provenance,
  ServiceHealth,
  SourceRef,
} from "../types";
import { AGENT_ACTIVITY_STATUSES } from "../types";
import type { DestinationPage } from "./contract";

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

export function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const rec = asRecord(value);
  if (rec && Array.isArray(rec.items)) return rec.items;
  return [];
}

export function itemsOf(value: unknown): unknown[] {
  return asArray(value);
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function optionalInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function fallbackProvenance(locator: string, now: string): Provenance {
  return {
    source: { system: "control-center", kind: "http", locator },
    observed_at: now,
    freshness_status: "UNKNOWN",
    confidence: 0,
  };
}

export function provenanceOf(row: Record<string, unknown>, fallback: Provenance): Provenance {
  const nested = asRecord(row.provenance);
  const sourceRaw = asRecord(nested?.source) ?? asRecord(row.source);
  const freshness = nested?.freshness_status ?? row.freshness_status;
  const observed = nested?.observed_at ?? row.observed_at;
  const confidence = nested?.confidence ?? row.confidence;
  const window = nested?.freshness_window_seconds ?? row.freshness_window_seconds;
  const source: SourceRef = sourceRaw
    ? {
        system: str(sourceRaw.system, fallback.source.system),
        kind: str(sourceRaw.kind, fallback.source.kind),
        locator: str(sourceRaw.locator, fallback.source.locator),
        ...(typeof sourceRaw.label === "string" ? { label: sourceRaw.label } : {}),
      }
    : fallback.source;
  const result: Provenance = {
    source,
    observed_at: str(observed, fallback.observed_at),
    freshness_status: isFreshness(freshness) ? freshness : fallback.freshness_status,
    confidence: typeof confidence === "number" ? confidence : fallback.confidence,
  };
  if (typeof window === "number") result.freshness_window_seconds = window;
  return result;
}

function isFreshness(value: unknown): value is FreshnessStatus {
  return value === "FRESH" || value === "STALE" || value === "UNKNOWN" || value === "ERROR";
}

export function moneyOf(value: unknown): Money | undefined {
  const rec = asRecord(value);
  if (!rec) return undefined;
  if (!Number.isInteger(rec.amount_cents) || typeof rec.currency !== "string") return undefined;
  return { amount_cents: rec.amount_cents as number, currency: rec.currency };
}

export function attentionFrom(row: Record<string, unknown>, fallback: Provenance): AttentionItem {
  const prov = provenanceOf(row, fallback);
  const item: AttentionItem = {
    schema_version: "control-center.attention-item.v1",
    id: str(row.id, "cc:attention-item:unknown"),
    scope: str(row.scope, "company"),
    severity: (row.severity as AttentionItem["severity"]) ?? "medium",
    status: (row.status as AttentionItem["status"]) ?? "open",
    title: str(row.title, "Sem título"),
    summary: str(row.summary, str(row.body)),
    provenance: prov,
    detected_at: str(row.detected_at, prov.observed_at),
    homepage_eligible: row.homepage_eligible !== false,
  };
  if (typeof row.recommended_action === "string") item.recommended_action = row.recommended_action;
  if (Array.isArray(row.related_ids)) item.related_ids = row.related_ids.map(String);
  return item;
}

export function priorityFrom(
  row: Record<string, unknown>,
  index: number,
  fallback: Provenance,
): PriorityRecommendation {
  const prov = provenanceOf(row, fallback);
  const item: PriorityRecommendation = {
    schema_version: "control-center.priority-recommendation.v1",
    id: str(row.id, `cc:priority-recommendation:${index}`),
    scope: str(row.scope, "company"),
    rank: typeof row.rank === "number" ? row.rank : index + 1,
    title: str(row.title, "Prioridade"),
    rationale: str(row.rationale, str(row.reason, str(row.body))),
    provenance: prov,
    generated_at: str(row.generated_at, prov.observed_at),
    horizon: (row.horizon as PriorityRecommendation["horizon"]) ?? "today",
  };
  if (Array.isArray(row.attention_item_ids)) item.attention_item_ids = row.attention_item_ids.map(String);
  if (Array.isArray(row.directive_ids)) item.directive_ids = row.directive_ids.map(String);
  return item;
}

export function directiveFrom(row: Record<string, unknown>): Directive {
  const created = asRecord(row.created_by);
  const supersedes = row.supersedes;
  return {
    schema_version: "control-center.directive.v1",
    id: str(row.id, "cc:directive:unknown"),
    kind: (row.kind as Directive["kind"]) ?? "fact",
    scope: str(row.scope, "company"),
    status: (row.status as Directive["status"]) ?? "active",
    title: str(row.title),
    body: str(row.body),
    effective_from: str(row.effective_from, str(row.observed_at, new Date().toISOString())),
    expires_at: row.expires_at === null || row.expires_at === undefined ? null : String(row.expires_at),
    supersedes: Array.isArray(supersedes) ? supersedes.map(String) : null,
    created_by: {
      kind: (created?.kind as ActorRef["kind"]) ?? "human",
      id: str(created?.id, "unknown"),
      ...(typeof created?.display_name === "string" ? { display_name: created.display_name } : {}),
    },
    created_at: str(row.created_at, new Date().toISOString()),
    updated_at: str(row.updated_at, new Date().toISOString()),
    audit: Array.isArray(row.audit)
      ? row.audit
          .map((entry) => asRecord(entry))
          .filter((entry): entry is Record<string, unknown> => entry != null)
          .map((entry) => ({
            at: str(entry.at),
            actor: {
              kind: ((asRecord(entry.actor)?.kind as ActorRef["kind"]) ?? "human") as ActorRef["kind"],
              id: str(asRecord(entry.actor)?.id, "unknown"),
            },
            action: (entry.action as Directive["audit"][number]["action"]) ?? "created",
          }))
      : [],
  };
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map(String);
}

/**
 * Parse a wire row into a ClientStatus, or `null` when it carries no client identity.
 *
 * The previous version defaulted the identity fields — `cc:client-status:unknown`,
 * `client:unknown`, slug `unknown`, name `Cliente` — so *any* object became a
 * client. Fed the clients snapshot envelope by the adapter's fallback, it minted
 * exactly the card reported in issue #70, with every source UNKNOWN. Identity is
 * now read, never defaulted: a row without one is not a client and is routed to
 * the data-quality queue by the caller.
 */
export function maybeClientFrom(row: Record<string, unknown>, fallback: Provenance): ClientStatus | null {
  const slug = row.client_slug;
  if (!isIdentifiedClientSlug(slug)) {
    return null;
  }
  const displayName = row.display_name;
  if (isPlaceholderDisplayName(displayName)) {
    return null;
  }
  const scope = str(row.scope, `client:${slug}`);
  if (scope !== `client:${slug}`) {
    return null;
  }
  const id = str(row.id, `cc:client-status:${slug}`);
  if (!id.endsWith(`:${slug}`)) {
    return null;
  }
  const item: ClientStatus = {
    schema_version: "control-center.client-status.v1",
    id,
    scope,
    client_slug: slug,
    display_name: displayName as string,
    lifecycle: (row.lifecycle as ClientStatus["lifecycle"]) ?? "unknown",
    provenance: provenanceOf(row, fallback),
  };
  if (Array.isArray(row.attention_item_ids)) item.attention_item_ids = row.attention_item_ids.map(String);
  const money = moneyOf(row.open_receivables);
  if (money) item.open_receivables = money;
  if (typeof row.notes === "string") item.notes = row.notes;
  if (typeof row.health === "string") item.health = row.health;
  const commitments = stringList(row.commitments);
  if (commitments) item.commitments = commitments;
  if (typeof row.owner === "string") item.owner = row.owner;
  if (typeof row.due_date === "string") item.due_date = row.due_date;
  const deliverables = stringList(row.deliverables);
  if (deliverables) item.deliverables = deliverables;
  const blockers = stringList(row.blockers);
  if (blockers) item.blockers = blockers;
  if (typeof row.next_action === "string") item.next_action = row.next_action;
  if (typeof row.evidence === "string") item.evidence = row.evidence;
  const sources = asRecord(row.sources);
  item.sources = {
    warmbly: typeof sources?.warmbly === "string" ? sources.warmbly : "UNKNOWN",
    asaas: typeof sources?.asaas === "string" ? sources.asaas : "UNKNOWN",
    governance: typeof sources?.governance === "string" ? sources.governance : "UNKNOWN",
  };
  return item;
}

/**
 * Parse one entry of the producer's client-identity queue.
 *
 * The origin, reason and correction all come from the producer, which is the
 * only party that knows them. The reader must not substitute its own base URL
 * for the origin, or its own guess for the reason.
 */
export function clientIdentityExceptionFrom(
  row: Record<string, unknown>,
  fallback: Provenance,
): ClientIdentityException {
  const origin = asRecord(row.origin);
  const reasons = Array.isArray(row.reason_codes) ? row.reason_codes.map(String) : [];
  const item: ClientIdentityException = {
    id: str(row.id, str(row.canonical_id, "client-identity")),
    source_id: typeof row.source_id === "string" ? row.source_id : null,
    kind: str(row.kind, "client_identity_missing"),
    why: str(row.why, "identidade de cliente não comprovada"),
    reason_codes: reasons,
    recommended_next_action: str(row.recommended_next_action, CLIENT_IDENTITY_REQUIRED_ACTION),
    status: str(row.status, "open"),
    origin: origin
      ? {
          system: str(origin.system, fallback.source.system),
          kind: str(origin.kind, fallback.source.kind),
          locator: str(origin.locator, fallback.source.locator),
        }
      : fallback.source,
  };
  if (typeof row.observed_at === "string") item.observed_at = row.observed_at;
  // Only the entry's own provenance. Falling back to the reader's would print
  // "control-center · <baseUrl>" — the party that fetched the record, not the
  // one that produced it and can correct it.
  if (asRecord(row.provenance) !== null) {
    item.provenance = provenanceOf(row, fallback);
  }
  return item;
}

/** The producer's identity queue, read off a clients snapshot. */
export function clientDataQualityFrom(
  snapshot: Record<string, unknown>,
  fallback: Provenance,
): ClientIdentityException[] {
  const dq = asRecord(snapshot.data_quality);
  if (dq === null) return [];
  return asArray(dq.entries).map((row) => clientIdentityExceptionFrom(asRecord(row) ?? {}, fallback));
}

export function commercialFrom(row: Record<string, unknown>, fallback: Provenance): CommercialSnapshot {
  const authority = asRecord(row.authority);
  const funnel = asRecord(row.funnel);
  const offerPin = asRecord(row.offer_pin);
  const extra = asRecord(row.extra_historical);
  const drift = asRecord(row.offer_version_drift);
  const weighted = asRecord(row.pipeline_weighted);
  const snap: CommercialSnapshot = {
    schema_version: "control-center.commercial-snapshot.v1",
    id: str(row.id, "cc:commercial-snapshot:unknown"),
    scope: str(row.scope, "commercial"),
    generated_at: str(row.generated_at, fallback.observed_at),
    provenance: provenanceOf(row, fallback),
    authority: {
      catalog_authority: "governance",
      commercial_runtime: "warmbly",
      this_document: "read_model",
    },
  };
  const pipelineOpen = optionalInt(row.pipeline_open_count);
  if (pipelineOpen !== undefined) snap.pipeline_open_count = pipelineOpen;
  const inboundUnread = optionalInt(row.inbound_unread_count);
  if (inboundUnread !== undefined) snap.inbound_unread_count = inboundUnread;
  const atRisk = optionalInt(row.at_risk_client_count);
  if (atRisk !== undefined) snap.at_risk_client_count = atRisk;
  if (authority) {
    snap.authority = {
      catalog_authority: "governance",
      commercial_runtime: "warmbly",
      this_document: "read_model",
    };
  }
  if (offerPin && typeof offerPin.catalog_id === "string") {
    snap.offer_pin = {
      catalog_authority: "governance",
      catalog_id: offerPin.catalog_id,
      ...(Array.isArray(offerPin.known_offer_ids)
        ? { known_offer_ids: offerPin.known_offer_ids.map(String) }
        : {}),
    };
  }
  if (funnel) {
    const mapped: CommercialSnapshot["funnel"] = {};
    const newLeads = optionalInt(funnel.new_leads);
    const qualified = optionalInt(funnel.qualified);
    const opportunities = optionalInt(funnel.opportunities);
    const proposals = optionalInt(funnel.proposals);
    const clients = optionalInt(funnel.clients);
    if (newLeads !== undefined) mapped.new_leads = newLeads;
    if (qualified !== undefined) mapped.qualified = qualified;
    if (opportunities !== undefined) mapped.opportunities = opportunities;
    if (proposals !== undefined) mapped.proposals = proposals;
    if (clients !== undefined) mapped.clients = clients;
    if (Object.keys(mapped).length > 0) snap.funnel = mapped;
  }
  const nominal = moneyOf(row.pipeline_nominal);
  if (nominal) snap.pipeline_nominal = nominal;
  if (Array.isArray(row.pipeline_nominal_by_currency)) {
    const split = row.pipeline_nominal_by_currency
      .map((item) => moneyOf(item))
      .filter((money): money is Money => money !== undefined);
    if (split.length > 1) {
      snap.pipeline_nominal_by_currency = split;
    } else if (split.length === 1 && !snap.pipeline_nominal) {
      // One readable currency left is a total, not a split, and not absence.
      const only = split[0];
      if (only) snap.pipeline_nominal = only;
    }
  }
  if (weighted && weighted.probability_reliable === true) {
    const money = moneyOf(weighted);
    if (money) snap.pipeline_weighted = { ...money, probability_reliable: true };
  }
  if (typeof row.aging_count === "number") snap.aging_count = row.aging_count;
  if (typeof row.stalled_count === "number") snap.stalled_count = row.stalled_count;
  if (typeof row.missing_next_action_count === "number") {
    snap.missing_next_action_count = row.missing_next_action_count;
  }
  if (Array.isArray(row.attention_item_ids)) snap.attention_item_ids = row.attention_item_ids.map(String);
  if (extra && extra.treated_as_public_offer === false) {
    snap.extra_historical = {
      treated_as_public_offer: false,
      ...(typeof extra.label === "string" ? { label: extra.label } : {}),
      ...(typeof extra.note === "string" ? { note: extra.note } : {}),
    };
  }
  if (drift && typeof drift.count === "number") {
    snap.offer_version_drift = {
      count: drift.count,
      ...(typeof drift.detail === "string" ? { detail: drift.detail } : {}),
    };
  }
  if (typeof row.availability === "string") snap.availability = row.availability;
  if (row.operations && typeof row.operations === "object") {
    const ops = asRecord(row.operations);
    if (ops) snap.operations = ops;
  }
  return snap;
}

export function financeFrom(row: Record<string, unknown>, fallback: Provenance): FinanceSnapshot {
  const overdue = moneyOf(row.overdue) ?? moneyOf(row.receivables_overdue);
  const receivable = moneyOf(row.receivable) ?? moneyOf(row.receivables_open);
  const snap: FinanceSnapshot = {
    schema_version: "control-center.finance-snapshot.v1",
    id: str(row.id, "cc:finance-snapshot:unknown"),
    scope: str(row.scope, "finance"),
    generated_at: str(row.generated_at, fallback.observed_at),
    provenance: provenanceOf(row, fallback),
    read_model_only: true,
    provider_mutations: "forbidden",
  };
  const contracted = moneyOf(row.contracted);
  if (contracted) snap.contracted = contracted;
  const billed = moneyOf(row.billed);
  if (billed) snap.billed = billed;
  const paid = moneyOf(row.paid);
  if (paid) snap.paid = paid;
  const received = moneyOf(row.effectively_received);
  if (received) snap.effectively_received = received;
  if (overdue) {
    snap.overdue = overdue;
    snap.receivables_overdue = overdue;
  }
  if (receivable) {
    snap.receivable = receivable;
    snap.receivables_open = receivable;
  }
  const refunds = moneyOf(row.refunds);
  if (refunds) snap.refunds = refunds;
  const chargebacks = moneyOf(row.chargebacks);
  if (chargebacks) snap.chargebacks = chargebacks;
  const cash = asRecord(row.cash_in);
  if (cash && cash.evidenced === true) {
    const money = moneyOf(cash);
    const source = asRecord(cash.source);
    if (money && source) {
      snap.cash_in = {
        ...money,
        evidenced: true,
        source: {
          system: str(source.system, "asaas"),
          kind: str(source.kind, "settlement-read"),
          locator: str(source.locator, "finance/settlements"),
        },
      };
    }
  }
  const mrr = asRecord(row.mrr);
  if (mrr && mrr.applicable === true) {
    const money = moneyOf(mrr);
    if (money) snap.mrr = { ...money, applicable: true, basis: "recurring_monthly" };
  }
  const runway = asRecord(row.runway);
  if (runway && runway.cash_reliable === true && runway.expense_reliable === true) {
    const cashBalance = moneyOf(runway.cash_balance);
    const expense = moneyOf(runway.monthly_expense);
    if (cashBalance && expense && typeof runway.months === "number") {
      snap.runway = {
        months: runway.months,
        cash_balance: cashBalance,
        monthly_expense: expense,
        cash_reliable: true,
        expense_reliable: true,
      };
    }
  }
  if (Array.isArray(row.attention_item_ids)) snap.attention_item_ids = row.attention_item_ids.map(String);
  return snap;
}

export function engineeringFrom(row: Record<string, unknown>, fallback: Provenance): EngineeringSnapshot {
  const snap: EngineeringSnapshot = {
    schema_version: "control-center.engineering-snapshot.v1",
    id: str(row.id, "cc:engineering-snapshot:unknown"),
    scope: str(row.scope, "company"),
    generated_at: str(row.generated_at, fallback.observed_at),
    provenance: provenanceOf(row, fallback),
    open_pr_count: num(row.open_pr_count),
    failing_check_count: num(row.failing_check_count),
    open_incident_count: num(row.open_incident_count),
  };
  if (Array.isArray(row.repo_scopes)) snap.repo_scopes = row.repo_scopes.map(String);
  if (Array.isArray(row.attention_item_ids)) snap.attention_item_ids = row.attention_item_ids.map(String);
  if (typeof row.repository === "string") snap.repository = row.repository;
  if (typeof row.default_branch === "string") snap.default_branch = row.default_branch;
  if (Array.isArray(row.prs)) {
    snap.prs = row.prs.map((pr) => {
      const rec = asRecord(pr) ?? {};
      return {
        ...(typeof rec.id === "string" ? { id: rec.id } : {}),
        ...(typeof rec.title === "string" ? { title: rec.title } : {}),
        ...(typeof rec.status === "string" ? { status: rec.status } : {}),
      };
    });
  }
  const ci = asRecord(row.ci);
  if (ci) {
    snap.ci = {
      ...(typeof ci.status === "string" ? { status: ci.status } : {}),
      ...(typeof ci.detail === "string" ? { detail: ci.detail } : {}),
    };
  }
  if (typeof row.p0_count === "number") snap.p0_count = row.p0_count;
  if (typeof row.p1_count === "number") snap.p1_count = row.p1_count;
  const aging = asRecord(row.aging);
  if (aging) {
    snap.aging = {
      ...(typeof aging.count === "number" ? { count: aging.count } : {}),
      ...(typeof aging.oldest_days === "number" ? { oldest_days: aging.oldest_days } : {}),
    };
  }
  const blockers = stringList(row.blockers);
  if (blockers) snap.blockers = blockers;
  if (typeof row.last_evidence === "string") snap.last_evidence = row.last_evidence;
  const hypo = asRecord(row.active_work_without_evidence);
  if (hypo && hypo.remains === "hypothesis") {
    snap.active_work_without_evidence = {
      remains: "hypothesis",
      ...(typeof hypo.detail === "string" ? { detail: hypo.detail } : {}),
    };
  }
  if (Array.isArray(row.repos)) {
    snap.repos = row.repos.map((item) => asRecord(item) ?? {});
  }
  if (Array.isArray(row.allowlist)) snap.allowlist = row.allowlist.map(String);
  return snap;
}

const HEALTH_STATUSES = ["healthy", "degraded", "down", "unknown"] as const;

/**
 * The infrastructure collector says "unhealthy" where the contract says
 * "down". Anything unrecognised is unknown — never healthy by omission.
 */
function healthStatusOf(value: unknown): ServiceHealth["status"] {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "unhealthy" || raw === "down") return "down";
  return (HEALTH_STATUSES as readonly string[]).includes(raw)
    ? (raw as ServiceHealth["status"])
    : "unknown";
}

/**
 * A runbook href the shell is willing to render: a same-origin absolute path,
 * or an http(s) URL with no embedded credentials. The projector validates the
 * same rule; the shell repeats it because a link it cannot vouch for is worse
 * than no link.
 */
export function safeRunbookHref(value: unknown): string | undefined {
  const raw = typeof value === "string" ? value.trim() : "";
  if (raw === "" || raw.length > 512 || /[\s<>"'\\]/.test(raw) || raw.startsWith("//")) {
    return undefined;
  }
  if (raw.startsWith("/")) {
    return raw.includes("@") ? undefined : raw;
  }
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (url.username !== "" || url.password !== "") return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

export function healthFrom(row: Record<string, unknown>, fallback: Provenance): ServiceHealth {
  const prov = provenanceOf(row, fallback);
  // The collector emits service_id/display_name; earlier payloads used
  // id/service_name. Reading only one pair is what produced a wall of cards
  // all called "service", so every known spelling is consulted before the row
  // is declared nameless — and a nameless row is labelled as a catalog defect
  // rather than given a generic name that hides it.
  const identity =
    str(row.service_name) || str(row.display_name) || str(row.service_id) || str(row.target_id);
  const item: ServiceHealth = {
    schema_version: "control-center.service-health.v1",
    id: str(row.id, `cc:service-health:${identity !== "" ? identity : "sem-identidade"}`),
    scope: str(row.scope, "infrastructure"),
    service_name: identity !== "" ? identity : "serviço sem identidade no catálogo",
    status: healthStatusOf(row.status),
    provenance: prov,
    checked_at: str(row.checked_at, prov.observed_at),
  };
  const serviceId = str(row.service_id);
  if (serviceId !== "") item.service_id = serviceId;
  const role = str(row.role);
  if (role !== "") item.role = role;
  const endpoint = str(row.endpoint);
  if (endpoint !== "") item.endpoint = endpoint;
  const lastError = str(row.last_error);
  if (lastError !== "") item.last_error = lastError;
  const runbook = safeRunbookHref(row.runbook_url);
  if (runbook) item.runbook_url = runbook;
  if (typeof row.duplicate_count === "number" && row.duplicate_count > 1) {
    item.duplicate_count = row.duplicate_count;
  }
  const catalogError = str(row.catalog_error) || (identity === "" ? "missing_service_identity" : "");
  if (catalogError !== "") item.catalog_error = catalogError;
  if (typeof row.evidence_conclusive === "boolean") item.evidence_conclusive = row.evidence_conclusive;
  if (typeof row.latency_ms === "number") item.latency_ms = row.latency_ms;
  if (typeof row.message === "string") item.message = row.message;
  if (Array.isArray(row.checks)) {
    item.checks = row.checks.map((check) => {
      const rec = asRecord(check) ?? {};
      return {
        name: str(rec.name, "check"),
        status: (rec.status as ServiceHealth["status"]) ?? "unknown",
        ...(typeof rec.detail === "string" ? { detail: rec.detail } : {}),
      };
    });
  }
  const http = asRecord(row.http);
  if (http) {
    item.http = {
      ...(typeof http.status === "string" ? { status: http.status } : {}),
      ...(typeof http.detail === "string" ? { detail: http.detail } : {}),
    };
  }
  const tls = asRecord(row.tls);
  if (tls) {
    item.tls = {
      ...(typeof tls.status === "string" ? { status: tls.status } : {}),
      ...(typeof tls.detail === "string" ? { detail: tls.detail } : {}),
    };
  }
  const docker = asRecord(row.docker);
  if (docker) {
    item.docker = {
      ...(typeof docker.status === "string" ? { status: docker.status } : {}),
      ...(typeof docker.detail === "string" ? { detail: docker.detail } : {}),
    };
  }
  const backup = asRecord(row.backup);
  if (backup) {
    item.backup = {
      ...(typeof backup.status === "string" ? { status: backup.status } : {}),
      ...(typeof backup.detail === "string" ? { detail: backup.detail } : {}),
    };
  }
  const hostMetrics = asRecord(row.host_metrics);
  if (hostMetrics) {
    item.host_metrics = {
      ...(typeof hostMetrics.status === "string" ? { status: hostMetrics.status } : {}),
      ...(typeof hostMetrics.detail === "string" ? { detail: hostMetrics.detail } : {}),
    };
  }
  const disk = asRecord(row.disk);
  if (disk) {
    item.disk = {
      ...(typeof disk.used_pct === "number" ? { used_pct: disk.used_pct } : {}),
      ...(typeof disk.detail === "string" ? { detail: disk.detail } : {}),
    };
  }
  const memory = asRecord(row.memory);
  if (memory) {
    item.memory = {
      ...(typeof memory.used_pct === "number" ? { used_pct: memory.used_pct } : {}),
      ...(typeof memory.detail === "string" ? { detail: memory.detail } : {}),
    };
  }
  const pncp = asRecord(row.pncp_freshness);
  if (pncp && isFreshness(pncp.freshness_status)) {
    item.pncp_freshness = {
      freshness_status: pncp.freshness_status,
      ...(typeof pncp.observed_at === "string" ? { observed_at: pncp.observed_at } : {}),
      ...(typeof pncp.detail === "string" ? { detail: pncp.detail } : {}),
    };
  }
  if (typeof row.partial_outage === "boolean") item.partial_outage = row.partial_outage;
  return item;
}

export function presentAgentStatus(raw: unknown, freshness: FreshnessStatus): AgentActivityPresentationStatus {
  const value = typeof raw === "string" ? raw.toLowerCase() : "";
  if ((AGENT_ACTIVITY_STATUSES as readonly string[]).includes(value)) {
    const mapped = value.toUpperCase() as AgentActivityPresentationStatus;
    if (mapped === "RUNNING" && freshness === "STALE") return "RUNNING";
    if (mapped === "DONE") return "DONE";
    return mapped;
  }
  return "UNKNOWN";
}

export function activityFrom(row: Record<string, unknown>, fallback: Provenance): AgentActivity {
  const prov = provenanceOf(row, fallback);
  const presentation = presentAgentStatus(row.status, prov.freshness_status);
  const finishedRaw = row.finished_at;
  const finished_at =
    presentation === "RUNNING" ? null : finishedRaw === null || finishedRaw === undefined ? null : String(finishedRaw);
  const activity: AgentActivity = {
    schema_version: "control-center.agent-activity.v1",
    id: str(row.id, "cc:agent-activity:unknown"),
    agent_id: str(row.agent_id, str(asRecord(row.agent)?.id, "agent:unknown")),
    scope: str(row.scope, "company"),
    status: str(row.status, "unknown"),
    presentation_status: presentation,
    started_at: str(row.started_at, prov.observed_at),
    finished_at,
    goal: str(row.goal, str(row.purpose, "sem goal")),
    summary: str(row.summary),
    provenance: prov,
  };
  if (typeof row.provider === "string") activity.provider = row.provider;
  const agent = asRecord(row.agent);
  if (!activity.provider && typeof agent?.provider === "string") activity.provider = agent.provider;
  if (typeof row.session_id === "string") activity.session_id = row.session_id;
  if (typeof row.repo === "string") activity.repo = row.repo;
  if (typeof row.campaign === "string") activity.campaign = row.campaign;
  else if (row.campaign === null) activity.campaign = null;
  const actor = asRecord(row.actor);
  if (actor) {
    activity.actor = {
      kind: (actor.kind as ActorRef["kind"]) ?? "agent",
      id: str(actor.id, activity.agent_id),
    };
  }
  const evidence = stringList(row.evidence_refs);
  if (evidence) activity.evidence_refs = evidence;
  const residual = stringList(row.residual_work);
  if (residual) activity.residual_work = residual;
  const blockers = stringList(row.blockers);
  if (blockers) activity.blockers = blockers;
  if (Array.isArray(row.related_ids)) activity.related_ids = row.related_ids.map(String);
  return activity;
}

function dedupeById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

export function mapContextDirectives(ctx: Record<string, unknown>, fallback: Provenance): Directive[] {
  const buckets = [
    ctx.active_directives,
    ctx.decisions,
    ctx.directives,
    ctx.facts,
    ctx.constraints,
    ctx.priorities,
    ctx.risks,
    ctx.hypotheses,
  ];
  const rows: Directive[] = [];
  for (const bucket of buckets) {
    for (const item of asArray(bucket)) {
      rows.push(directiveFrom(asRecord(item) ?? {}));
    }
  }
  void fallback;
  return dedupeById(rows);
}

export function mapHojePayloads(input: {
  today: unknown;
  attentionNow: unknown;
  attentionToday: unknown;
  snapshot: unknown;
  activities: unknown;
  fallback: Provenance;
}): HojeComposeInput {
  const today = asRecord(input.today) ?? {};
  const snapshot = asRecord(input.snapshot) ?? {};
  const incidents = dedupeById(
    [
      ...asArray(today.incidents),
      ...itemsOf(input.attentionNow),
      ...itemsOf(input.attentionToday),
      ...asArray(snapshot.attention_items),
    ].map((row) => attentionFrom(asRecord(row) ?? {}, input.fallback)),
  );
  const priorities = [
    ...asArray(today.today),
    ...asArray(today.recommended_actions),
    ...asArray(today.priorities),
    ...asArray(snapshot.top_priorities),
  ].map((row, index) => priorityFrom(asRecord(row) ?? {}, index, input.fallback));
  // Rows without a client identity are not clients. They are dropped here and
  // published separately as the data-quality queue.
  const clients = [
    ...asArray(today.clients),
    ...asArray(snapshot.clients),
    ...itemsOf(snapshot.client_statuses),
  ]
    .map((row) => maybeClientFrom(asRecord(row) ?? {}, input.fallback))
    .filter((row): row is ClientStatus => row !== null);
  const commercialRaw = asRecord(today.commercial) ?? asRecord(snapshot.commercial);
  const financeRaw = asRecord(today.finance) ?? asRecord(snapshot.finance);
  const engineeringRaw = asRecord(today.engineering) ?? asRecord(snapshot.engineering);
  const infra = [...asArray(today.infra), ...asArray(snapshot.health), ...itemsOf(snapshot.infra)].map((row) =>
    healthFrom(asRecord(row) ?? {}, input.fallback),
  );
  const activityRows = itemsOf(input.activities);
  const fromToday = asArray(today.agent_activity);
  const activities = (activityRows.length > 0 ? activityRows : fromToday).map((row) =>
    activityFrom(asRecord(row) ?? {}, input.fallback),
  );
  return {
    generated_at: str(today.generated_at, input.fallback.observed_at),
    headline: str(today.headline, "O que exige atenção agora."),
    priorities,
    incidents,
    clients,
    commercial: commercialRaw ? commercialFrom(commercialRaw, input.fallback) : null,
    finance: financeRaw ? financeFrom(financeRaw, input.fallback) : null,
    engineering: engineeringRaw ? engineeringFrom(engineeringRaw, input.fallback) : null,
    infra,
    activities,
  };
}

export function pageFromHoje(
  id: DestinationId,
  operator: ActorRef,
  composeInput: HojeComposeInput,
  hoje: HojeViewModel,
): DestinationPage {
  const dest = getDestination(id);
  return {
    id,
    label: dest.label,
    scope: dest.scope,
    generated_at: composeInput.generated_at,
    operator,
    headline: composeInput.headline,
    attention: [...composeInput.incidents],
    priorities: [...composeInput.priorities].slice(0, 3),
    ...(composeInput.commercial ? { commercial: composeInput.commercial } : {}),
    ...(composeInput.finance ? { finance: composeInput.finance } : {}),
    ...(composeInput.engineering ? { engineering: composeInput.engineering } : {}),
    clients: [...composeInput.clients],
    health: [...composeInput.infra],
    activities: [...composeInput.activities],
    hoje,
  };
}

export function composePageFromHojeInput(id: DestinationId, operator: ActorRef, input: HojeComposeInput): DestinationPage {
  return pageFromHoje(id, operator, input, composeHoje(input));
}
