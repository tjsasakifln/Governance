from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from delivery.capacity import CapacityError, CapacityLedger, evaluate_admission, project_capacity_read_only


ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "delivery" / "fixtures"
EVALUATED_AT = "2026-08-25T12:00:00Z"


def load(name: str):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def decide(*, readiness=None, capacity=None, active=(), reserved=0, request=None):
    return evaluate_admission(
        request=request or load("canary-capacity-request.v1.json"),
        readiness=load("cfg-diag-exp-v1.production-ready.json") if readiness is None else readiness,
        capacity_snapshot=load("capacity-synthetic-one.v1.json") if capacity is None else capacity,
        active_work_orders=active,
        reserved_effort_units=reserved,
        evaluated_at=EVALUATED_AT,
    )


def test_capacity_unknown_fails_closed():
    profile = load("cfg-diag-exp-v1.production-ready.json")
    unknown_readiness = {**profile, "readiness_state": "UNKNOWN"}
    assert decide(readiness=unknown_readiness)["decision"] == "UNKNOWN"
    assert decide(readiness=unknown_readiness)["reason_codes"] == ["READINESS_UNKNOWN"]

    assert decide(capacity={})["decision"] == "UNKNOWN"
    unknown_staffed = load("capacity-synthetic-one.v1.json")
    unknown_staffed["staffed_capacity_units"] = None
    result = decide(capacity=unknown_staffed)
    assert result["decision"] == "UNKNOWN"
    assert result["reason_codes"] == ["STAFFED_CAPACITY_UNKNOWN"]


def test_zero_one_wip_and_deadline_decisions_are_explicit():
    zero = load("capacity-synthetic-one.v1.json")
    zero["staffed_capacity_units"] = 0
    assert decide(capacity=zero)["decision"] == "CANNOT_ACCEPT"
    one = decide()
    assert one["decision"] == "CAN_ACCEPT"
    assert one["available_effort_units"] == 1

    active = [{"work_order_id": "wo_existing", "current_stage": "IN_PROGRESS", "estimated_capacity_units": 1}]
    exhausted = decide(active=active)
    assert exhausted["decision"] == "CANNOT_ACCEPT"
    closed = [{**active[0], "current_stage": "CLOSED"}]
    assert decide(active=closed)["decision"] == "CAN_ACCEPT"

    impossible = load("canary-capacity-request.v1.json")
    impossible["requested_deadline"] = "2026-08-26"
    result = decide(request=impossible)
    assert result["decision"] == "CANNOT_ACCEPT"
    assert "REQUESTED_DEADLINE_INFEASIBLE" in result["reason_codes"]


def test_hold_replay_and_concurrency_10x_consume_one(tmp_path: Path):
    decision = decide()
    ledger = CapacityLedger(tmp_path / "capacity.sqlite3")

    def hold():
        return ledger.acquire_hold(
            decision=decision,
            idempotency_key="diag-canary-001:hold",
            correlation_id="corr_confenge_diag_canary_001",
            created_at=EVALUATED_AT,
            expires_at="2026-08-28T12:00:00Z",
        )

    with ThreadPoolExecutor(max_workers=10) as pool:
        results = list(pool.map(lambda _: hold(), range(10)))
    assert len({item["hold_id"] for item in results}) == 1
    projection = ledger.projection(
        capacity_snapshot_id=decision["capacity_snapshot_id"],
        staffed_capacity_units=1,
        active_work_orders=[],
    )
    assert projection["held_units"] == 1
    assert projection["available_units"] == 0
    assert ledger.reserved_effort_units(capacity_snapshot_id=decision["capacity_snapshot_id"]) == 1

    with pytest.raises(CapacityError, match="exhausted"):
        ledger.acquire_hold(
            decision=decision,
            idempotency_key="diag-canary-002:hold",
            correlation_id="corr_confenge_diag_canary_001",
            created_at=EVALUATED_AT,
            expires_at="2026-08-28T12:00:00Z",
        )
    ledger.close()


