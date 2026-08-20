import type { PoolClient } from 'pg';
import { NotFoundError } from '../errors.js';
import { generatePublicId } from '../ids.js';
import { logEvent } from '../log.js';
import { moneyColumns, sourceColumns, toUtcIso } from '../money.js';
import { mapAttention, type AttentionRow } from '../rows.js';
import type { AttentionItem, CreateAttentionItemInput } from '../types.js';
import { createAttentionItemInputSchema, parseInput, scopedIdQuerySchema, scopeQuerySchema } from '../validation.js';
import { insertAuditEvent } from './audit.js';

const ATTENTION_COLUMNS = `
  id, scope, severity, title, body, status,
  source_system, source_kind, source_locator, source_label,
  observed_at, freshness_status,
  confidence, related_directive_id, money_amount_cents, money_currency, expires_at,
  created_at, updated_at
`;

async function upsertCurrentAttention(tx: PoolClient, item: AttentionItem): Promise<void> {
  const source = sourceColumns(item.source);
  await tx.query(
    `INSERT INTO control_center.current_attention_items (
       attention_item_id, scope, severity, status, title,
       source_system, source_kind, source_locator, source_label,
       observed_at, freshness_status, confidence, money_amount_cents, money_currency, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now())
     ON CONFLICT (attention_item_id) DO UPDATE SET
       scope = EXCLUDED.scope,
       severity = EXCLUDED.severity,
       status = EXCLUDED.status,
       title = EXCLUDED.title,
       source_system = EXCLUDED.source_system,
       source_kind = EXCLUDED.source_kind,
       source_locator = EXCLUDED.source_locator,
       source_label = EXCLUDED.source_label,
       observed_at = EXCLUDED.observed_at,
       freshness_status = EXCLUDED.freshness_status,
       confidence = EXCLUDED.confidence,
       money_amount_cents = EXCLUDED.money_amount_cents,
       money_currency = EXCLUDED.money_currency,
       updated_at = now()`,
    [
      item.id,
      item.scope,
      item.severity,
      item.status,
      item.title,
      source.system,
      source.kind,
      source.locator,
      source.label,
      toUtcIso(item.observedAt),
      item.freshnessStatus,
      item.confidence,
      item.money?.amountCents ?? null,
      item.money?.currency ?? null,
    ],
  );
}

async function refreshOpenAttention(tx: PoolClient): Promise<void> {
  await tx.query('REFRESH MATERIALIZED VIEW control_center.mv_open_attention');
}

export async function createAttentionItem(tx: PoolClient, raw: CreateAttentionItemInput): Promise<AttentionItem> {
  const input = parseInput(createAttentionItemInputSchema, raw, 'createAttentionItem');
  const money = moneyColumns(input.money ?? null);
  const source = sourceColumns(input.source);
  const id = generatePublicId('attention-item');
  const result = await tx.query(
    `INSERT INTO control_center.attention_items (
       id, scope, severity, title, body, status,
       source_system, source_kind, source_locator, source_label,
       observed_at, freshness_status,
       confidence, related_directive_id, money_amount_cents, money_currency, expires_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     RETURNING ${ATTENTION_COLUMNS}`,
    [
      id,
      input.scope,
      input.severity,
      input.title,
      input.body,
      input.status,
      source.system,
      source.kind,
      source.locator,
      source.label,
      toUtcIso(input.observedAt),
      input.freshnessStatus,
      input.confidence,
      input.relatedDirectiveId ?? null,
      money.amountCents,
      money.currency,
      input.expiresAt ? toUtcIso(input.expiresAt) : null,
    ],
  );
  const item = mapAttention(result.rows[0] as AttentionRow);
  await upsertCurrentAttention(tx, item);
  await refreshOpenAttention(tx);
  await insertAuditEvent(tx, {
    actor: 'operator',
    action: 'attention.create',
    entityType: 'attention_item',
    entityId: item.id,
    scope: item.scope,
    payload: { severity: item.severity, status: item.status },
    source: item.source,
    observedAt: item.observedAt,
    freshnessStatus: item.freshnessStatus,
    confidence: item.confidence,
  });
  logEvent('attention.create', { attentionId: item.id, scope: item.scope, severity: item.severity });
  return item;
}

export async function resolveAttentionItem(
  tx: PoolClient,
  scope: string,
  id: string,
  observedAt: Date,
): Promise<AttentionItem> {
  const parsed = parseInput(scopedIdQuerySchema, { scope, id }, 'resolveAttentionItem');
  const result = await tx.query(
    `UPDATE control_center.attention_items
     SET status = 'resolved', updated_at = now(), observed_at = $3
     WHERE id = $1 AND scope = $2
     RETURNING ${ATTENTION_COLUMNS}`,
    [parsed.id, parsed.scope, toUtcIso(observedAt)],
  );
  if (result.rowCount !== 1) {
    throw new NotFoundError(`attention item ${parsed.id} not found in scope ${parsed.scope}`);
  }
  const item = mapAttention(result.rows[0] as AttentionRow);
  await upsertCurrentAttention(tx, item);
  await refreshOpenAttention(tx);
  await insertAuditEvent(tx, {
    actor: 'operator',
    action: 'attention.resolve',
    entityType: 'attention_item',
    entityId: item.id,
    scope: item.scope,
    payload: { status: item.status },
    source: item.source,
    observedAt: item.observedAt,
    freshnessStatus: item.freshnessStatus,
    confidence: item.confidence,
  });
  return item;
}

export async function listAttentionItemsByScope(tx: PoolClient, scope: string): Promise<AttentionItem[]> {
  const parsed = parseInput(scopeQuerySchema, { scope }, 'listAttentionItemsByScope');
  const result = await tx.query(
    `SELECT ${ATTENTION_COLUMNS}
     FROM control_center.attention_items
     WHERE scope = $1
     ORDER BY created_at DESC, id ASC`,
    [parsed.scope],
  );
  return result.rows.map((row) => mapAttention(row as AttentionRow));
}
