from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path

import pytest

from delivery.control_center import project_work_order
from delivery.errors import IllegalTransitionError, OptimisticConcurrencyError, ReplayError
from delivery.store import SQLiteWorkOrderStore
from delivery.work_order import WorkOrderService, rebuild_store_projection, rebuild_work_order

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "delivery" / "fixtures" / "delivery_order_requested.synthetic.v1.json"


def request() -> dict:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def admission(**overrides) -> dict:
    value = {
        "decision": "CAN_ACCEPT",
        "readiness_state": "PRODUCTION_READY",
        "readiness_ref": "readiness:CFG-DIAG-EXP-v1@v1",
        "capacity_hold_id": "hold:diag-canary-001",
        "capacity_snapshot_id": "capacity:synthetic-one-unit-001",
        "calendar_version": "calendar:business-days-v1",
    }
    value.update(overrides)
    return value


@pytest.fixture
def service(tmp_path: Path) -> WorkOrderService:
    return WorkOrderService(SQLiteWorkOrderStore(tmp_path / "delivery.sqlite3"))


def create(service: WorkOrderService, req: dict | None = None, adm: dict | None = None) -> dict:
    return service.request_delivery(
        req or request(),
        adm or admission(),
        required_inputs=["company_context", "expansion_target"],
        qa_checklist=["sources_referenced", "scope_respected", "no_customer_data"],
        estimated_effort_units=1,
        sla_business_days=2,
    )


def meta(key: str, version: int, at: str) -> dict:
    return {
        "idempotency_key": key,
        "expected_version": version,
        "occurred_at": at,
        "actor": "operator:delivery-synthetic",
    }


def ready(service: WorkOrderService) -> tuple[str, int]:
    made = create(service)
    wid = made["work_order_id"]
    service.assign_owner(wid, "owner:delivery-synthetic", **meta("owner-1", 1, "2026-08-25T12:01:00.000Z"))
    service.receive_input(
        wid,
        "company_context",
        "fixture:input-company-context-redacted",
        **meta("input-1", 2, "2026-08-25T12:02:00.000Z"),
    )
    final = service.receive_input(
        wid,
        "expansion_target",
        "fixture:input-expansion-target-redacted",
        **meta("input-2", 3, "2026-08-25T12:03:00.000Z"),
    )
    assert final["state"]["current_stage"] == "READY"
    return wid, 4


def in_progress_with_artifact(service: WorkOrderService) -> tuple[str, int]:
    wid, version = ready(service)
    service.start(wid, **meta("start-1", version, "2026-08-25T12:04:00.000Z"))
    result = service.record_artifact(
        wid,
        "artifact:diag-expansion-sandbox-v1",
        **meta("artifact-1", version + 1, "2026-08-25T12:05:00.000Z"),
    )
    return wid, result["state"]["version"]


def test_create_replay_three_times_creates_exactly_one_work_order(service: WorkOrderService):
    results = [create(service) for _ in range(3)]
    assert len({item["work_order_id"] for item in results}) == 1
    assert [item["duplicate"] for item in results] == [False, True, True]
    assert len(service.store.list_work_orders()) == 1
    assert service.store.count_events() == 1


def test_same_business_snapshot_with_new_transport_id_still_has_one_work_order(service: WorkOrderService):
    first = create(service)
    replay = request()
    replay["event_id"] = "evt-delivery-request-replayed-transport-002"
    replay["idempotency_key"] = "delivery-request:proposal-diag-canary-001:1:reconciled-replay-002"
    second = create(service, replay)
    assert first["work_order_id"] == second["work_order_id"]
    assert second["status"] == "EXISTS"
    assert service.store.count_events() == 1


def test_financial_readiness_and_capacity_unknown_are_held_without_partial_os(service: WorkOrderService):
    unknown_finance = request()
    unknown_finance["idempotency_key"] = "held-finance-unknown"
    unknown_finance["financial_gate"] = {
        "schema_version": "confenge.financial_gate.v1",
        "state": "UNKNOWN",
        "synthetic": True,
        "source_event_id": None,
        "received_revenue": False,
        "evidence_refs": [],
    }
    assert create(service, unknown_finance)["blockers"] == ["financial_gate:UNKNOWN"]

    for key, adm in (
        ("held-readiness", admission(readiness_state="UNKNOWN")),
        ("held-capacity", admission(decision="UNKNOWN")),
        ("held-capacity-zero", admission(decision="CANNOT_ACCEPT")),
    ):
        req = request()
        req["idempotency_key"] = key
        result = create(service, req, adm)
        assert result["status"] == "HELD"
        assert result["work_order_id"] is None
    assert service.store.list_work_orders() == []
    assert service.store.count_events() == 0


def test_inputs_and_owner_fail_closed(service: WorkOrderService):
    made = create(service)
    wid = made["work_order_id"]
    with pytest.raises(IllegalTransitionError, match="owner"):
        service.start(wid, **meta("start-no-owner", 1, "2026-08-25T12:01:00.000Z"))
    service.assign_owner(wid, "owner:delivery-synthetic", **meta("owner", 1, "2026-08-25T12:02:00.000Z"))
    with pytest.raises(IllegalTransitionError, match="inputs missing"):
        service.start(wid, **meta("start-missing-inputs", 2, "2026-08-25T12:03:00.000Z"))
    state = service.store.get(wid)
    assert state["current_stage"] == "AWAITING_INPUTS"
    assert state["clock_state"] == "NOT_STARTED"