def test_hold_rejects_tampered_capacity_arithmetic(tmp_path: Path):
    decision = decide()
    decision["capacity_limit_after_wip_units"] = 50
    with CapacityLedger(tmp_path / "capacity.sqlite3") as ledger:
        with pytest.raises(CapacityError, match="capacity basis"):
            ledger.acquire_hold(
                decision=decision,
                idempotency_key="tampered-capacity:hold",
                correlation_id="corr_confenge_diag_canary_001",
                created_at=EVALUATED_AT,
                expires_at="2026-08-28T12:00:00Z",
            )


def test_commit_and_close_release_update_projection_without_double_count(tmp_path: Path):
    decision = decide()
    with CapacityLedger(tmp_path / "capacity.sqlite3") as ledger:
        held = ledger.acquire_hold(
            decision=decision,
            idempotency_key="diag-canary-001:hold",
            correlation_id="corr_confenge_diag_canary_001",
            created_at=EVALUATED_AT,
            expires_at="2026-08-28T12:00:00Z",
        )
        committed = ledger.commit(
            hold_id=held["hold_id"],
            work_order_id="wo_confenge_diag_canary_001",
            idempotency_key="diag-canary-001:commit",
            committed_at="2026-08-25T13:00:00Z",
        )
        assert committed["state"] == "COMMITTED"
        assert ledger.commit(
            hold_id=held["hold_id"],
            work_order_id="wo_confenge_diag_canary_001",
            idempotency_key="diag-canary-001:commit",
            committed_at="2026-08-25T13:00:00Z",
        ) == committed
        active = [{"work_order_id": "wo_confenge_diag_canary_001", "current_stage": "IN_PROGRESS", "estimated_capacity_units": 1}]
        projection = ledger.projection(
            capacity_snapshot_id=decision["capacity_snapshot_id"],
            staffed_capacity_units=1,
            active_work_orders=active,
        )
        assert projection == {
            "schema_version": "confenge.capacity_projection.v1",
            "capacity_snapshot_id": decision["capacity_snapshot_id"],
            "staffed_capacity_units": 1,
            "active_wip_units": 1,
            "held_units": 0,
            "committed_units": 1,
            "released_units": 0,
            "available_units": 0,
        }
        assert ledger.reserved_effort_units(
            capacity_snapshot_id=decision["capacity_snapshot_id"],
            active_work_order_ids=["wo_confenge_diag_canary_001"],
        ) == 0

        released = ledger.release(
            hold_id=held["hold_id"],
            reason="WORK_ORDER_CLOSED",
            idempotency_key="diag-canary-001:release",
            released_at="2026-08-25T18:00:00Z",
        )
        assert released["state"] == "RELEASED"
        closed = [{**active[0], "current_stage": "CLOSED"}]
        released_projection = ledger.projection(
            capacity_snapshot_id=decision["capacity_snapshot_id"],
            staffed_capacity_units=1,
            active_work_orders=closed,
        )
        assert released_projection["available_units"] == 1
        assert released_projection["committed_units"] == 0
        assert released_projection["released_units"] == 1


def test_policy_ceiling_50_is_not_a_capacity_input():
    source = (ROOT / "delivery" / "capacity.py").read_text(encoding="utf-8")
    snapshot = load("capacity-synthetic-one.v1.json")
    assert "global_active_slots" not in source
    assert snapshot["staffed_capacity_units"] == 1
    assert snapshot["policy_ceiling_used_as_staffed_capacity"] is False
    assert snapshot["real_checkout_enabled"] is False


def test_read_only_projection_separates_ceiling_from_unknown_staffed_capacity():
    projection = project_capacity_read_only(
        policy_ceiling=50,
        capacity_snapshot=None,
        active_work_orders=None,
        committed_allocations=None,
        projected_at=EVALUATED_AT,
    )
    assert projection["policy_ceiling"] == 50
    assert projection["staffed_capacity"] is None
    assert projection["staffed_capacity_state"] == "UNKNOWN"
    assert projection["committed"] is None
    assert projection["available"] is None
    assert projection["freshness"] == "UNKNOWN"
    assert projection["admission"] == "UNKNOWN"
    assert projection["can_accept"] is False
    assert projection["checkout_enabled"] is False


