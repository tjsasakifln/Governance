import type { PoolClient } from 'pg';
import { generatePublicId } from '../ids.js';
import { logEvent } from '../log.js';
import { sourceColumns, toUtcIso } from '../money.js';
import { mapAgentActivity, mapAgentActivityRevision, type AgentActivityRevisionRow, type AgentActivityRow } from '../rows.js';
import type { AgentActivity, AgentActivityRevision, RecordAgentActivityInput } from '../types.js';
import { parseInput, recordAgentActivityInputSchema, scopeQuerySchema } from '../validation.js';
import { insertAuditEvent } from './audit.js';

const ACTIVITY_COLUMNS = `
  id, correlation_id, scope, agent_id, status, goal, summary, started_at, finished_at,
  source_system, source_kind, source_locator, source_label,
  observed_at, freshness_status, confidence, payload, current_revision_no, created_at
`;

const REVISION_COLUMNS = `
  id, activity_id, revision_no, status, summary,
  source_system, source_kind, source_locator, source_label,
  observed_at, freshness_status, confidence, recorded_at
`;

export async function recordAgentActivity(
  tx: PoolClient,
  raw: RecordAgentActivityInput,
): Promise<{ activity: AgentActivity; revision: AgentActivityRevision; inserted: boolean }> {
  const input = parseInput(recordAgentActivityInputSchema, raw, 'recordAgentActivity');
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`agent-activity:${input.correlationId}`]);
  const source = sourceColumns(input.source);
  const existing = await tx.query(
    `SELECT ${ACTIVITY_COLUMNS} FROM control_center.agent_activities WHERE correlation_id = $1`,
    [input.correlationId],
  );

  let activityId: string;
  let revisionNo: number;
  let inserted = false;
  const startedAt = input.startedAt ?? input.observedAt;
  const finishedAt = input.finishedAt ?? null;

  if (existing.rowCount === 1) {
    const current = mapAgentActivity(existing.rows[0] as AgentActivityRow);
    activityId = current.id;
    revisionNo = current.currentRevisionNo + 1;
    await tx.query(
      `UPDATE control_center.agent_activities
       SET status = $2,
           summary = $3,
           finished_at = $4,
           source_system = $5,
           source_kind = $6,
           source_locator = $7,
           source_label = $8,
           observed_at = $9,
           freshness_status = $10,
           confidence = $11,
           payload = $12::jsonb,
           current_revision_no = $13
       WHERE id = $1`,
      [
        activityId,
        input.status,
        input.summary,
        finishedAt ? toUtcIso(finishedAt) : null,
        source.system,
        source.kind,
        source.locator,
        source.label,
        toUtcIso(input.observedAt),
        input.freshnessStatus,
        input.confidence,
        JSON.stringify(input.payload ?? {}),
        revisionNo,
      ],
    );
  } else {
    activityId = generatePublicId('agent-activity');
    revisionNo = 1;
    inserted = true;
    await tx.query(
      `INSERT INTO control_center.agent_activities (
         id, correlation_id, scope, agent_id, status, goal, summary, started_at, finished_at,
         source_system, source_kind, source_locator, source_label,
         observed_at, freshness_status, confidence, payload, current_revision_no
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18)`,
      [
        activityId,
        input.correlationId,
        input.scope,
        input.agentId,
        input.status,
        input.goal,
        input.summary,
        toUtcIso(startedAt),
        finishedAt ? toUtcIso(finishedAt) : null,
        source.system,
        source.kind,
        source.locator,
        source.label,
        toUtcIso(input.observedAt),
        input.freshnessStatus,
        input.confidence,
        JSON.stringify(input.payload ?? {}),
        revisionNo,
      ],
    );
  }

  const revisionInsert = await tx.query(
    `INSERT INTO control_center.agent_activity_revisions (
       id, activity_id, revision_no, status, summary,
       source_system, source_kind, source_locator, source_label,
       observed_at, freshness_status, confidence
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING ${REVISION_COLUMNS}`,
    [
      generatePublicId('agent-activity-revision'),
      activityId,
      revisionNo,
      input.status,
      input.summary,
      source.system,
      source.kind,
      source.locator,
      source.label,
      toUtcIso(input.observedAt),
      input.freshnessStatus,
      input.confidence,
    ],
  );

  const loaded = await tx.query(
    `SELECT ${ACTIVITY_COLUMNS} FROM control_center.agent_activities WHERE id = $1`,
    [activityId],
  );
  const activity = mapAgentActivity(loaded.rows[0] as AgentActivityRow);
  const revision = mapAgentActivityRevision(revisionInsert.rows[0] as AgentActivityRevisionRow);

  await insertAuditEvent(tx, {
    actor: input.agentId,
    action: inserted ? 'agent_activity.start' : 'agent_activity.revise',
    entityType: 'agent_activity',
    entityId: activity.id,
    scope: activity.scope,
    payload: { correlationId: activity.correlationId, revisionNo },
    source: activity.source,
    observedAt: activity.observedAt,
    freshnessStatus: activity.freshnessStatus,
    confidence: activity.confidence,
  });
  logEvent(inserted ? 'agent_activity.start' : 'agent_activity.revise', {
    activityId: activity.id,
    scope: activity.scope,
  });
  return { activity, revision, inserted };
}

export async function listAgentActivitiesByScope(tx: PoolClient, scope: string): Promise<AgentActivity[]> {
  const parsed = parseInput(scopeQuerySchema, { scope }, 'listAgentActivitiesByScope');
  const result = await tx.query(
    `SELECT ${ACTIVITY_COLUMNS}
     FROM control_center.agent_activities
     WHERE scope = $1
     ORDER BY started_at DESC, id ASC`,
    [parsed.scope],
  );
  return result.rows.map((row) => mapAgentActivity(row as AgentActivityRow));
}

export async function listAllAgentActivities(tx: PoolClient): Promise<AgentActivity[]> {
  const result = await tx.query(
    `SELECT ${ACTIVITY_COLUMNS}
     FROM control_center.agent_activities
     ORDER BY started_at DESC, id ASC`,
  );
  return result.rows.map((row) => mapAgentActivity(row as AgentActivityRow));
}

export async function countAgentActivitiesInSessionsTable(tx: PoolClient, activityId: string): Promise<number> {
  const result = await tx.query(
    `SELECT count(*)::int AS n FROM control_center.agent_sessions WHERE id = $1`,
    [activityId],
  );
  return (result.rows[0] as { n: number }).n;
}
