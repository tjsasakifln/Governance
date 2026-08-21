DROP VIEW IF EXISTS control_center.v_latest_operational_snapshots;
DROP VIEW IF EXISTS control_center.v_latest_source_observations;
DROP VIEW IF EXISTS control_center.v_latest_collector_runs;

DROP TRIGGER IF EXISTS operational_snapshot_revisions_append_only ON control_center.operational_snapshot_revisions;
DROP TRIGGER IF EXISTS operational_snapshots_append_only ON control_center.operational_snapshots;
DROP TRIGGER IF EXISTS collector_run_revisions_append_only ON control_center.collector_run_revisions;
DROP TRIGGER IF EXISTS collector_runs_append_only ON control_center.collector_runs;

DROP TABLE IF EXISTS control_center.operational_snapshot_revisions;
DROP TABLE IF EXISTS control_center.collector_run_revisions;

ALTER TABLE control_center.operational_snapshots
  DROP CONSTRAINT IF EXISTS operational_snapshots_idempotency_key_key;

ALTER TABLE control_center.operational_snapshots
  DROP CONSTRAINT IF EXISTS operational_snapshots_idempotency_key_check;

ALTER TABLE control_center.operational_snapshots
  DROP COLUMN IF EXISTS idempotency_key;

ALTER TABLE control_center.collector_runs
  DROP CONSTRAINT IF EXISTS collector_runs_status_objective_check;

UPDATE control_center.collector_runs
SET status = CASE status
  WHEN 'RUNNING' THEN 'started'
  WHEN 'DONE' THEN 'succeeded'
  WHEN 'PARTIAL' THEN 'succeeded'
  WHEN 'FAILED' THEN 'failed'
  WHEN 'UNKNOWN' THEN 'skipped'
  ELSE status
END
WHERE status IN ('RUNNING', 'DONE', 'PARTIAL', 'FAILED', 'UNKNOWN');

ALTER TABLE control_center.collector_runs
  ADD CONSTRAINT collector_runs_status_check
  CHECK (status IN ('started', 'succeeded', 'failed', 'skipped'));

DROP FUNCTION IF EXISTS control_center.is_collector_run_status(TEXT);
