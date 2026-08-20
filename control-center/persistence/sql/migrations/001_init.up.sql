CREATE SCHEMA IF NOT EXISTS control_center;

CREATE TABLE control_center.schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE control_center.directives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('decision', 'directive', 'fact', 'constraint', 'priority', 'risk', 'hypothesis')),
  scope TEXT NOT NULL CHECK (char_length(btrim(scope)) BETWEEN 1 AND 256),
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'superseded', 'expired', 'withdrawn')),
  title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 512),
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 20000),
  effective_from TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  supersedes UUID REFERENCES control_center.directives (id),
  created_by TEXT NOT NULL CHECK (char_length(btrim(created_by)) BETWEEN 1 AND 256),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  current_revision_id UUID,
  CHECK (expires_at IS NULL OR expires_at > effective_from),
  CHECK (supersedes IS DISTINCT FROM id)
);

CREATE TABLE control_center.directive_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  directive_id UUID NOT NULL REFERENCES control_center.directives (id),
  revision_no INTEGER NOT NULL CHECK (revision_no >= 1),
  kind TEXT NOT NULL CHECK (kind IN ('decision', 'directive', 'fact', 'constraint', 'priority', 'risk', 'hypothesis')),
  scope TEXT NOT NULL CHECK (char_length(btrim(scope)) BETWEEN 1 AND 256),
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'superseded', 'expired', 'withdrawn')),
  title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 512),
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 20000),
  effective_from TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  supersedes UUID,
  created_by TEXT NOT NULL CHECK (char_length(btrim(created_by)) BETWEEN 1 AND 256),
  source TEXT NOT NULL CHECK (char_length(btrim(source)) BETWEEN 1 AND 256),
  observed_at TIMESTAMPTZ NOT NULL,
  freshness_status TEXT NOT NULL CHECK (freshness_status IN ('fresh', 'stale', 'unknown', 'expired')),
  confidence NUMERIC(5, 4) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  recorded_by TEXT NOT NULL CHECK (char_length(btrim(recorded_by)) BETWEEN 1 AND 256),
  UNIQUE (directive_id, revision_no)
);

ALTER TABLE control_center.directives
  ADD CONSTRAINT directives_current_revision_fk
  FOREIGN KEY (current_revision_id) REFERENCES control_center.directive_revisions (id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE control_center.collector_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collector_name TEXT NOT NULL CHECK (char_length(btrim(collector_name)) BETWEEN 1 AND 128),
  idempotency_key TEXT NOT NULL CHECK (char_length(btrim(idempotency_key)) BETWEEN 1 AND 512),
  status TEXT NOT NULL CHECK (status IN ('started', 'succeeded', 'failed', 'skipped')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  source TEXT NOT NULL CHECK (char_length(btrim(source)) BETWEEN 1 AND 256),
  observed_at TIMESTAMPTZ NOT NULL,
  freshness_status TEXT NOT NULL CHECK (freshness_status IN ('fresh', 'stale', 'unknown', 'expired')),
  confidence NUMERIC(5, 4) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  scope TEXT NOT NULL CHECK (char_length(btrim(scope)) BETWEEN 1 AND 256),
  error_code TEXT CHECK (error_code IS NULL OR char_length(error_code) BETWEEN 1 AND 64),
  stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (idempotency_key),
  CHECK (finished_at IS NULL OR finished_at >= started_at)
);

CREATE TABLE control_center.source_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL CHECK (char_length(btrim(source)) BETWEEN 1 AND 256),
  observed_at TIMESTAMPTZ NOT NULL,
  freshness_status TEXT NOT NULL CHECK (freshness_status IN ('fresh', 'stale', 'unknown', 'expired')),
  confidence NUMERIC(5, 4) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  scope TEXT NOT NULL CHECK (char_length(btrim(scope)) BETWEEN 1 AND 256),
  observation_kind TEXT NOT NULL CHECK (char_length(btrim(observation_kind)) BETWEEN 1 AND 128),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  money_amount_cents BIGINT CHECK (money_amount_cents IS NULL OR money_amount_cents >= 0),
  money_currency CHAR(3) CHECK (money_currency IS NULL OR money_currency ~ '^[A-Z]{3}$'),
  CHECK ((money_amount_cents IS NULL) = (money_currency IS NULL)),
  idempotency_key TEXT NOT NULL CHECK (char_length(btrim(idempotency_key)) BETWEEN 1 AND 512),
  collector_run_id UUID REFERENCES control_center.collector_runs (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (idempotency_key)
);

CREATE TABLE control_center.operational_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL CHECK (char_length(btrim(scope)) BETWEEN 1 AND 256),
  snapshot_kind TEXT NOT NULL CHECK (char_length(btrim(snapshot_kind)) BETWEEN 1 AND 128),
  source TEXT NOT NULL CHECK (char_length(btrim(source)) BETWEEN 1 AND 256),
  observed_at TIMESTAMPTZ NOT NULL,
  freshness_status TEXT NOT NULL CHECK (freshness_status IN ('fresh', 'stale', 'unknown', 'expired')),
  confidence NUMERIC(5, 4) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  money_amount_cents BIGINT CHECK (money_amount_cents IS NULL OR money_amount_cents >= 0),
  money_currency CHAR(3) CHECK (money_currency IS NULL OR money_currency ~ '^[A-Z]{3}$'),
  CHECK ((money_amount_cents IS NULL) = (money_currency IS NULL)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE control_center.attention_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL CHECK (char_length(btrim(scope)) BETWEEN 1 AND 256),
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 512),
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 20000),
  status TEXT NOT NULL CHECK (status IN ('open', 'acknowledged', 'resolved', 'dismissed')),
  source TEXT NOT NULL CHECK (char_length(btrim(source)) BETWEEN 1 AND 256),
  observed_at TIMESTAMPTZ NOT NULL,
  freshness_status TEXT NOT NULL CHECK (freshness_status IN ('fresh', 'stale', 'unknown', 'expired')),
  confidence NUMERIC(5, 4) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  related_directive_id UUID REFERENCES control_center.directives (id),
  money_amount_cents BIGINT CHECK (money_amount_cents IS NULL OR money_amount_cents >= 0),
  money_currency CHAR(3) CHECK (money_currency IS NULL OR money_currency ~ '^[A-Z]{3}$'),
  CHECK ((money_amount_cents IS NULL) = (money_currency IS NULL)),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE control_center.agent_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL CHECK (char_length(btrim(scope)) BETWEEN 1 AND 256),
  agent_id TEXT NOT NULL CHECK (char_length(btrim(agent_id)) BETWEEN 1 AND 256),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  context_query JSONB NOT NULL DEFAULT '{}'::jsonb,
  source TEXT NOT NULL CHECK (char_length(btrim(source)) BETWEEN 1 AND 256),
  observed_at TIMESTAMPTZ NOT NULL,
  freshness_status TEXT NOT NULL CHECK (freshness_status IN ('fresh', 'stale', 'unknown', 'expired')),
  confidence NUMERIC(5, 4) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE TABLE control_center.audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor TEXT NOT NULL CHECK (char_length(btrim(actor)) BETWEEN 1 AND 256),
  action TEXT NOT NULL CHECK (char_length(btrim(action)) BETWEEN 1 AND 128),
  entity_type TEXT NOT NULL CHECK (char_length(btrim(entity_type)) BETWEEN 1 AND 64),
  entity_id UUID,
  scope TEXT NOT NULL CHECK (char_length(btrim(scope)) BETWEEN 1 AND 256),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  source TEXT NOT NULL CHECK (char_length(btrim(source)) BETWEEN 1 AND 256),
  observed_at TIMESTAMPTZ NOT NULL,
  freshness_status TEXT NOT NULL CHECK (freshness_status IN ('fresh', 'stale', 'unknown', 'expired'))
);

