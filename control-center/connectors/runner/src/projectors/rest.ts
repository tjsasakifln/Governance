import {
  CLIENT_IDENTITY_BASES,
  CLIENT_IDENTITY_REASON_CODES,
  CLIENT_IDENTITY_REQUIRED_ACTION,
  CLIENT_IDENTITY_REQUIRED_ACTIONS,
  isIdentifiedClientSlug,
  isPlaceholderDisplayName,
  type ClientIdentityBasis,
  type ClientIdentityReasonCode,
} from "@confenge/control-center-contracts";
// A leaf module with no imports of its own: this does not pull the collector's
// runtime into the runner's import graph, only the one rule both must obey.
import { hasSecretQueryKey } from "../../../infrastructure/src/secret-keys.ts";
import { availabilityFromEnvelope, freshnessForAvailability } from "./availability.ts";
import {
  FRESHNESS,
  PROJECTOR_VERSION,
  asArray,
  asRecord,
  capList,
  finiteNumber,
  isoOr,
  type CollectorEnvelope,
  type FreshnessStatus,
  type ProjectedSnapshot,
} from "./types.ts";

const HEALTH_STATUS = ["healthy", "degraded", "down", "unknown"] as const;
type HealthStatus = (typeof HEALTH_STATUS)[number];

/**
 * The collector speaks healthy/degraded/unhealthy/unknown; the contract and the
 * cockpit speak healthy/degraded/down/unknown. Anything unrecognised is
 * unknown, never healthy.
 */
function normalizeHealthStatus(value: unknown): HealthStatus {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "unhealthy" || raw === "down") return "down";
  if (raw === "healthy" || raw === "degraded" || raw === "unknown") return raw;
  return "unknown";
}

const STATUS_SEVERITY: Record<HealthStatus, number> = { down: 3, degraded: 2, unknown: 1, healthy: 0 };
const FRESHNESS_SEVERITY: Record<FreshnessStatus, number> = { ERROR: 3, STALE: 2, UNKNOWN: 1, FRESH: 0 };

function asFreshness(value: unknown, fallback: FreshnessStatus): FreshnessStatus {
  return typeof value === "string" && (FRESHNESS as readonly string[]).includes(value)
    ? (value as FreshnessStatus)
    : fallback;
}

/**
 * A DOM/resource-id-safe rendering of a catalog id. Lossy on purpose — target
 * ids legally contain "." and "_" (allowlist TARGET_ID) — so it is used only to
 * build an id, never to decide whether two rows are the same service. Two
 * distinct ids that slug alike are reported as an ambiguity, not merged.
 */
function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "sem-identidade"
  );
}

function textOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/** A ServiceCheck from the collector, shaped as the cockpit's {status, detail}. */
function checkSlot(checks: readonly Record<string, unknown>[], kind: string): Record<string, unknown> | undefined {
  const found = checks.find((check) => check.check === kind || check.name === kind);
  if (!found) return undefined;
  const detail = textOrUndefined(found.summary) ?? textOrUndefined(found.detail);
  return {
    status: normalizeHealthStatus(found.status),
    ...(detail ? { detail } : {}),
  };
}

interface InfraService {
  /** Exact identity. Never a slug: a slug merges services that are not the same. */
  readonly key: string;
  readonly slug: string;
  readonly row: Record<string, unknown>;
  readonly status: HealthStatus;
  readonly freshness: FreshnessStatus;
  readonly latency: number | undefined;
  readonly lastError: string | undefined;
  readonly anonymous: boolean;
}

/**
 * One monitored dependency, named. The collector emits service_id/display_name
 * (connectors/infrastructure ServiceHealth); older payloads used id/service_name.
 * A row that carries neither is a catalog defect and is labelled as one instead
 * of being rendered as yet another nameless "service" card.
 */
