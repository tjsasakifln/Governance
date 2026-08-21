import type pg from 'pg';
import { withTransaction } from './db.js';
import {
  appliedMigrations,
  listNamedObjects,
  listViewColumns,
  migrateDown,
  migrateUp,
} from './migrate.js';
import { applyRetention } from './retention.js';
import { expectedMigrationsPresent, pingStore } from './ready.js';
import {
  listAgentActivitiesByScope,
  listAllAgentActivities,
  recordAgentActivity,
} from './repositories/agent-activities.js';
import { endAgentSession, listAgentSessionsByScope, startAgentSession } from './repositories/agent-sessions.js';
import { createAttentionItem, listAttentionItemsByScope, resolveAttentionItem } from './repositories/attention-items.js';
import { getAuditEvent, insertAuditEvent, listAuditEventsByScope, listAuditEventsForEntity } from './repositories/audit.js';
import {
  countCollectorRunsByIdempotencyKey,
  finishCollectorRun,
  listCollectorRunsByScope,
  listLatestCollectorRuns,
  startCollectorRun,
} from './repositories/collector-runs.js';
import {
  createDirective,
  getDirective,
  getRevision,
  listAllCurrentDirectives,
  listAllRevisions,
  listCurrentDirectivesByScope,
  listRevisionsByScope,
  supersedeDirective,
} from './repositories/directives.js';
import {
  countObservationsByIdempotencyKey,
  getObservation,
  listLatestSourceObservations,
  listObservationsByScope,
  recordObservation,
} from './repositories/observations.js';
import {
  countSnapshotsByIdempotencyKey,
  getSnapshot,
  listLatestOperationalSnapshots,
  listSnapshotsByScope,
  recordSnapshot,
  reviseSnapshot,
} from './repositories/snapshots.js';
import { listOperatorActionsByScope, recordOperatorAction } from './repositories/operator-actions.js';
import type {
  AppendAuditEventInput,
  CreateAttentionItemInput,
  CreateDirectiveInput,
  FinishCollectorRunInput,
  RecordAgentActivityInput,
  RecordObservationInput,
  RecordOperatorActionInput,
  RecordSnapshotInput,
  RetentionPolicyInput,
  ReviseSnapshotInput,
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

  async listNamedObjects(): Promise<{ tables: string[]; materializedViews: string[]; views: string[] }> {
    return listNamedObjects(this.pool);
  }

  async listViewColumns(viewName: string): Promise<string[]> {
    return listViewColumns(this.pool, viewName);
  }

  async expectedMigrationsPresent(): Promise<boolean> {
    return expectedMigrationsPresent(this.pool);
  }

  async pingStore(): Promise<void> {
    return pingStore(this.pool);
  }

  async applyRetention(policy: RetentionPolicyInput) {
    return applyRetention(this.pool, policy);
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

  async listAllCurrentDirectives() {
    return withTransaction(this.pool, (tx) => listAllCurrentDirectives(tx));
  }

  async listAllRevisions() {
    return withTransaction(this.pool, (tx) => listAllRevisions(tx));
  }

  async listRevisionsByScope(scope: string, directiveId: string) {
    return withTransaction(this.pool, (tx) => listRevisionsByScope(tx, scope, directiveId));
  }

  async recordObservation(input: RecordObservationInput) {
    return withTransaction(this.pool, (tx) => recordObservation(tx, input));
  }

  async getObservation(id: string) {
    return withTransaction(this.pool, (tx) => getObservation(tx, id));
  }

  async listObservationsByScope(scope: string) {
    return withTransaction(this.pool, (tx) => listObservationsByScope(tx, scope));
  }

  async listLatestSourceObservations() {
    return withTransaction(this.pool, (tx) => listLatestSourceObservations(tx));
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

  async listLatestCollectorRuns() {
    return withTransaction(this.pool, (tx) => listLatestCollectorRuns(tx));
  }

  async countCollectorRunsByIdempotencyKey(idempotencyKey: string) {
    return withTransaction(this.pool, (tx) => countCollectorRunsByIdempotencyKey(tx, idempotencyKey));
  }

  async recordSnapshot(input: RecordSnapshotInput) {
    return withTransaction(this.pool, (tx) => recordSnapshot(tx, input));
  }

  async reviseSnapshot(input: ReviseSnapshotInput) {
    return withTransaction(this.pool, (tx) => reviseSnapshot(tx, input));
  }

  async getSnapshot(id: string) {
    return withTransaction(this.pool, (tx) => getSnapshot(tx, id));
  }

  async listSnapshotsByScope(scope: string) {
    return withTransaction(this.pool, (tx) => listSnapshotsByScope(tx, scope));
  }

  async listLatestOperationalSnapshots() {
    return withTransaction(this.pool, (tx) => listLatestOperationalSnapshots(tx));
  }

  async countSnapshotsByIdempotencyKey(idempotencyKey: string) {
    return withTransaction(this.pool, (tx) => countSnapshotsByIdempotencyKey(tx, idempotencyKey));
  }

  async recordOperatorAction(input: RecordOperatorActionInput) {
    return withTransaction(this.pool, (tx) => recordOperatorAction(tx, input));
  }

  async listOperatorActionsByScope(scope: string) {
    return withTransaction(this.pool, (tx) => listOperatorActionsByScope(tx, scope));
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

  async listAllAgentActivities() {
    return withTransaction(this.pool, (tx) => listAllAgentActivities(tx));
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
