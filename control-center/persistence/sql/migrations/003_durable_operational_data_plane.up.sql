-- Additive durable operational data plane.
-- OBJECTIVE collector-run status lives on this schema and the frozen latest views.
-- History is append-only; latest is a projection. source_observations is reused.

CREATE OR REPLACE FUNCTION control_center.is_collector_run_status(value TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT value IN ('RUNNING', 'DONE', 'PARTIAL', 'FAILED', 'UNKNOWN')
$$;

DO $$
DECLARE
  con TEXT;
BEGIN
  SELECT c.conname INTO con
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'control_center'
    AND t.relname = 'collector_runs'
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) ILIKE '%started%'
    AND pg_get_constraintdef(c.oid) ILIKE '%succeeded%'
  LIMIT 1;
  IF con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE control_center.collector_runs DROP CONSTRAINT %I', con);
  END IF;
END
$$;

UPDATE control_center.collector_runs
SET status = CASE status
  WHEN 'started' THEN 'RUNNING'
  WHEN 'succeeded' THEN 'DONE'
  WHEN 'failed' THEN 'FAILED'
  WHEN 'skipped' THEN 'UNKNOWN'
  ELSE status
END
WHERE status IN ('started', 'succeeded', 'failed', 'skipped');

ALTER TABLE control_center.collector_runs
  ADD CONSTRAINT collector_runs_status_objective_check
  CHECK (control_center.is_collector_run_status(status));

CREATE TABLE control_center.collector_run_revisions (
  id TEXT PRIMARY KEY CHECK (control_center.is_resource_id(id)),
  internal_uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  run_id TEXT NOT NULL REFERENCES control_center.collector_runs (id),
  revision_no INTEGER NOT NULL CHECK (revision_no >= 1),
  status TEXT NOT NULL CHECK (control_center.is_collector_run_status(status)),
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  source_system TEXT NOT NULL CHECK (control_center.is_source_system(source_system)),
  source_kind TEXT NOT NULL CHECK (control_center.is_source_kind(source_kind)),
  source_locator TEXT NOT NULL CHECK (char_length(btrim(source_locator)) BETWEEN 1 AND 512),
  source_label TEXT CHECK (source_label IS NULL OR char_length(btrim(source_label)) BETWEEN 1 AND 128),
  observed_at TIMESTAMPTZ NOT NULL,
  freshness_status TEXT NOT NULL CHECK (control_center.is_freshness(freshness_status)),
  confidence NUMERIC(5, 4) NOT NULL CHECK (control_center.is_confidence(confidence)),
  error_code TEXT CHECK (error_code IS NULL OR char_length(error_code) BETWEEN 1 AND 64),
  error_message TEXT CHECK (error_message IS NULL OR char_length(error_message) BETWEEN 1 AND 512),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload_ref TEXT CHECK (payload_ref IS NULL OR char_length(btrim(payload_ref)) BETWEEN 1 AND 512),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, revision_no),
  CHECK (finished_at IS NULL OR finished_at >= started_at)
);

INSERT INTO control_center.collector_run_revisions (
  id, run_id, revision_no, status, started_at, finished_at,
  source_system, source_kind, source_locator, source_label,
  observed_at, freshness_status, confidence, error_code, error_message, payload, payload_ref
)
SELECT
  'cc:collector-run-revision:' || substr(r.id, length('cc:collector-run:') + 1),
  r.id,
  1,
  r.status,
  r.started_at,
  r.finished_at,
  r.source_system,
  r.source_kind,
  r.source_locator,
  r.source_label,
  r.observed_at,
  r.freshness_status,
  r.confidence,
  r.error_code,
  NULL,
  COALESCE(r.stats, '{}'::jsonb),
  NULL
FROM control_center.collector_runs r
WHERE NOT EXISTS (
  SELECT 1 FROM control_center.collector_run_revisions x WHERE x.run_id = r.id
);

CREATE INDEX collector_run_revisions_run_idx
  ON control_center.collector_run_revisions (run_id, revision_no DESC);

CREATE TRIGGER collector_runs_append_only
  BEFORE UPDATE OR DELETE ON control_center.collector_runs
  FOR EACH ROW EXECUTE FUNCTION control_center.cc_reject_mutation();

CREATE TRIGGER collector_run_revisions_append_only
  BEFORE UPDATE OR DELETE ON control_center.collector_run_revisions
  FOR EACH ROW EXECUTE FUNCTION control_center.cc_reject_mutation();

ALTER TABLE control_center.operational_snapshots
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