function projectService(
  item: unknown,
  index: number,
  envelope: CollectorEnvelope,
  fallbackFreshness: FreshnessStatus,
): InfraService {
  const raw = asRecord(item) ?? {};
  const checks = asArray(raw.checks)
    .map((check) => asRecord(check))
    .filter((check): check is Record<string, unknown> => check !== null);
  const serviceId = textOrUndefined(raw.service_id) ?? textOrUndefined(raw.id);
  const displayName = textOrUndefined(raw.display_name) ?? textOrUndefined(raw.service_name);
  const anonymous = serviceId === undefined && displayName === undefined;
  // Identity is compared verbatim. Anonymous rows are each their own service:
  // two defects are two defects, not a duplicate of one another.
  const key = anonymous
    ? `anonymous:${index}`
    : serviceId !== undefined
      ? `service_id:${serviceId}`
      : `display_name:${String(displayName)}`;
  const slug = anonymous ? `sem-identidade-${index + 1}` : slugify(serviceId ?? String(displayName));
  const freshness = asFreshness(raw.freshness_status, fallbackFreshness);
  const status = normalizeHealthStatus(raw.status);
  const observedAt = isoOr(raw.observed_at, envelope.observed_at);
  const confidence = finiteNumber(raw.confidence) ?? envelope.confidence;
  const latency = finiteNumber(raw.latency_ms);
  const latencyCheck = textOrUndefined(raw.latency_check);
  const lastError = textOrUndefined(raw.last_error);
  const runbook = safeRunbookUrl(raw.runbook_url);
  const http = checkSlot(checks, "http");
  const tls = checkSlot(checks, "tls");
  const docker = checkSlot(checks, "docker");
  const backup = checkSlot(checks, "backup");
  const hostMetrics = checkSlot(checks, "host_metrics");
  const row: Record<string, unknown> = {
    schema_version: "control-center.service-health.v1",
    id: `cc:service-health:${slug}`,
    scope: "infrastructure",
    service_id: serviceId ?? null,
    service_name: displayName ?? serviceId ?? "serviço sem identidade no catálogo",
    role: textOrUndefined(raw.role) ?? "função não declarada no catálogo",
    endpoint: textOrUndefined(raw.endpoint) ?? "endpoint não declarado no catálogo",
    status,
    freshness_status: freshness,
    observed_at: observedAt,
    checked_at: observedAt,
    confidence,
    partial_outage: raw.partial_outage === true,
    checks: capList(
      checks.map((check) => ({
        name: String(check.check ?? check.name ?? "check"),
        status: normalizeHealthStatus(check.status),
        ...(textOrUndefined(check.summary) ? { detail: textOrUndefined(check.summary) } : {}),
      })),
    ),
    provenance: {
      source: envelope.source,
      observed_at: observedAt,
      freshness_status: freshness,
      confidence,
    },
    ...(latency !== undefined ? { latency_ms: latency } : {}),
    ...(latencyCheck ? { latency_check: latencyCheck } : {}),
    ...(lastError ? { last_error: lastError, message: lastError } : {}),
    ...(runbook ? { runbook_url: runbook } : {}),
    ...(http ? { http } : {}),
    ...(tls ? { tls } : {}),
    ...(docker ? { docker } : {}),
    ...(backup ? { backup } : {}),
    ...(hostMetrics ? { host_metrics: hostMetrics } : {}),
    ...(anonymous ? { catalog_error: "missing_service_identity" } : {}),
  };
  return { key, slug, row, status, freshness, latency, lastError, anonymous };
}

/**
 * Two entries for the same catalog id collapse into one card. Every dimension
 * is rolled up independently — worst status, worst freshness, lowest
 * confidence, highest latency, first recorded error — because picking whichever
 * member row looked worse "overall" silently discarded the other's evidence: a
 * down+FRESH row losing to a healthy+STALE one took its 503 with it.
 */
