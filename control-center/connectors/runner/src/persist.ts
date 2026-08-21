import {
  canonicalObservationIdempotencyKey,
  canonicalSnapshotIdempotencyKey,
  type Persistence,
} from "@confenge/control-center-persistence";
import { fitPersistPayload } from "./persist-payload.ts";
import { projectCollector } from "./projectors/project.ts";
import type { CollectorEnvelope, CollectorName } from "./run.ts";

export type PersistSourceResult = {
  collector: CollectorName;
  runId: string;
  status: "RUNNING" | "DONE" | "PARTIAL" | "FAILED" | "UNKNOWN";
  freshnessStatus: CollectorEnvelope["freshness_status"];
  observedAt: string;
  errorCode: string | null;
  errorMessage: string | null;
  projected: number;
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
  return fitPersistPayload(payload);
}

function logPersistFailure(stage: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(
    `${JSON.stringify({
      ts: new Date().toISOString(),
      component: "control-center-collector",
      event: "persist_failed",
      stage,
      error: message.slice(0, 512),
    })}\n`,
  );
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
  let projected = 0;
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
  } catch (error) {
    observationFailed = true;
    logPersistFailure("observation", error);
  }

  const projections = projectCollector(envelope);
  for (const projectedSnapshot of projections) {
    try {
      await persistence.recordSnapshot({
        scope: projectedSnapshot.scope,
        snapshotKind: projectedSnapshot.snapshot_kind,
        payload: payloadObject(projectedSnapshot.payload),
        idempotencyKey: canonicalSnapshotIdempotencyKey({
          scope: projectedSnapshot.scope,
          snapshotKind: projectedSnapshot.snapshot_kind,
          source: projectedSnapshot.source,
          observedAt,
        }),
        source: projectedSnapshot.source,
        observedAt,
        freshnessStatus: projectedSnapshot.freshness_status,
        confidence: projectedSnapshot.confidence,
      });
      projected += 1;
    } catch (error) {
      snapshotFailed = true;
      logPersistFailure(`snapshot:${projectedSnapshot.snapshot_kind}`, error);
    }
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
      projected,
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
    projected,
  };
}
