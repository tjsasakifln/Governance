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

export function projectClientsFromCommercial(commercial: ProjectedSnapshot): ProjectedSnapshot {
  const operations = asRecord(commercial.payload.operations) ?? {};
  const pipeline = asArray(operations.pipeline);
  const exceptions = asArray(operations.exceptions);
  const activity = asArray(operations.activity);
  const clients = capList(
    pipeline.map((item) => {
      const row = asRecord(item) ?? {};
      const slug = String(row.source_id ?? row.id ?? "unknown")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "unknown";
      const relatedExceptions = exceptions.filter((ex) => {
        const rec = asRecord(ex) ?? {};
        return rec.source_id === row.source_id || rec.source_id === row.id;
      });
      const last = activity.find((event) => {
        const rec = asRecord(event) ?? {};
        return rec.source_id === row.source_id || rec.lead_or_account === row.display_name;
      });
      return {
        schema_version: "control-center.client-status.v1",
        id: `cc:client-status:${slug}`,
        scope: `client:${slug}`,
        client_slug: slug,
        display_name: row.display_name ?? slug,
        lifecycle: row.status === "won" ? "active" : row.status === "open" ? "lead" : "unknown",
        next_action: row.next_action,
        last_interaction: asRecord(last)?.at ?? null,
        active_exceptions: relatedExceptions.length,
        sources: {
          warmbly: commercial.availability,
          asaas: "UNKNOWN",
          governance: "UNKNOWN",
        },
      };
    }),
  );

  return {
    projector_version: PROJECTOR_VERSION,
    snapshot_kind: "clients",
    scope: "clients",
    payload: {
      schema_version: "control-center.clients-snapshot.v1",
      projector_version: PROJECTOR_VERSION,
      availability: commercial.availability,
      clients,
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
