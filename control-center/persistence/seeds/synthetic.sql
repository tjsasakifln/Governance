-- Synthetic seed only. No personal names, emails, CPF/CNPJ, phones, or live customer data.
-- Operator and agent identifiers are opaque synthetic tokens.

INSERT INTO control_center.directives (
  id, kind, scope, status, title, body, effective_from, expires_at,
  created_by, created_at, current_revision_id
) VALUES (
  'cc:directive:synthetic-stale-freshness',
  'priority',
  'company',
  'active',
  'Synthetic: treat stale collector freshness as an exception',
  'Seed directive. Control Center homepage should surface freshness exceptions before KPI walls.',
  TIMESTAMPTZ '2026-01-01 00:00:00+00',
  NULL,
  'synthetic-operator-01',
  TIMESTAMPTZ '2026-01-01 00:00:00+00',
  'cc:directive-revision:synthetic-stale-freshness-r1'
) ON CONFLICT DO NOTHING;

INSERT INTO control_center.directive_revisions (
  id, directive_id, revision_no, kind, scope, status, title, body, effective_from,
  expires_at, created_by, source_system, source_kind, source_locator, source_label,
  observed_at, freshness_status, confidence, recorded_at, recorded_by
) VALUES (
  'cc:directive-revision:synthetic-stale-freshness-r1',
  'cc:directive:synthetic-stale-freshness',
  1,
  'priority',
  'company',
  'active',
  'Synthetic: treat stale collector freshness as an exception',
  'Seed directive. Control Center homepage should surface freshness exceptions before KPI walls.',
  TIMESTAMPTZ '2026-01-01 00:00:00+00',
  NULL,
  'synthetic-operator-01',
  'manual',
  'fixture',
  'synthetic-stale-freshness',
  'seed',
  TIMESTAMPTZ '2026-01-01 00:00:00+00',
  'FRESH',
  1.0000,
  TIMESTAMPTZ '2026-01-01 00:00:00+00',
  'synthetic-operator-01'
) ON CONFLICT DO NOTHING;

INSERT INTO control_center.current_directives (
  directive_id, revision_id, kind, scope, status, title, effective_from, expires_at,
  created_by, source_system, source_kind, source_locator, source_label,
  observed_at, freshness_status, confidence, updated_at
) VALUES (
  'cc:directive:synthetic-stale-freshness',
  'cc:directive-revision:synthetic-stale-freshness-r1',
  'priority',
  'company',
  'active',
  'Synthetic: treat stale collector freshness as an exception',
  TIMESTAMPTZ '2026-01-01 00:00:00+00',
  NULL,
  'synthetic-operator-01',
  'manual',
  'fixture',
  'synthetic-stale-freshness',
  'seed',
  TIMESTAMPTZ '2026-01-01 00:00:00+00',
  'FRESH',
  1.0000,
  TIMESTAMPTZ '2026-01-01 00:00:00+00'
) ON CONFLICT DO NOTHING;

INSERT INTO control_center.collector_runs (
  id, collector_name, idempotency_key, status, started_at, finished_at,
  source_system, source_kind, source_locator, source_label,
  observed_at, freshness_status, confidence, scope, error_code, stats
) VALUES (
  'cc:collector-run:synthetic-warmbly-2026-01-01',
  'synthetic-warmbly-readonly',
  'synthetic-warmbly-readonly:2026-01-01T00:00:00Z',
  'DONE',
  TIMESTAMPTZ '2026-01-01 00:00:00+00',
  TIMESTAMPTZ '2026-01-01 00:00:05+00',
  'warmbly',
  'collector',
  'synthetic-warmbly-readonly:2026-01-01',
  NULL,
  TIMESTAMPTZ '2026-01-01 00:00:00+00',
  'FRESH',
  0.9000,
  'commercial',
  NULL,
  '{"rows": 1}'::jsonb
) ON CONFLICT DO NOTHING;

INSERT INTO control_center.collector_run_revisions (
  id, run_id, revision_no, status, started_at, finished_at,
  source_system, source_kind, source_locator, source_label,
  observed_at, freshness_status, confidence, error_code, error_message, payload, payload_ref
) VALUES (
  'cc:collector-run-revision:synthetic-warmbly-2026-01-01',
  'cc:collector-run:synthetic-warmbly-2026-01-01',
  1,
  'DONE',
  TIMESTAMPTZ '2026-01-01 00:00:00+00',
  TIMESTAMPTZ '2026-01-01 00:00:05+00',
  'warmbly',
  'collector',
  'synthetic-warmbly-readonly:2026-01-01',
  NULL,
  TIMESTAMPTZ '2026-01-01 00:00:00+00',
  'FRESH',
  0.9000,
  NULL,
  NULL,
  '{"rows": 1}'::jsonb,
  NULL
) ON CONFLICT DO NOTHING;

