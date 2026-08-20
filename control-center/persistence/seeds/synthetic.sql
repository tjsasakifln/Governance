-- Synthetic seed only. No personal names, emails, CPF/CNPJ, phones, or live customer data.
-- Operator and agent identifiers are opaque synthetic tokens.

INSERT INTO control_center.directives (
  id, kind, scope, status, title, body, effective_from, expires_at, supersedes,
  created_by, created_at, current_revision_id
) VALUES (
  '00000000-0000-4000-8000-000000000001',
  'priority',
  'ops.exceptions',
  'active',
  'Synthetic: treat stale collector freshness as an exception',
  'Seed directive. Control Center homepage should surface freshness exceptions before KPI walls.',
  TIMESTAMPTZ '2026-01-01 00:00:00+00',
  NULL,
  NULL,
  'synthetic-operator-01',
  TIMESTAMPTZ '2026-01-01 00:00:00+00',
  '00000000-0000-4000-8000-000000000011'
) ON CONFLICT DO NOTHING;

INSERT INTO control_center.directive_revisions (
  id, directive_id, revision_no, kind, scope, status, title, body, effective_from,
  expires_at, supersedes, created_by, source, observed_at, freshness_status,
  confidence, recorded_at, recorded_by
) VALUES (
  '00000000-0000-4000-8000-000000000011',
  '00000000-0000-4000-8000-000000000001',
  1,
  'priority',
  'ops.exceptions',
  'active',
  'Synthetic: treat stale collector freshness as an exception',
  'Seed directive. Control Center homepage should surface freshness exceptions before KPI walls.',
  TIMESTAMPTZ '2026-01-01 00:00:00+00',
  NULL,
  NULL,
  'synthetic-operator-01',
  'synthetic-fixture',
  TIMESTAMPTZ '2026-01-01 00:00:00+00',
  'fresh',
  1.0000,
  TIMESTAMPTZ '2026-01-01 00:00:00+00',
  'synthetic-operator-01'
) ON CONFLICT DO NOTHING;

INSERT INTO control_center.current_directives (
  directive_id, revision_id, kind, scope, status, title, effective_from, expires_at,
  supersedes, created_by, source, observed_at, freshness_status, confidence, updated_at
) VALUES (
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000011',
  'priority',
  'ops.exceptions',
  'active',
  'Synthetic: treat stale collector freshness as an exception',
  TIMESTAMPTZ '2026-01-01 00:00:00+00',
  NULL,
  NULL,
  'synthetic-operator-01',
  'synthetic-fixture',
  TIMESTAMPTZ '2026-01-01 00:00:00+00',
  'fresh',
  1.0000,
  TIMESTAMPTZ '2026-01-01 00:00:00+00'
) ON CONFLICT DO NOTHING;

INSERT INTO control_center.collector_runs (
  id, collector_name, idempotency_key, status, started_at, finished_at, source,
  observed_at, freshness_status, confidence, scope, error_code, stats
) VALUES (
  '00000000-0000-4000-8000-000000000021',
  'synthetic-warmbly-readonly',
  'synthetic-warmbly-readonly:2026-01-01T00:00:00Z',
  'succeeded',
  TIMESTAMPTZ '2026-01-01 00:00:00+00',
  TIMESTAMPTZ '2026-01-01 00:00:05+00',
  'synthetic-warmbly',
  TIMESTAMPTZ '2026-01-01 00:00:00+00',
  'fresh',
  0.9000,
  'commercial.pipeline',
  NULL,
  '{"rows": 1}'::jsonb
) ON CONFLICT DO NOTHING;

INSERT INTO control_center.source_observations (
  id, source, observed_at, freshness_status, confidence, scope, observation_kind,
  payload, money_amount_cents, money_currency, idempotency_key, collector_run_id, created_at
) VALUES (
  '00000000-0000-4000-8000-000000000031',
  'synthetic-warmbly',
  TIMESTAMPTZ '2026-01-01 00:00:00+00',
  'fresh',
  0.9000,
  'commercial.pipeline',
  'open-exceptions-count',
  '{"open_exceptions": 3}'::jsonb,
  250000,
  'BRL',
  'synthetic-warmbly:open-exceptions-count:2026-01-01T00:00:00Z',
  '00000000-0000-4000-8000-000000000021',
  TIMESTAMPTZ '2026-01-01 00:00:05+00'
) ON CONFLICT DO NOTHING;

