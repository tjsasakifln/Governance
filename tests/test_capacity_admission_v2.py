from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from pathlib import Path

import pytest

from delivery.capacity import (
    CapacityError,
    CapacityLedger,
    evaluate_admission_v2,
    evaluate_catalog_availability,
    project_capacity_read_only_v2,
)
from scripts.validate_commercial_authority import schema_validate


ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "delivery" / "fixtures"
SCHEMAS = ROOT / "schemas"
EVALUATED_AT = "2026-08-26T12:00:00Z"


def load(name: str):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def evaluate_v2(
    *,
    readiness=...,
    capacity=...,
    work_orders=...,
    allocations=...,
    request=...,
    policy=...,
    calendar=...,
):
    return evaluate_admission_v2(
        request=load("canary-capacity-request.v1.json") if request is ... else request,
        readiness=load("cfg-diag-exp-v1.production-ready.json") if readiness is ... else readiness,
        policy_ceiling=load("policy-ceiling-input.v1.json") if policy is ... else policy,
        capacity_snapshot=load("capacity-synthetic-one.v2.json") if capacity is ... else capacity,
        working_calendar=load("working-calendar-synthetic.v1.json") if calendar is ... else calendar,
        work_order_snapshot=load("work-orders-empty.capacity-snapshot.v1.json") if work_orders is ... else work_orders,
        allocation_snapshot=load("allocations-empty.model-only.v1.json") if allocations is ... else allocations,
        evaluated_at=EVALUATED_AT,
    )


def test_representative_fixture_matrix_is_complete_and_fail_closed():
    fixture = load("admission-scenarios.v2.json")
    assert fixture["safety"] == {
        "synthetic_only": True,
        "real_reservation_created": False,
        "checkout_enabled": False,
        "outbound_mutated": False,
    }
    assert {row["name"] for row in fixture["scenarios"]} == {
        "sem_capacity",
        "capacity_zero",
        "uma_vaga",
        "snapshot_stale",
        "readiness_missing",
        "deadline_impossivel",
        "work_order_ativo",
        "concorrencia_replay_10x",
        "cancellation_refund_timeout_ambiguos",
    }

    no_capacity = evaluate_v2(capacity=None)
    assert no_capacity["decision"] == "UNKNOWN"
    assert no_capacity["reason_codes"] == ["STAFFED_CAPACITY_UNKNOWN"]
    assert no_capacity["actionability"]["promise_allowed"] is False
    unknown_projection = project_capacity_read_only_v2(
        no_capacity, projected_at=EVALUATED_AT
    )
    assert unknown_projection["policy_ceiling"] == 50
    assert unknown_projection["staffed_capacity"] is None
    assert unknown_projection["committed"] is None
    assert unknown_projection["available"] is None
    assert unknown_projection["admission"] == "UNKNOWN"

    zero = load("capacity-synthetic-one.v2.json")
    zero["staffed_capacity_units"] = 0
    zero_result = evaluate_v2(capacity=zero)
    assert zero_result["decision"] == "CANNOT_ACCEPT"
    assert "INSUFFICIENT_STAFFED_CAPACITY" in zero_result["reason_codes"]

    one = evaluate_v2()
    assert one["decision"] == "CAN_ACCEPT"
    assert one["policy"]["ceiling_units"] == 50
    assert one["staffed"]["capacity_units"] == 1
    assert one["available_effort_units"] == 1
    assert one["evidence_class"] == "SYNTHETIC"
    assert one["actionability"]["promise_allowed"] is False
    assert one["actionability"]["checkout_enabled"] is False

    stale = load("capacity-synthetic-one.v2.json")
    stale["as_of"] = "2026-08-26T11:00:00Z"
    stale["expires_at"] = EVALUATED_AT
    stale_result = evaluate_v2(capacity=stale)
    assert stale_result["decision"] == "UNKNOWN"
    assert "CAPACITY_SNAPSHOT_STALE" in stale_result["reason_codes"]

    missing_readiness = evaluate_v2(readiness=None)
    assert missing_readiness["decision"] == "UNKNOWN"
    assert "READINESS_UNKNOWN" in missing_readiness["reason_codes"]

    request = load("canary-capacity-request.v1.json")
    request["requested_deadline"] = "2026-08-27"
    impossible = evaluate_v2(request=request)
    assert impossible["decision"] == "CANNOT_ACCEPT"
    assert impossible["deadline"]["risk"] == "INFEASIBLE"
    assert "REQUESTED_DEADLINE_INFEASIBLE" in impossible["reason_codes"]

    active = evaluate_v2(work_orders=load("work-orders-active.capacity-snapshot.v1.json"))
    assert active["decision"] == "CANNOT_ACCEPT"
    assert active["wip"]["non_terminal_work_orders"] == 1
    assert active["wip"]["committed_effort_units"] == 1
    assert active["available_effort_units"] == 0

    ambiguous = evaluate_v2(
        allocations=load("allocations-reconciliation-required.model-only.v1.json")
    )
    assert ambiguous["decision"] == "UNKNOWN"
    assert ambiguous["allocations"]["reconciliation_required_effort_units"] == 3
    assert "RECONCILIATION_REQUIRED" in ambiguous["reason_codes"]


