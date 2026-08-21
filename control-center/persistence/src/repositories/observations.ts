import type { PoolClient } from 'pg';
import { NotFoundError } from '../errors.js';
import { generatePublicId } from '../ids.js';
import { logEvent } from '../log.js';
import { moneyColumns, sourceColumns, toUtcIso } from '../money.js';
import { mapObservation, type ObservationRow } from '../rows.js';
import type { RecordObservationInput, SourceObservation } from '../types.js';
import {
  parseInput,
  publicIdQuerySchema,
  recordObservationInputSchema,
  scopeQuerySchema,
} from '../validation.js';
import { insertAuditEvent } from './audit.js';

const OBSERVATION_COLUMNS = `
  id, source_system, source_kind, source_locator, source_label,
  observed_at, freshness_status, confidence, scope, observation_kind,
  payload, money_amount_cents, money_currency, idempotency_key, collector_run_id, created_at
`;

async function upsertCurrentObservation(tx: PoolClient, observation: SourceObservation): Promise<void> {
  const source = sourceColumns(observation.source);
  await tx.query(
    `INSERT INTO control_center.current_source_observations (
       source_system, source_kind, source_locator, scope, observation_id,
       observed_at, freshness_status, confidence, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
     ON CONFLICT (source_system, source_kind, source_locator, scope) DO UPDATE SET
       observation_id = EXCLUDED.observation_id,
       observed_at = EXCLUDED.observed_at,
       freshness_status = EXCLUDED.freshness_status,
       confidence = EXCLUDED.confidence,
       updated_at = now()
     WHERE EXCLUDED.observed_at >= control_center.current_source_observations.observed_at`,
    [
      source.system,
      source.kind,
      source.locator,
      observation.scope,
      observation.id,
      toUtcIso(observation.observedAt),
      observation.freshnessStatus,
      observation.confidence,
    ],
  );
}

export async function recordObservation(
  tx: PoolClient,
  raw: RecordObservationInput,
): Promise<{ observation: SourceObservation; inserted: boolean }> {
  const input = parseInput(recordObservationInputSchema, raw, 'recordObservation');
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [input.idempotencyKey]);
  const money = moneyColumns(input.money ?? null);
  const source = sourceColumns(input.source);
  const id = generatePublicId('source-observation');
  const insert = await tx.query(
    `INSERT INTO control_center.source_observations (
       id, source_system, source_kind, source_locator, source_label,
       observed_at, freshness_status, confidence, scope, observation_kind,
       payload, money_amount_cents, money_currency, idempotency_key, collector_run_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING ${OBSERVATION_COLUMNS}`,
    [
      id,
      source.system,
      source.kind,
      source.locator,
      source.label,
      toUtcIso(input.observedAt),
      input.freshnessStatus,
      input.confidence,
      input.scope,
      input.observationKind,
      JSON.stringify(input.payload ?? {}),
      money.amountCents,
      money.currency,
      input.idempotencyKey,
      input.collectorRunId ?? null,
    ],
  );

  const inserted = insert.rows.length > 0;
  const row = inserted
    ? (insert.rows[0] as ObservationRow)
    : (
        await tx.query(
          `SELECT ${OBSERVATION_COLUMNS}
           FROM control_center.source_observations
           WHERE idempotency_key = $1`,
          [input.idempotencyKey],
        )
      ).rows[0] as ObservationRow;

  const observation = mapObservation(row);
  await upsertCurrentObservation(tx, observation);
  if (inserted) {
    await insertAuditEvent(tx, {
      actor: 'collector',
      action: 'observation.record',
      entityType: 'source_observation',
      entityId: observation.id,
      scope: observation.scope,
      payload: { observationKind: observation.observationKind },
      source: observation.source,
      observedAt: observation.observedAt,
      freshnessStatus: observation.freshnessStatus,
      confidence: observation.confidence,
    });
    logEvent('observation.record', {
      observationId: observation.id,
      scope: observation.scope,
    });
  }
  return { observation, inserted };
}

