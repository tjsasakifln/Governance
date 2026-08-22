import {
  CLIENT_IDENTITY_REQUIRED_ACTION,
  clientSlugFrom,
  isPlaceholderDisplayName,
  isReservedClientSlug,
  type ClientIdentityReasonCode,
} from "@confenge/control-center-contracts";
import { availabilityFromEnvelope, freshnessForAvailability } from "./availability.ts";
import {
  PROJECTOR_VERSION,
  asArray,
  asRecord,
  capList,
  type CollectorEnvelope,
  type ProjectedSnapshot,
} from "./types.ts";

export function projectInfrastructure(envelope: CollectorEnvelope): ProjectedSnapshot {
  const availability = availabilityFromEnvelope(envelope);
  const freshness = freshnessForAvailability(availability, envelope.freshness_status);
  const payload = asRecord(envelope.payload) ?? {};
  const health = asArray(payload.service_health).length > 0 ? asArray(payload.service_health) : asArray(payload.health);
  const first = asRecord(health[0]) ?? payload;
  const statuses = health.map((item) => String(asRecord(item)?.status ?? "unknown"));
  const partial = statuses.some((status) => status !== "healthy") && statuses.some((status) => status === "healthy");
  return {
    projector_version: PROJECTOR_VERSION,
    snapshot_kind: "infrastructure",
    scope: "infrastructure",
    payload: {
      schema_version: "control-center.infrastructure-snapshot.v1",
      projector_version: PROJECTOR_VERSION,
      availability,
      service_name: first.service_name ?? "control-center-infrastructure",
      status: partial ? "degraded" : first.status ?? (availability === "FRESH" ? "unknown" : "unknown"),
      partial_outage: partial,
      services: capList(
        health.map((item) => {
          const row = asRecord(item) ?? {};
          return {
            id: row.id,
            service_name: row.service_name ?? row.id,
            status: row.status,
            freshness_status: row.freshness_status,
            partial_outage: row.partial_outage === true,
            http: row.http,
            tls: row.tls,
            disk: row.disk,
            memory: row.memory,
          };
        }),
      ),
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

interface ClientIdentity {
  slug: string | null;
  display_name: string | null;
  reasons: ClientIdentityReasonCode[];
}

/**
 * Fail-closed identity read of one pipeline row.
 *
 * The projector used to sanitize `source_id ?? id ?? "unknown"` into a slug and
 * fall back to the literal `"unknown"` when the value was absent or sanitized to
 * nothing. That produced `client:unknown` — a card that looks like a real client,
 * repeated once per unusable deal, feeding client counts and risk alerts. There
 * is no slug that honestly represents "we do not know who this is", so an
 * unusable identifier now yields `null` and the record leaves as a data-quality
 * exception instead of a client.
 */
function clientIdentityOf(row: Record<string, unknown>): ClientIdentity {
  const reasons: ClientIdentityReasonCode[] = [];
  const raw = row.source_id ?? row.id;
  if (typeof raw !== "string" || raw.trim() === "") {
    reasons.push("missing_source_id");
  }
  const slug = clientSlugFrom(raw);
  if (slug === null && reasons.length === 0) {
    // A non-empty identifier that still cannot become an identity: either it
    // sanitizes to nothing (`"###"`) or it reduces to a reserved placeholder
    // token (`"unknown"`). Both are unusable, but the operator fixes them
    // differently, so the queue keeps them apart.
    const sanitized = String(raw)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    reasons.push(isReservedClientSlug(sanitized) ? "reserved_placeholder_slug" : "unusable_source_id");
  }
  const rawName = row.display_name;
  let displayName: string | null = null;
  if (typeof rawName !== "string" || rawName.trim() === "") {
    reasons.push("missing_display_name");
  } else if (isPlaceholderDisplayName(rawName)) {
    reasons.push("placeholder_display_name");
  } else {
    displayName = rawName.trim();
  }
  return { slug, display_name: displayName, reasons };
}

const IDENTITY_REASON_TEXT: Record<ClientIdentityReasonCode, string> = {
  missing_source_id: "o registro comercial não trouxe source_id nem id",
  unusable_source_id: "o identificador do registro não produz um slug utilizável",
  reserved_placeholder_slug: "o identificador do registro é um placeholder reservado, não uma identidade",
  missing_display_name: "o registro comercial não trouxe nome de cliente",
  placeholder_display_name: "o nome do registro é um placeholder, não uma identidade",
};

function identityWhy(reasons: readonly ClientIdentityReasonCode[]): string {
  return reasons.map((code) => IDENTITY_REASON_TEXT[code]).join("; ");
}

export function projectClientsFromCommercial(commercial: ProjectedSnapshot): ProjectedSnapshot {
  const operations = asRecord(commercial.payload.operations) ?? {};
  const pipeline = asArray(operations.pipeline);
  const exceptions = asArray(operations.exceptions);
  const activity = asArray(operations.activity);

  // Identity-less records never become clients. They are collected here with
  // origin, reason and the single correction that clears them.
  const dataQualityQueue: Record<string, unknown>[] = [];
  // One client per slug: N unusable deals used to collapse into N identical
  // `client:unknown` rows, and N deals for the same real client used to repeat it.
  const bySlug = new Map<string, Record<string, unknown>>();

  pipeline.forEach((item, index) => {
    const row = asRecord(item) ?? {};
    const identity = clientIdentityOf(row);
    const relatedExceptions = exceptions.filter((ex) => {
      const rec = asRecord(ex) ?? {};
      return (
        (typeof row.source_id === "string" && rec.source_id === row.source_id) ||
        (typeof row.id === "string" && rec.source_id === row.id)
      );
    });

    if (identity.slug === null || identity.display_name === null) {
      const locator =
        typeof row.source_id === "string" && row.source_id.trim() !== ""
          ? row.source_id.trim()
          : typeof row.id === "string" && row.id.trim() !== ""
            ? row.id.trim()
            : `pipeline[${index}]`;
      dataQualityQueue.push({
        schema_version: "control-center.client-identity-exception.v1",
        id: `client-identity:${index}`,
        canonical_id: `cc:attention-item:client-identity-${index}`,
        source_id: typeof row.source_id === "string" ? row.source_id : null,
        kind: "client_identity_missing",
        queue: "data_quality.client_identity",
        why: identityWhy(identity.reasons),
        reason_codes: identity.reasons,
        recommended_next_action: CLIENT_IDENTITY_REQUIRED_ACTION,
        status: "open",
        source: CLIENT_IDENTITY_ORIGIN,
        origin: {
          system: commercial.source.system,
          kind: "commercial-deal",
          locator,
        },
        observed_at: commercial.observed_at,
        blocks: "client_publication",
        evidence: {
          stage: row.stage ?? null,
          status: row.status ?? null,
          age_seconds: row.age_seconds ?? null,
        },
      });
      return;
    }

    const last = activity.find((event) => {
      const rec = asRecord(event) ?? {};
      return (
        (typeof row.source_id === "string" && rec.source_id === row.source_id) ||
        (typeof row.id === "string" && rec.source_id === row.id) ||
        rec.lead_or_account === identity.display_name
      );
    });

    const slug = identity.slug;
    const existing = bySlug.get(slug);
    if (existing) {
      existing.active_exceptions = Number(existing.active_exceptions ?? 0) + relatedExceptions.length;
      existing.merged_records = Number(existing.merged_records ?? 1) + 1;
      if (existing.next_action === null && row.next_action !== undefined) {
        existing.next_action = row.next_action;
      }
      return;
    }

    bySlug.set(slug, {
      schema_version: "control-center.client-status.v1",
      id: `cc:client-status:${slug}`,
      scope: `client:${slug}`,
      client_slug: slug,
      display_name: identity.display_name,
      lifecycle: row.status === "won" ? "active" : row.status === "open" ? "lead" : "unknown",
      next_action: row.next_action ?? null,
      last_interaction: asRecord(last)?.at ?? null,
      active_exceptions: relatedExceptions.length,
      merged_records: 1,
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
      },
      unidentified_record_count: dataQualityQueue.length,
      open_blocker_count: exceptions.length,
      at_risk_client_count: clients.filter((row) => Number(row.active_exceptions) > 0).length,
    },
    freshness_status: commercial.freshness_status,
    availability: commercial.availability,
    confidence: commercial.confidence,
    observed_at: commercial.observed_at,
    source: commercial.source,
  };
}