def test_all_non_terminal_work_orders_enter_wip_once_and_terminals_do_not():
    non_terminal = [
        "AWAITING_INPUTS",
        "READY",
        "IN_PROGRESS",
        "BLOCKED",
        "QA",
        "READY_TO_DELIVER",
        "DELIVERED",
        "ACCEPTED",
        "REWORK_REQUIRED",
    ]
    snapshot = load("work-orders-empty.capacity-snapshot.v1.json")
    snapshot["work_orders"] = [
        {
            "work_order_id": f"cc:work-order:wip-{index}",
            "current_stage": stage,
            "deliverable_id": "CFG-DIAG-EXP-v1",
            "deliverable_version": "v1",
            "estimated_capacity_units": index,
            "due_at": None,
            "clock_state": "PAUSED_INTERNAL" if stage == "BLOCKED" else "RUNNING",
            "blockers": ["DEPENDENCY_BLOCKED"] if stage == "BLOCKED" else [],
        }
        for index, stage in enumerate(non_terminal, start=1)
    ] + [
        {
            "work_order_id": f"cc:work-order:terminal-{stage.lower()}",
            "current_stage": stage,
            "deliverable_id": "CFG-DIAG-EXP-v1",
            "deliverable_version": "v1",
            "estimated_capacity_units": 99,
            "due_at": None,
            "clock_state": "STOPPED",
            "blockers": [],
        }
        for stage in ("CLOSED", "CANCELLED")
    ]
    capacity = load("capacity-synthetic-one.v2.json")
    capacity["staffed_capacity_units"] = 50
    result = evaluate_v2(work_orders=snapshot, capacity=capacity)
    assert result["wip"]["non_terminal_work_orders"] == len(non_terminal)
    assert result["wip"]["committed_effort_units"] == sum(range(1, 10))
    assert result["wip"]["blocked_effort_units"] == non_terminal.index("BLOCKED") + 1
    assert len(result["wip"]["work_order_refs"]) == len(non_terminal)

    incomplete = deepcopy(snapshot)
    incomplete["complete"] = False
    assert evaluate_v2(work_orders=incomplete, capacity=capacity)["decision"] == "UNKNOWN"


def test_v2_rejects_missing_correlation_and_tampered_freshness_policy():
    request = load("canary-capacity-request.v1.json")
    request.pop("correlation_id")
    invalid_request = evaluate_v2(request=request)
    assert invalid_request["decision"] == "UNKNOWN"
    assert "CAPACITY_REQUEST_INVALID" in invalid_request["reason_codes"]

    capacity = load("capacity-synthetic-one.v2.json")
    capacity["freshness"]["max_age_seconds"] += 1
    invalid_capacity = evaluate_v2(capacity=capacity)
    assert invalid_capacity["decision"] == "UNKNOWN"
    assert "CAPACITY_SNAPSHOT_INVALID" in invalid_capacity["reason_codes"]