CREATE INDEX directives_scope_status_idx
  ON control_center.directives (scope, status, kind);
CREATE INDEX directives_supersedes_idx
  ON control_center.directives (supersedes)
  WHERE supersedes IS NOT NULL;
CREATE INDEX directive_revisions_directive_idx
  ON control_center.directive_revisions (directive_id, revision_no);
CREATE INDEX collector_runs_scope_started_idx
  ON control_center.collector_runs (scope, started_at DESC);
CREATE INDEX source_observations_scope_observed_idx
  ON control_center.source_observations (scope, observed_at DESC);
CREATE INDEX source_observations_run_idx
  ON control_center.source_observations (collector_run_id)
  WHERE collector_run_id IS NOT NULL;
CREATE INDEX operational_snapshots_scope_observed_idx
  ON control_center.operational_snapshots (scope, observed_at DESC);
CREATE INDEX attention_items_scope_status_idx
  ON control_center.attention_items (scope, status, severity);
CREATE INDEX agent_sessions_scope_started_idx
  ON control_center.agent_sessions (scope, started_at DESC);
CREATE INDEX audit_events_scope_occurred_idx
  ON control_center.audit_events (scope, occurred_at DESC);
CREATE INDEX audit_events_entity_idx
  ON control_center.audit_events (entity_type, entity_id);

CREATE OR REPLACE FUNCTION control_center.cc_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'append-only table % does not allow %', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER directive_revisions_append_only
  BEFORE UPDATE OR DELETE ON control_center.directive_revisions
  FOR EACH ROW EXECUTE FUNCTION control_center.cc_reject_mutation();

CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON control_center.audit_events
  FOR EACH ROW EXECUTE FUNCTION control_center.cc_reject_mutation();

CREATE TRIGGER directives_no_delete
  BEFORE DELETE ON control_center.directives
  FOR EACH ROW EXECUTE FUNCTION control_center.cc_reject_mutation();

CREATE TRIGGER source_observations_append_only
  BEFORE UPDATE OR DELETE ON control_center.source_observations
  FOR EACH ROW EXECUTE FUNCTION control_center.cc_reject_mutation();