function mergeDuplicates(members: readonly InfraService[]): Record<string, unknown> {
  const base = members[0];
  if (!base) {
    throw new Error("mergeDuplicates called with no members");
  }
  if (members.length === 1) {
    return base.row;
  }
  const worstStatus = members.reduce(
    (worst, member) => (STATUS_SEVERITY[member.status] > STATUS_SEVERITY[worst] ? member.status : worst),
    base.status,
  );
  const worstFreshness = members.reduce(
    (worst, member) => (FRESHNESS_SEVERITY[member.freshness] > FRESHNESS_SEVERITY[worst] ? member.freshness : worst),
    base.freshness,
  );
  const confidences = members
    .map((member) => finiteNumber(member.row.confidence))
    .filter((value): value is number => value !== undefined);
  // The check that produced the surviving number travels with it. Keeping the
  // base row's latency_check while taking another member's max reported, for
  // example, 120 ms "(http)" for a figure measured by reachability.
  const timed = members
    .filter((member): member is InfraService & { latency: number } => member.latency !== undefined)
    .sort((a, b) => b.latency - a.latency);
  const slowest = timed[0];
  const errors = members
    .map((member) => member.lastError)
    .filter((value): value is string => value !== undefined);
  const worstMember =
    members.find((member) => member.status === worstStatus && member.lastError !== undefined) ??
    members.find((member) => member.status === worstStatus) ??
    base;
  const merged: Record<string, unknown> = {
    ...base.row,
    ...(worstMember.row.http ? { http: worstMember.row.http } : {}),
    ...(worstMember.row.tls ? { tls: worstMember.row.tls } : {}),
    ...(worstMember.row.docker ? { docker: worstMember.row.docker } : {}),
    ...(worstMember.row.backup ? { backup: worstMember.row.backup } : {}),
    ...(worstMember.row.host_metrics ? { host_metrics: worstMember.row.host_metrics } : {}),
    status: worstStatus,
    freshness_status: worstFreshness,
    partial_outage: members.some((member) => member.row.partial_outage === true),
    duplicate_count: members.length,
  };
  if (confidences.length > 0) {
    merged.confidence = Math.min(...confidences);
  }
  if (slowest) {
    merged.latency_ms = slowest.latency;
    const check = slowest.row.latency_check;
    if (typeof check === "string" && check !== "") {
      merged.latency_check = check;
    } else {
      delete merged.latency_check;
    }
  }
  const joined = [...new Set(errors)].join(" | ");
  if (joined !== "") {
    merged.last_error = joined;
    merged.message = joined;
  }
  const provenance = asRecord(merged.provenance);
  if (provenance) {
    merged.provenance = {
      ...provenance,
      freshness_status: worstFreshness,
      ...(confidences.length > 0 ? { confidence: Math.min(...confidences) } : {}),
    };
  }
  return merged;
}

interface GroupedServices {
  readonly services: Record<string, unknown>[];
  readonly duplicateGroups: number;
  readonly ambiguousIds: number;
}

/**
 * Grouping is by exact catalog identity. Two different ids that happen to slug
 * alike (cfg-health and cfg.health) are two services, and losing one of them to
 * a merge would delete a monitored dependency from the cockpit and from the
 * count. They keep separate cards, separate ids, and are flagged so the
 * ambiguity is fixed in the catalog rather than hidden here.
 */
function groupServices(services: readonly InfraService[]): GroupedServices {
  const byKey = new Map<string, InfraService[]>();
  for (const service of services) {
    const bucket = byKey.get(service.key);
    if (bucket) {
      bucket.push(service);
    } else {
      byKey.set(service.key, [service]);
    }
  }
  const groups = [...byKey.values()];
  const slugCounts = new Map<string, number>();
  for (const members of groups) {
    const slug = members[0]?.slug ?? "sem-identidade";
    slugCounts.set(slug, (slugCounts.get(slug) ?? 0) + 1);
  }
  const seenBySlug = new Map<string, number>();
  let ambiguousIds = 0;
  const rows = groups.map((members) => {
    const merged = mergeDuplicates(members);
    const slug = members[0]?.slug ?? "sem-identidade";
    if ((slugCounts.get(slug) ?? 0) > 1) {
      const ordinal = (seenBySlug.get(slug) ?? 0) + 1;
      seenBySlug.set(slug, ordinal);
      ambiguousIds += 1;
      return {
        ...merged,
        id: `cc:service-health:${slug}-${ordinal}`,
        catalog_error: merged.catalog_error ?? "ambiguous_service_id",
      };
    }
    return merged;
  });
  return {
    services: rows,
    duplicateGroups: groups.filter((members) => members.length > 1).length,
    ambiguousIds,
  };
}

