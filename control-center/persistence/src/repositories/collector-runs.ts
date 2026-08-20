import type { PoolClient } from 'pg';
import { NotFoundError } from '../errors.js';
import { generatePublicId } from '../ids.js';
import { logEvent } from '../log.js';
import { sourceColumns, toUtcIso } from '../money.js';
import { mapCollectorRun, type CollectorRunRow } from '../rows.js';
import type { CollectorRun, FinishCollectorRunInput, StartCollectorRunInput } from '../types.js';
import {
  finishCollectorRunInputSchema,
  parseInput,
  scopeQuerySchema,
  startCollectorRunInputSchema,
} from '../validation.js';
import { insertAuditEvent } from './audit.js';

const RUN_COLUMNS = `
  id, collector_name, idempotency_key, status, started_at, finished_at,
  source_system, source_kind, source_locator, source_label,
  observed_at, freshness_status, confidence, scope, error_code, stats
`;

export async function startCollectorRun(
  tx: PoolClient,
  raw: StartCollectorRunInput,
): Promise<{ run: CollectorRun; inserted: boolean }> {
  const input = parseInput(startCollectorRunInputSchema, raw, 'startCollectorRun');
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [input.idempotencyKey]);
  const id = generatePublicId('collector-run');
  const source = sourceColumns(input.source);
  const insert = await tx.query(
    `INSERT INTO control_center.collector_runs (
       id, collector_name, idempotency_key, status,
       source_system, source_kind, source_locator, source_label,
       observed_at, freshness_status, confidence, scope, stats
     ) VALUES ($1,$2,$3,'started',$4,$5,$6,$7,$8,$9,$10,$11,'{}'::jsonb)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING ${RUN_COLUMNS}`,
    [
      id,
      input.collectorName,
      input.idempotencyKey,
      source.system,
      source.kind,
      source.locator,
      source.label,
      toUtcIso(input.observedAt),
      input.freshnessStatus,
      input.confidence,
      input.scope,
    ],
  );
  const inserted = insert.rows.length > 0;
  const row = inserted
    ? (insert.rows[0] as CollectorRunRow)
    : (
        await tx.query(
          `SELECT ${RUN_COLUMNS} FROM control_center.collector_runs WHERE idempotency_key = $1`,
          [input.idempotencyKey],
        )
      ).rows[0] as CollectorRunRow;
  const run = mapCollectorRun(row);
  if (inserted) {
    await insertAuditEvent(tx, {
      actor: input.collectorName,
      action: 'collector_run.start',
      entityType: 'collector_run',
      entityId: run.id,
      scope: run.scope,
      payload: { collectorName: run.collectorName },
      source: run.source,
      observedAt: run.observedAt,
      freshnessStatus: run.freshnessStatus,
      confidence: run.confidence,
    });
    logEvent('collector_run.start', { runId: run.id, scope: run.scope, collectorName: run.collectorName });
  }
  return { run, inserted };
}

export async function finishCollectorRun(tx: PoolClient, raw: FinishCollectorRunInput): Promise<CollectorRun> {
  const input = parseInput(finishCollectorRunInputSchema, raw, 'finishCollectorRun');
  const result = await tx.query(
    `UPDATE control_center.collector_runs
     SET status = $2,
         finished_at = now(),
         observed_at = $3,
         freshness_status = $4,
         confidence = $5,
         error_code = $6,
         stats = $7::jsonb
     WHERE id = $1
     RETURNING ${RUN_COLUMNS}`,
    [
      input.id,
      input.status,
      toUtcIso(input.observedAt),
      input.freshnessStatus,
      input.confidence,
      input.errorCode ?? null,
      JSON.stringify(input.stats ?? {}),
    ],
  );
  if (result.rowCount !== 1) {
    throw new NotFoundError(`collector run ${input.id} not found`);
  }
  const run = mapCollectorRun(result.rows[0] as CollectorRunRow);
  await insertAuditEvent(tx, {
    actor: run.collectorName,
    action: 'collector_run.finish',
    entityType: 'collector_run',
    entityId: run.id,
    scope: run.scope,
    payload: { status: run.status, errorCode: run.errorCode },
    source: run.source,
    observedAt: run.observedAt,
    freshnessStatus: run.freshnessStatus,
    confidence: run.confidence,
  });
  logEvent('collector_run.finish', { runId: run.id, status: run.status, scope: run.scope });
  return run;
}

export async function listCollectorRunsByScope(tx: PoolClient, scope: string): Promise<CollectorRun[]> {
  const parsed = parseInput(scopeQuerySchema, { scope }, 'listCollectorRunsByScope');
  const result = await tx.query(
    `SELECT ${RUN_COLUMNS}
     FROM control_center.collector_runs
     WHERE scope = $1
     ORDER BY started_at DESC, id ASC`,
    [parsed.scope],
  );
  return result.rows.map((row) => mapCollectorRun(row as CollectorRunRow));
}

export async function countCollectorRunsByIdempotencyKey(tx: PoolClient, idempotencyKey: string): Promise<number> {
  const result = await tx.query(
    `SELECT count(*)::int AS n FROM control_center.collector_runs WHERE idempotency_key = $1`,
    [idempotencyKey],
  );
  return (result.rows[0] as { n: number }).n;
}
