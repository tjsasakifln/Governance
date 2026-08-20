DROP INDEX IF EXISTS control_center.mv_open_attention_scope_severity_idx;
DROP INDEX IF EXISTS control_center.mv_open_attention_id_idx;
DROP MATERIALIZED VIEW IF EXISTS control_center.mv_open_attention;

DROP TABLE IF EXISTS control_center.current_source_observations;
DROP TABLE IF EXISTS control_center.current_attention_items;
DROP TABLE IF EXISTS control_center.current_directives;
