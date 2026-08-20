import type { PoolClient } from 'pg';
import { generatePublicId } from '../ids.js';
import { logEvent } from '../log.js';
import { moneyColumns, sourceColumns, toUtcIso } from '../money.js';
import { mapSnapshot, type SnapshotRow } from '../rows.js';
import type { OperationalSnapshot, RecordSnapshotInput } from '../types.js';
import { parseInput, recordSnapshotInputSchema, scopeQuerySchema } from '../validation.js';
import { insertAuditEvent } from './audit.js';

const SNAPSHOT_COLUMNS = `
  id, scope, snapshot_kind, source_system, source_kind, source_locator, source_label,
  observed_at, freshness_status, confidence,
  payload, money_amount_cents, money_currency, created_at
`;

export async function recordSnapshot(tx: PoolClient, raw: RecordSnapshotInput): Promise<OperationalSnapshot> {
  const input = parseInput(recordSnapshotInputSchema, raw, 'recordSnapshot');
  const money = moneyColumns(input.money ?? null);
  const source = sourceColumns(input.source);
  const id = generatePublicId('operational-snapshot');
  const result = await tx.query(
    `INSERT INTO control_center.operational_snapshots (
       id, scope, snapshot_kind, source_system, source_kind, source_locator, source_label,
       observed_at, freshness_status, confidence,
       payload, money_amount_cents, money_currency
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13)
     RETURNING ${SNAPSHOT_COLUMNS}`,
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
    ],
  );
  const snapshot = mapSnapshot(result.rows[0] as SnapshotRow);
  await insertAuditEvent(tx, {
    actor: 'collector',
    action: 'snapshot.record',
    entityType: 'operational_snapshot',
    entityId: snapshot.id,
    scope: snapshot.scope,
    payload: { snapshotKind: snapshot.snapshotKind },
    source: snapshot.source,
    observedAt: snapshot.observedAt,
    freshnessStatus: snapshot.freshnessStatus,
    confidence: snapshot.confidence,
  });
  logEvent('snapshot.record', { snapshotId: snapshot.id, scope: snapshot.scope });
  return snapshot;
}

export async function listSnapshotsByScope(tx: PoolClient, scope: string): Promise<OperationalSnapshot[]> {
  const parsed = parseInput(scopeQuerySchema, { scope }, 'listSnapshotsByScope');
  const result = await tx.query(
    `SELECT ${SNAPSHOT_COLUMNS}
     FROM control_center.operational_snapshots
     WHERE scope = $1
     ORDER BY observed_at DESC, id ASC`,
    [parsed.scope],
  );
  return result.rows.map((row) => mapSnapshot(row as SnapshotRow));
}
