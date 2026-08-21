import {
  createPersistence,
  createPool,
  withTransaction,
  type Persistence,
} from "@confenge/control-center-persistence";
import type pg from "pg";
import type { ActorRef, AgentActivityRecord, DirectiveRecord, Provenance } from "../types.ts";
import type { PersistencePort } from "./adapter.ts";
import { createFixtureStore } from "./fixture.ts";

const ACTOR_KINDS = new Set(["human", "agent", "system"]);

function encodeActor(actor: ActorRef): string {
  return `${actor.kind}:${actor.id}`;
}

function decodeActor(raw: string): ActorRef {
  const idx = raw.indexOf(":");
  if (idx > 0) {
    const kind = raw.slice(0, idx);
    const id = raw.slice(idx + 1);
    if (ACTOR_KINDS.has(kind) && id.length > 0) {
      return { kind: kind as ActorRef["kind"], id };
    }
  }
  return { kind: "human", id: raw };
}

function toDate(iso: string): Date {
  return new Date(iso);
}

function activityStatusToPersistence(
  status: AgentActivityRecord["status"],
): "RUNNING" | "DONE" | "PARTIAL" | "BLOCKED" | "FAILED" {
  switch (status) {
    case "running":
      return "RUNNING";
    case "done":
      return "DONE";
    case "partial":
      return "PARTIAL";
    case "blocked":
      return "BLOCKED";
    case "failed":
      return "FAILED";
  }
}

function activityStatusFromPersistence(status: string): AgentActivityRecord["status"] {
  switch (status) {
    case "RUNNING":
      return "running";
    case "DONE":
      return "done";
    case "PARTIAL":
      return "partial";
    case "BLOCKED":
      return "blocked";
    case "FAILED":
      return "failed";
    default:
      return "failed";
  }
}

function revisionToRecord(revision: {
  id: string;
  directiveId: string;
  revisionNo: number;
  kind: DirectiveRecord["kind"];
  scope: string;
  status: DirectiveRecord["status"];
  title: string;
  body: string;
  effectiveFrom: Date;
  expiresAt: Date | null;
  supersedes: string[];
  createdBy: string;
  recordedAt: Date;
  source: Provenance["source"];
  observedAt: Date;
  freshnessStatus: Provenance["freshness_status"];
  confidence: number;
}): DirectiveRecord {
  const actor = decodeActor(revision.createdBy);
  const iso = revision.recordedAt.toISOString();
  return {
    id: revision.directiveId,
    revision_id: revision.id,
    version: revision.revisionNo,
    kind: revision.kind,
    title: revision.title,
    body: revision.body,
    scope: revision.scope,
    status: revision.status,
    effective_from: revision.effectiveFrom.toISOString(),
    expires_at: revision.expiresAt ? revision.expiresAt.toISOString() : null,
    supersedes: revision.supersedes.length > 0 ? revision.supersedes : null,
    created_by: actor,
    created_at: iso,
    updated_at: iso,
    provenance: {
      source: revision.source,
      observed_at: revision.observedAt.toISOString(),
      freshness_status: revision.freshnessStatus,
      confidence: revision.confidence,
    },
  };
}

export interface PostgresStore extends PersistencePort {
  readonly pool: pg.Pool;
  readonly persistence: Persistence;
  flush(): Promise<void>;
  readyCheck(): Promise<boolean>;
}

export async function createPostgresStore(connectionString: string): Promise<PostgresStore> {
  return createPostgresStoreFromPool(createPool(connectionString));
}

