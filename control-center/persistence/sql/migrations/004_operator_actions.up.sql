-- Additive operator-action ledger. Founder-attributable, idempotent, append-only.
-- Forbidden commercial-send / money mutations cannot be stored.

CREATE OR REPLACE FUNCTION control_center.is_operator_action_type(value TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT value IN (
    'REVIEW_ACTIVITY',
    'ACKNOWLEDGE_EXCEPTION',
    'REOPEN_EXCEPTION',
    'CONFIRM_NEXT_ACTION',
    'REJECT_NEXT_ACTION',
    'RECORD_NOTE',
    'MARK_REVIEWED'
  )
$$;

CREATE OR REPLACE FUNCTION control_center.is_operator_action_status(value TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT value IN ('accepted', 'rejected', 'duplicate')
$$;

CREATE TABLE control_center.operator_actions (
  id TEXT PRIMARY KEY CHECK (control_center.is_resource_id(id)),
  internal_uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  action_type TEXT NOT NULL CHECK (control_center.is_operator_action_type(action_type)),
  target_canonical_id TEXT NOT NULL CHECK (char_length(btrim(target_canonical_id)) BETWEEN 1 AND 128),
  target_source_id TEXT NOT NULL CHECK (char_length(btrim(target_source_id)) BETWEEN 1 AND 128),
  actor_kind TEXT NOT NULL CHECK (actor_kind = 'human'),
  actor_id TEXT NOT NULL CHECK (char_length(btrim(actor_id)) BETWEEN 1 AND 128),
  occurred_at TIMESTAMPTZ NOT NULL,
  correlation_id TEXT NOT NULL CHECK (char_length(btrim(correlation_id)) BETWEEN 1 AND 128),
  idempotency_key TEXT NOT NULL CHECK (char_length(btrim(idempotency_key)) BETWEEN 1 AND 512),
  scope TEXT NOT NULL CHECK (control_center.is_scope(scope)),
  resulting_status TEXT NOT NULL CHECK (control_center.is_operator_action_status(resulting_status)),
  before_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  after_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence_ref TEXT CHECK (evidence_ref IS NULL OR char_length(btrim(evidence_ref)) BETWEEN 1 AND 512),
  note TEXT CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 4000),
  source_system TEXT NOT NULL CHECK (control_center.is_source_system(source_system)),
  source_kind TEXT NOT NULL CHECK (control_center.is_source_kind(source_kind)),
  source_locator TEXT NOT NULL CHECK (char_length(btrim(source_locator)) BETWEEN 1 AND 512),
  source_label TEXT CHECK (source_label IS NULL OR char_length(btrim(source_label)) BETWEEN 1 AND 128),
  observed_at TIMESTAMPTZ NOT NULL,
  freshness_status TEXT NOT NULL CHECK (control_center.is_freshness(freshness_status)),
  confidence NUMERIC(5, 4) NOT NULL CHECK (control_center.is_confidence(confidence)),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (idempotency_key)
);

CREATE INDEX operator_actions_scope_occurred_idx
  ON control_center.operator_actions (scope, occurred_at DESC, id DESC);

CREATE INDEX operator_actions_target_idx
  ON control_center.operator_actions (target_canonical_id, occurred_at DESC);

CREATE TRIGGER operator_actions_append_only
  BEFORE UPDATE OR DELETE ON control_center.operator_actions
  FOR EACH ROW EXECUTE FUNCTION control_center.cc_reject_mutation();
