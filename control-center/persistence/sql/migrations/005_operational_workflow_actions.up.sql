-- Additive local-workflow actions. These append audit only; they do not write
-- Warmbly and cannot mark an upstream exception resolved.
CREATE OR REPLACE FUNCTION control_center.is_operator_action_type(value TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT value IN (
    'REVIEW_ACTIVITY', 'ACKNOWLEDGE_EXCEPTION', 'REOPEN_EXCEPTION',
    'CONFIRM_NEXT_ACTION', 'REJECT_NEXT_ACTION', 'RECORD_NOTE',
    'MARK_REVIEWED', 'ASSIGN_TRIAGE', 'MARK_TRIAGED',
    'START_EXCEPTION_WORK'
  )
$$;
