import type { PoolClient } from 'pg';
import { NotFoundError } from '../errors.js';
import { generatePublicId } from '../ids.js';
import { logEvent } from '../log.js';
import { moneyColumns, sourceColumns, toUtcIso } from '../money.js';
import { mapSnapshot, type SnapshotRow } from '../rows.js';
import type { OperationalSnapshot, RecordSnapshotInput, ReviseSnapshotInput } from '../types.js';
import {
  parseInput,
  publicIdQuerySchema,
  recordSnapshotInputSchema,
  reviseSnapshotInputSchema,
  scopeQuerySchema,
} from '../validation.js';
import { insertAuditEvent } from './audit.js';

const SNAPSHOT_COLUMNS = `
  s.id, s.scope, s.snapshot_kind,
  rev.source_system, rev.source_kind, rev.source_locator, rev.source_label,
  rev.observed_at, rev.freshness_status, rev.confidence,
  rev.snapshot_json AS payload, s.money_amount_cents, s.money_currency, s.created_at,
  s.idempotency_key, rev.revision_no
`;

const LATEST_FROM = `
  control_center.operational_snapshots s
  JOIN control_center.operational_snapshot_revisions rev
    ON rev.snapshot_id = s.id
   AND rev.revision_no = (
     SELECT max(r2.revision_no)
     FROM control_center.operational_snapshot_revisions r2
     WHERE r2.snapshot_id = s.id
   )
`;

export function canonicalSnapshotIdempotencyKey(input: {
  scope: string;
  snapshotKind: string;
  source: { system: string; kind: string; locator: string };
  observedAt: Date;
}): string {
  return [
    input.scope,
    input.snapshotKind,
    input.source.system,
    input.source.kind,
    input.source.locator,
    input.observedAt.toISOString(),
  ].join(':');
}

async function selectSnapshotById(tx: PoolClient, id: string): Promise<OperationalSnapshot | null> {
  const result = await tx.query(`SELECT ${SNAPSHOT_COLUMNS} FROM ${LATEST_FROM} WHERE s.id = $1`, [id]);
  if (result.rowCount !== 1) {
    return null;
  }
  return mapSnapshot(result.rows[0] as SnapshotRow);
}

async function selectSnapshotByIdempotencyKey(tx: PoolClient, key: string): Promise<OperationalSnapshot | null> {
  const result = await tx.query(`SELECT ${SNAPSHOT_COLUMNS} FROM ${LATEST_FROM} WHERE s.idempotency_key = $1`, [key]);
  if (result.rowCount !== 1) {
    return null;
  }
  return mapSnapshot(result.rows[0] as SnapshotRow);
}