export async function createPostgresStoreFromPool(pool: pg.Pool): Promise<PostgresStore> {
  const persistence = createPersistence(pool);
  await persistence.migrateUp();
  const memory = createFixtureStore();
  let chain: Promise<void> = Promise.resolve();

  const enqueue = (work: () => Promise<void>): void => {
    chain = chain.then(work, work);
  };

  const writeRevision = async (record: DirectiveRecord): Promise<void> => {
    await withTransaction(pool, async (tx) => {
      const existing = await tx.query(`SELECT id FROM control_center.directives WHERE id = $1`, [
        record.id,
      ]);
      const expiresAt = record.expires_at;
      const supersedes = record.supersedes ?? [];
      const source = record.provenance.source;
      if (existing.rowCount === 0) {
        await tx.query(
          `INSERT INTO control_center.directives (
             id, kind, scope, status, title, body, effective_from, expires_at, created_by, current_revision_id
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            record.id,
            record.kind,
            record.scope,
            record.status,
            record.title,
            record.body,
            record.effective_from,
            expiresAt,
            encodeActor(record.created_by),
            record.revision_id,
          ],
        );
      } else {
        await tx.query(
          `UPDATE control_center.directives
           SET kind = $2, scope = $3, status = $4, title = $5, body = $6,
               effective_from = $7, expires_at = $8, current_revision_id = $9
           WHERE id = $1`,
          [
            record.id,
            record.kind,
            record.scope,
            record.status,
            record.title,
            record.body,
            record.effective_from,
            expiresAt,
            record.revision_id,
          ],
        );
      }
      await tx.query(
        `INSERT INTO control_center.directive_revisions (
           id, directive_id, revision_no, kind, scope, status, title, body, effective_from,
           expires_at, created_by, source_system, source_kind, source_locator, source_label,
           observed_at, freshness_status, confidence, recorded_by
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19
         )
         ON CONFLICT (id) DO NOTHING`,
        [
          record.revision_id,
          record.id,
          record.version,
          record.kind,
          record.scope,
          record.status,
          record.title,
          record.body,
          record.effective_from,
          expiresAt,
          encodeActor(record.created_by),
          source.system,
          source.kind,
          source.locator,
          source.label ?? null,
          record.provenance.observed_at,
          record.provenance.freshness_status,
          record.provenance.confidence,
          encodeActor(record.created_by),
        ],
      );
      await tx.query(
        `INSERT INTO control_center.current_directives (
           directive_id, revision_id, kind, scope, status, title, effective_from, expires_at,
           created_by, source_system, source_kind, source_locator, source_label,
           observed_at, freshness_status, confidence, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, now()
         )
         ON CONFLICT (directive_id) DO UPDATE SET
           revision_id = EXCLUDED.revision_id,
           kind = EXCLUDED.kind,
           scope = EXCLUDED.scope,
           status = EXCLUDED.status,
           title = EXCLUDED.title,
           effective_from = EXCLUDED.effective_from,
           expires_at = EXCLUDED.expires_at,
           created_by = EXCLUDED.created_by,
           source_system = EXCLUDED.source_system,
           source_kind = EXCLUDED.source_kind,
           source_locator = EXCLUDED.source_locator,
           source_label = EXCLUDED.source_label,
           observed_at = EXCLUDED.observed_at,
           freshness_status = EXCLUDED.freshness_status,
           confidence = EXCLUDED.confidence,
           updated_at = now()`,
        [
          record.id,
          record.revision_id,
          record.kind,
          record.scope,
          record.status,
          record.title,
          record.effective_from,
          expiresAt,
          encodeActor(record.created_by),
          source.system,
          source.kind,
          source.locator,
          source.label ?? null,
          record.provenance.observed_at,
          record.provenance.freshness_status,
          record.provenance.confidence,
        ],
      );
      for (const superseded of supersedes) {
        await tx.query(
          `INSERT INTO control_center.directive_supersedes (directive_id, superseded_id)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [record.id, superseded],
        );
        await tx.query(
          `INSERT INTO control_center.directive_revision_supersedes (revision_id, superseded_id)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [record.revision_id, superseded],
        );
      }
    });
  };

  const revisions = await persistence.listAllRevisions();
  const currents = await persistence.listAllCurrentDirectives();
  for (const revision of revisions) {
    memory.insertRevision(revisionToRecord(revision));
  }
  for (const current of currents) {
    memory.setCurrent(current.directiveId, current.revisionId);
  }
  const activities = await persistence.listAllAgentActivities();
  for (const activity of activities) {
    const kind: AgentActivityRecord["kind"] =
      activity.payload && activity.payload["kind"] === "blocker" ? "blocker" : "session_result";
    memory.recordAgentActivity({
      id: activity.id,
      correlation_id: activity.correlationId,
      agent_id: activity.agentId,
      scope: activity.scope,
      status: activityStatusFromPersistence(activity.status),
      goal: activity.goal,
      summary: activity.summary,
      started_at: activity.startedAt.toISOString(),
      finished_at: activity.finishedAt ? activity.finishedAt.toISOString() : null,
      kind,
      payload: activity.payload,
      actor: { kind: "agent", id: activity.agentId },
      provenance: {
        source: activity.source,
        observed_at: activity.observedAt.toISOString(),
        freshness_status: activity.freshnessStatus,
        confidence: activity.confidence,
      },
    });
  }

  const store: PostgresStore = {
    pool,
    persistence,
    insertRevision(record) {
      memory.insertRevision(record);
      enqueue(() => writeRevision(record));
    },
    getRevision(revisionId) {
      return memory.getRevision(revisionId);
    },
    getCurrent(id) {
      return memory.getCurrent(id);
    },
    listCurrent() {
      return memory.listCurrent();
    },
    listRevisions(id) {
      return memory.listRevisions(id);
    },
    setCurrent(id, revisionId) {
      memory.setCurrent(id, revisionId);
    },
    appendAudit(event) {
      memory.appendAudit(event);
      enqueue(async () => {
        await persistence.appendAuditEvent({
          actor: encodeActor(event.actor),
          action: event.action,
          entityType: event.entity_type,
          entityId: event.entity_id,
          scope: event.metadata["scope"] ? String(event.metadata["scope"]) : "company",
          payload: { ...event.metadata, revision_id: event.revision_id },
          source: {
            system: "control-center",
            kind: "context-audit",
            locator: event.id,
          },
          observedAt: toDate(event.at),
          freshnessStatus: "FRESH",
          confidence: 1,
        });
      });
    },
    listAudit() {
      return memory.listAudit();
    },
    insertProposal(record) {
      memory.insertProposal(record);
    },
    getProposal(id) {
      return memory.getProposal(id);
    },
    listProposals() {
      return memory.listProposals();
    },
    updateProposal(record) {
      memory.updateProposal(record);
    },
    recordAgentActivity(record) {
      memory.recordAgentActivity(record);
      enqueue(async () => {
        await persistence.recordAgentActivity({
          correlationId: record.correlation_id,
          agentId: record.agent_id,
          scope: record.scope,
          status: activityStatusToPersistence(record.status),
          goal: record.goal,
          summary: record.summary,
          startedAt: toDate(record.started_at),
          finishedAt: record.finished_at ? toDate(record.finished_at) : null,
          payload: { ...record.payload, kind: record.kind, activity_id: record.id },
          source: record.provenance.source,
          observedAt: toDate(record.provenance.observed_at),
          freshnessStatus: record.provenance.freshness_status,
          confidence: record.provenance.confidence,
        });
      });
    },
    listAgentActivities() {
      return memory.listAgentActivities();
    },
    async flush() {
      await chain;
    },
    async readyCheck() {
      try {
        await pool.query("SELECT 1");
        return true;
      } catch {
        return false;
      }
    },
  };
  return store;
}