def test_synthetic_capacity_projection_never_becomes_real_readiness():
    projection = project_capacity_read_only(
        policy_ceiling=50,
        capacity_snapshot=load("capacity-synthetic-one.v1.json"),
        active_work_orders=[],
        committed_allocations=0,
        projected_at=EVALUATED_AT,
        admission_decision="CAN_ACCEPT",
    )
    assert projection["staffed_capacity"] == 1
    assert projection["committed"] == 0
    assert projection["available"] == 1
    assert projection["evidence_class"] == "SYNTHETIC"
    assert projection["admission"] == "UNKNOWN"
    assert projection["can_accept"] is False
    assert projection["checkout_enabled"] is False
    assert projection["reason_codes"] == ["SYNTHETIC_CAPACITY_NOT_REAL_READINESS"]


def test_read_only_capacity_projection_validates_against_versioned_schema():
    schema = json.loads((ROOT / "schemas" / "capacity-projection.v1.schema.json").read_text())
    Draft202012Validator.check_schema(schema)
    projection = project_capacity_read_only(
        policy_ceiling=50,
        capacity_snapshot=None,
        active_work_orders=None,
        committed_allocations=None,
        projected_at=EVALUATED_AT,
    )
    Draft202012Validator(schema).validate(projection)


def test_expiry_reconciliation_and_idempotency_payloads_fail_closed(tmp_path: Path):
    decision = decide()
    with CapacityLedger(tmp_path / "capacity.sqlite3") as ledger:
        held = ledger.acquire_hold(
            decision=decision,
            idempotency_key="diag-expiry:hold",
            correlation_id="corr_confenge_diag_canary_001",
            created_at=EVALUATED_AT,
            expires_at="2026-08-25T13:00:00Z",
        )
        with pytest.raises(CapacityError, match="different command"):
            ledger.acquire_hold(
                decision=decision,
                idempotency_key="diag-expiry:hold",
                correlation_id="corr_confenge_diag_canary_001",
                created_at=EVALUATED_AT,
                expires_at="2026-08-25T14:00:00Z",
            )
        assert ledger.reconcile_expired(as_of="2026-08-25T13:00:00Z") == [held["hold_id"]]
        assert ledger.get(held["hold_id"])["state"] == "EXPIRED"
        assert ledger.get(held["hold_id"])["release_reason"] == "HOLD_EXPIRED"
        assert ledger.reserved_effort_units(
            capacity_snapshot_id=decision["capacity_snapshot_id"]
        ) == 0
        with pytest.raises(CapacityError, match="EXPIRED"):
            ledger.commit(
                hold_id=held["hold_id"],
                work_order_id="cc:work-order:expired",
                idempotency_key="diag-expiry:commit",
                committed_at="2026-08-25T12:30:00Z",
            )


def test_duplicate_or_legacy_wip_shape_is_unknown():
    canonical = {
        "work_order_id": "cc:work-order:active",
        "current_stage": "IN_PROGRESS",
        "estimated_capacity_units": 1,
    }
    assert decide(active=[canonical, canonical])["reason_codes"] == ["ACTIVE_WIP_INVALID"]
    assert decide(
        active=[{"work_order_id": "legacy", "stage": "IN_PROGRESS", "estimated_effort_units": 1}]
    )["reason_codes"] == ["ACTIVE_WIP_INVALID"]


def test_future_capacity_snapshot_and_empty_calendar_fail_closed():
    future = load("capacity-synthetic-one.v1.json")
    future["as_of"] = "2026-08-25T12:00:01Z"
    assert decide(capacity=future)["reason_codes"] == ["CAPACITY_SNAPSHOT_FROM_FUTURE"]

    no_days = load("capacity-synthetic-one.v1.json")
    no_days["working_calendar"]["working_weekdays"] = []
    assert decide(capacity=no_days)["reason_codes"] == ["WORKING_CALENDAR_INVALID"]