INSERT INTO control_center.source_observations (
  id, source_system, source_kind, source_locator, source_label,
  observed_at, freshness_status, confidence, scope, observation_kind,
  payload, money_amount_cents, money_currency, idempotency_key, collector_run_id, created_at
) VALUES (
  'cc:source-observation:synthetic-warmbly-open-exceptions',
  'warmbly',
  'collector',
  'synthetic-warmbly-readonly:2026-01-01',
  NULL,
  TIMESTAMPTZ '2026-01-01 00:00:00+00',
  'FRESH',
  0.9000,
  'commercial',
  'open-exceptions-count',
  '{"open_exceptions": 3}'::jsonb,
  250000,
  'BRL',
  'synthetic-warmbly:open-exceptions-count:2026-01-01T00:00:00Z',
  'cc:collector-run:synthetic-warmbly-2026-01-01',
  TIMESTAMPTZ '2026-01-01 00:00:05+00'
) ON CONFLICT DO NOTHING;

INSERT INTO control_center.current_source_observations (
  source_system, source_kind, source_locator, scope, observation_id,
  observed_at, freshness_status, confidence, updated_at
) VALUES (
  'warmbly',
  'collector',
  'synthetic-warmbly-readonly:2026-01-01',
  'commercial',
  'cc:source-observation:synthetic-warmbly-open-exceptions',
  TIMESTAMPTZ '2026-01-01 00:00:00+00',
  'FRESH',
  0.9000,
  TIMESTAMPTZ '2026-01-01 00:00:05+00'
) ON CONFLICT DO NOTHING;

INSERT INTO control_center.operational_snapshots (
  id, scope, snapshot_kind, source_system, source_kind, source_locator, source_label,
  observed_at, freshness_status, confidence,
  payload, money_amount_cents, money_currency, created_at, idempotency_key
) VALUES (
  'cc:operational-snapshot:synthetic-exceptions-brief',
  'commercial',
  'exceptions-brief',
  'warmbly',
  'collector',
  'synthetic-warmbly-readonly:2026-01-01',
  NULL,
  TIMESTAMPTZ '2026-01-01 00:00:00+00',
  'FRESH',
  0.9000,
  '{"headline": "3 synthetic exceptions", "items": 3}'::jsonb,
  250000,
  'BRL',
  TIMESTAMPTZ '2026-01-01 00:00:05+00',
  'commercial:exceptions-brief:warmbly:collector:synthetic-warmbly-readonly:2026-01-01:2026-01-01T00:00:00.000Z'
) ON CONFLICT DO NOTHING;

INSERT INTO control_center.operational_snapshot_revisions (
  id, snapshot_id, revision_no,
  source_system, source_kind, source_locator, source_label,
  observed_at, freshness_status, confidence, snapshot_json
) VALUES (
  'cc:operational-snapshot-revision:synthetic-exceptions-brief',
  'cc:operational-snapshot:synthetic-exceptions-brief',
  1,
  'warmbly',
  'collector',
  'synthetic-warmbly-readonly:2026-01-01',
  NULL,
  TIMESTAMPTZ '2026-01-01 00:00:00+00',
  'FRESH',
  0.9000,
  '{"headline": "3 synthetic exceptions", "items": 3}'::jsonb
) ON CONFLICT DO NOTHING;

INSERT INTO control_center.attention_items (
  id, scope, severity, title, body, status,
  source_system, source_kind, source_locator, source_label,
  observed_at, freshness_status,
  confidence, related_directive_id, money_amount_cents, money_currency, expires_at, created_at, updated_at
) VALUES (
  'cc:attention-item:synthetic-collector-lag',
  'company',
  'high',
  'Synthetic: collector freshness lag',
  'Seed attention item. No live systems were contacted.',
  'open',
  'manual',
  'fixture',
  'synthetic-collector-lag',
  'seed',
  TIMESTAMPTZ '2026-01-01 00:00:00+00',
  'STALE',
  0.8000,
  'cc:directive:synthetic-stale-freshness',
  250000,
  'BRL',
  TIMESTAMPTZ '2026-12-31 23:59:59+00',
  TIMESTAMPTZ '2026-01-01 00:00:00+00',
  TIMESTAMPTZ '2026-01-01 00:00:00+00'
) ON CONFLICT DO NOTHING;

