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
