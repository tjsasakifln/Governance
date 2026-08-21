import {
  canonicalObservationIdempotencyKey,
  canonicalSnapshotIdempotencyKey,
  type Persistence,
} from "@confenge/control-center-persistence";
import type { CollectorEnvelope, CollectorName } from "./run.ts";

export type PersistSourceResult = {
  collector: CollectorName;
  runId: string;
  status: "RUNNING" | "DONE" | "PARTIAL" | "FAILED" | "UNKNOWN";
  freshnessStatus: CollectorEnvelope["freshness_status"];
  observedAt: string;
  errorCode: string | null;
  errorMessage: string | null;
};

function scopeFor(collector: CollectorName): string {
  if (collector === "asaas") {
    return "finance";
  }
  if (collector === "warmbly") {
    return "commercial";
  }
  if (collector === "pncp") {
    return "inbound";
  }
  if (collector === "infra") {
    return "infrastructure";
  }
  return "company";
}

function payloadObject(payload: unknown): Record<string, unknown> {
  if (payload !== null && typeof payload === "object" && !Array.isArray(payload)) {
    return payload as Record<string, unknown>;
  }
  return { value: payload ?? null };
}

export async function persistSourceResult(
  persistence: Persistence,
  envelope: CollectorEnvelope,
): Promise<PersistSourceResult> {
  const observedAt = new Date(envelope.observed_at);
  const scope = scopeFor(envelope.collector);
  const source = {
    system: envelope.source.system,
    kind: envelope.source.kind,
    locator: envelope.source.locator,
  };
  const runKey = `${envelope.collector}:${envelope.source.locator}:${envelope.observed_at}`;
  const started = await persistence.startCollectorRun({
    collectorName: envelope.collector,
    idempotencyKey: runKey,
    scope,
    source,
    observedAt,
    freshnessStatus: envelope.freshness_status,
    confidence: envelope.confidence,
  });
  let observationFailed = false;
  let snapshotFailed = false;
  try {
    await persistence.recordObservation({
      scope,
      observationKind: `${envelope.collector}-collect`,
      payload: payloadObject(envelope.payload),
      idempotencyKey: canonicalObservationIdempotencyKey({
        source,
        observationKind: `${envelope.collector}-collect`,
        observedAt,
      }),
      collectorRunId: started.run.id,
      source,
      observedAt,
      freshnessStatus: envelope.freshness_status,
      confidence: envelope.confidence,
    });
  } catch {
    observationFailed = true;
  }
  try {
    await persistence.recordSnapshot({
      scope,
      snapshotKind: `${envelope.collector}-snapshot`,
      payload: payloadObject(envelope.payload),
      idempotencyKey: canonicalSnapshotIdempotencyKey({
        scope,
        snapshotKind: `${envelope.collector}-snapshot`,
        source,
        observedAt,
      }),
      source,
      observedAt,
      freshnessStatus: envelope.freshness_status,
      confidence: envelope.confidence,
    });
  } catch {
    snapshotFailed = true;
  }
  const collectFailed = Boolean(envelope.error);
  let status: PersistSourceResult["status"] = "DONE";
  if (collectFailed) {
    status = envelope.freshness_status === "UNKNOWN" ? "UNKNOWN" : "FAILED";
  } else if (observationFailed || snapshotFailed) {
    status = "PARTIAL";
  }
  const finished = await persistence.finishCollectorRun({
    id: started.run.id,
    status,
    errorCode: envelope.error?.code ?? (observationFailed || snapshotFailed ? "persist_partial" : null),
    errorMessage: envelope.error?.message ?? null,
    stats: {
      observationFailed,
      snapshotFailed,
      collectFailed,
    },
    observedAt,
    freshnessStatus: envelope.freshness_status,
    confidence: envelope.confidence,
  });
  return {
    collector: envelope.collector,
    runId: finished.id,
    status: finished.status,
    freshnessStatus: finished.freshnessStatus,
    observedAt: finished.observedAt.toISOString(),
    errorCode: finished.errorCode,
    errorMessage: finished.errorMessage,
  };
}
