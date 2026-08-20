import type { PoolClient } from 'pg';
import { NotFoundError } from '../errors.js';
import { generatePublicId } from '../ids.js';
import { logEvent } from '../log.js';
import { sourceColumns, toUtcIso } from '../money.js';
import { mapAgentSession, type AgentSessionRow } from '../rows.js';
import type { AgentSession, StartAgentSessionInput } from '../types.js';
import { parseInput, scopedIdQuerySchema, scopeQuerySchema, startAgentSessionInputSchema } from '../validation.js';
import { insertAuditEvent } from './audit.js';

const SESSION_COLUMNS = `
  id, scope, agent_id, started_at, ended_at, context_query,
  source_system, source_kind, source_locator, source_label,
  observed_at, freshness_status, confidence
`;

export async function startAgentSession(tx: PoolClient, raw: StartAgentSessionInput): Promise<AgentSession> {
  const input = parseInput(startAgentSessionInputSchema, raw, 'startAgentSession');
  const id = generatePublicId('agent-session');
  const source = sourceColumns(input.source);
  const result = await tx.query(
    `INSERT INTO control_center.agent_sessions (
       id, scope, agent_id, context_query,
       source_system, source_kind, source_locator, source_label,
       observed_at, freshness_status, confidence
     ) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11)
     RETURNING ${SESSION_COLUMNS}`,
    [
      id,
      input.scope,
      input.agentId,
      JSON.stringify(input.contextQuery ?? {}),
      source.system,
      source.kind,
      source.locator,
      source.label,
      toUtcIso(input.observedAt),
      input.freshnessStatus,
      input.confidence,
    ],
  );
  const session = mapAgentSession(result.rows[0] as AgentSessionRow);
  await insertAuditEvent(tx, {
    actor: input.agentId,
    action: 'agent_session.start',
    entityType: 'agent_session',
    entityId: session.id,
    scope: session.scope,
    payload: { agentId: session.agentId },
    source: session.source,
    observedAt: session.observedAt,
    freshnessStatus: session.freshnessStatus,
    confidence: session.confidence,
  });
  logEvent('agent_session.start', { sessionId: session.id, scope: session.scope });
  return session;
}

export async function endAgentSession(tx: PoolClient, scope: string, id: string): Promise<AgentSession> {
  const parsed = parseInput(scopedIdQuerySchema, { scope, id }, 'endAgentSession');
  const result = await tx.query(
    `UPDATE control_center.agent_sessions
     SET ended_at = now()
     WHERE id = $1 AND scope = $2
     RETURNING ${SESSION_COLUMNS}`,
    [parsed.id, parsed.scope],
  );
  if (result.rowCount !== 1) {
    throw new NotFoundError(`agent session ${parsed.id} not found in scope ${parsed.scope}`);
  }
  return mapAgentSession(result.rows[0] as AgentSessionRow);
}

export async function listAgentSessionsByScope(tx: PoolClient, scope: string): Promise<AgentSession[]> {
  const parsed = parseInput(scopeQuerySchema, { scope }, 'listAgentSessionsByScope');
  const result = await tx.query(
    `SELECT ${SESSION_COLUMNS}
     FROM control_center.agent_sessions
     WHERE scope = $1
     ORDER BY started_at DESC, id ASC`,
    [parsed.scope],
  );
  return result.rows.map((row) => mapAgentSession(row as AgentSessionRow));
}
