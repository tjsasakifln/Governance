import type { Money, Provenance } from '../types.js';

/**
 * Contract for future collector workstreams. This package does not call live
 * systems. Collectors should remain read-only against origin systems and write
 * here through Persistence.recordObservation / startCollectorRun.
 */
export type CollectorWritePort = {
  startRun(input: {
    collectorName: string;
    idempotencyKey: string;
    scope: string;
  } & Provenance): Promise<{ runId: string; inserted: boolean }>;
  recordObservation(input: {
    scope: string;
    observationKind: string;
    payload?: Record<string, unknown>;
    money?: Money | null;
    idempotencyKey: string;
    collectorRunId?: string | null;
  } & Provenance): Promise<{ observationId: string; inserted: boolean }>;
};

export const COLLECTOR_IDEMPOTENCY_KEY_FORMAT =
  '<collectorName>:<observationKind>:<logicalEventId-or-observedAt>';
