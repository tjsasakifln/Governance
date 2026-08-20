-- Principal queries for Control Center persistence.
-- Timestamps are timestamptz (UTC). Presentation in America/Sao_Paulo is a consumer concern.
-- All list queries MUST filter by scope so agents never receive whole-company memory.

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
  d.supersedes,
  d.source,
  d.observed_at,
  d.freshness_status,
  d.confidence
FROM control_center.current_directives d
WHERE d.scope = $1
  AND d.status = 'active'
  AND (d.expires_at IS NULL OR d.expires_at > now())
ORDER BY d.effective_from DESC;

-- Full revision history for one directive (audit / supersession trail).
-- $1 = directive_id
SELECT
  r.id,
  r.directive_id,
  r.revision_no,
  r.status,
  r.title,
  r.source,
  r.observed_at,
  r.freshness_status,
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
  a.source,
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
  c.source,
  c.observation_id,
  c.observed_at,
  c.freshness_status,
  c.confidence
FROM control_center.current_source_observations c
WHERE c.scope = $1
ORDER BY c.observed_at DESC;

-- Collector run by idempotency key (dedupe / replay).
-- $1 = idempotency_key
SELECT id, collector_name, status, started_at, finished_at, source, observed_at, freshness_status
FROM control_center.collector_runs
WHERE idempotency_key = $1;

-- Audit trail for an entity, still scoped.
-- $1 = scope  $2 = entity_type  $3 = entity_id
SELECT id, occurred_at, actor, action, entity_type, entity_id, source, observed_at, freshness_status
FROM control_center.audit_events
WHERE scope = $1
  AND entity_type = $2
  AND entity_id = $3
ORDER BY occurred_at ASC;

-- Agent session context window for a scope.
-- $1 = scope
SELECT id, agent_id, started_at, ended_at, source, observed_at, freshness_status
FROM control_center.agent_sessions
WHERE scope = $1
ORDER BY started_at DESC
LIMIT 50;