async function insertRevision(
  tx: PoolClient,
  input: {
    snapshotId: string;
    revisionNo: number;
    source: ReturnType<typeof sourceColumns>;
    observedAt: Date;
    freshnessStatus: OperationalSnapshot['freshnessStatus'];
    confidence: number;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  const id = generatePublicId('operational-snapshot-revision');
  await tx.query(
    `INSERT INTO control_center.operational_snapshot_revisions (
       id, snapshot_id, revision_no,
       source_system, source_kind, source_locator, source_label,
       observed_at, freshness_status, confidence, snapshot_json
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
    [
      id,
      input.snapshotId,
      input.revisionNo,
      input.source.system,
      input.source.kind,
      input.source.locator,
      input.source.label,
      toUtcIso(input.observedAt),
      input.freshnessStatus,
      input.confidence,
      JSON.stringify(input.payload),
    ],
  );
}

export async function recordSnapshot(
  tx: PoolClient,
  raw: RecordSnapshotInput,
): Promise<{ snapshot: OperationalSnapshot; inserted: boolean }> {
  const input = parseInput(recordSnapshotInputSchema, raw, 'recordSnapshot');
  const money = moneyColumns(input.money ?? null);
  const source = sourceColumns(input.source);
  const idempotencyKey =
    input.idempotencyKey ??
    canonicalSnapshotIdempotencyKey({
      scope: input.scope,
      snapshotKind: input.snapshotKind,
      source: input.source,
      observedAt: input.observedAt,
    });
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [idempotencyKey]);
  const existing = await selectSnapshotByIdempotencyKey(tx, idempotencyKey);
  if (existing) {
    return { snapshot: existing, inserted: false };
  }
  const id = generatePublicId('operational-snapshot');
  const insert = await tx.query(
    `INSERT INTO control_center.operational_snapshots (
       id, scope, snapshot_kind, source_system, source_kind, source_locator, source_label,
       observed_at, freshness_status, confidence,
       payload, money_amount_cents, money_currency, idempotency_key
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [
      id,
      input.scope,
      input.snapshotKind,
      source.system,
      source.kind,
      source.locator,
      source.label,
      toUtcIso(input.observedAt),
      input.freshnessStatus,
      input.confidence,
      JSON.stringify(input.payload),
      money.amountCents,
      money.currency,
      idempotencyKey,
    ],
  );
  if (insert.rowCount !== 1) {
    const raced = await selectSnapshotByIdempotencyKey(tx, idempotencyKey);
    if (!raced) {
      throw new NotFoundError(`operational snapshot for key ${idempotencyKey} not found after conflict`);
    }
    return { snapshot: raced, inserted: false };
  }
  await insertRevision(tx, {
    snapshotId: id,
    revisionNo: 1,
    source,
    observedAt: input.observedAt,
    freshnessStatus: input.freshnessStatus,
    confidence: input.confidence,
    payload: input.payload,
  });
  const snapshot = await selectSnapshotById(tx, id);
  if (!snapshot) {
    throw new NotFoundError(`operational snapshot ${id} not found after insert`);
  }
  await insertAuditEvent(tx, {
    actor: 'collector',
    action: 'snapshot.record',
    entityType: 'operational_snapshot',
    entityId: snapshot.id,
    scope: snapshot.scope,
    payload: { snapshotKind: snapshot.snapshotKind, revisionNo: snapshot.revisionNo },
    source: snapshot.source,
    observedAt: snapshot.observedAt,
    freshnessStatus: snapshot.freshnessStatus,
    confidence: snapshot.confidence,
  });
  logEvent('snapshot.record', { snapshotId: snapshot.id, scope: snapshot.scope });
  return { snapshot, inserted: true };
}

export async function reviseSnapshot(tx: PoolClient, raw: ReviseSnapshotInput): Promise<OperationalSnapshot> {
  const input = parseInput(reviseSnapshotInputSchema, raw, 'reviseSnapshot');
  const current = await selectSnapshotById(tx, input.id);
  if (!current) {
    throw new NotFoundError(`operational snapshot ${input.id} not found`);
  }
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [current.idempotencyKey]);
  const latest = await selectSnapshotById(tx, input.id);
  if (!latest) {
    throw new NotFoundError(`operational snapshot ${input.id} not found`);
  }
  const source = sourceColumns(input.source);
  await insertRevision(tx, {
    snapshotId: latest.id,
    revisionNo: latest.revisionNo + 1,
    source,
    observedAt: input.observedAt,
    freshnessStatus: input.freshnessStatus,
    confidence: input.confidence,
    payload: input.payload,
  });
  const snapshot = await selectSnapshotById(tx, latest.id);
  if (!snapshot) {
    throw new NotFoundError(`operational snapshot ${input.id} not found after revise`);
  }
  await insertAuditEvent(tx, {
    actor: 'collector',
    action: 'snapshot.revise',
    entityType: 'operational_snapshot',
    entityId: snapshot.id,
    scope: snapshot.scope,
    payload: { snapshotKind: snapshot.snapshotKind, revisionNo: snapshot.revisionNo },
    source: snapshot.source,
    observedAt: snapshot.observedAt,
    freshnessStatus: snapshot.freshnessStatus,
    confidence: snapshot.confidence,
  });
  logEvent('snapshot.revise', { snapshotId: snapshot.id, revisionNo: snapshot.revisionNo });
  return snapshot;
}

export async function getSnapshot(tx: PoolClient, id: string): Promise<OperationalSnapshot> {
  const parsed = parseInput(publicIdQuerySchema, { id }, 'getSnapshot');
  const snapshot = await selectSnapshotById(tx, parsed.id);
  if (!snapshot) {
    throw new NotFoundError(`operational snapshot ${parsed.id} not found`);
  }
  const latest = await tx.query<{ id: string }>(
    `SELECT s.id
     FROM ${LATEST_FROM}
     WHERE s.scope = $1 AND s.snapshot_kind = $2
       AND rev.source_system = $3 AND rev.source_kind = $4 AND rev.source_locator = $5
     ORDER BY rev.observed_at DESC, s.id DESC
     LIMIT 1`,
    [snapshot.scope, snapshot.snapshotKind, snapshot.source.system, snapshot.source.kind, snapshot.source.locator],
  );
  if (latest.rows[0]?.id && latest.rows[0].id !== snapshot.id) {
    return { ...snapshot, freshnessStatus: 'STALE' };
  }
  return snapshot;
}

export async function listSnapshotsByScope(tx: PoolClient, scope: string): Promise<OperationalSnapshot[]> {
  const parsed = parseInput(scopeQuerySchema, { scope }, 'listSnapshotsByScope');
  const result = await tx.query(
    `SELECT ${SNAPSHOT_COLUMNS} FROM ${LATEST_FROM} WHERE s.scope = $1 ORDER BY rev.observed_at DESC, s.id ASC`,
    [parsed.scope],
  );
  return result.rows.map((row) => mapSnapshot(row as SnapshotRow));
}

export async function listLatestOperationalSnapshots(tx: PoolClient): Promise<
  Array<{
    snapshotId: string;
    scope: string;
    snapshotType: string;
    observedAt: Date;
    freshnessStatus: string;
    confidence: number;
    sourceSystem: string;
    sourceKind: string;
    sourceLocator: string;
    snapshotJson: Record<string, unknown>;
  }>
> {
  const result = await tx.query(
    `SELECT snapshot_id, scope, snapshot_type, observed_at, freshness_status, confidence,
            source_system, source_kind, source_locator, snapshot_json
     FROM control_center.v_latest_operational_snapshots
     ORDER BY scope, snapshot_type, source_system, source_kind, source_locator`,
  );
  return result.rows.map((row) => {
    const record = row as {
      snapshot_id: string;
      scope: string;
      snapshot_type: string;
      observed_at: Date;
      freshness_status: string;
      confidence: string | number;
      source_system: string;
      source_kind: string;
      source_locator: string;
      snapshot_json: unknown;
    };
    return {
      snapshotId: record.snapshot_id,
      scope: record.scope,
      snapshotType: record.snapshot_type,
      observedAt: record.observed_at,
      freshnessStatus: record.freshness_status,
      confidence: Number(record.confidence),
      sourceSystem: record.source_system,
      sourceKind: record.source_kind,
      sourceLocator: record.source_locator,
      snapshotJson:
        record.snapshot_json && typeof record.snapshot_json === 'object' && !Array.isArray(record.snapshot_json)
          ? (record.snapshot_json as Record<string, unknown>)
          : {},
    };
  });
}

export async function countSnapshotsByIdempotencyKey(tx: PoolClient, idempotencyKey: string): Promise<number> {
  const result = await tx.query(
    `SELECT count(*)::int AS n FROM control_center.operational_snapshots WHERE idempotency_key = $1`,
    [idempotencyKey],
  );
  return (result.rows[0] as { n: number }).n;
}
