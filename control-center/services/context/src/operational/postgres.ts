import { createPool } from "@confenge/control-center-persistence";
import type pg from "pg";
import { toUtcIso } from "../clock.ts";
import type { FreshnessStatus } from "../types.ts";
import { OperationalUnavailableError } from "./errors.ts";
import type { OperationalReadPort } from "./port.ts";
import {
  COLLECTOR_RUN_STATUSES,
  OPERATIONAL_VIEWS,
  type CollectorRunRow,
  type CollectorRunStatus,
  type OperationalReadResult,
  type OperationalSnapshotRow,
  type SourceObservationRow,
  type SourceRef,
} from "./types.ts";

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function str(row: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function num(row: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return undefined;
}

function utc(value: unknown): string {
  if (value instanceof Date) {
    return toUtcIso(value);
  }
  if (typeof value === "string" && value.endsWith("Z")) {
    return value.includes("T") ? value : `${value}T00:00:00.000Z`;
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return toUtcIso(parsed);
    }
  }
  return toUtcIso(new Date(0));
}

function freshness(value: unknown): FreshnessStatus {
  if (value === "FRESH" || value === "STALE" || value === "UNKNOWN" || value === "ERROR") {
    return value;
  }
  return "UNKNOWN";
}

function sourceFrom(row: Record<string, unknown>): SourceRef {
  const source: SourceRef = {
    system: str(row, "source_system", "sourceSystem") ?? "unknown",
    kind: str(row, "source_kind", "sourceKind") ?? "view",
    locator: str(row, "source_locator", "sourceLocator") ?? "control_center",
  };
  const label = str(row, "source_label", "sourceLabel");
  if (label) {
    source.label = label;
  }
  return source;
}

function payloadOf(row: Record<string, unknown>): Record<string, unknown> {
  const payload = row.payload;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return payload as Record<string, unknown>;
  }
  if (typeof payload === "string") {
    try {
      const parsed: unknown = JSON.parse(payload);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

function runStatus(value: unknown): CollectorRunStatus {
  if (typeof value === "string" && (COLLECTOR_RUN_STATUSES as readonly string[]).includes(value)) {
    return value as CollectorRunStatus;
  }
  return "failed";
}

function mapCollector(row: Record<string, unknown>): CollectorRunRow {
  const stats = asRecord(row.stats);
  const emitted =
    num(row, "observations_emitted", "observationsEmitted") ??
    num(stats, "observations_emitted") ??
    0;
  return {
    id: str(row, "id") ?? "cc:collector-run:unknown",
    collector_name: str(row, "collector_name", "collectorName") ?? "unknown",
    scope: str(row, "scope") ?? "company",
    status: runStatus(row.status),
    started_at: utc(row.started_at ?? row.startedAt),
    finished_at: row.finished_at === null || row.finishedAt === null ? null : utc(row.finished_at ?? row.finishedAt),
    idempotency_key: str(row, "idempotency_key", "idempotencyKey") ?? "unknown",
    read_only: true,
    observations_emitted: emitted,
    error_code: str(row, "error_code", "errorCode") ?? null,
    error_message: str(row, "error_message", "errorMessage") ?? null,
    source: sourceFrom(row),
    observed_at: utc(row.observed_at ?? row.observedAt),
    freshness_status: freshness(row.freshness_status ?? row.freshnessStatus),
    confidence: num(row, "confidence") ?? 0,
  };
}

function mapObservation(row: Record<string, unknown>): SourceObservationRow {
  const mapped: SourceObservationRow = {
    id: str(row, "id", "observation_id") ?? "cc:source-observation:unknown",
    scope: str(row, "scope") ?? "company",
    observation_kind: str(row, "observation_kind", "observationKind") ?? "unknown",
    source: sourceFrom(row),
    observed_at: utc(row.observed_at ?? row.observedAt),
    freshness_status: freshness(row.freshness_status ?? row.freshnessStatus),
    confidence: num(row, "confidence") ?? 0,
    collected_at: utc(row.collected_at ?? row.collectedAt ?? row.created_at ?? row.createdAt ?? row.observed_at),
    idempotency_key: str(row, "idempotency_key", "idempotencyKey") ?? "unknown",
    payload: payloadOf(row),
    error_code: str(row, "error_code", "errorCode") ?? null,
    error_message: str(row, "error_message", "errorMessage") ?? null,
  };
  const schemaRef = str(row, "payload_schema_ref", "payloadSchemaRef");
  if (schemaRef) {
    mapped.payload_schema_ref = schemaRef;
  }
  return mapped;
}

function mapSnapshot(row: Record<string, unknown>): OperationalSnapshotRow {
  return {
    id: str(row, "id") ?? "cc:operational-snapshot:unknown",
    scope: str(row, "scope") ?? "company",
    snapshot_kind: str(row, "snapshot_kind", "snapshotKind") ?? "unknown",
    generated_at: utc(row.generated_at ?? row.generatedAt ?? row.created_at ?? row.observed_at),
    source: sourceFrom(row),
    observed_at: utc(row.observed_at ?? row.observedAt),
    freshness_status: freshness(row.freshness_status ?? row.freshnessStatus),
    confidence: num(row, "confidence") ?? 0,
    payload: payloadOf(row),
  };
}

async function selectView(pool: pg.Pool, view: string): Promise<Record<string, unknown>[]> {
  try {
    const result = await pool.query(`SELECT * FROM ${view}`);
    return result.rows as Record<string, unknown>[];
  } catch (err) {
    const message = err instanceof Error ? err.message : "query failed";
    throw new OperationalUnavailableError(`failed reading ${view}: ${message}`.slice(0, 240));
  }
}

export function createPostgresOperationalPort(connectionString: string): OperationalReadPort {
  const pool = createPool(connectionString);
  return {
    async readLatest(): Promise<OperationalReadResult> {
      const [runs, observations, snapshots] = await Promise.all([
        selectView(pool, OPERATIONAL_VIEWS.collectorRuns),
        selectView(pool, OPERATIONAL_VIEWS.sourceObservations),
        selectView(pool, OPERATIONAL_VIEWS.operationalSnapshots),
      ]);
      return {
        collector_runs: runs.map(mapCollector),
        source_observations: observations.map(mapObservation),
        operational_snapshots: snapshots.map(mapSnapshot),
      };
    },
  };
}
