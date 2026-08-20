DROP TRIGGER IF EXISTS agent_activity_revisions_append_only ON control_center.agent_activity_revisions;
DROP TRIGGER IF EXISTS source_observations_append_only ON control_center.source_observations;
DROP TRIGGER IF EXISTS directives_no_delete ON control_center.directives;
DROP TRIGGER IF EXISTS audit_events_append_only ON control_center.audit_events;
DROP TRIGGER IF EXISTS directive_revision_supersedes_append_only ON control_center.directive_revision_supersedes;
DROP TRIGGER IF EXISTS directive_revisions_append_only ON control_center.directive_revisions;

DROP TABLE IF EXISTS control_center.audit_events;
DROP TABLE IF EXISTS control_center.agent_activity_revisions;
DROP TABLE IF EXISTS control_center.agent_activities;
DROP TABLE IF EXISTS control_center.agent_sessions;
DROP TABLE IF EXISTS control_center.attention_items;
DROP TABLE IF EXISTS control_center.operational_snapshots;
DROP TABLE IF EXISTS control_center.source_observations;
DROP TABLE IF EXISTS control_center.collector_runs;
DROP TABLE IF EXISTS control_center.directive_revision_supersedes;
DROP TABLE IF EXISTS control_center.directive_supersedes;

ALTER TABLE IF EXISTS control_center.directives
  DROP CONSTRAINT IF EXISTS directives_current_revision_fk;

DROP TABLE IF EXISTS control_center.directive_revisions;
DROP TABLE IF EXISTS control_center.directives;

DROP FUNCTION IF EXISTS control_center.cc_reject_mutation();
DROP FUNCTION IF EXISTS control_center.is_confidence(NUMERIC);
DROP FUNCTION IF EXISTS control_center.is_source_kind(TEXT);
DROP FUNCTION IF EXISTS control_center.is_source_system(TEXT);
DROP FUNCTION IF EXISTS control_center.is_scope(TEXT);
DROP FUNCTION IF EXISTS control_center.is_resource_id(TEXT);
DROP FUNCTION IF EXISTS control_center.is_directive_status(TEXT);
DROP FUNCTION IF EXISTS control_center.is_freshness(TEXT);

DROP TABLE IF EXISTS control_center.schema_migrations;
DROP SCHEMA IF EXISTS control_center;