/**
 * A runbook link the cockpit may render. Same-origin absolute path, or an
 * http(s) URL with no credentials and no secret-looking query key — the same
 * rule, from the same module, that the allowlist parser applies, because a link
 * the operator cannot trust is worse than no link. Anything else is dropped.
 *
 * The decode lives inside hasSecretQueryKey: a malformed escape such as
 * `?%ZZ=1` used to throw URIError out of here, past projectCollector and past
 * runSource's try/finally, so the whole infra snapshot went unpersisted for
 * that run over a config typo.
 */
function safeRunbookUrl(value: unknown): string | undefined {
  const raw = textOrUndefined(value);
  if (!raw || raw.length > 512 || /[\s<>"'\\]/.test(raw) || raw.startsWith("//")) {
    return undefined;
  }
  if (raw.startsWith("/")) {
    if (raw.includes("@")) return undefined;
    return hasSecretQueryKey(raw.includes("?") ? raw.slice(raw.indexOf("?") + 1) : "") ? undefined : raw;
  }
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (url.username || url.password) return undefined;
    if (hasSecretQueryKey(url.search)) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

export function projectInfrastructure(envelope: CollectorEnvelope): ProjectedSnapshot {
  const availability = availabilityFromEnvelope(envelope);
  const freshness = freshnessForAvailability(availability, envelope.freshness_status);
  const payload = asRecord(envelope.payload) ?? {};
  const health = asArray(payload.service_health).length > 0 ? asArray(payload.service_health) : asArray(payload.health);
  const first = asRecord(health[0]) ?? payload;
  const projected = health.map((item, index) => projectService(item, index, envelope, freshness));
  const grouped = groupServices(projected);
  const statuses = projected.map((service) => service.status);
  const partial = statuses.some((status) => status !== "healthy") && statuses.some((status) => status === "healthy");
  const overallStatus = statuses.reduce<HealthStatus>(
    (worst, status) => (STATUS_SEVERITY[status] > STATUS_SEVERITY[worst] ? status : worst),
    normalizeHealthStatus(first.status),
  );
  const catalogErrors = projected.filter((service) => service.anonymous).length + grouped.ambiguousIds;
  return {
    projector_version: PROJECTOR_VERSION,
    snapshot_kind: "infrastructure",
    scope: "infrastructure",
    payload: {
      schema_version: "control-center.infrastructure-snapshot.v1",
      projector_version: PROJECTOR_VERSION,
      availability,
      service_name: first.service_name ?? "control-center-infrastructure",
      // The snapshot summary is a decision signal, so it carries the worst
      // observed service state. Array order must never hide a later outage.
      status: partial ? "degraded" : overallStatus,
      partial_outage: partial,
      monitored_service_count: grouped.services.length,
      catalog_error_count: catalogErrors,
      duplicate_group_count: grouped.duplicateGroups,
      // Present whenever the run is not fully trustworthy, not only when the
      // collector threw. A probe that failed while the collector itself ran
      // fine is the common case, and it used to leave the operator with a bare
      // confidence of 0 and nothing to distinguish it from "never configured".
      ...(envelope.error || availability !== "FRESH"
        ? { unavailability_reason: envelope.error?.code ?? availability }
        : {}),
      services: capList(grouped.services),
    },
    freshness_status: freshness,
    availability,
    confidence: envelope.confidence,
    observed_at: envelope.observed_at,
    source: envelope.source,
  };
}

export function projectPncp(envelope: CollectorEnvelope): ProjectedSnapshot {
  const availability = availabilityFromEnvelope(envelope);
  const freshness = freshnessForAvailability(availability, envelope.freshness_status);
  const payload = asRecord(envelope.payload) ?? {};
  const health = asRecord(payload.service_health) ?? asRecord(payload.health) ?? payload;
  const evidence = asRecord(payload.evidence) ?? asRecord(payload.contract) ?? payload;
  return {
    projector_version: PROJECTOR_VERSION,
    snapshot_kind: "pncp",
    scope: "inbound",
    payload: {
      schema_version: "control-center.pncp-snapshot.v1",
      projector_version: PROJECTOR_VERSION,
      availability,
      contract_version: evidence.contract_version ?? "PNCP_CONTRACT_FRESHNESS/1.0",
      service_name: health.service_name ?? "pncp-contracts",
      status: health.status ?? "unknown",
      last_update_at: evidence.source_publication_or_update_at ?? evidence.persisted_at ?? evidence.last_run_at ?? null,
      ingestion_succeeded: evidence.unresolved_window_count === 0 && String(evidence.upstream_status ?? "").toUpperCase() === "FRESH",
      coverage_window: evidence.source_window ?? evidence.latest_successful_closed_window ?? null,
      usable_for_commercial_intelligence_now:
        freshness === "FRESH" && String(evidence.upstream_status ?? "").toUpperCase() === "FRESH",
      scheduled_job: {
        last_run_at: evidence.last_run_at ?? null,
        next_run_at: evidence.next_run_at ?? null,
        timer: evidence.timer ?? null,
      },
      evidence,
    },
    freshness_status: freshness,
    availability,
    confidence: envelope.confidence,
    observed_at: envelope.observed_at,
    source: envelope.source,
  };
}

/** Where an identity-less commercial record came from. Shown on the queue entry. */
const CLIENT_IDENTITY_ORIGIN = "warmbly.commercial.pipeline";

const IDENTITY_REASON_TEXT: Record<ClientIdentityReasonCode, string> = {
  missing_client_key:
    "o negócio não está vinculado a nenhuma conta/empresa na origem (sem client_id, account_id ou organization_id, e sem razão social)",
  unusable_client_key: "a chave de cliente do registro não produz um identificador utilizável",
  reserved_placeholder_slug: "a chave de cliente do registro é um placeholder reservado, não uma identidade",
  missing_display_name: "o registro não trouxe o nome da empresa",
  placeholder_display_name: "o nome da empresa no registro é um placeholder, não uma identidade",
};

function identityWhy(reasons: readonly ClientIdentityReasonCode[]): string {
  return reasons.map((code) => IDENTITY_REASON_TEXT[code]).join("; ");
}

interface PipelineClientIdentity {
  slug: string | null;
  display_name: string | null;
  basis: ClientIdentityBasis | null;
  reasons: ClientIdentityReasonCode[];
}

const IDENTITY_BASES = new Set<string>(CLIENT_IDENTITY_BASES);
const REASON_CODES = new Set<string>(CLIENT_IDENTITY_REASON_CODES);

/**
 * Read the client identity the commercial projector attached to the row.
 *
 * A row that predates that field (an older persisted snapshot) carries no client
 * identity at all, which is the fail-closed answer: it goes to the queue rather
 * than being re-derived from the deal key.
 */
function clientIdentityOfPipelineRow(row: Record<string, unknown>): PipelineClientIdentity {
  const slug = typeof row.client_slug === "string" && isIdentifiedClientSlug(row.client_slug)
    ? row.client_slug
    : null;
  const name =
    typeof row.client_display_name === "string" && !isPlaceholderDisplayName(row.client_display_name)
      ? row.client_display_name
      : null;
  const basis =
    typeof row.client_identity_basis === "string" && IDENTITY_BASES.has(row.client_identity_basis)
      ? (row.client_identity_basis as ClientIdentityBasis)
      : null;
  const declared = asArray(row.client_identity_reasons)
    .filter((code): code is ClientIdentityReasonCode => typeof code === "string" && REASON_CODES.has(code));
  const reasons = declared.length > 0 ? declared : slug === null || name === null ? ["missing_client_key" as const] : [];
  return { slug, display_name: name, basis, reasons };
}

/** The correction for the first (most specific) reason, not a generic sentence. */
function identityAction(reasons: readonly ClientIdentityReasonCode[]): string {
  const first = reasons[0];
  return first === undefined ? CLIENT_IDENTITY_REQUIRED_ACTION : CLIENT_IDENTITY_REQUIRED_ACTIONS[first];
}

/**
 * Roll the commercial pipeline up into clients.
 *
 * Two rules carry this function:
 *
 * 1. A client is a company/account, not a deal. The identity comes from
 *    `resolveClientIdentity`, which reads client-level fields only. The old code
 *    slugged the *deal* id (`source_id ?? id ?? "unknown"`), which minted one
 *    "client" per deal, split one company across its deals, and — when the deal
 *    had no id at all — produced the `client:unknown` card from issue #70.
 * 2. Absence is not an identity. A record without a client key leaves as a
 *    data-quality exception carrying origin, reason code and the correction for
 *    that reason; it never becomes a client and never reaches a count.
 */
export function projectClientsFromCommercial(commercial: ProjectedSnapshot): ProjectedSnapshot {
  const operations = asRecord(commercial.payload.operations) ?? {};
  const pipeline = asArray(operations.pipeline);
  const exceptions = asArray(operations.exceptions);
  const activity = asArray(operations.activity);

  const dataQualityQueue: Record<string, unknown>[] = [];
  // Keyed by client slug, so N deals for one company are one client — the join
  // the deal id could never express.
  const bySlug = new Map<string, Record<string, unknown>>();
  // How each published identity was resolved. This lives here, not on the
  // ClientStatus rows: v1 ClientStatus is frozen with additionalProperties:false,
  // and per ADR-CC-001 adding a field to it would be a v1.1/v2 bump. The clients
  // snapshot is not a frozen resource schema, so the roll-up is recorded here and
  // the resource stays exactly v1.
  const resolvedIdentities = new Map<string, { client_slug: string; identity_basis: ClientIdentityBasis; derived_from_deal_count: number }>();

  pipeline.forEach((item, index) => {
    const row = asRecord(item) ?? {};
    // Resolved upstream against the raw deal (see commercial.ts). Re-deriving it
    // from the projected row would only ever find the deal key.
    const identity = clientIdentityOfPipelineRow(row);
    const dealKey = typeof row.source_id === "string" && row.source_id.trim() !== ""
      ? row.source_id.trim()
      : typeof row.id === "string" && row.id.trim() !== ""
        ? row.id.trim()
        : null;
    const relatedExceptions = exceptions.filter((ex) => {
      const rec = asRecord(ex) ?? {};
      return dealKey !== null && rec.source_id === dealKey;
    });

    if (identity.slug === null || identity.display_name === null || identity.basis === null) {
      dataQualityQueue.push({
        schema_version: "control-center.client-identity-exception.v1",
        id: `client-identity:${dealKey ?? index}`,
        canonical_id: `cc:attention-item:client-identity-${index}`,
        source_id: dealKey,
        kind: "client_identity_missing",
        queue: "data_quality.client_identity",
        why: identityWhy(identity.reasons),
        reason_codes: identity.reasons,
        recommended_next_action: identityAction(identity.reasons),
        status: "open",
        source: CLIENT_IDENTITY_ORIGIN,
        origin: {
          system: commercial.source.system,
          kind: "commercial-deal",
          locator: dealKey ?? `pipeline[${index}]`,
        },
        observed_at: commercial.observed_at,
        blocks: "client_publication",
        evidence: {
          deal_source_id: dealKey,
          stage: row.stage ?? null,
          status: row.status ?? null,
          age_seconds: row.age_seconds ?? null,
        },
      });
      return;
    }

    const last = activity.find((event) => {
      const rec = asRecord(event) ?? {};
      return (dealKey !== null && rec.source_id === dealKey) || rec.lead_or_account === identity.display_name;
    });

    const slug = identity.slug;
    const existing = bySlug.get(slug);
    if (existing) {
      existing.active_exceptions = Number(existing.active_exceptions ?? 0) + relatedExceptions.length;
      const rolled = resolvedIdentities.get(slug);
      if (rolled) rolled.derived_from_deal_count += 1;
      if (existing.next_action === null && typeof row.next_action === "string") {
        existing.next_action = row.next_action;
      }
      if (existing.last_interaction === null) {
        existing.last_interaction = asRecord(last)?.at ?? null;
      }
      // A company with one won deal is an active client even if its other deals
      // are still open. Lifecycle escalates, it never downgrades on a later row.
      if (row.status === "won") {
        existing.lifecycle = "active";
      } else if (row.status === "open" && existing.lifecycle === "unknown") {
        existing.lifecycle = "lead";
      }
      return;
    }

    resolvedIdentities.set(slug, {
      client_slug: slug,
      identity_basis: identity.basis,
      derived_from_deal_count: 1,
    });
    bySlug.set(slug, {
      schema_version: "control-center.client-status.v1",
      id: `cc:client-status:${slug}`,
      scope: `client:${slug}`,
      client_slug: slug,
      display_name: identity.display_name,
      lifecycle: row.status === "won" ? "active" : row.status === "open" ? "lead" : "unknown",
      next_action: typeof row.next_action === "string" ? row.next_action : null,
      last_interaction: asRecord(last)?.at ?? null,
      active_exceptions: relatedExceptions.length,
      sources: {
        warmbly: commercial.availability,
        asaas: "UNKNOWN",
        governance: "UNKNOWN",
      },
      identity_resolution: "not_proven",
      note: "Warmbly commercial projection only. Asaas and Governance are labeled UNKNOWN; no cross-source identity join.",
    });
  });

  const clients = capList([...bySlug.values()]);
  const atRisk = clients.filter((row) => Number(row.active_exceptions) > 0).length;

  return {
    projector_version: PROJECTOR_VERSION,
    snapshot_kind: "clients",
    scope: "clients",
    payload: {
      schema_version: "control-center.clients-snapshot.v1",
      projector_version: PROJECTOR_VERSION,
      availability: commercial.availability,
      client_360: "partial_warmbly_only",
      identity_resolution: "not_proven",
      sources: {
        warmbly: commercial.availability,
        asaas: "UNKNOWN",
        governance: "UNKNOWN",
      },
      note: "Useful operational client view from Warmbly. Not a proven multi-source 360.",
      clients,
      client_count: clients.length,
      // Records that could not be identified. Deliberately NOT part of
      // open_blocker_count or at_risk_client_count: a data-quality gap is not a
      // client at operational risk, and must not raise the client-risk alert.
      data_quality: {
        queue: "client_identity",
        origin: CLIENT_IDENTITY_ORIGIN,
        unidentified_record_count: dataQualityQueue.length,
        required_action: CLIENT_IDENTITY_REQUIRED_ACTION,
        counts_as_client: false,
        raises_client_risk: false,
        entries: capList(dataQualityQueue),
        // What a client identity may be derived from, and what each published
        // client was actually keyed on. A deal basis is absent from the
        // vocabulary on purpose: a deal key is not a client identity.
        identity_bases: [...CLIENT_IDENTITY_BASES],
        resolved_identities: capList([...resolvedIdentities.values()]),
      },
      unidentified_record_count: dataQualityQueue.length,
      // Commercial exceptions. Named for what they are: this count is about the
      // commercial stream, not about any client, and the clients surface must
      // not read it as client risk.
      open_blocker_count: exceptions.length,
      at_risk_client_count: atRisk,
    },
    freshness_status: commercial.freshness_status,
    availability: commercial.availability,
    confidence: commercial.confidence,
    observed_at: commercial.observed_at,
    source: commercial.source,
  };
}
