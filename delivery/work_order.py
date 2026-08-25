"""Work Order v1 command handler, state machine and event replay."""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from .contracts import (
    WORK_ORDER_SCHEMA,
    deterministic_work_order_id,
    validate_admission,
    validate_delivery_order_requested,
    work_order_business_key,
)
from .errors import ContractError, GateHeldError, IllegalTransitionError, ReplayError
from .store import SQLiteWorkOrderStore

ACTIVE_STAGES = {
    "AWAITING_INPUTS",
    "READY",
    "IN_PROGRESS",
    "BLOCKED",
    "QA",
    "READY_TO_DELIVER",
    "DELIVERED",
    "ACCEPTED",
}


def _nonempty(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ContractError(f"{field} must be a non-empty string")
    return value


def _parse_utc(value: str) -> datetime:
    if not isinstance(value, str) or not value.endswith("Z"):
        raise ContractError("timestamps must be UTC RFC3339 values ending in Z")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise ContractError(f"invalid timestamp {value!r}") from error
    if parsed.tzinfo is None or parsed.utcoffset() != timedelta(0):
        raise ContractError("timestamps must be UTC")
    return parsed


def _utc(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def add_business_days(value: str, days: int) -> str:
    """Deterministic v1 calendar: Monday-Friday, no inferred holidays."""

    if days < 1:
        raise ContractError("sla_business_days must be positive")
    cursor = _parse_utc(value)
    remaining = days
    while remaining:
        cursor += timedelta(days=1)
        if cursor.weekday() < 5:
            remaining -= 1
    return _utc(cursor)


def _apply_delta(state: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    result = deepcopy(state)
    for key, value in payload.items():
        if key == "received_input":
            item = value
            result["received_inputs"][item["input_id"]] = item["evidence_ref"]
        elif key == "artifact_ref":
            if value not in result["artifact_refs"]:
                result["artifact_refs"].append(value)
        else:
            result[key] = deepcopy(value)
    return result


def apply_event(state: dict[str, Any] | None, event: dict[str, Any]) -> dict[str, Any]:
    if event.get("schema_version") != "confenge.work_order_event.v1":
        raise ReplayError("unknown event schema")
    if event.get("event_type") == "WORK_ORDER_CREATED":
        if state is not None:
            raise ReplayError("WORK_ORDER_CREATED must be the first event")
        created = deepcopy(event["payload"]["state"])
        created["version"] = event["version"]
        created["last_event_id"] = event["event_id"]
        return created
    if state is None:
        raise ReplayError("event stream does not start with WORK_ORDER_CREATED")
    if event.get("work_order_id") != state["work_order_id"]:
        raise ReplayError("event work_order_id diverges from stream")
    expected = state["version"] + 1
    if event.get("version") != expected or event.get("expected_version") != state["version"]:
        raise ReplayError(
            f"non-contiguous event version: expected {expected}, got {event.get('version')}"
        )
    result = _apply_delta(state, event["payload"])
    result["version"] = event["version"]
    result["last_event_id"] = event["event_id"]
    return result


def rebuild_work_order(events: list[dict[str, Any]]) -> dict[str, Any]:
    """Converge duplicate/out-of-order transport into one strict event stream."""

    if not events:
        raise ReplayError("cannot rebuild an empty stream")
    unique: dict[str, dict[str, Any]] = {}
    for event in events:
        event_id = event.get("event_id")
        if not isinstance(event_id, str):
            raise ReplayError("event_id missing")
        existing = unique.get(event_id)
        if existing is not None and existing != event:
            raise ReplayError(f"event_id {event_id!r} has conflicting payloads")
        unique[event_id] = deepcopy(event)
    ordered = sorted(unique.values(), key=lambda item: int(item.get("version", -1)))
    state: dict[str, Any] | None = None
    for event in ordered:
        state = apply_event(state, event)
    assert state is not None
    return state


def rebuild_store_projection(store: SQLiteWorkOrderStore) -> list[dict[str, Any]]:
    """Delete every disposable Work Order row and rebuild it only from events."""

    events = store.events()
    grouped: dict[str, list[dict[str, Any]]] = {}
    for event in events:
        grouped.setdefault(event["work_order_id"], []).append(event)
    rebuilt = [rebuild_work_order(stream) for stream in grouped.values()]
    store.clear_projection()
    for state in rebuilt:
        store.replace_projection(state["work_order_id"], state)
    return sorted(rebuilt, key=lambda state: state["work_order_id"])


class WorkOrderService:
    def __init__(self, store: SQLiteWorkOrderStore):
        self.store = store

    def request_delivery(
        self,
        request: Any,
        admission: Any,
        *,
        required_inputs: list[str],
        qa_checklist: list[str],
        estimated_effort_units: float,
        sla_business_days: int,
        actor: str = "system:delivery-handoff",
    ) -> dict[str, Any]:
        clean_request = validate_delivery_order_requested(request)
        clean_admission = validate_admission(admission)
        decision_input = {
            "request": clean_request,
            "admission": clean_admission,
            "required_inputs": required_inputs,
            "qa_checklist": qa_checklist,
            "estimated_effort_units": estimated_effort_units,
            "sla_business_days": sla_business_days,
        }
        existing = self.store.get_decision(clean_request["idempotency_key"], decision_input)
        if existing is not None:
            return existing
        blockers: list[str] = []
        gate = clean_request["financial_gate"]
        if gate["state"] not in {"SYNTHETIC_VALID", "AUTHORIZED"}:
            blockers.append("financial_gate:UNKNOWN")
        if clean_admission["readiness_state"] not in {"PRODUCTION_READY", "DELIVERY_VALIDATED"}:
            blockers.append(f"readiness:{clean_admission['readiness_state']}")
        if clean_admission["decision"] != "CAN_ACCEPT":
            blockers.append(f"capacity:{clean_admission['decision']}")
        if not clean_request["onboarding_ref"]:
            blockers.append("onboarding_ref:UNKNOWN")
        if not required_inputs or not all(isinstance(item, str) and item for item in required_inputs):
            blockers.append("required_inputs:UNKNOWN")
        if not qa_checklist or not all(isinstance(item, str) and item for item in qa_checklist):
            blockers.append("qa_checklist:UNKNOWN")
        if not isinstance(estimated_effort_units, (int, float)) or isinstance(
            estimated_effort_units, bool
        ) or estimated_effort_units <= 0:
            blockers.append("estimated_effort:UNKNOWN")
        if not isinstance(sla_business_days, int) or isinstance(sla_business_days, bool) or sla_business_days < 1:
            blockers.append("calendar_or_sla:UNKNOWN")
        if blockers:
            response = {
                "status": "HELD",
                "work_order_id": None,
                "state": None,
                "duplicate": False,
                "blockers": blockers,
            }
            return self.store.record_held_decision(
                idempotency_key=clean_request["idempotency_key"],
                request=decision_input,
                response=response,
            )
        if gate["synthetic"] and gate["received_revenue"]:
            raise GateHeldError("synthetic gate cannot be revenue")
        work_order_id = deterministic_work_order_id(clean_request)
        state = {
            "schema_version": WORK_ORDER_SCHEMA,
            "work_order_id": work_order_id,
            "business_key": work_order_business_key(clean_request),
            "synthetic": clean_request["synthetic"],
            "correlation_id": clean_request["correlation_id"],
            "organization_id": clean_request["organization_id"],
            "account_id": clean_request["account_id"],
            "client_ref": clean_request["client_ref"],
            "opportunity_id": clean_request["opportunity_id"],
            "qco_id": clean_request["qco_id"],
            "proposal_id": clean_request["proposal_id"],
            "proposal_version": clean_request["proposal_version"],
            "accepted_snapshot_hash": clean_request["accepted_snapshot_hash"],
            "offer_id": clean_request["offer_id"],
            "offer_version": clean_request["offer_version"],
            "deliverable_id": clean_request["deliverable_id"],
            "deliverable_version": clean_request["deliverable_version"],
            "scope_version": clean_request["scope_version"],
            "price_version": clean_request["price_version"],
            "terms_version": clean_request["terms_version"],
            "required_inputs": list(dict.fromkeys(required_inputs)),
            "received_inputs": {},
            "created_at": clean_request["occurred_at"],
            "started_at": None,
            "due_at": None,
            "sla_business_days": sla_business_days,
            "calendar_version": clean_admission["calendar_version"],
            "clock_state": "NOT_STARTED",
            "blockers": [f"input:{item}" for item in dict.fromkeys(required_inputs)],
            "current_stage": "AWAITING_INPUTS",
            "responsible_owner": None,
            "estimated_effort": {"units": float(estimated_effort_units), "unit": "capacity_unit"},
            "actual_effort": {"units": 0.0, "unit": "capacity_unit"},
            "qa_state": "NOT_STARTED",
            "qa_checklist": list(qa_checklist),
            "artifact_refs": [],
            "delivery_state": "NOT_DELIVERED",
            "delivery_evidence_ref": None,
            "acceptance_state": "UNKNOWN",
            "acceptance_actor": None,
            "acceptance_at": None,
            "acceptance_evidence_ref": None,
            "outcome": "UNKNOWN",
            "readiness_state": clean_admission["readiness_state"],
            "readiness_ref": clean_admission["readiness_ref"],
            "capacity_commitment_id": clean_admission["capacity_hold_id"],
            "onboarding_ref": clean_request["onboarding_ref"],
            "version": 0,
            "last_event_id": "pending",
        }
        return self.store.create(
            request=clean_request,
            decision_document=decision_input,
            state=state,
            occurred_at=clean_request["occurred_at"],
            actor=actor,
        )

    def _command(
        self,
        work_order_id: str,
        *,
        event_type: str,
        idempotency_key: str,
        expected_version: int,
        occurred_at: str,
        actor: str,
        command: dict[str, Any],
        transition: Callable[[dict[str, Any]], tuple[dict[str, Any], dict[str, Any]]],
    ) -> dict[str, Any]:
        _parse_utc(occurred_at)
        _nonempty(idempotency_key, "idempotency_key")
        _nonempty(actor, "actor")
        return self.store.mutate(
            work_order_id=work_order_id,
            event_type=event_type,
            idempotency_key=idempotency_key,
            expected_version=expected_version,
            causation_id=command.get("causation_id", idempotency_key),
            occurred_at=occurred_at,
            actor=actor,
            command=command,
            transition=transition,
        )

    def assign_owner(self, work_order_id: str, owner: str, **meta: Any) -> dict[str, Any]:
        owner = _nonempty(owner, "owner")

        def transition(state: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
            if state["current_stage"] in {"ACCEPTED", "CLOSED"}:
                raise IllegalTransitionError("owner cannot change after acceptance")
            payload: dict[str, Any] = {"responsible_owner": owner}
            if set(state["required_inputs"]) == set(state["received_inputs"]):
                payload["current_stage"] = "READY"
                payload["blockers"] = []
            return payload, _apply_delta(state, payload)

        return self._command(
            work_order_id,
            event_type="OWNER_ASSIGNED",
            command={"owner": owner},
            transition=transition,
            **meta,
        )

    def receive_input(
        self, work_order_id: str, input_id: str, evidence_ref: str, **meta: Any
    ) -> dict[str, Any]:
        input_id = _nonempty(input_id, "input_id")
        evidence_ref = _nonempty(evidence_ref, "evidence_ref")

        def transition(state: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
            if state["current_stage"] not in {"AWAITING_INPUTS", "READY"}:
                raise IllegalTransitionError("inputs can only be recorded before work starts")
            if input_id not in state["required_inputs"]:
                raise ContractError(f"input {input_id!r} is not required by this Work Order")
            payload: dict[str, Any] = {
                "received_input": {"input_id": input_id, "evidence_ref": evidence_ref}
            }
            next_state = _apply_delta(state, payload)
            missing = sorted(set(state["required_inputs"]) - set(next_state["received_inputs"]))
            blockers = [f"input:{item}" for item in missing]
            if next_state["responsible_owner"] is None:
                blockers.append("owner:UNKNOWN")
            payload["blockers"] = blockers
            if not blockers:
                payload["current_stage"] = "READY"
                payload["due_at"] = add_business_days(meta["occurred_at"], state["sla_business_days"])
            next_state = _apply_delta(state, payload)
            return payload, next_state

        return self._command(
            work_order_id,
            event_type="INPUT_RECEIVED",
            command={"input_id": input_id, "evidence_ref": evidence_ref},
            transition=transition,
            **meta,
        )

    def start(self, work_order_id: str, **meta: Any) -> dict[str, Any]:
        def transition(state: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
            if state["responsible_owner"] is None:
                raise IllegalTransitionError("responsible owner is required")
            missing = sorted(set(state["required_inputs"]) - set(state["received_inputs"]))
            if missing:
                raise IllegalTransitionError(f"required inputs missing: {', '.join(missing)}")
            if state["current_stage"] != "READY":
                raise IllegalTransitionError(f"cannot start from {state['current_stage']}")
            payload = {
                "current_stage": "IN_PROGRESS",
                "clock_state": "RUNNING",
                "started_at": meta["occurred_at"],
                "blockers": [],
            }
            return payload, _apply_delta(state, payload)

        return self._command(
            work_order_id,
            event_type="WORK_STARTED",
            command={},
            transition=transition,
            **meta,
        )

    def block(self, work_order_id: str, reason: str, **meta: Any) -> dict[str, Any]:
        reason = _nonempty(reason, "reason")

        def transition(state: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
            if state["current_stage"] != "IN_PROGRESS":
                raise IllegalTransitionError("only IN_PROGRESS work can be blocked")
            payload = {"current_stage": "BLOCKED", "clock_state": "PAUSED", "blockers": [reason]}
            return payload, _apply_delta(state, payload)

        return self._command(
            work_order_id,
            event_type="WORK_BLOCKED",
            command={"reason": reason},
            transition=transition,
            **meta,
        )

    def resume(self, work_order_id: str, **meta: Any) -> dict[str, Any]:
        def transition(state: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
            if state["current_stage"] != "BLOCKED":
                raise IllegalTransitionError("only BLOCKED work can resume")
            payload = {"current_stage": "IN_PROGRESS", "clock_state": "RUNNING", "blockers": []}
            return payload, _apply_delta(state, payload)

        return self._command(
            work_order_id,
            event_type="WORK_RESUMED",
            command={},
            transition=transition,
            **meta,
        )

    def record_artifact(self, work_order_id: str, artifact_ref: str, **meta: Any) -> dict[str, Any]:
        artifact_ref = _nonempty(artifact_ref, "artifact_ref")

        def transition(state: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
            if state["current_stage"] != "IN_PROGRESS":
                raise IllegalTransitionError("artifacts are recorded from IN_PROGRESS")
            payload = {"artifact_ref": artifact_ref}
            return payload, _apply_delta(state, payload)

        return self._command(
            work_order_id,
            event_type="ARTIFACT_RECORDED",
            command={"artifact_ref": artifact_ref},
            transition=transition,
            **meta,
        )

    def start_qa(self, work_order_id: str, **meta: Any) -> dict[str, Any]:
        def transition(state: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
            if state["current_stage"] != "IN_PROGRESS":
                raise IllegalTransitionError("QA can only start from IN_PROGRESS")
            if not state["artifact_refs"]:
                raise IllegalTransitionError("QA requires at least one referenced artifact")
            payload = {"current_stage": "QA", "qa_state": "IN_REVIEW"}
            return payload, _apply_delta(state, payload)

        return self._command(
            work_order_id,
            event_type="QA_STARTED",
            command={},
            transition=transition,
            **meta,
        )

    def fail_qa(self, work_order_id: str, reason: str, **meta: Any) -> dict[str, Any]:
        reason = _nonempty(reason, "reason")

        def transition(state: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
            if state["current_stage"] != "QA":
                raise IllegalTransitionError("QA failure requires QA stage")
            payload = {
                "current_stage": "IN_PROGRESS",
                "qa_state": "FAILED",
                "blockers": [f"qa_correction:{reason}"],
            }
            return payload, _apply_delta(state, payload)

        return self._command(
            work_order_id,
            event_type="QA_FAILED",
            command={"reason": reason},
            transition=transition,
            **meta,
        )

    def pass_qa(self, work_order_id: str, checklist_evidence_ref: str, **meta: Any) -> dict[str, Any]:
        checklist_evidence_ref = _nonempty(checklist_evidence_ref, "checklist_evidence_ref")

        def transition(state: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
            if state["current_stage"] != "QA" or state["qa_state"] != "IN_REVIEW":
                raise IllegalTransitionError("QA pass requires an active QA review")
            payload = {
                "current_stage": "READY_TO_DELIVER",
                "qa_state": "PASSED",
                "blockers": [],
                "qa_evidence_ref": checklist_evidence_ref,
            }
            return payload, _apply_delta(state, payload)

        return self._command(
            work_order_id,
            event_type="QA_PASSED",
            command={"checklist_evidence_ref": checklist_evidence_ref},
            transition=transition,
            **meta,
        )

    def deliver(self, work_order_id: str, evidence_ref: str, **meta: Any) -> dict[str, Any]:
        evidence_ref = _nonempty(evidence_ref, "evidence_ref")

        def transition(state: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
            if state["current_stage"] != "READY_TO_DELIVER" or state["qa_state"] != "PASSED":
                raise IllegalTransitionError("delivery requires READY_TO_DELIVER and passed QA")
            if not state["artifact_refs"]:
                raise IllegalTransitionError("delivery without an artifact is forbidden")
            payload = {
                "current_stage": "DELIVERED",
                "delivery_state": "SANDBOX",
                "delivery_evidence_ref": evidence_ref,
                "clock_state": "STOPPED",
            }
            return payload, _apply_delta(state, payload)

        return self._command(
            work_order_id,
            event_type="DELIVERED",
            command={"mode": "SANDBOX", "evidence_ref": evidence_ref},
            transition=transition,
            **meta,
        )

    def accept_delivery(self, work_order_id: str, evidence_ref: str, **meta: Any) -> dict[str, Any]:
        evidence_ref = _nonempty(evidence_ref, "evidence_ref")

        def transition(state: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
            if state["current_stage"] != "DELIVERED" or state["delivery_state"] != "SANDBOX":
                raise IllegalTransitionError("explicit acceptance requires delivered sandbox evidence")
            payload = {
                "current_stage": "ACCEPTED",
                "acceptance_state": "ACCEPTED_SANDBOX",
                "acceptance_actor": meta["actor"],
                "acceptance_at": meta["occurred_at"],
                "acceptance_evidence_ref": evidence_ref,
            }
            return payload, _apply_delta(state, payload)

        return self._command(
            work_order_id,
            event_type="DELIVERY_ACCEPTED",
            command={"mode": "SANDBOX", "evidence_ref": evidence_ref},
            transition=transition,
            **meta,
        )

    def close(self, work_order_id: str, evidence_ref: str, actual_effort_units: float, **meta: Any) -> dict[str, Any]:
        evidence_ref = _nonempty(evidence_ref, "evidence_ref")
        if not isinstance(actual_effort_units, (int, float)) or isinstance(actual_effort_units, bool) or actual_effort_units < 0:
            raise ContractError("actual_effort_units must be non-negative")

        def transition(state: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
            if state["current_stage"] != "ACCEPTED" or state["acceptance_state"] != "ACCEPTED_SANDBOX":
                raise IllegalTransitionError("close requires explicit acceptance")
            payload = {
                "current_stage": "CLOSED",
                "clock_state": "STOPPED",
                "outcome": "UNKNOWN",
                "actual_effort": {"units": float(actual_effort_units), "unit": "capacity_unit"},
                "closeout_evidence_ref": evidence_ref,
            }
            return payload, _apply_delta(state, payload)

        return self._command(
            work_order_id,
            event_type="WORK_ORDER_CLOSED",
            command={"evidence_ref": evidence_ref, "actual_effort_units": actual_effort_units},
            transition=transition,
            **meta,
        )