def test_v2_decision_and_read_only_projection_validate_against_schemas():
    decision = evaluate_v2()
    projection = project_capacity_read_only_v2(decision, projected_at=EVALUATED_AT)
    schema_validate(
        decision,
        json.loads((SCHEMAS / "capacity-admission.v2.schema.json").read_text()),
    )
    schema_validate(
        projection,
        json.loads((SCHEMAS / "capacity-projection.v2.schema.json").read_text()),
    )
    assert projection["policy_ceiling"] == 50
    assert projection["staffed_capacity"] == 1
    assert projection["committed"] == 0
    assert projection["available"] == 1
    assert projection["deadline_risk"] == "FEASIBLE"
    assert projection["can_accept"] is False
    assert projection["checkout_enabled"] is False

    unknown = project_capacity_read_only_v2(None, projected_at=EVALUATED_AT)
    schema_validate(
        unknown,
        json.loads((SCHEMAS / "capacity-projection.v2.schema.json").read_text()),
    )
    assert unknown["admission"] == "UNKNOWN"
    assert unknown["available"] is None


@pytest.mark.parametrize(
    ("fixture", "schema"),
    [
        ("working-calendar-synthetic.v1.json", "working-calendar.v1.schema.json"),
        ("capacity-synthetic-one.v2.json", "staffed-capacity-snapshot.v2.schema.json"),
        ("work-orders-empty.capacity-snapshot.v1.json", "work-order-capacity-snapshot.v1.schema.json"),
        ("work-orders-active.capacity-snapshot.v1.json", "work-order-capacity-snapshot.v1.schema.json"),
        ("allocations-empty.model-only.v1.json", "capacity-allocation-snapshot.v1.schema.json"),
        ("allocations-reconciliation-required.model-only.v1.json", "capacity-allocation-snapshot.v1.schema.json"),
        ("readiness-54.fail-closed.v2.json", "delivery-readiness-inventory.v2.schema.json"),
    ],
)
def test_versioned_input_fixtures_validate(fixture: str, schema: str):
    schema_validate(load(fixture), json.loads((SCHEMAS / schema).read_text()))


def test_readiness_matrix_v2_is_exactly_54_and_never_promotes_unknown():
    inventory = load("readiness-54.fail-closed.v2.json")
    assert inventory["record_count"] == len(inventory["records"]) == 54
    assert {
        (row["deliverable_id"], row["deliverable_version"])
        for row in inventory["records"]
    } == {(f"CFG-D{index:02d}", "v1") for index in range(1, 55)}
    assert {row["readiness_state"] for row in inventory["records"]} == {"UNKNOWN"}
    assert all(
        row["owner_ref"]
        and row["blocker_code"]
        and row["evidence_refs"]
        and row["next_action"]
        and row["freshness"]
        and row["expires_at"]
        for row in inventory["records"]
    )


def test_sold_out_false_never_defaults_to_available():
    assert evaluate_catalog_availability(
        catalog_sold_out=False, admission=None
    ) == {"decision": "UNKNOWN", "reason_codes": ["ADMISSION_DECISION_MISSING"]}
    synthetic_can_accept = evaluate_v2()
    assert evaluate_catalog_availability(
        catalog_sold_out=False, admission=synthetic_can_accept
    ) == {"decision": "UNKNOWN", "reason_codes": ["ADMISSION_NOT_ACTIONABLE"]}
    assert evaluate_catalog_availability(
        catalog_sold_out=True, admission=synthetic_can_accept
    ) == {"decision": "CANNOT_ACCEPT", "reason_codes": ["CATALOG_STATIC_BLOCK"]}

    production_gates = json.loads(
        (ROOT / "commercial" / "gates" / "production-gates.v1.json").read_text()
    )
    capacity_gate = next(
        gate for gate in production_gates["gates"] if gate["gate_id"] == "capacity_inventory"
    )
    assert "commercial ceiling of 50 is not staffed inventory" in capacity_gate["required_evidence"]
    contract_text = (ROOT / "commercial" / "CONSUMER-CONTRACT.md").read_text()
    assert "`sold_out=false`" in contract_text
    assert "never yields `CAN_ACCEPT`" in contract_text