UPDATE control_center.operational_snapshots
SET idempotency_key = concat_ws(
  ':',
  scope,
  snapshot_kind,
  source_system,
  source_kind,
  source_locator,
  to_char(observed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  id
)
WHERE idempotency_key IS NULL OR btrim(idempotency_key) = '';

ALTER TABLE control_center.operational_snapshots
  ALTER COLUMN idempotency_key SET NOT NULL;

ALTER TABLE control_center.operational_snapshots
  ADD CONSTRAINT operational_snapshots_idempotency_key_check
  CHECK (char_length(btrim(idempotency_key)) BETWEEN 1 AND 512);

ALTER TABLE control_center.operational_snapshots
  ADD CONSTRAINT operational_snapshots_idempotency_key_key UNIQUE (idempotency_key);

CREATE TABLE control_center.operational_snapshot_revisions (
  id TEXT PRIMARY KEY CHECK (control_center.is_resource_id(id)),
  internal_uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  snapshot_id TEXT NOT NULL REFERENCES control_center.operational_snapshots (id),
  revision_no INTEGER NOT NULL CHECK (revision_no >= 1),
  source_system TEXT NOT NULL CHECK (control_center.is_source_system(source_system)),
  source_kind TEXT NOT NULL CHECK (control_center.is_source_kind(source_kind)),
  source_locator TEXT NOT NULL CHECK (char_length(btrim(source_locator)) BETWEEN 1 AND 512),
  source_label TEXT CHECK (source_label IS NULL OR char_length(btrim(source_label)) BETWEEN 1 AND 128),
  observed_at TIMESTAMPTZ NOT NULL,
  freshness_status TEXT NOT NULL CHECK (control_center.is_freshness(freshness_status)),
  confidence NUMERIC(5, 4) NOT NULL CHECK (control_center.is_confidence(confidence)),
  snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (snapshot_id, revision_no)
);

INSERT INTO control_center.operational_snapshot_revisions (
  id, snapshot_id, revision_no,
  source_system, source_kind, source_locator, source_label,
  observed_at, freshness_status, confidence, snapshot_json
)
SELECT
  'cc:operational-snapshot-revision:' || substr(s.id, length('cc:operational-snapshot:') + 1),
  s.id,
  1,
  s.source_system,
  s.source_kind,
  s.source_locator,
  s.source_label,
  s.observed_at,
  s.freshness_status,
  s.confidence,
  COALESCE(s.payload, '{}'::jsonb)
FROM control_center.operational_snapshots s
WHERE NOT EXISTS (
  SELECT 1 FROM control_center.operational_snapshot_revisions x WHERE x.snapshot_id = s.id
);

CREATE INDEX operational_snapshot_revisions_snapshot_idx
  ON control_center.operational_snapshot_revisions (snapshot_id, revision_no DESC);

CREATE TRIGGER operational_snapshots_append_only
  BEFORE UPDATE OR DELETE ON control_center.operational_snapshots
  FOR EACH ROW EXECUTE FUNCTION control_center.cc_reject_mutation();

CREATE TRIGGER operational_snapshot_revisions_append_only
  BEFORE UPDATE OR DELETE ON control_center.operational_snapshot_revisions
  FOR EACH ROW EXECUTE FUNCTION control_center.cc_reject_mutation();

CREATE OR REPLACE VIEW control_center.v_latest_collector_runs AS
SELECT DISTINCT ON (r.collector_name)
  r.collector_name AS collector,
  r.id AS run_id,
  rev.status,
  rev.freshness_status,
  r.started_at,
  rev.finished_at,
  rev.observed_at,
  rev.error_code,
  rev.payload AS payload_json
FROM control_center.collector_runs r
JOIN control_center.collector_run_revisions rev
  ON rev.run_id = r.id
 AND rev.revision_no = (
   SELECT max(r2.revision_no)
   FROM control_center.collector_run_revisions r2
   WHERE r2.run_id = r.id
 )
ORDER BY r.collector_name, r.started_at DESC, r.id DESC;

CREATE OR REPLACE VIEW control_center.v_latest_source_observations AS
SELECT DISTINCT ON (o.source_system, o.source_kind, o.source_locator, o.scope, o.observation_kind)
  o.id AS observation_id,
  o.scope,
  o.observation_kind AS observation_type,
  o.source_system,
  o.source_kind,
  o.source_locator,
  o.observed_at,
  o.freshness_status,
  o.confidence,
  o.payload AS payload_json
FROM control_center.source_observations o
ORDER BY
  o.source_system,
  o.source_kind,
  o.source_locator,
  o.scope,
  o.observation_kind,
  o.observed_at DESC,
  o.created_at DESC,
  o.id DESC;

CREATE OR REPLACE VIEW control_center.v_latest_operational_snapshots AS
SELECT DISTINCT ON (s.scope, s.snapshot_kind, s.source_system, s.source_kind, s.source_locator)
  s.id AS snapshot_id,
  s.scope,
  s.snapshot_kind AS snapshot_type,
  rev.observed_at,
  rev.freshness_status,
  rev.confidence,
  rev.source_system,
  rev.source_kind,
  rev.source_locator,
  rev.snapshot_json
FROM control_center.operational_snapshots s
JOIN control_center.operational_snapshot_revisions rev
  ON rev.snapshot_id = s.id
 AND rev.revision_no = (
   SELECT max(r2.revision_no)
   FROM control_center.operational_snapshot_revisions r2
   WHERE r2.snapshot_id = s.id
 )
ORDER BY
  s.scope,
  s.snapshot_kind,
  s.source_system,
  s.source_kind,
  s.source_locator,
  rev.observed_at DESC,
  s.id DESC;