def test_optimistic_concurrency_and_idempotent_command(service: WorkOrderService):
    made = create(service)
    wid = made["work_order_id"]
    first = service.assign_owner(wid, "owner:a", **meta("owner-concurrent", 1, "2026-08-25T12:01:00.000Z"))
    replay = service.assign_owner(wid, "owner:a", **meta("owner-concurrent", 1, "2026-08-25T12:01:00.000Z"))
    assert replay["duplicate"] is True
    assert replay["event"]["event_id"] == first["event"]["event_id"]
    with pytest.raises(OptimisticConcurrencyError, match="expected version 1"):
        service.assign_owner(wid, "owner:b", **meta("owner-stale", 1, "2026-08-25T12:02:00.000Z"))


def test_due_at_is_evented_and_deterministic_on_replay(service: WorkOrderService):
    wid, _ = ready(service)
    before = service.store.get(wid)
    assert before["due_at"] == "2026-08-27T12:03:00.000Z"
    events = list(reversed(service.store.events(wid)))
    rebuilt = rebuild_work_order(events + [deepcopy(events[-1])])
    assert rebuilt == before
    assert rebuilt["due_at"] == before["due_at"]


def test_qa_fail_returns_to_production_then_passes_to_ready_to_deliver(service: WorkOrderService):
    wid, version = in_progress_with_artifact(service)
    review = service.start_qa(wid, **meta("qa-start-1", version, "2026-08-25T12:06:00.000Z"))
    failed = service.fail_qa(
        wid,
        "source reference missing",
        **meta("qa-fail-1", review["state"]["version"], "2026-08-25T12:07:00.000Z"),
    )
    assert failed["state"]["current_stage"] == "IN_PROGRESS"
    assert failed["state"]["qa_state"] == "FAILED"
    correction = service.record_artifact(
        wid,
        "artifact:diag-expansion-sandbox-v2",
        **meta("artifact-correction", failed["state"]["version"], "2026-08-25T12:08:00.000Z"),
    )
    review2 = service.start_qa(
        wid,
        **meta("qa-start-2", correction["state"]["version"], "2026-08-25T12:09:00.000Z"),
    )
    passed = service.pass_qa(
        wid,
        "fixture:qa-checklist-passed",
        **meta("qa-pass", review2["state"]["version"], "2026-08-25T12:10:00.000Z"),
    )
    assert passed["state"]["current_stage"] == "READY_TO_DELIVER"
    assert passed["state"]["qa_state"] == "PASSED"


def test_delivery_without_artifact_and_acceptance_without_delivery_are_rejected(service: WorkOrderService):
    wid, version = in_progress_with_artifact(service)
    with pytest.raises(IllegalTransitionError, match="explicit acceptance"):
        service.accept_delivery(
            wid,
            "fixture:false-acceptance",
            **meta("accept-before-delivery", version, "2026-08-25T12:06:00.000Z"),
        )
    qa = service.start_qa(wid, **meta("qa-start", version, "2026-08-25T12:07:00.000Z"))
    passed = service.pass_qa(
        wid,
        "fixture:qa-passed",
        **meta("qa-pass", qa["state"]["version"], "2026-08-25T12:08:00.000Z"),
    )
    defensive = deepcopy(passed["state"])
    defensive["artifact_refs"] = []
    service.store.replace_projection(wid, defensive)
    with pytest.raises(IllegalTransitionError, match="without an artifact"):
        service.deliver(
            wid,
            "fixture:false-delivery",
            **meta("deliver-no-artifact", defensive["version"], "2026-08-25T12:09:00.000Z"),
        )


def test_illegal_transition_does_not_append_event(service: WorkOrderService):
    made = create(service)
    wid = made["work_order_id"]
    before = service.store.count_events(wid)
    with pytest.raises(IllegalTransitionError):
        service.start_qa(wid, **meta("illegal-qa", 1, "2026-08-25T12:01:00.000Z"))
    assert service.store.count_events(wid) == before


def test_projector_rebuilds_from_zero_and_control_center_copies_truth(service: WorkOrderService):
    wid, _ = ready(service)
    expected = service.store.get(wid)
    service.store.clear_projection()
    with pytest.raises(KeyError):
        service.store.get(wid)
    rebuilt = rebuild_store_projection(service.store)
    assert rebuilt == [expected]
    projection = project_work_order(expected, observed_at="2026-08-25T12:10:00.000Z")
    assert projection["stage"] == expected["current_stage"]
    assert projection["owner"] == expected["responsible_owner"]
    assert projection["source"]["last_event_id"] == expected["last_event_id"]
    assert "set_stage" not in projection


def test_replay_rejects_missing_or_conflicting_events(service: WorkOrderService):
    wid, _ = ready(service)
    events = service.store.events(wid)
    with pytest.raises(ReplayError, match="non-contiguous"):
        rebuild_work_order([events[0], events[-1]])
    conflict = deepcopy(events[0])
    conflict["payload"]["state"]["account_id"] = "different"
    with pytest.raises(ReplayError, match="conflicting payloads"):
        rebuild_work_order(events + [conflict])