export async function listObservationsByScope(tx: PoolClient, scope: string): Promise<SourceObservation[]> {
  const parsed = parseInput(scopeQuerySchema, { scope }, 'listObservationsByScope');
  const result = await tx.query(
    `SELECT ${OBSERVATION_COLUMNS}
     FROM control_center.source_observations
     WHERE scope = $1
     ORDER BY observed_at DESC, id ASC`,
    [parsed.scope],
  );
  return result.rows.map((item) => mapObservation(item as ObservationRow));
}

export async function countObservationsByIdempotencyKey(tx: PoolClient, idempotencyKey: string): Promise<number> {
  const result = await tx.query(
    `SELECT count(*)::int AS n
     FROM control_center.source_observations
     WHERE idempotency_key = $1`,
    [idempotencyKey],
  );
  const row = result.rows[0] as { n: number };
  return row.n;
}

export async function getObservation(tx: PoolClient, id: string): Promise<SourceObservation> {
  const parsed = parseInput(publicIdQuerySchema, { id }, 'getObservation');
  const result = await tx.query(
    `SELECT ${OBSERVATION_COLUMNS} FROM control_center.source_observations WHERE id = $1`,
    [parsed.id],
  );
  if (result.rowCount !== 1) {
    throw new NotFoundError(`source observation ${parsed.id} not found`);
  }
  const observation = mapObservation(result.rows[0] as ObservationRow);
  const latest = await tx.query<{ id: string }>(
    `SELECT id
     FROM control_center.source_observations
     WHERE source_system = $1 AND source_kind = $2 AND source_locator = $3
       AND scope = $4 AND observation_kind = $5
     ORDER BY observed_at DESC, created_at DESC, id DESC
     LIMIT 1`,
    [
      observation.source.system,
      observation.source.kind,
      observation.source.locator,
      observation.scope,
      observation.observationKind,
    ],
  );
  if (latest.rows[0]?.id && latest.rows[0].id !== observation.id) {
    return { ...observation, freshnessStatus: 'STALE' };
  }
  return observation;
}

export async function listLatestSourceObservations(tx: PoolClient): Promise<
  Array<{
    observationId: string;
    scope: string;
    observationType: string;
    sourceSystem: string;
    sourceKind: string;
    sourceLocator: string;
    observedAt: Date;
    freshnessStatus: string;
    confidence: number;
    payloadJson: Record<string, unknown>;
  }>
> {
  const result = await tx.query(
    `SELECT observation_id, scope, observation_type, source_system, source_kind, source_locator,
            observed_at, freshness_status, confidence, payload_json
     FROM control_center.v_latest_source_observations
     ORDER BY source_system, source_kind, source_locator, scope, observation_type`,
  );
  return result.rows.map((row) => {
    const record = row as {
      observation_id: string;
      scope: string;
      observation_type: string;
      source_system: string;
      source_kind: string;
      source_locator: string;
      observed_at: Date;
      freshness_status: string;
      confidence: string | number;
      payload_json: unknown;
    };
    return {
      observationId: record.observation_id,
      scope: record.scope,
      observationType: record.observation_type,
      sourceSystem: record.source_system,
      sourceKind: record.source_kind,
      sourceLocator: record.source_locator,
      observedAt: record.observed_at,
      freshnessStatus: record.freshness_status,
      confidence: Number(record.confidence),
      payloadJson:
        record.payload_json && typeof record.payload_json === 'object' && !Array.isArray(record.payload_json)
          ? (record.payload_json as Record<string, unknown>)
          : {},
    };
  });
}

export function canonicalObservationIdempotencyKey(input: {
  source: { system: string; kind: string; locator: string };
  observationKind: string;
  observedAt: Date;
}): string {
  return [
    input.source.system,
    input.source.kind,
    input.source.locator,
    input.observationKind,
    input.observedAt.toISOString(),
  ].join(':');
}
