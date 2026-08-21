import type { PoolClient } from 'pg';
import { ConflictError } from '../errors.js';
import { generatePublicId } from '../ids.js';
import { logEvent } from '../log.js';
import { sourceColumns, toUtcIso } from '../money.js';
import type { OperatorAction, RecordOperatorActionInput } from '../types.js';
import { parseInput, recordOperatorActionInputSchema, scopeQuerySchema } from '../validation.js';
import { insertAuditEvent } from './audit.js';

const COLUMNS = `
  id, action_type, target_canonical_id, target_source_id, actor_kind, actor_id,
  occurred_at, correlation_id, idempotency_key, scope, resulting_status,
  before_json, after_json, evidence_ref, note,
  source_system, source_kind, source_locator, source_label,
  observed_at, freshness_status, confidence, recorded_at
`;

function operatorPayloadConflicts(existing: OperatorAction, input: RecordOperatorActionInput): boolean {
  return (
    existing.actionType !== input.actionType ||
    existing.targetCanonicalId !== input.targetCanonicalId ||
    existing.targetSourceId !== input.targetSourceId
  );
}

function mapRow(row: Record<string, unknown>): OperatorAction {
  return {
    id: String(row.id),
    actionType: row.action_type as OperatorAction['actionType'],
    targetCanonicalId: String(row.target_canonical_id),
    targetSourceId: String(row.target_source_id),
    actorKind: 'human',
    actorId: String(row.actor_id),
    occurredAt: new Date(String(row.occurred_at)),
    correlationId: String(row.correlation_id),
    idempotencyKey: String(row.idempotency_key),
    scope: String(row.scope),
    resultingStatus: row.resulting_status as OperatorAction['resultingStatus'],
    beforeJson: (row.before_json as Record<string, unknown>) ?? {},
    afterJson: (row.after_json as Record<string, unknown>) ?? {},
    evidenceRef: row.evidence_ref ? String(row.evidence_ref) : null,
    note: row.note ? String(row.note) : null,
    source: {
      system: String(row.source_system),
      kind: String(row.source_kind),
      locator: String(row.source_locator),
      ...(row.source_label ? { label: String(row.source_label) } : {}),
    },
    observedAt: new Date(String(row.observed_at)),
    freshnessStatus: row.freshness_status as OperatorAction['freshnessStatus'],
    confidence: Number(row.confidence),
  };
}

export async function recordOperatorAction(
  tx: PoolClient,
  raw: RecordOperatorActionInput,
): Promise<{ action: OperatorAction; inserted: boolean }> {
  const input = parseInput(recordOperatorActionInputSchema, raw, 'recordOperatorAction');
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [input.idempotencyKey]);
  const existing = await tx.query(`SELECT ${COLUMNS} FROM control_center.operator_actions WHERE idempotency_key = $1`, [
    input.idempotencyKey,
  ]);
  if (existing.rowCount === 1) {
    const action = mapRow(existing.rows[0] as Record<string, unknown>);
    if (operatorPayloadConflicts(action, input)) {
      throw new ConflictError('idempotency key reused with conflicting payload');
    }
    return { action: { ...action, resultingStatus: 'duplicate' }, inserted: false };
  }
  const id = generatePublicId('operator-action');
  const source = sourceColumns(input.source);
  const inserted = await tx.query(
    `INSERT INTO control_center.operator_actions (
       id, action_type, target_canonical_id, target_source_id, actor_kind, actor_id,
       occurred_at, correlation_id, idempotency_key, scope, resulting_status,
       before_json, after_json, evidence_ref, note,
       source_system, source_kind, source_locator, source_label,
       observed_at, freshness_status, confidence
     ) VALUES ($1,$2,$3,$4,'human',$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14,$15,$16,$17,$18,$19,$20,$21)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING ${COLUMNS}`,
    [
      id,
      input.actionType,
      input.targetCanonicalId,
      input.targetSourceId,
      input.actorId,
      toUtcIso(input.occurredAt),
      input.correlationId,
      input.idempotencyKey,
      input.scope,
      input.resultingStatus,
      JSON.stringify(input.beforeJson ?? {}),
      JSON.stringify(input.afterJson ?? {}),
      input.evidenceRef ?? null,
      input.note ?? null,
      source.system,
      source.kind,
      source.locator,
      source.label,
      toUtcIso(input.observedAt),
      input.freshnessStatus,
      input.confidence,
    ],
  );
  if (inserted.rowCount !== 1) {
    const again = await tx.query(`SELECT ${COLUMNS} FROM control_center.operator_actions WHERE idempotency_key = $1`, [
      input.idempotencyKey,
    ]);
    const action = mapRow(again.rows[0] as Record<string, unknown>);
    if (operatorPayloadConflicts(action, input)) {
      throw new ConflictError('idempotency key reused with conflicting payload');
    }
    return { action: { ...action, resultingStatus: 'duplicate' }, inserted: false };
  }
  const action = mapRow(inserted.rows[0] as Record<string, unknown>);
  await insertAuditEvent(tx, {
    actor: `human:${input.actorId}`,
    action: `operator_action.${input.actionType}`,
    entityType: 'operator-action',
    entityId: action.id,
    scope: input.scope,
    payload: {
      target_canonical_id: input.targetCanonicalId,
      target_source_id: input.targetSourceId,
      correlation_id: input.correlationId,
    },
    source: input.source,
    observedAt: input.observedAt,
    freshnessStatus: input.freshnessStatus,
    confidence: input.confidence,
  });
  logEvent('operator_action.append', { id: action.id, actionType: input.actionType, scope: input.scope });
  return { action, inserted: true };
}

export async function listOperatorActionsByScope(tx: PoolClient, scope: string): Promise<OperatorAction[]> {
  const parsed = parseInput(scopeQuerySchema, { scope }, 'listOperatorActionsByScope');
  const result = await tx.query(
    `SELECT ${COLUMNS} FROM control_center.operator_actions WHERE scope = $1 ORDER BY occurred_at DESC, id DESC`,
    [parsed.scope],
  );
  return result.rows.map((row) => mapRow(row as Record<string, unknown>));
}
