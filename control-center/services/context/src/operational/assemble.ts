import {
  DEFAULT_SCORING_CONFIG,
  rankAttention,
  type AttentionSignal,
} from "@confenge/control-center-attention";
import { toUtcIso, type Clock } from "../clock.ts";
import type { RepoDomainMap } from "../scope.ts";
import type { FreshnessStatus, Scope } from "../types.ts";
import { isOperationalUnavailableError } from "./errors.ts";
import { demoteHealthStatus, looksHealthy, minConfidence, worstFreshness } from "./freshness.ts";
import {
  financeStages,
  nominalPipeline,
  pipelineByCurrency,
  reliableWeightedPipeline,
  type ProvenanceSeed,
} from "./money.ts";
import type { OperationalReadPort } from "./port.ts";
import { stripForbiddenKeys } from "./sanitize.ts";
import {
  applicableDomains,
  collectorNameToDomain,
  rowVisibleUnderQuery,
  snapshotKindToDomain,
} from "./scope.ts";
import { cosmeticSignal, founderOverrideFromSnapshots, signalsFromSlot } from "./signals.ts";
import {
  ABSENCE_REASONS,
  OPERATIONAL_DOMAIN_SCHEMA_VERSION,
  OPERATIONAL_DOMAINS,
  OPERATIONAL_ENVELOPE_SCHEMA_VERSION,
  type AbsenceReason,
  type CollectorRunRow,
  type DomainSlot,
  type ObservationEntry,
  type OperationalDomain,
  type OperationalEnvelope,
  type OperationalReadResult,
  type OperationalSnapshotRow,
  type SourceObservationRow,
  type SourceRef,
} from "./types.ts";

export interface AssembleDeps {
  port: OperationalReadPort;
  clock: Clock;
  repoDomains: RepoDomainMap;
}

const SYNTHETIC_SOURCE: SourceRef = {
  system: "control-center",
  kind: "operational-view",
  locator: "control_center.v_latest_operational_snapshots",
};

function compareId(a: { id: string }, b: { id: string }): number {
  return a.id.localeCompare(b.id);
}

function latestSnapshot(
  rows: readonly OperationalSnapshotRow[],
  domain: OperationalDomain,
): OperationalSnapshotRow | undefined {
  const matches = rows.filter((row) => snapshotKindToDomain(row.snapshot_kind) === domain);
  matches.sort((a, b) => {
    const time = b.observed_at.localeCompare(a.observed_at);
    return time !== 0 ? time : b.id.localeCompare(a.id);
  });
  return matches[0];
}

function latestCollector(rows: readonly CollectorRunRow[], domain: OperationalDomain): CollectorRunRow | undefined {
  const matches = rows.filter((row) => collectorNameToDomain(row.collector_name) === domain);
  matches.sort((a, b) => b.observed_at.localeCompare(a.observed_at) || b.id.localeCompare(a.id));
  return matches[0];
}

function absenceFromCollector(run: CollectorRunRow | undefined): AbsenceReason {
  if (!run) {
    return "no_data";
  }
  const code = (run.error_code ?? "").toUpperCase();
  if (run.status === "skipped" || code === "NOT_CONFIGURED") {
    return "not_configured";
  }
  if (run.status === "failed" || run.freshness_status === "ERROR" || code === "UPSTREAM_ERROR") {
    return "upstream_error";
  }
  return "no_data";
}

