import type { PoolClient } from 'pg';
import { NotFoundError } from '../errors.js';
import { generatePublicId } from '../ids.js';
import { logEvent } from '../log.js';
import { sourceColumns, toUtcIso } from '../money.js';
import { mapCollectorRun, type CollectorRunRow } from '../rows.js';
import { toObjectiveCollectorRunStatus } from '../run-status.js';
import { assertSanitizedJson, sanitizeErrorCode, sanitizeErrorMessage } from '../sanitize.js';
import type { CollectorRun, FinishCollectorRunInput, StartCollectorRunInput } from '../types.js';
import {
  finishCollectorRunInputSchema,
  parseInput,
  scopeQuerySchema,
  startCollectorRunInputSchema,
} from '../validation.js';
import { insertAuditEvent } from './audit.js';

const RUN_COLUMNS = `
  r.id, r.collector_name, r.idempotency_key,
  rev.status, r.started_at, rev.finished_at,
  rev.source_system, rev.source_kind, rev.source_locator, rev.source_label,
  rev.observed_at, rev.freshness_status, rev.confidence, r.scope,
  rev.error_code, rev.error_message, rev.payload AS stats, rev.payload_ref, rev.revision_no
`;

const LATEST_FROM = `
  control_center.collector_runs r
  JOIN control_center.collector_run_revisions rev
    ON rev.run_id = r.id
   AND rev.revision_no = (
     SELECT max(r2.revision_no) FROM control_center.collector_run_revisions r2 WHERE r2.run_id = r.id
   )
`;

async function selectRunById(tx: PoolClient, id: string): Promise<CollectorRun | null> {
  const result = await tx.query(`SELECT ${RUN_COLUMNS} FROM ${LATEST_FROM} WHERE r.id = $1`, [id]);
  if (result.rowCount !== 1) {
    return null;
  }
  return mapCollectorRun(result.rows[0] as CollectorRunRow);
}

async function selectRunByIdempotencyKey(tx: PoolClient, key: string): Promise<CollectorRun | null> {
  const result = await tx.query(`SELECT ${RUN_COLUMNS} FROM ${LATEST_FROM} WHERE r.idempotency_key = $1`, [key]);
  if (result.rowCount !== 1) {
    return null;
  }
  return mapCollectorRun(result.rows[0] as CollectorRunRow);
}

async function insertRevision(
  tx: PoolClient,
  input: {
    runId: string;
    revisionNo: number;
    status: CollectorRun['status'];
    startedAt: Date;
    finishedAt: Date | null;
    source: ReturnType<typeof sourceColumns>;
    observedAt: Date;
    freshnessStatus: CollectorRun['freshnessStatus'];
    confidence: number;
    errorCode: string | null;
    errorMessage: string | null;
    payload: Record<string, unknown>;
    payloadRef: string | null;
  },
): Promise<void> {
  const id = generatePublicId('collector-run-revision');
  await tx.query(
    `INSERT INTO control_center.collector_run_revisions (
       id, run_id, revision_no, status, started_at, finished_at,
       source_system, source_kind, source_locator, source_label,
       observed_at, freshness_status, confidence, error_code, error_message, payload, payload_ref
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17)`,
    [
      id,
      input.runId,
      input.revisionNo,
      input.status,
      toUtcIso(input.startedAt),
      input.finishedAt ? toUtcIso(input.finishedAt) : null,
      input.source.system,
      input.source.kind,
      input.source.locator,
      input.source.label,
      toUtcIso(input.observedAt),
      input.freshnessStatus,
      input.confidence,
      input.errorCode,
      input.errorMessage,
      JSON.stringify(input.payload),
      input.payloadRef,
    ],
  );
}