def test_cross_repo_consumers_read_decision_and_never_recalculate_wip():
    contract = json.loads(
        (ROOT / "delivery" / "admission-consumer-contract.v2.json").read_text()
    )
    assert contract["schema_version"] == "confenge.capacity_consumer_contract.v2"
    assert "recalculate WIP" in contract["consumer_rules"]["web_cfg"]["must_not"]
    assert "recalculate committed or available" in contract["consumer_rules"]["warmbly"]["must_not"]
    assert contract["consumer_rules"]["control_center"]["must_not"] == [
        "mutate admission inputs",
        "act as ledger",
        "create holds or Work Orders",
    ]
    assert all(rule["checkout_enabled"] is False for rule in contract["decision_rules"])
    assert contract["safety"]["contains_pii"] is False


def test_aggregate_decision_and_projection_do_not_expose_client_pii():
    decision = evaluate_v2(work_orders=load("work-orders-active.capacity-snapshot.v1.json"))
    projection = project_capacity_read_only_v2(decision, projected_at=EVALUATED_AT)
    serialized = json.dumps({"decision": decision, "projection": projection})
    for forbidden in (
        '"client_id"',
        '"account_id"',
        '"client_ref"',
        '"organization_id"',
        '"proposal_id"',
        '"email"',
        '"phone"',
        '"document"',
    ):
        assert forbidden not in serialized


def test_model_only_ledger_replay_10x_and_ambiguities_remain_consumed(tmp_path: Path):
    v2_decision = evaluate_v2()
    correlation_id = v2_decision["request"]["correlation_id"]
    capacity_snapshot_id = v2_decision["staffed"]["snapshot_id"]
    with CapacityLedger(tmp_path / "capacity.sqlite3") as ledger:
        def hold():
            return ledger.acquire_hold(
                decision=v2_decision,
                idempotency_key="same-key-10x",
                correlation_id=correlation_id,
                created_at=EVALUATED_AT,
                expires_at="2026-08-26T13:00:00Z",
            )

        with ThreadPoolExecutor(max_workers=10) as pool:
            results = list(pool.map(lambda _: hold(), range(10)))
        assert len({row["hold_id"] for row in results}) == 1
        hold_id = results[0]["hold_id"]
        ambiguous = ledger.mark_reconciliation_required(
            hold_id=hold_id,
            ambiguity="CHECKOUT_TIMEOUT_AMBIGUOUS",
            idempotency_key="same-key-reconcile",
            observed_at="2026-08-26T12:05:00Z",
        )
        assert ambiguous["state"] == "RECONCILIATION_REQUIRED"
        assert ledger.reserved_effort_units(capacity_snapshot_id=capacity_snapshot_id) == 1
        assert ledger.reconcile_expired(as_of="2026-08-26T14:00:00Z") == []
        assert ledger.projection(
            capacity_snapshot_id=capacity_snapshot_id,
            staffed_capacity_units=1,
            active_work_orders=[],
        )["available_units"] == 0


def test_model_only_ledger_rejects_real_reservation(tmp_path: Path):
    decision = {
        "decision": "CAN_ACCEPT",
        "synthetic": False,
        "correlation_id": "corr-real-forbidden",
        "requested_effort_units": 1,
        "capacity_limit_after_wip_units": 1,
        "staffed_capacity_units": 1,
        "active_wip_units": 0,
        "reserved_effort_units": 0,
        "available_effort_units": 1,
        "capacity_snapshot_id": "cap-real-forbidden",
        "active_work_order_ids": [],
    }
    with CapacityLedger(tmp_path / "capacity.sqlite3") as ledger:
        with pytest.raises(CapacityError, match="MODEL_ONLY"):
            ledger.acquire_hold(
                decision=decision,
                idempotency_key="real-forbidden",
                correlation_id="corr-real-forbidden",
                created_at=EVALUATED_AT,
                expires_at="2026-08-26T13:00:00Z",
            )
