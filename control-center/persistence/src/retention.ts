import type pg from 'pg';
import { ValidationError } from './errors.js';
import { withTransaction } from './db.js';
import { insertAuditEvent } from './repositories/audit.js';

export const RETENTION_MIN_AGE_DAYS = 90;

export type RetentionPolicy = {
  maxAgeDays: number;
  applyDeletes?: boolean;
  actor: string;
  scope?: string;
  observedAt?: Date;
};

export type RetentionResult = {
  deleted: number;
  applyDeletes: false;
  candidates: {
    collectorRunRevisions: number;
    sourceObservations: number;
    operationalSnapshotRevisions: number;
    auditEvents: number;
  };
  reason: string;
};

function assertPolicy(policy: RetentionPolicy | null | undefined): RetentionPolicy {
  if (!policy || typeof policy !== 'object') {
    throw new ValidationError('retention policy is required');
  }
  if (
    typeof policy.maxAgeDays !== 'number' ||
    !Number.isInteger(policy.maxAgeDays) ||
    policy.maxAgeDays < RETENTION_MIN_AGE_DAYS
  ) {
    throw new ValidationError(
      `retention maxAgeDays must be an integer >= ${RETENTION_MIN_AGE_DAYS} (conservative fail-closed)`,
    );
  }
  if (typeof policy.actor !== 'string' || policy.actor.trim().length === 0) {
    throw new ValidationError('retention actor is required');
  }
  if (policy.applyDeletes === true) {
    throw new ValidationError('retention refuses destructive purge of append-only history');
  }
  return policy;
}

export async function applyRetention(pool: pg.Pool, raw: RetentionPolicy): Promise<RetentionResult> {
  const policy = assertPolicy(raw);
  const cutoff = new Date(Date.now() - policy.maxAgeDays * 24 * 60 * 60 * 1000);
  return withTransaction(pool, async (tx) => {
    const runs = await tx.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM control_center.collector_run_revisions WHERE recorded_at < $1`,
      [cutoff.toISOString()],
    );
    const observations = await tx.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM control_center.source_observations WHERE created_at < $1`,
      [cutoff.toISOString()],
    );
    const snapshots = await tx.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM control_center.operational_snapshot_revisions WHERE recorded_at < $1`,
      [cutoff.toISOString()],
    );
    const audits = await tx.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM control_center.audit_events WHERE occurred_at < $1`,
      [cutoff.toISOString()],
    );
    const candidates = {
      collectorRunRevisions: runs.rows[0]?.n ?? 0,
      sourceObservations: observations.rows[0]?.n ?? 0,
      operationalSnapshotRevisions: snapshots.rows[0]?.n ?? 0,
      auditEvents: audits.rows[0]?.n ?? 0,
    };
    const result: RetentionResult = {
      deleted: 0,
      applyDeletes: false,
      candidates,
      reason: 'append-only history is never deleted; retention is audit-only',
    };
    await insertAuditEvent(tx, {
      actor: policy.actor.trim(),
      action: 'retention.evaluate',
      entityType: 'retention',
      entityId: null,
      scope: policy.scope ?? 'company',
      payload: {
        maxAgeDays: policy.maxAgeDays,
        applyDeletes: false,
        deleted: 0,
        candidates,
      },
      source: { system: 'control-center', kind: 'retention', locator: 'retention.evaluate' },
      observedAt: policy.observedAt ?? new Date(),
      freshnessStatus: 'FRESH',
      confidence: 1,
    });
    return result;
  });
}
