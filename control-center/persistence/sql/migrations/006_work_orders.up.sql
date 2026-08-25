-- CONFENGE Delivery OS Work Order v1.
-- Events and holds are append-only authorities. work_orders is a disposable
-- current-state projection and can be rebuilt from work_order_events.

CREATE TABLE control_center.work_orders (
  work_order_id TEXT PRIMARY KEY CHECK (control_center.is_resource_id(work_order_id)),
  proposal_id TEXT NOT NULL CHECK (char_length(btrim(proposal_id)) BETWEEN 1 AND 256),
  accepted_snapshot_hash TEXT NOT NULL CHECK (accepted_snapshot_hash ~ '^sha256:[a-f0-9]{64}$'),
  deliverable_id TEXT NOT NULL CHECK (char_length(btrim(deliverable_id)) BETWEEN 1 AND 256),
  deliverable_version TEXT NOT NULL CHECK (char_length(btrim(deliverable_version)) BETWEEN 1 AND 128),
  current_version INTEGER NOT NULL CHECK (current_version >= 1),
  current_stage TEXT NOT NULL CHECK (current_stage IN (
    'AWAITING_INPUTS', 'READY', 'IN_PROGRESS', 'BLOCKED', 'QA', 'READY_TO_DELIVER',
    'DELIVERED', 'ACCEPTED', 'REWORK_REQUIRED', 'CLOSED', 'CANCELLED'
  )),
  last_event_id TEXT NOT NULL CHECK (control_center.is_resource_id(last_event_id)),
  synthetic BOOLEAN NOT NULL,
  projection_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CHECK (jsonb_typeof(projection_json) = 'object'),
  CHECK (projection_json ->> 'schema_version' = 'confenge.work_order.v1'),
  CHECK (projection_json ->> 'work_order_id' = work_order_id),
  CHECK ((projection_json ->> 'version')::INTEGER = current_version),
  CHECK (projection_json ->> 'current_stage' = current_stage),
  CHECK (projection_json ->> 'last_event_id' = last_event_id)
);

CREATE UNIQUE INDEX work_orders_one_active_identity
  ON control_center.work_orders (proposal_id, accepted_snapshot_hash, deliverable_id, deliverable_version)
  WHERE current_stage NOT IN ('CLOSED', 'CANCELLED');

CREATE INDEX work_orders_stage_due_idx
  ON control_center.work_orders (current_stage, ((projection_json ->> 'due_at')));

CREATE OR REPLACE FUNCTION control_center.cc_guard_work_order_projection()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.work_order_id <> OLD.work_order_id
     OR NEW.proposal_id <> OLD.proposal_id
     OR NEW.accepted_snapshot_hash <> OLD.accepted_snapshot_hash
     OR NEW.deliverable_id <> OLD.deliverable_id
     OR NEW.deliverable_version <> OLD.deliverable_version
     OR (NEW.projection_json ->> 'proposal_id') IS DISTINCT FROM (OLD.projection_json ->> 'proposal_id')
     OR (NEW.projection_json ->> 'proposal_version') IS DISTINCT FROM (OLD.projection_json ->> 'proposal_version')
     OR (NEW.projection_json ->> 'client_id') IS DISTINCT FROM (OLD.projection_json ->> 'client_id')
     OR (NEW.projection_json ->> 'account_id') IS DISTINCT FROM (OLD.projection_json ->> 'account_id')
     OR (NEW.projection_json ->> 'opportunity_id') IS DISTINCT FROM (OLD.projection_json ->> 'opportunity_id')
     OR (NEW.projection_json ->> 'qco_id') IS DISTINCT FROM (OLD.projection_json ->> 'qco_id')
     OR (NEW.projection_json ->> 'order_id') IS DISTINCT FROM (OLD.projection_json ->> 'order_id')
     OR (NEW.projection_json -> 'provider_refs') IS DISTINCT FROM (OLD.projection_json -> 'provider_refs')
     OR (NEW.projection_json ->> 'accepted_snapshot_hash') IS DISTINCT FROM (OLD.projection_json ->> 'accepted_snapshot_hash')
     OR (NEW.projection_json ->> 'offer_id') IS DISTINCT FROM (OLD.projection_json ->> 'offer_id')
     OR (NEW.projection_json ->> 'offer_version') IS DISTINCT FROM (OLD.projection_json ->> 'offer_version')
     OR (NEW.projection_json ->> 'deliverable_id') IS DISTINCT FROM (OLD.projection_json ->> 'deliverable_id')
     OR (NEW.projection_json ->> 'deliverable_version') IS DISTINCT FROM (OLD.projection_json ->> 'deliverable_version')
     OR (NEW.projection_json ->> 'scope_version') IS DISTINCT FROM (OLD.projection_json ->> 'scope_version')
     OR (NEW.projection_json ->> 'price_version') IS DISTINCT FROM (OLD.projection_json ->> 'price_version')
     OR (NEW.projection_json ->> 'terms_version') IS DISTINCT FROM (OLD.projection_json ->> 'terms_version')
     OR (NEW.projection_json ->> 'business_calendar_version') IS DISTINCT FROM (OLD.projection_json ->> 'business_calendar_version')
     OR (NEW.projection_json ->> 'estimated_effort_minutes') IS DISTINCT FROM (OLD.projection_json ->> 'estimated_effort_minutes')
     OR (NEW.projection_json ->> 'estimated_capacity_units') IS DISTINCT FROM (OLD.projection_json ->> 'estimated_capacity_units')
     OR (NEW.projection_json ->> 'capacity_commitment_id') IS DISTINCT FROM (OLD.projection_json ->> 'capacity_commitment_id')
     OR (NEW.projection_json ->> 'created_at') IS DISTINCT FROM (OLD.projection_json ->> 'created_at')
     OR (NEW.projection_json ->> 'synthetic') IS DISTINCT FROM (OLD.projection_json ->> 'synthetic')
     OR jsonb_path_query_array(NEW.projection_json, '$.inputs_required[*].input_id')
        IS DISTINCT FROM jsonb_path_query_array(OLD.projection_json, '$.inputs_required[*].input_id')
  THEN
    RAISE EXCEPTION 'accepted Work Order identity/snapshot is immutable';
  END IF;
  IF NEW.current_version < OLD.current_version OR NEW.current_version > OLD.current_version + 1 THEN
    RAISE EXCEPTION 'Work Order projection version must stay or advance exactly once';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER work_orders_guard_projection
  BEFORE UPDATE ON control_center.work_orders
  FOR EACH ROW EXECUTE FUNCTION control_center.cc_guard_work_order_projection();

