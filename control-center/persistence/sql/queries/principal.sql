-- Principal queries for Control Center persistence.
-- Timestamps are timestamptz (UTC). Presentation in America/Sao_Paulo is a consumer concern.
-- All list queries MUST filter by scope so agents never receive whole-company memory.
-- Public identities are cc:* text. SourceRef is structured columns, never a free-text source.

-- Active current directives in a scope (cockpit / MCP context).
-- $1 = scope
SELECT
  d.directive_id,
  d.revision_id,
  d.kind,
  d.scope,
  d.status,
  d.title,
  d.effective_from,
  d.expires_at,
  (
    SELECT COALESCE(array_agg(s.superseded_id ORDER BY s.superseded_id), ARRAY[]::text[])
    FROM control_center.directive_supersedes s
    WHERE s.directive_id = d.directive_id
  ) AS supersedes,
  d.source_system,
  d.source_kind,
  d.source_locator,
  d.source_label,
  d.observed_at,
  d.freshness_status,
  d.confidence
FROM control_center.current_directives d
WHERE d.scope = $1
  AND d.status = 'active'
  AND (d.expires_at IS NULL OR d.expires_at > now())
ORDER BY d.effective_from DESC;

-- Full revision history for one directive (audit / supersession trail).
-- $1 = directive_id (cc:directive:...)
SELECT
  r.id,
  r.directive_id,
  r.revision_no,
  r.status,
  r.title,
  r.source_system,
  r.source_kind,
  r.source_locator,
  r.source_label,
  r.observed_at,
  r.freshness_status,
  r.confidence,
  r.recorded_at,
  r.recorded_by
FROM control_center.directive_revisions r
WHERE r.directive_id = $1
ORDER BY r.revision_no ASC;

-- Open attention items for a scope ("exceptions and the 3 things now").
-- $1 = scope  $2 = limit
SELECT
  a.id,
  a.severity,
  a.title,
  a.status,
  a.source_system,
  a.source_kind,
  a.source_locator,
  a.source_label,
  a.observed_at,
  a.freshness_status,
  a.confidence,
  a.money_amount_cents,
  a.money_currency
FROM control_center.mv_open_attention a
WHERE a.scope = $1
ORDER BY
  CASE a.severity
    WHEN 'critical' THEN 1
    WHEN 'high' THEN 2
    WHEN 'medium' THEN 3
    ELSE 4
  END,
  a.observed_at DESC
LIMIT $2;

-- Latest observation per source for a scope (freshness/provenance panel).
-- $1 = scope
SELECT
  c.source_system,
  c.source_kind,
  c.source_locator,
  c.observation_id,
  c.observed_at,
  c.freshness_status,
  c.confidence
FROM control_center.current_source_observations c
WHERE c.scope = $1
ORDER BY c.observed_at DESC;

-- Collector run by idempotency key (dedupe / replay).
-- $1 = idempotency_key
SELECT id, collector_name, status, started_at, finished_at,
       source_system, source_kind, source_locator, observed_at, freshness_status, confidence
FROM control_center.collector_runs
WHERE idempotency_key = $1;

-- Audit trail for an entity, still scoped.
-- $1 = scope  $2 = entity_type  $3 = entity_id (cc:*)
SELECT id, occurred_at, actor, action, entity_type, entity_id,
       source_system, source_kind, source_locator, observed_at, freshness_status, confidence
FROM control_center.audit_events
WHERE scope = $1
  AND entity_type = $2
  AND entity_id = $3
ORDER BY occurred_at ASC;

-- Agent session context window for a scope. Not the execution ledger.
-- $1 = scope
SELECT id, agent_id, started_at, ended_at,
       source_system, source_kind, source_locator, observed_at, freshness_status, confidence
FROM control_center.agent_sessions
WHERE scope = $1
ORDER BY started_at DESC
LIMIT 50;

-- Agent activity execution ledger for a scope. Separate from agent_sessions.
-- $1 = scope
SELECT id, correlation_id, agent_id, status, goal, summary, started_at, finished_at,
       source_system, source_kind, source_locator, observed_at, freshness_status, confidence
FROM control_center.agent_activities
WHERE scope = $1
ORDER BY started_at DESC
LIMIT 50;