export async function startCollectorRun(
  tx: PoolClient,
  raw: StartCollectorRunInput,
): Promise<{ run: CollectorRun; inserted: boolean }> {
  const input = parseInput(startCollectorRunInputSchema, raw, 'startCollectorRun');
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [input.idempotencyKey]);
  const existing = await selectRunByIdempotencyKey(tx, input.idempotencyKey);
  if (existing) {
    return { run: existing, inserted: false };
  }
  const id = generatePublicId('collector-run');
  const source = sourceColumns(input.source);
  const inserted = await tx.query(
    `INSERT INTO control_center.collector_runs (
       id, collector_name, idempotency_key, status, started_at,
       source_system, source_kind, source_locator, source_label,
       observed_at, freshness_status, confidence, scope, stats
     ) VALUES ($1,$2,$3,'RUNNING',$4,$5,$6,$7,$8,$9,$10,$11,$12,'{}'::jsonb)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [
      id,
      input.collectorName,
      input.idempotencyKey,
      toUtcIso(input.observedAt),
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
  if (inserted.rowCount !== 1) {
    const raced = await selectRunByIdempotencyKey(tx, input.idempotencyKey);
    if (!raced) {
      throw new NotFoundError(`collector run for key ${input.idempotencyKey} not found after conflict`);
    }
    return { run: raced, inserted: false };
  }
  await insertRevision(tx, {
    runId: id,
    revisionNo: 1,
    status: 'RUNNING',
    startedAt: input.observedAt,
    finishedAt: null,
    source,
    observedAt: input.observedAt,
    freshnessStatus: input.freshnessStatus,
    confidence: input.confidence,
    errorCode: null,
    errorMessage: null,
    payload: {},
    payloadRef: null,
  });
  const run = await selectRunById(tx, id);
  if (!run) {
    throw new NotFoundError(`collector run ${id} not found after insert`);
  }
  await insertAuditEvent(tx, {
    actor: input.collectorName,
    action: 'collector_run.start',
    entityType: 'collector_run',
    entityId: run.id,
    scope: run.scope,
    payload: { collectorName: run.collectorName, revisionNo: run.revisionNo },
    source: run.source,
    observedAt: run.observedAt,
    freshnessStatus: run.freshnessStatus,
    confidence: run.confidence,
  });
  logEvent('collector_run.start', { runId: run.id, scope: run.scope, collectorName: run.collectorName });
  return { run, inserted: true };
}

export async function finishCollectorRun(tx: PoolClient, raw: FinishCollectorRunInput): Promise<CollectorRun> {
  const input = parseInput(finishCollectorRunInputSchema, raw, 'finishCollectorRun');
  const status = toObjectiveCollectorRunStatus(input.status);
  const identity = await tx.query(`SELECT idempotency_key FROM control_center.collector_runs WHERE id = $1`, [input.id]);
  if (identity.rowCount !== 1) {
    throw new NotFoundError(`collector run ${input.id} not found`);
  }
  const idempotencyKey = (identity.rows[0] as { idempotency_key: string }).idempotency_key;
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [idempotencyKey]);
  const current = await selectRunById(tx, input.id);
  if (!current) {
    throw new NotFoundError(`collector run ${input.id} not found`);
  }
  const payload = assertSanitizedJson({ ...(input.stats ?? {}), ...(input.payload ?? {}) }, 'finishCollectorRun.payload');
  const errorCode = sanitizeErrorCode(input.errorCode ?? null);
  const errorMessage = sanitizeErrorMessage(input.errorMessage ?? null);
  const sameTerminal =
    current.status === status &&
    current.errorCode === errorCode &&
    JSON.stringify(current.stats) === JSON.stringify(payload);
  if (sameTerminal && current.status !== 'RUNNING') {
    return current;
  }
  const finishedAt = input.observedAt < current.startedAt ? current.startedAt : input.observedAt;
  await insertRevision(tx, {
    runId: current.id,
    revisionNo: current.revisionNo + 1,
    status,
    startedAt: current.startedAt,
    finishedAt,
    source: sourceColumns(current.source),
    observedAt: input.observedAt,
    freshnessStatus: input.freshnessStatus,
    confidence: input.confidence,
    errorCode,
    errorMessage,
    payload,
    payloadRef: input.payloadRef ?? null,
  });
  const run = await selectRunById(tx, current.id);
  if (!run) {
    throw new NotFoundError(`collector run ${input.id} not found after finish`);
  }
  await insertAuditEvent(tx, {
    actor: run.collectorName,
    action: 'collector_run.finish',
    entityType: 'collector_run',
    entityId: run.id,
    scope: run.scope,
    payload: { status: run.status, errorCode: run.errorCode, revisionNo: run.revisionNo },
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
    `SELECT ${RUN_COLUMNS} FROM ${LATEST_FROM} WHERE r.scope = $1 ORDER BY r.started_at DESC, r.id ASC`,
    [parsed.scope],
  );
  return result.rows.map((row) => mapCollectorRun(row as CollectorRunRow));
}

export async function listLatestCollectorRuns(tx: PoolClient): Promise<
  Array<{
    collector: string;
    runId: string;
    status: string;
    freshnessStatus: string;
    startedAt: Date;
    finishedAt: Date | null;
    observedAt: Date;
    errorCode: string | null;
    payloadJson: Record<string, unknown>;
  }>
> {
  const result = await tx.query(
    `SELECT collector, run_id, status, freshness_status, started_at, finished_at,
            observed_at, error_code, payload_json
     FROM control_center.v_latest_collector_runs
     ORDER BY collector ASC`,
  );
  return result.rows.map((row) => {
    const record = row as {
      collector: string;
      run_id: string;
      status: string;
      freshness_status: string;
      started_at: Date;
      finished_at: Date | null;
      observed_at: Date;
      error_code: string | null;
      payload_json: unknown;
    };
    return {
      collector: record.collector,
      runId: record.run_id,
      status: record.status,
      freshnessStatus: record.freshness_status,
      startedAt: record.started_at,
      finishedAt: record.finished_at,
      observedAt: record.observed_at,
      errorCode: record.error_code,
      payloadJson:
        record.payload_json && typeof record.payload_json === 'object' && !Array.isArray(record.payload_json)
          ? (record.payload_json as Record<string, unknown>)
          : {},
    };
  });
}

export async function countCollectorRunsByIdempotencyKey(tx: PoolClient, idempotencyKey: string): Promise<number> {
  const result = await tx.query(
    `SELECT count(*)::int AS n FROM control_center.collector_runs WHERE idempotency_key = $1`,
    [idempotencyKey],
  );
  return (result.rows[0] as { n: number }).n;
}