INSERT INTO control_center.current_attention_items (
  attention_item_id, scope, severity, status, title,
  source_system, source_kind, source_locator, source_label,
  observed_at, freshness_status, confidence, money_amount_cents, money_currency, updated_at
) VALUES (
  'cc:attention-item:synthetic-collector-lag',
  'company',
  'high',
  'open',
  'Synthetic: collector freshness lag',
  'manual',
  'fixture',
  'synthetic-collector-lag',
  'seed',
  TIMESTAMPTZ '2026-01-01 00:00:00+00',
  'STALE',
  0.8000,
  250000,
  'BRL',
  TIMESTAMPTZ '2026-01-01 00:00:00+00'
) ON CONFLICT DO NOTHING;

INSERT INTO control_center.agent_sessions (
  id, scope, agent_id, started_at, ended_at, context_query,
  source_system, source_kind, source_locator, source_label,
  observed_at, freshness_status, confidence
) VALUES (
  'cc:agent-session:synthetic-mcp-01',
  'company',
  'synthetic-agent-mcp-01',
  TIMESTAMPTZ '2026-01-01 00:01:00+00',
  TIMESTAMPTZ '2026-01-01 00:01:08+00',
  '{"scope": "company", "limit": 3}'::jsonb,
  'manual',
  'mcp',
  'synthetic-mcp-01',
  NULL,
  TIMESTAMPTZ '2026-01-01 00:01:00+00',
  'FRESH',
  1.0000
) ON CONFLICT DO NOTHING;

INSERT INTO control_center.agent_activities (
  id, correlation_id, scope, agent_id, status, goal, summary, started_at, finished_at,
  source_system, source_kind, source_locator, source_label,
  observed_at, freshness_status, confidence, payload, current_revision_no, created_at
) VALUES (
  'cc:agent-activity:synthetic-run-01',
  'synthetic-run-01',
  'company',
  'synthetic-agent-mcp-01',
  'DONE',
  'Seed a synthetic execution ledger row',
  'Completed synthetic activity. Not stored in agent_sessions.',
  TIMESTAMPTZ '2026-01-01 00:02:00+00',
  TIMESTAMPTZ '2026-01-01 00:02:08+00',
  'agent',
  'report',
  'synthetic-run-01',
  NULL,
  TIMESTAMPTZ '2026-01-01 00:02:08+00',
  'FRESH',
  0.8500,
  '{"evidence": []}'::jsonb,
  1,
  TIMESTAMPTZ '2026-01-01 00:02:00+00'
) ON CONFLICT DO NOTHING;

INSERT INTO control_center.agent_activity_revisions (
  id, activity_id, revision_no, status, summary,
  source_system, source_kind, source_locator, source_label,
  observed_at, freshness_status, confidence, recorded_at
) VALUES (
  'cc:agent-activity-revision:synthetic-run-01-r1',
  'cc:agent-activity:synthetic-run-01',
  1,
  'DONE',
  'Completed synthetic activity. Not stored in agent_sessions.',
  'agent',
  'report',
  'synthetic-run-01',
  NULL,
  TIMESTAMPTZ '2026-01-01 00:02:08+00',
  'FRESH',
  0.8500,
  TIMESTAMPTZ '2026-01-01 00:02:08+00'
) ON CONFLICT DO NOTHING;

INSERT INTO control_center.audit_events (
  id, occurred_at, actor, action, entity_type, entity_id, scope, payload,
  source_system, source_kind, source_locator, source_label,
  observed_at, freshness_status, confidence
) VALUES (
  'cc:audit-event:synthetic-directive-create',
  TIMESTAMPTZ '2026-01-01 00:00:00+00',
  'synthetic-operator-01',
  'directive.create',
  'directive',
  'cc:directive:synthetic-stale-freshness',
  'company',
  '{"kind": "priority"}'::jsonb,
  'manual',
  'fixture',
  'synthetic-stale-freshness',
  'seed',
  TIMESTAMPTZ '2026-01-01 00:00:00+00',
  'FRESH',
  1.0000
) ON CONFLICT DO NOTHING;

REFRESH MATERIALIZED VIEW control_center.mv_open_attention;