CREATE TABLE control_center.work_order_events (
  event_id TEXT PRIMARY KEY CHECK (control_center.is_resource_id(event_id)),
  work_order_id TEXT NOT NULL REFERENCES control_center.work_orders (work_order_id),
  event_version INTEGER NOT NULL CHECK (event_version >= 1),
  expected_version INTEGER NOT NULL CHECK (expected_version >= 0),
  event_type TEXT NOT NULL CHECK (char_length(btrim(event_type)) BETWEEN 1 AND 64),
  occurred_at TIMESTAMPTZ NOT NULL,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('human', 'agent', 'system')),
  actor_id TEXT NOT NULL CHECK (char_length(btrim(actor_id)) BETWEEN 1 AND 256),
  reason_code TEXT NOT NULL CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{1,127}$'),
  literal_reason_ref TEXT NOT NULL CHECK (char_length(btrim(literal_reason_ref)) BETWEEN 1 AND 512),
  idempotency_key TEXT NOT NULL UNIQUE CHECK (char_length(btrim(idempotency_key)) BETWEEN 8 AND 512),
  correlation_id TEXT NOT NULL CHECK (char_length(btrim(correlation_id)) BETWEEN 1 AND 128),
  causation_id TEXT CHECK (causation_id IS NULL OR char_length(btrim(causation_id)) BETWEEN 1 AND 128),
  source_system TEXT NOT NULL CHECK (control_center.is_source_system(source_system)),
  event_json JSONB NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (work_order_id, event_version),
  CHECK (event_version = expected_version + 1),
  CHECK (jsonb_typeof(event_json) = 'object'),
  CHECK (event_json ->> 'schema_version' = 'confenge.work_order_event.v1'),
  CHECK (event_json ->> 'event_id' = event_id),
  CHECK (event_json ->> 'work_order_id' = work_order_id),
  CHECK ((event_json ->> 'event_version')::INTEGER = event_version),
  CHECK ((event_json ->> 'expected_version')::INTEGER = expected_version)
);

CREATE INDEX work_order_events_stream_idx
  ON control_center.work_order_events (work_order_id, event_version);

CREATE TABLE control_center.work_order_event_holds (
  hold_id TEXT PRIMARY KEY CHECK (control_center.is_resource_id(hold_id)),
  work_order_id TEXT NOT NULL CHECK (control_center.is_resource_id(work_order_id)),
  reason TEXT NOT NULL CHECK (reason IN (
    'MISSING_ORDER', 'VERSION_CONFLICT', 'IDEMPOTENCY_CONFLICT',
    'ACTIVE_IDENTITY_CONFLICT', 'TEMPORAL_CONFLICT', 'PROJECTION_CONFLICT'
  )),
  current_version INTEGER CHECK (current_version IS NULL OR current_version >= 1),
  idempotency_key TEXT NOT NULL CHECK (char_length(btrim(idempotency_key)) BETWEEN 8 AND 512),
  event_json JSONB NOT NULL,
  projection_json JSONB NOT NULL,
  held_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(event_json) = 'object'),
  CHECK (jsonb_typeof(projection_json) = 'object')
);

CREATE INDEX work_order_event_holds_order_idx
  ON control_center.work_order_event_holds (work_order_id, held_at DESC);

CREATE TRIGGER work_order_events_append_only
  BEFORE UPDATE OR DELETE ON control_center.work_order_events
  FOR EACH ROW EXECUTE FUNCTION control_center.cc_reject_mutation();

CREATE TRIGGER work_order_event_holds_append_only
  BEFORE UPDATE OR DELETE ON control_center.work_order_event_holds
  FOR EACH ROW EXECUTE FUNCTION control_center.cc_reject_mutation();

CREATE TRIGGER work_orders_no_delete
  BEFORE DELETE ON control_center.work_orders
  FOR EACH ROW EXECUTE FUNCTION control_center.cc_reject_mutation();

CREATE VIEW control_center.v_work_order_projection AS
SELECT
  work_order_id,
  current_version AS version,
  current_stage AS stage,
  projection_json ->> 'clock_state' AS clock_state,
  projection_json ->> 'responsible_owner' AS responsible_owner,
  (projection_json ->> 'due_at')::TIMESTAMPTZ AS due_at,
  projection_json ->> 'QA_state' AS qa_state,
  projection_json ->> 'client_acceptance_state' AS acceptance_state,
  jsonb_array_length(projection_json -> 'blockers') AS blocker_count,
  synthetic,
  updated_at AS observed_at,
  projection_json
FROM control_center.work_orders;
