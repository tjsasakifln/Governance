"""Read-only Control Center projection for Delivery OS Work Orders."""

from __future__ import annotations

from copy import deepcopy
from typing import Any


def project_work_order(state: dict[str, Any], *, observed_at: str) -> dict[str, Any]:
    """Map persisted truth without deriving or mutating workflow state."""

    required = {
        "work_order_id",
        "client_ref",
        "deliverable_id",
        "deliverable_version",
        "current_stage",
        "responsible_owner",
        "clock_state",
        "due_at",
        "readiness_state",
        "blockers",
        "qa_state",
        "artifact_refs",
        "acceptance_state",
        "last_event_id",
        "correlation_id",
        "proposal_id",
        "proposal_version",
    }
    missing = sorted(required - state.keys())
    if missing:
        raise ValueError(f"work order projection missing truth fields: {', '.join(missing)}")
    blockers = state["blockers"]
    artifacts = state["artifact_refs"]
    return {
        "schema_version": "confenge.control_center.delivery_projection.v1",
        "work_order_id": state["work_order_id"],
        "client_ref": state["client_ref"],
        "deliverable": {
            "id": state["deliverable_id"],
            "version": state["deliverable_version"],
        },
        "stage": state["current_stage"],
        "owner": state["responsible_owner"],
        "clock": state["clock_state"],
        "due_at": state["due_at"],
        "readiness": state["readiness_state"],
        "blocker": blockers[0] if blockers else None,
        "qa_state": state["qa_state"],
        "artifact_count": len(artifacts),
        "artifact_ref": artifacts[-1] if artifacts else None,
        "acceptance": state["acceptance_state"],
        "freshness": "FRESH",
        "source": {
            "system": "governance-delivery-os",
            "schema_version": state["schema_version"],
            "last_event_id": state["last_event_id"],
            "observed_at": observed_at,
        },
        "correlation_id": state["correlation_id"],
        "proposal_ref": f"{state['proposal_id']}@{state['proposal_version']}",
    }


def rebuild_control_center(states: list[dict[str, Any]], *, observed_at: str) -> list[dict[str, Any]]:
    return [
        project_work_order(deepcopy(state), observed_at=observed_at)
        for state in sorted(states, key=lambda item: item["work_order_id"])
    ]
