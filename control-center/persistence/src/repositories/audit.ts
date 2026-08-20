import type { PoolClient } from 'pg';
import { generatePublicId } from '../ids.js';
import { NotFoundError } from '../errors.js';
import { logEvent } from '../log.js';
import { sourceColumns, toUtcIso } from '../money.js';
import { mapAuditEvent, type AuditEventRow } from '../rows.js';
import type { AppendAuditEventInput, AuditEvent } from '../types.js';
import {
  appendAuditEventInputSchema,
  parseInput,
  publicIdQuerySchema,
  scopedIdQuerySchema,
  scopeQuerySchema,
} from '../validation.js';

const AUDIT_COLUMNS = `
  id, occurred_at, actor, action, entity_type, entity_id, scope, payload,
  source_system, source_kind, source_locator, source_label,
  observed_at, freshness_status, confidence
`;

export async function insertAuditEvent(tx: PoolClient, raw: AppendAuditEventInput): Promise<AuditEvent> {
  const input = parseInput(appendAuditEventInputSchema, raw, 'appendAuditEvent');
  const id = generatePublicId('audit-event');
  const source = sourceColumns(input.source);
  const result = await tx.query(
    `INSERT INTO control_center.audit_events (
       id, actor, action, entity_type, entity_id, scope, payload,
       source_system, source_kind, source_locator, source_label,
       observed_at, freshness_status, confidence
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14)
     RETURNING ${AUDIT_COLUMNS}`,
    [
      id,
      input.actor,
      input.action,
      input.entityType,
      input.entityId ?? null,
      input.scope,
      JSON.stringify(input.payload ?? {}),
      source.system,
      source.kind,
      source.locator,
      source.label,
      toUtcIso(input.observedAt),
      input.freshnessStatus,
      input.confidence,
    ],
  );
  logEvent('audit.append', {
    auditId: id,
    action: input.action,
    entityType: input.entityType,
    scope: input.scope,
  });
  return mapAuditEvent(result.rows[0] as AuditEventRow);
}

export async function getAuditEvent(tx: PoolClient, id: string): Promise<AuditEvent> {
  const parsed = parseInput(publicIdQuerySchema, { id }, 'getAuditEvent');
  const result = await tx.query(
    `SELECT ${AUDIT_COLUMNS} FROM control_center.audit_events WHERE id = $1`,
    [parsed.id],
  );
  if (result.rowCount !== 1) {
    throw new NotFoundError(`audit event ${parsed.id} not found`);
  }
  return mapAuditEvent(result.rows[0] as AuditEventRow);
}

export async function listAuditEventsByScope(tx: PoolClient, scope: string): Promise<AuditEvent[]> {
  const parsed = parseInput(scopeQuerySchema, { scope }, 'listAuditEventsByScope');
  const result = await tx.query(
    `SELECT ${AUDIT_COLUMNS}
     FROM control_center.audit_events
     WHERE scope = $1
     ORDER BY occurred_at ASC, id ASC`,
    [parsed.scope],
  );
  return result.rows.map((row) => mapAuditEvent(row as AuditEventRow));
}

export async function listAuditEventsForEntity(
  tx: PoolClient,
  scope: string,
  entityId: string,
): Promise<AuditEvent[]> {
  const parsed = parseInput(scopedIdQuerySchema, { scope, id: entityId }, 'listAuditEventsForEntity');
  const result = await tx.query(
    `SELECT ${AUDIT_COLUMNS}
     FROM control_center.audit_events
     WHERE scope = $1 AND entity_id = $2
     ORDER BY occurred_at ASC, id ASC`,
    [parsed.scope, parsed.id],
  );
  return result.rows.map((row) => mapAuditEvent(row as AuditEventRow));
}

export function isAppendOnlyViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const record = error as { code?: string; message?: string };
  return record.code === '25006' || record.code === '23001' || Boolean(record.message?.includes('append-only'));
}
