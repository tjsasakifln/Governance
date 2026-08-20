import type pg from 'pg';
import { withTransaction } from './db.js';
import {
  appliedMigrations,
  listNamedObjects,
  migrateDown,
  migrateUp,
} from './migrate.js';
import {
  listAgentActivitiesByScope,
  recordAgentActivity,
} from './repositories/agent-activities.js';
import { endAgentSession, listAgentSessionsByScope, startAgentSession } from './repositories/agent-sessions.js';
import { createAttentionItem, listAttentionItemsByScope, resolveAttentionItem } from './repositories/attention-items.js';
import { getAuditEvent, insertAuditEvent, listAuditEventsByScope, listAuditEventsForEntity } from './repositories/audit.js';
import {
  countCollectorRunsByIdempotencyKey,
  finishCollectorRun,
  listCollectorRunsByScope,
  startCollectorRun,
} from './repositories/collector-runs.js';
import {
  createDirective,
  getDirective,
  getRevision,
  listCurrentDirectivesByScope,
  listRevisionsByScope,
  supersedeDirective,
} from './repositories/directives.js';
import { countObservationsByIdempotencyKey, listObservationsByScope, recordObservation } from './repositories/observations.js';
import { listSnapshotsByScope, recordSnapshot } from './repositories/snapshots.js';
import type {
  AppendAuditEventInput,
  CreateAttentionItemInput,
  CreateDirectiveInput,
  FinishCollectorRunInput,
  RecordAgentActivityInput,
  RecordObservationInput,
  RecordSnapshotInput,
  StartAgentSessionInput,
  StartCollectorRunInput,
  SupersedeDirectiveInput,
} from './types.js';

export class Persistence {
  constructor(readonly pool: pg.Pool) {}

  async migrateUp(): Promise<string[]> {
    return migrateUp(this.pool);
  }

  async migrateDown(): Promise<string[]> {
    return migrateDown(this.pool);
  }

  async appliedMigrations(): Promise<string[]> {
    return appliedMigrations(this.pool);
  }

  async listNamedObjects(): Promise<{ tables: string[]; materializedViews: string[] }> {
    return listNamedObjects(this.pool);
  }

  async createDirective(input: CreateDirectiveInput) {
    return withTransaction(this.pool, (tx) => createDirective(tx, input));
  }

  async supersedeDirective(input: SupersedeDirectiveInput) {
    return withTransaction(this.pool, (tx) => supersedeDirective(tx, input));
  }

  async getDirective(id: string) {
    return withTransaction(this.pool, (tx) => getDirective(tx, id));
  }

  async getRevision(id: string) {
    return withTransaction(this.pool, (tx) => getRevision(tx, id));
  }

  async listCurrentDirectivesByScope(scope: string) {
    return withTransaction(this.pool, (tx) => listCurrentDirectivesByScope(tx, scope));
  }

  async listRevisionsByScope(scope: string, directiveId: string) {
    return withTransaction(this.pool, (tx) => listRevisionsByScope(tx, scope, directiveId));
  }

  async recordObservation(input: RecordObservationInput) {
    return withTransaction(this.pool, (tx) => recordObservation(tx, input));
  }

  async listObservationsByScope(scope: string) {
    return withTransaction(this.pool, (tx) => listObservationsByScope(tx, scope));
  }

  async countObservationsByIdempotencyKey(idempotencyKey: string) {
    return withTransaction(this.pool, (tx) => countObservationsByIdempotencyKey(tx, idempotencyKey));
  }

  async startCollectorRun(input: StartCollectorRunInput) {
    return withTransaction(this.pool, (tx) => startCollectorRun(tx, input));
  }

  async finishCollectorRun(input: FinishCollectorRunInput) {
    return withTransaction(this.pool, (tx) => finishCollectorRun(tx, input));
  }

  async listCollectorRunsByScope(scope: string) {
    return withTransaction(this.pool, (tx) => listCollectorRunsByScope(tx, scope));
  }

  async countCollectorRunsByIdempotencyKey(idempotencyKey: string) {
    return withTransaction(this.pool, (tx) => countCollectorRunsByIdempotencyKey(tx, idempotencyKey));
  }

  async recordSnapshot(input: RecordSnapshotInput) {
    return withTransaction(this.pool, (tx) => recordSnapshot(tx, input));
  }

  async listSnapshotsByScope(scope: string) {
    return withTransaction(this.pool, (tx) => listSnapshotsByScope(tx, scope));
  }

  async createAttentionItem(input: CreateAttentionItemInput) {
    return withTransaction(this.pool, (tx) => createAttentionItem(tx, input));
  }

  async resolveAttentionItem(scope: string, id: string, observedAt: Date) {
    return withTransaction(this.pool, (tx) => resolveAttentionItem(tx, scope, id, observedAt));
  }

  async listAttentionItemsByScope(scope: string) {
    return withTransaction(this.pool, (tx) => listAttentionItemsByScope(tx, scope));
  }

  async startAgentSession(input: StartAgentSessionInput) {
    return withTransaction(this.pool, (tx) => startAgentSession(tx, input));
  }

  async endAgentSession(scope: string, id: string) {
    return withTransaction(this.pool, (tx) => endAgentSession(tx, scope, id));
  }

  async listAgentSessionsByScope(scope: string) {
    return withTransaction(this.pool, (tx) => listAgentSessionsByScope(tx, scope));
  }

  async recordAgentActivity(input: RecordAgentActivityInput) {
    return withTransaction(this.pool, (tx) => recordAgentActivity(tx, input));
  }

  async listAgentActivitiesByScope(scope: string) {
    return withTransaction(this.pool, (tx) => listAgentActivitiesByScope(tx, scope));
  }

  async appendAuditEvent(input: AppendAuditEventInput) {
    return withTransaction(this.pool, (tx) => insertAuditEvent(tx, input));
  }

  async getAuditEvent(id: string) {
    return withTransaction(this.pool, (tx) => getAuditEvent(tx, id));
  }

  async listAuditEventsByScope(scope: string) {
    return withTransaction(this.pool, (tx) => listAuditEventsByScope(tx, scope));
  }

  async listAuditEventsForEntity(scope: string, entityId: string) {
    return withTransaction(this.pool, (tx) => listAuditEventsForEntity(tx, scope, entityId));
  }
}

export function createPersistence(pool: pg.Pool): Persistence {
  return new Persistence(pool);
}
