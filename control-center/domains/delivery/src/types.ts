export interface WorkOrderReadModel {
  schema_version: "confenge.work_order.v1";
  work_order_id: string;
  client_ref: string;
  deliverable_id: string;
  deliverable_version: string;
  current_stage: string;
  responsible_owner: string | null;
  clock_state: string;
  due_at: string | null;
  readiness_state: string;
  blockers: string[];
  qa_state: string;
  artifact_refs: string[];
  acceptance_state: string;
  last_event_id: string;
  correlation_id: string;
  proposal_id: string;
  proposal_version: number;
}

export interface ControlCenterDeliveryProjection {
  schema_version: "confenge.control_center.delivery_projection.v1";
  work_order_id: string;
  client_ref: string;
  deliverable: { id: string; version: string };
  stage: string;
  owner: string | null;
  clock: string;
  due_at: string | null;
  readiness: string;
  blocker: string | null;
  qa_state: string;
  artifact_count: number;
  artifact_ref: string | null;
  acceptance: string;
  freshness: "FRESH";
  source: {
    system: "governance-delivery-os";
    schema_version: "confenge.work_order.v1";
    last_event_id: string;
    observed_at: string;
  };
  correlation_id: string;
  proposal_ref: string;
}
