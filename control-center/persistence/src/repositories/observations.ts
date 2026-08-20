import type { PoolClient } from 'pg';
import { generatePublicId } from '../ids.js';
import { logEvent } from '../log.js';
import { moneyColumns, sourceColumns, toUtcIso } from '../money.js';
import { mapObservation, type ObservationRow } from '../rows.js';
import type { RecordObservationInput, SourceObservation } from '../types.js';
import { parseInput, recordObservationInputSchema, scopeQuerySchema } from '../validation.js';
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