INSERT INTO control_center.current_source_observations (
  source, scope, observation_id, observed_at, freshness_status, confidence, updated_at
) VALUES (
  'synthetic-warmbly',
  'commercial.pipeline',
  '00000000-0000-4000-8000-000000000031',
  TIMESTAMPTZ '2026-01-01 00:00:00+00',
  'fresh',
  0.9000,
  TIMESTAMPTZ '2026-01-01 00:00:05+00'
) ON CONFLICT DO NOTHING;

INSERT INTO control_center.operational_snapshots (
  id, scope, snapshot_kind, source, observed_at, freshness_status, confidence,
  payload, money_amount_cents, money_currency, created_at
) VALUES (
  '00000000-0000-4000-8000-000000000041',
  'commercial.pipeline',
  'exceptions-brief',
  'synthetic-warmbly',
  TIMESTAMPTZ '2026-01-01 00:00:00+00',
  'fresh',
  0.9000,
  '{"headline": "3 synthetic exceptions", "items": 3}'::jsonb,
  250000,
  'BRL',
  TIMESTAMPTZ '2026-01-01 00:00:05+00'
) ON CONFLICT DO NOTHING;

INSERT INTO control_center.attention_items (
  id, scope, severity, title, body, status, source, observed_at, freshness_status,
  confidence, related_directive_id, money_amount_cents, money_currency, expires_at, created_at, updated_at
) VALUES (
  '00000000-0000-4000-8000-000000000051',
  'ops.exceptions',
  'high',
  'Synthetic: collector freshness lag',
  'Seed attention item. No live systems were contacted.',
  'open',
  'synthetic-fixture',
  TIMESTAMPTZ '2026-01-01 00:00:00+00',
  'stale',
  0.8000,
  '00000000-0000-4000-8000-000000000001',
  250000,
  'BRL',
  TIMESTAMPTZ '2026-12-31 23:59:59+00',
  TIMESTAMPTZ '2026-01-01 00:00:00+00',
  TIMESTAMPTZ '2026-01-01 00:00:00+00'
) ON CONFLICT DO NOTHING;

INSERT INTO control_center.current_attention_items (
  attention_item_id, scope, severity, status, title, source, observed_at,
  freshness_status, confidence, money_amount_cents, money_currency, updated_at
) VALUES (
  '00000000-0000-4000-8000-000000000051',
  'ops.exceptions',
  'high',
  'open',
  'Synthetic: collector freshness lag',
  'synthetic-fixture',
  TIMESTAMPTZ '2026-01-01 00:00:00+00',
  'stale',
  0.8000,
  250000,
  'BRL',
  TIMESTAMPTZ '2026-01-01 00:00:00+00'
) ON CONFLICT DO NOTHING;

INSERT INTO control_center.agent_sessions (
  id, scope, agent_id, started_at, ended_at, context_query, source, observed_at, freshness_status, confidence
) VALUES (
  '00000000-0000-4000-8000-000000000061',
  'ops.exceptions',
  'synthetic-agent-mcp-01',
  TIMESTAMPTZ '2026-01-01 00:01:00+00',
  TIMESTAMPTZ '2026-01-01 00:01:08+00',
  '{"scope": "ops.exceptions", "limit": 3}'::jsonb,
  'synthetic-mcp',
  TIMESTAMPTZ '2026-01-01 00:01:00+00',
  'fresh',
  1.0000
) ON CONFLICT DO NOTHING;

INSERT INTO control_center.audit_events (
  id, occurred_at, actor, action, entity_type, entity_id, scope, payload, source, observed_at, freshness_status
) VALUES (
  '00000000-0000-4000-8000-000000000071',
  TIMESTAMPTZ '2026-01-01 00:00:00+00',
  'synthetic-operator-01',
  'directive.create',
  'directive',
  '00000000-0000-4000-8000-000000000001',
  'ops.exceptions',
  '{"kind": "priority"}'::jsonb,
  'synthetic-fixture',
  TIMESTAMPTZ '2026-01-01 00:00:00+00',
  'fresh'
) ON CONFLICT DO NOTHING;

REFRESH MATERIALIZED VIEW control_center.mv_open_attention;