function absenceFreshness(reason: AbsenceReason, run: CollectorRunRow | undefined): FreshnessStatus {
  if (reason === "upstream_error") {
    return "ERROR";
  }
  if (run?.freshness_status === "ERROR") {
    return "ERROR";
  }
  if (run?.freshness_status === "STALE") {
    return "STALE";
  }
  return "UNKNOWN";
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function mapCommercial(payload: Record<string, unknown>, seed: ProvenanceSeed, id: string): Record<string, unknown> {
  const funnel = asRecord(payload.funnel);
  const out: Record<string, unknown> = {
    schema_version: "control-center.commercial-snapshot.v1",
    id,
    authority: {
      catalog_authority: "governance",
      commercial_runtime: "warmbly",
      this_document: "read_model",
    },
    offer_pin: asRecord(payload.offer_pin).catalog_id
      ? payload.offer_pin
      : { catalog_authority: "governance", catalog_id: "CFG-OFFER-CATALOG-v1" },
  };
  if (Object.keys(funnel).length > 0) {
    out.funnel = funnel;
  } else {
    const counts = asRecord(payload.counts);
    const derived: Record<string, unknown> = {};
    if (typeof counts.inbound_now === "number") derived.new_leads = counts.inbound_now;
    if (typeof counts.deals_open === "number") derived.opportunities = counts.deals_open;
    if (Object.keys(derived).length > 0) {
      out.funnel = derived;
    }
  }
  // Read side, not just write side: snapshots persisted before the currency
  // policy landed still carry a zero total stamped with whatever code the
  // upstream summary happened to report. They are withheld here too.
  const nominal = nominalPipeline(payload.pipeline_nominal, seed);
  if (nominal) {
    out.pipeline_nominal = nominal;
  }
  const nominalByCurrency = pipelineByCurrency(payload.pipeline_nominal_by_currency, seed);
  if (nominalByCurrency.length > 1) {
    out.pipeline_nominal_by_currency = nominalByCurrency;
  }
  const weighted = reliableWeightedPipeline(payload, seed);
  if (weighted) {
    out.pipeline_weighted = { ...weighted, probability_reliable: true };
  }
  for (const key of [
    "aging_count",
    "stalled_count",
    "missing_next_action_count",
    "pipeline_open_count",
    "inbound_unread_count",
    "at_risk_client_count",
  ]) {
    if (typeof payload[key] === "number") {
      out[key] = payload[key];
    }
  }
  const counts = asRecord(payload.counts);
  if (out.pipeline_open_count === undefined && typeof counts.deals_open === "number") {
    out.pipeline_open_count = counts.deals_open;
  }
  if (out.inbound_unread_count === undefined && typeof counts.inbox_unread === "number") {
    out.inbound_unread_count = counts.inbox_unread;
  }
  if (out.stalled_count === undefined && typeof counts.deals_stalled === "number") {
    out.stalled_count = counts.deals_stalled;
  }
  if (out.missing_next_action_count === undefined && typeof counts.tasks_overdue === "number") {
    out.missing_next_action_count = counts.tasks_overdue;
  }
  if (payload.operations && typeof payload.operations === "object") {
    out.operations = payload.operations;
  }
  if (typeof payload.availability === "string") {
    out.availability = payload.availability;
  }
  if (typeof payload.configured === "boolean") {
    out.configured = payload.configured;
  }
  return out;
}

function mapFinance(payload: Record<string, unknown>, seed: ProvenanceSeed, id: string): Record<string, unknown> {
  const stages = financeStages(payload, seed);
  const out: Record<string, unknown> = {
    schema_version: "control-center.finance-snapshot.v1",
    id,
    read_model_only: true,
    provider_mutations: "forbidden",
    ...stages,
  };
  if (payload.operations && typeof payload.operations === "object") {
    out.operations = payload.operations;
  }
  if (typeof payload.availability === "string") {
    out.availability = payload.availability;
  }
  return out;
}

function mapClients(payload: Record<string, unknown>, id: string): Record<string, unknown> {
  const out: Record<string, unknown> = {
    schema_version: "control-center.clients-snapshot.v1",
    id,
  };
  for (const key of ["client_slug", "display_name", "lifecycle", "at_risk_client_count", "open_blocker_count", "clients"]) {
    if (payload[key] !== undefined) {
      out[key] = payload[key];
    }
  }
  if (typeof payload.availability === "string") {
    out.availability = payload.availability;
  }
  return out;
}

function mapEngineering(payload: Record<string, unknown>, id: string): Record<string, unknown> {
  const out: Record<string, unknown> = {
    schema_version: "control-center.engineering-snapshot.v1",
    id,
  };
  for (const key of [
    "open_pr_count",
    "failing_check_count",
    "open_incident_count",
    "repo_scopes",
    "repos",
    "allowlist",
    "repository",
    "default_branch",
    "ci",
    "recommended_allowlist",
  ]) {
    if (payload[key] !== undefined) {
      out[key] = payload[key];
    }
  }
  if (typeof payload.availability === "string") {
    out.availability = payload.availability;
  }
  return out;
}

function mapInfraLike(
  payload: Record<string, unknown>,
  seed: ProvenanceSeed,
  id: string,
  schema: string,
): Record<string, unknown> {
  const rawStatus = typeof payload.status === "string" ? payload.status : undefined;
  const status = demoteHealthStatus(seed.freshness_status, rawStatus);
  const out: Record<string, unknown> = {
    schema_version: schema,
    id,
  };
  if (typeof payload.service_name === "string") {
    out.service_name = payload.service_name;
  }
  if (status !== undefined) {
    out.status = status;
  }
  for (const key of ["services", "partial_outage", "availability", "evidence", "contract_version", "last_update_at", "ingestion_succeeded", "coverage_window", "usable_for_commercial_intelligence_now", "scheduled_job"]) {
    if (payload[key] !== undefined) {
      out[key] = payload[key];
    }
  }
  return out;
}

function snapshotBody(domain: OperationalDomain, row: OperationalSnapshotRow): Record<string, unknown> {
  const payload = stripForbiddenKeys(row.payload) as Record<string, unknown>;
  const seed: ProvenanceSeed = {
    source: row.source,
    observed_at: row.observed_at,
    freshness_status: row.freshness_status,
    confidence: row.confidence,
  };
  if (domain === "commercial") {
    return mapCommercial(payload, seed, row.id);
  }
  if (domain === "finance") {
    return mapFinance(payload, seed, row.id);
  }
  if (domain === "clients") {
    return mapClients(payload, row.id);
  }
  if (domain === "engineering") {
    return mapEngineering(payload, row.id);
  }
  if (domain === "infrastructure") {
    return mapInfraLike(payload, seed, row.id, "control-center.infrastructure-snapshot.v1");
  }
  return mapInfraLike(payload, seed, row.id, "control-center.pncp-snapshot.v1");
}

function presentSlot(domain: OperationalDomain, row: OperationalSnapshotRow): DomainSlot {
  const body = snapshotBody(domain, row);
  const rawStatus = typeof body.status === "string" ? body.status : undefined;
  const unhealthy = rawStatus === "down" || rawStatus === "unhealthy" || rawStatus === "degraded" || rawStatus === "unknown";
  const healthy = looksHealthy(row.freshness_status, "present") && !unhealthy;
  return {
    schema_version: OPERATIONAL_DOMAIN_SCHEMA_VERSION,
    domain,
    scope: row.scope,
    source: row.source,
    observed_at: row.observed_at,
    freshness_status: row.freshness_status,
    confidence: row.confidence,
    presence: "present",
    healthy,
    snapshot: body,
  };
}

function absentSlot(
  domain: OperationalDomain,
  query: Scope,
  reason: AbsenceReason,
  run: CollectorRunRow | undefined,
  generatedAt: string,
): DomainSlot {
  const freshness = absenceFreshness(reason, run);
  const source = run?.source ?? {
    system: "control-center",
    kind: "operational-view",
    locator: `domain/${domain}`,
  };
  return {
    schema_version: OPERATIONAL_DOMAIN_SCHEMA_VERSION,
    domain,
    scope: query,
    source,
    observed_at: run?.observed_at ?? generatedAt,
    freshness_status: freshness,
    confidence: 0,
    presence: "absent",
    absence_reason: reason,
    healthy: false,
    snapshot: null,
  };
}

function toObservation(row: SourceObservationRow): ObservationEntry {
  const payload = stripForbiddenKeys(row.payload) as Record<string, unknown>;
  const entry: ObservationEntry = {
    schema_version: "control-center.source-observation.v1",
    id: row.id,
    scope: row.scope,
    source: row.source,
    observed_at: row.observed_at,
    freshness_status: row.freshness_status,
    confidence: row.confidence,
    collected_at: row.collected_at,
    idempotency_key: row.idempotency_key,
    payload,
  };
  if (row.payload_schema_ref) {
    entry.payload_schema_ref = row.payload_schema_ref;
  }
  if (row.error_code) {
    const code = row.error_code.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
    entry.error = {
      code: /^[A-Z][A-Z0-9_]*$/.test(code) ? code : "UPSTREAM_ERROR",
      message: (row.error_message ?? "source observation error").slice(0, 512),
    };
  } else if (row.freshness_status === "ERROR") {
    entry.error = { code: "UPSTREAM_ERROR", message: "source observation freshness is ERROR" };
  }
  return entry;
}

function emptySnapshots(): Record<OperationalDomain, DomainSlot | null> {
  return {
    commercial: null,
    finance: null,
    clients: null,
    engineering: null,
    infrastructure: null,
    pncp: null,
  };
}

function errorEnvelope(scope: Scope, generatedAt: string): OperationalEnvelope {
  const snapshots = emptySnapshots();
  for (const domain of applicableDomains(scope)) {
    snapshots[domain] = absentSlot(domain, scope, "upstream_error", undefined, generatedAt);
  }
  return {
    schema_version: OPERATIONAL_ENVELOPE_SCHEMA_VERSION,
    scope,
    generated_at: generatedAt,
    freshness_status: "ERROR",
    confidence: 0,
    snapshots,
    attention_now: [],
    today: [],
    source_observations: [],
  };
}

function filterBundle(bundle: OperationalReadResult, query: Scope, repoDomains: RepoDomainMap): OperationalReadResult {
  return {
    collector_runs: bundle.collector_runs.filter((row) => rowVisibleUnderQuery(row.scope, query, repoDomains)),
    source_observations: bundle.source_observations.filter((row) =>
      rowVisibleUnderQuery(row.scope, query, repoDomains),
    ),
    operational_snapshots: bundle.operational_snapshots.filter((row) =>
      rowVisibleUnderQuery(row.scope, query, repoDomains),
    ),
  };
}

function buildSlots(
  query: Scope,
  generatedAt: string,
  bundle: OperationalReadResult,
): Record<OperationalDomain, DomainSlot | null> {
  const snapshots = emptySnapshots();
  const applicable = new Set(applicableDomains(query));
  for (const domain of OPERATIONAL_DOMAINS) {
    if (!applicable.has(domain)) {
      snapshots[domain] = null;
      continue;
    }
    const row = latestSnapshot(bundle.operational_snapshots, domain);
    if (row) {
      snapshots[domain] = presentSlot(domain, row);
      continue;
    }
    const run = latestCollector(bundle.collector_runs, domain);
    snapshots[domain] = absentSlot(domain, query, absenceFromCollector(run), run, generatedAt);
  }
  return snapshots;
}

function envelopeFreshness(
  snapshots: Record<OperationalDomain, DomainSlot | null>,
  observations: readonly ObservationEntry[],
): { freshness_status: FreshnessStatus; confidence: number } {
  const statuses: FreshnessStatus[] = [];
  const confidences: number[] = [];
  for (const domain of OPERATIONAL_DOMAINS) {
    const slot = snapshots[domain];
    if (!slot) {
      continue;
    }
    statuses.push(slot.freshness_status);
    if (slot.presence === "present") {
      confidences.push(slot.confidence);
    }
  }
  for (const obs of observations) {
    statuses.push(obs.freshness_status);
    confidences.push(obs.confidence);
  }
  return {
    freshness_status: worstFreshness(statuses),
    confidence: minConfidence(confidences),
  };
}

export async function assembleEnvelope(deps: AssembleDeps, query: Scope): Promise<OperationalEnvelope> {
  const generatedAt = toUtcIso(deps.clock.now());
  let bundle: OperationalReadResult;
  try {
    bundle = await deps.port.readLatest();
  } catch (err) {
    if (isOperationalUnavailableError(err) || err instanceof Error) {
      return errorEnvelope(query, generatedAt);
    }
    return errorEnvelope(query, generatedAt);
  }
  const visible = filterBundle(bundle, query, deps.repoDomains);
  const snapshots = buildSlots(query, generatedAt, visible);
  const source_observations = visible.source_observations.map(toObservation).sort(compareId);
  const rollup = envelopeFreshness(snapshots, source_observations);

  const signals: AttentionSignal[] = [];
  for (const domain of OPERATIONAL_DOMAINS) {
    const slot = snapshots[domain];
    if (slot) {
      signals.push(...signalsFromSlot(slot));
    }
  }
  const anyPresent = OPERATIONAL_DOMAINS.some((domain) => snapshots[domain]?.presence === "present");
  if (anyPresent) {
    signals.push(cosmeticSignal(query, SYNTHETIC_SOURCE, generatedAt));
  }
  const override = founderOverrideFromSnapshots(visible.operational_snapshots);
  const ranked = rankAttention({
    signals,
    config: DEFAULT_SCORING_CONFIG,
    clock_now: generatedAt,
    override,
  });
  const envelope: OperationalEnvelope = {
    schema_version: OPERATIONAL_ENVELOPE_SCHEMA_VERSION,
    scope: query,
    generated_at: generatedAt,
    freshness_status: rollup.freshness_status,
    confidence: rollup.confidence,
    snapshots,
    attention_now: ranked.attention_now,
    today: ranked.today,
    source_observations,
  };
  if (ranked.audit.length > 0) {
    envelope.audit = ranked.audit;
  }
  return envelope;
}

export { ABSENCE_REASONS };
