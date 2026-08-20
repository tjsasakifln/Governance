CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS control_center;

CREATE TABLE control_center.schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION control_center.is_freshness(value TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT value IN ('FRESH', 'STALE', 'UNKNOWN', 'ERROR')
$$;

CREATE OR REPLACE FUNCTION control_center.is_directive_status(value TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT value IN ('draft', 'active', 'superseded', 'revoked', 'expired')
$$;

CREATE OR REPLACE FUNCTION control_center.is_resource_id(value TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT value IS NOT NULL
    AND char_length(value) BETWEEN 6 AND 128
    AND value ~ '^cc:[a-z][a-z0-9-]*:[A-Za-z0-9._~-]+$'
    AND value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
$$;

CREATE OR REPLACE FUNCTION control_center.is_scope(value TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT value IS NOT NULL
    AND char_length(value) BETWEEN 2 AND 128
    AND (
      value IN ('company', 'commercial', 'finance', 'clients', 'infrastructure', 'inbound')
      OR value ~ '^repo:[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)?$'
      OR value ~ '^client:[a-z0-9]+(-[a-z0-9]+)*$'
      OR (
        value ~ '^[a-z][a-z0-9-]*:[A-Za-z0-9._:~-]+$'
        AND split_part(value, ':', 1) NOT IN (
          'company', 'commercial', 'finance', 'clients', 'infrastructure', 'inbound', 'repo', 'client'
        )
      )
    )
$$;

CREATE OR REPLACE FUNCTION control_center.is_source_system(value TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT value IS NOT NULL
    AND char_length(value) BETWEEN 1 AND 64
    AND value ~ '^[a-z][a-z0-9-]*$'
$$;

CREATE OR REPLACE FUNCTION control_center.is_source_kind(value TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT value IS NOT NULL
    AND char_length(value) BETWEEN 1 AND 64
    AND value ~ '^[a-z][a-z0-9._-]*$'
$$;

CREATE OR REPLACE FUNCTION control_center.is_confidence(value NUMERIC)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT value IS NOT NULL AND value >= 0 AND value <= 1
$$;

CREATE TABLE control_center.directives (
  id TEXT PRIMARY KEY CHECK (control_center.is_resource_id(id)),
  internal_uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('decision', 'directive', 'fact', 'constraint', 'priority', 'risk', 'hypothesis')),
  scope TEXT NOT NULL CHECK (control_center.is_scope(scope)),
  status TEXT NOT NULL CHECK (control_center.is_directive_status(status)),
  title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 512),
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 20000),
  effective_from TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  created_by TEXT NOT NULL CHECK (char_length(btrim(created_by)) BETWEEN 1 AND 256),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  current_revision_id TEXT,
  CHECK (expires_at IS NULL OR expires_at > effective_from)
);

CREATE TABLE control_center.directive_revisions (
  id TEXT PRIMARY KEY CHECK (control_center.is_resource_id(id)),
  internal_uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  directive_id TEXT NOT NULL REFERENCES control_center.directives (id),
  revision_no INTEGER NOT NULL CHECK (revision_no >= 1),
  kind TEXT NOT NULL CHECK (kind IN ('decision', 'directive', 'fact', 'constraint', 'priority', 'risk', 'hypothesis')),
  scope TEXT NOT NULL CHECK (control_center.is_scope(scope)),
  status TEXT NOT NULL CHECK (control_center.is_directive_status(status)),
  title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 512),
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 20000),
  effective_from TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  created_by TEXT NOT NULL CHECK (char_length(btrim(created_by)) BETWEEN 1 AND 256),
  source_system TEXT NOT NULL CHECK (control_center.is_source_system(source_system)),
  source_kind TEXT NOT NULL CHECK (control_center.is_source_kind(source_kind)),
  source_locator TEXT NOT NULL CHECK (char_length(btrim(source_locator)) BETWEEN 1 AND 512),
  source_label TEXT CHECK (source_label IS NULL OR char_length(btrim(source_label)) BETWEEN 1 AND 128),
  observed_at TIMESTAMPTZ NOT NULL,
  freshness_status TEXT NOT NULL CHECK (control_center.is_freshness(freshness_status)),
  confidence NUMERIC(5, 4) NOT NULL CHECK (control_center.is_confidence(confidence)),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  recorded_by TEXT NOT NULL CHECK (char_length(btrim(recorded_by)) BETWEEN 1 AND 256),
  UNIQUE (directive_id, revision_no)
);

ALTER TABLE control_center.directives
  ADD CONSTRAINT directives_current_revision_fk
  FOREIGN KEY (current_revision_id) REFERENCES control_center.directive_revisions (id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE control_center.directive_supersedes (
  directive_id TEXT NOT NULL REFERENCES control_center.directives (id),
  superseded_id TEXT NOT NULL REFERENCES control_center.directives (id),
  PRIMARY KEY (directive_id, superseded_id),
  CHECK (directive_id IS DISTINCT FROM superseded_id),
  CHECK (control_center.is_resource_id(directive_id)),
  CHECK (control_center.is_resource_id(superseded_id))
);

CREATE TABLE control_center.directive_revision_supersedes (
  revision_id TEXT NOT NULL REFERENCES control_center.directive_revisions (id),
  superseded_id TEXT NOT NULL REFERENCES control_center.directives (id),
  PRIMARY KEY (revision_id, superseded_id),
  CHECK (control_center.is_resource_id(revision_id)),
  CHECK (control_center.is_resource_id(superseded_id))
);

CREATE TABLE control_center.collector_runs (
  id TEXT PRIMARY KEY CHECK (control_center.is_resource_id(id)),
  internal_uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  collector_name TEXT NOT NULL CHECK (char_length(btrim(collector_name)) BETWEEN 1 AND 128),
  idempotency_key TEXT NOT NULL CHECK (char_length(btrim(idempotency_key)) BETWEEN 1 AND 512),
  status TEXT NOT NULL CHECK (status IN ('started', 'succeeded', 'failed', 'skipped')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  source_system TEXT NOT NULL CHECK (control_center.is_source_system(source_system)),
  source_kind TEXT NOT NULL CHECK (control_center.is_source_kind(source_kind)),
  source_locator TEXT NOT NULL CHECK (char_length(btrim(source_locator)) BETWEEN 1 AND 512),
  source_label TEXT CHECK (source_label IS NULL OR char_length(btrim(source_label)) BETWEEN 1 AND 128),
  observed_at TIMESTAMPTZ NOT NULL,
  freshness_status TEXT NOT NULL CHECK (control_center.is_freshness(freshness_status)),
  confidence NUMERIC(5, 4) NOT NULL CHECK (control_center.is_confidence(confidence)),
  scope TEXT NOT NULL CHECK (control_center.is_scope(scope)),
  error_code TEXT CHECK (error_code IS NULL OR char_length(error_code) BETWEEN 1 AND 64),
  stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (idempotency_key),
  CHECK (finished_at IS NULL OR finished_at >= started_at)
);

CREATE TABLE control_center.source_observations (
  id TEXT PRIMARY KEY CHECK (control_center.is_resource_id(id)),
  internal_uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  source_system TEXT NOT NULL CHECK (control_center.is_source_system(source_system)),
  source_kind TEXT NOT NULL CHECK (control_center.is_source_kind(source_kind)),
  source_locator TEXT NOT NULL CHECK (char_length(btrim(source_locator)) BETWEEN 1 AND 512),
  source_label TEXT CHECK (source_label IS NULL OR char_length(btrim(source_label)) BETWEEN 1 AND 128),
  observed_at TIMESTAMPTZ NOT NULL,
  freshness_status TEXT NOT NULL CHECK (control_center.is_freshness(freshness_status)),
  confidence NUMERIC(5, 4) NOT NULL CHECK (control_center.is_confidence(confidence)),
  scope TEXT NOT NULL CHECK (control_center.is_scope(scope)),
  observation_kind TEXT NOT NULL CHECK (char_length(btrim(observation_kind)) BETWEEN 1 AND 128),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  money_amount_cents BIGINT CHECK (money_amount_cents IS NULL OR money_amount_cents >= 0),
  money_currency CHAR(3) CHECK (money_currency IS NULL OR money_currency ~ '^[A-Z]{3}$'),
  CHECK ((money_amount_cents IS NULL) = (money_currency IS NULL)),
  idempotency_key TEXT NOT NULL CHECK (char_length(btrim(idempotency_key)) BETWEEN 1 AND 512),
  collector_run_id TEXT REFERENCES control_center.collector_runs (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (idempotency_key)
);

CREATE TABLE control_center.operational_snapshots (
  id TEXT PRIMARY KEY CHECK (control_center.is_resource_id(id)),
  internal_uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL CHECK (control_center.is_scope(scope)),
  snapshot_kind TEXT NOT NULL CHECK (char_length(btrim(snapshot_kind)) BETWEEN 1 AND 128),
  source_system TEXT NOT NULL CHECK (control_center.is_source_system(source_system)),
  source_kind TEXT NOT NULL CHECK (control_center.is_source_kind(source_kind)),
  source_locator TEXT NOT NULL CHECK (char_length(btrim(source_locator)) BETWEEN 1 AND 512),
  source_label TEXT CHECK (source_label IS NULL OR char_length(btrim(source_label)) BETWEEN 1 AND 128),
  observed_at TIMESTAMPTZ NOT NULL,
  freshness_status TEXT NOT NULL CHECK (control_center.is_freshness(freshness_status)),
  confidence NUMERIC(5, 4) NOT NULL CHECK (control_center.is_confidence(confidence)),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  money_amount_cents BIGINT CHECK (money_amount_cents IS NULL OR money_amount_cents >= 0),
  money_currency CHAR(3) CHECK (money_currency IS NULL OR money_currency ~ '^[A-Z]{3}$'),
  CHECK ((money_amount_cents IS NULL) = (money_currency IS NULL)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE control_center.attention_items (
  id TEXT PRIMARY KEY CHECK (control_center.is_resource_id(id)),
  internal_uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL CHECK (control_center.is_scope(scope)),
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 512),
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 20000),
  status TEXT NOT NULL CHECK (status IN ('open', 'acknowledged', 'resolved', 'dismissed')),
  source_system TEXT NOT NULL CHECK (control_center.is_source_system(source_system)),
  source_kind TEXT NOT NULL CHECK (control_center.is_source_kind(source_kind)),
  source_locator TEXT NOT NULL CHECK (char_length(btrim(source_locator)) BETWEEN 1 AND 512),
  source_label TEXT CHECK (source_label IS NULL OR char_length(btrim(source_label)) BETWEEN 1 AND 128),
  observed_at TIMESTAMPTZ NOT NULL,
  freshness_status TEXT NOT NULL CHECK (control_center.is_freshness(freshness_status)),
  confidence NUMERIC(5, 4) NOT NULL CHECK (control_center.is_confidence(confidence)),
  related_directive_id TEXT REFERENCES control_center.directives (id),
  CHECK (related_directive_id IS NULL OR control_center.is_resource_id(related_directive_id)),
  money_amount_cents BIGINT CHECK (money_amount_cents IS NULL OR money_amount_cents >= 0),
  money_currency CHAR(3) CHECK (money_currency IS NULL OR money_currency ~ '^[A-Z]{3}$'),
  CHECK ((money_amount_cents IS NULL) = (money_currency IS NULL)),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE control_center.agent_sessions (
  id TEXT PRIMARY KEY CHECK (control_center.is_resource_id(id)),
  internal_uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL CHECK (control_center.is_scope(scope)),
  agent_id TEXT NOT NULL CHECK (char_length(btrim(agent_id)) BETWEEN 1 AND 256),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  context_query JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_system TEXT NOT NULL CHECK (control_center.is_source_system(source_system)),
  source_kind TEXT NOT NULL CHECK (control_center.is_source_kind(source_kind)),
  source_locator TEXT NOT NULL CHECK (char_length(btrim(source_locator)) BETWEEN 1 AND 512),
  source_label TEXT CHECK (source_label IS NULL OR char_length(btrim(source_label)) BETWEEN 1 AND 128),
  observed_at TIMESTAMPTZ NOT NULL,
  freshness_status TEXT NOT NULL CHECK (control_center.is_freshness(freshness_status)),
  confidence NUMERIC(5, 4) NOT NULL CHECK (control_center.is_confidence(confidence)),
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE TABLE control_center.agent_activities (
  id TEXT PRIMARY KEY CHECK (control_center.is_resource_id(id)),
  internal_uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  correlation_id TEXT NOT NULL UNIQUE CHECK (char_length(btrim(correlation_id)) BETWEEN 1 AND 128),
  scope TEXT NOT NULL CHECK (control_center.is_scope(scope)),
  agent_id TEXT NOT NULL CHECK (char_length(btrim(agent_id)) BETWEEN 1 AND 256),
  status TEXT NOT NULL CHECK (status IN ('RUNNING', 'DONE', 'PARTIAL', 'BLOCKED', 'FAILED', 'UNKNOWN')),
  goal TEXT NOT NULL CHECK (char_length(btrim(goal)) BETWEEN 1 AND 512),
  summary TEXT NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 20000),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  source_system TEXT NOT NULL CHECK (control_center.is_source_system(source_system)),
  source_kind TEXT NOT NULL CHECK (control_center.is_source_kind(source_kind)),
  source_locator TEXT NOT NULL CHECK (char_length(btrim(source_locator)) BETWEEN 1 AND 512),
  source_label TEXT CHECK (source_label IS NULL OR char_length(btrim(source_label)) BETWEEN 1 AND 128),
  observed_at TIMESTAMPTZ NOT NULL,
  freshness_status TEXT NOT NULL CHECK (control_center.is_freshness(freshness_status)),
  confidence NUMERIC(5, 4) NOT NULL CHECK (control_center.is_confidence(confidence)),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  current_revision_no INTEGER NOT NULL CHECK (current_revision_no >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (finished_at IS NULL OR finished_at >= started_at)
);

CREATE TABLE control_center.agent_activity_revisions (
  id TEXT PRIMARY KEY CHECK (control_center.is_resource_id(id)),
  internal_uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  activity_id TEXT NOT NULL REFERENCES control_center.agent_activities (id),
  revision_no INTEGER NOT NULL CHECK (revision_no >= 1),
  status TEXT NOT NULL CHECK (status IN ('RUNNING', 'DONE', 'PARTIAL', 'BLOCKED', 'FAILED', 'UNKNOWN')),
  summary TEXT NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 20000),
  source_system TEXT NOT NULL CHECK (control_center.is_source_system(source_system)),
  source_kind TEXT NOT NULL CHECK (control_center.is_source_kind(source_kind)),
  source_locator TEXT NOT NULL CHECK (char_length(btrim(source_locator)) BETWEEN 1 AND 512),
  source_label TEXT CHECK (source_label IS NULL OR char_length(btrim(source_label)) BETWEEN 1 AND 128),
  observed_at TIMESTAMPTZ NOT NULL,
  freshness_status TEXT NOT NULL CHECK (control_center.is_freshness(freshness_status)),
  confidence NUMERIC(5, 4) NOT NULL CHECK (control_center.is_confidence(confidence)),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (activity_id, revision_no)
);

CREATE TABLE control_center.audit_events (
  id TEXT PRIMARY KEY CHECK (control_center.is_resource_id(id)),
  internal_uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor TEXT NOT NULL CHECK (char_length(btrim(actor)) BETWEEN 1 AND 256),
  action TEXT NOT NULL CHECK (char_length(btrim(action)) BETWEEN 1 AND 128),
  entity_type TEXT NOT NULL CHECK (char_length(btrim(entity_type)) BETWEEN 1 AND 64),
  entity_id TEXT CHECK (entity_id IS NULL OR control_center.is_resource_id(entity_id)),
  scope TEXT NOT NULL CHECK (control_center.is_scope(scope)),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_system TEXT NOT NULL CHECK (control_center.is_source_system(source_system)),
  source_kind TEXT NOT NULL CHECK (control_center.is_source_kind(source_kind)),
  source_locator TEXT NOT NULL CHECK (char_length(btrim(source_locator)) BETWEEN 1 AND 512),
  source_label TEXT CHECK (source_label IS NULL OR char_length(btrim(source_label)) BETWEEN 1 AND 128),
  observed_at TIMESTAMPTZ NOT NULL,
  freshness_status TEXT NOT NULL CHECK (control_center.is_freshness(freshness_status)),
  confidence NUMERIC(5, 4) NOT NULL CHECK (control_center.is_confidence(confidence))
);

CREATE INDEX directives_scope_status_idx
  ON control_center.directives (scope, status, kind);
CREATE INDEX directive_revisions_directive_idx
  ON control_center.directive_revisions (directive_id, revision_no);
CREATE INDEX directive_supersedes_superseded_idx
  ON control_center.directive_supersedes (superseded_id);
CREATE INDEX directive_revision_supersedes_superseded_idx
  ON control_center.directive_revision_supersedes (superseded_id);
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
CREATE INDEX agent_activities_scope_started_idx
  ON control_center.agent_activities (scope, started_at DESC);
CREATE INDEX agent_activity_revisions_activity_idx
  ON control_center.agent_activity_revisions (activity_id, revision_no);
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

CREATE TRIGGER directive_revision_supersedes_append_only
  BEFORE UPDATE OR DELETE ON control_center.directive_revision_supersedes
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

CREATE TRIGGER agent_activity_revisions_append_only
  BEFORE UPDATE OR DELETE ON control_center.agent_activity_revisions
  FOR EACH ROW EXECUTE FUNCTION control_center.cc_reject_mutation();
