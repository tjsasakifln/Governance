DROP TRIGGER IF EXISTS operator_actions_append_only ON control_center.operator_actions;
DROP TABLE IF EXISTS control_center.operator_actions;
DROP FUNCTION IF EXISTS control_center.is_operator_action_status(TEXT);
DROP FUNCTION IF EXISTS control_center.is_operator_action_type(TEXT);
