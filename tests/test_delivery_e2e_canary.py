from __future__ import annotations

import json
from pathlib import Path

from delivery.canary import HANDOFF_FIXTURE, run_canary

ROOT = Path(__file__).resolve().parents[1]


def test_single_canary_closes_projects_and_replays_without_duplicates(tmp_path: Path):
    handoff = json.loads(HANDOFF_FIXTURE.read_text(encoding="utf-8"))
    manifest = run_canary(
        handoff=handoff,
        state_dir=tmp_path,
        repo_paths={"warmbly": ROOT, "governance": ROOT, "web_cfg": ROOT},
        projector="python",
        producer_mode="test-golden",
    )
    assert manifest["proposal_state"] == "ACCEPTED"
    assert manifest["financial_gate"] == "SYNTHETIC_VALID"
    assert manifest["readiness"] == "DELIVERY_VALIDATED"
    assert manifest["capacity"] == "COMMITTED"
    assert manifest["capacity_after_close"] == "RELEASED"
    assert manifest["stage"] == "CLOSED"
    assert manifest["qa"] == "PASSED"
    assert manifest["qa_negative_path"] == "FAILED"
    assert manifest["delivery"] == "SANDBOX"
    assert manifest["acceptance"] == "ACCEPTED_SANDBOX"
    assert manifest["outcome"] == "UNKNOWN"
    assert manifest["duplicate_business_mutations"] == 0
    assert manifest["work_order_count"] == 1
    assert manifest["capacity_hold_replays"] == 10
    assert manifest["replay_converged"] is True
    assert manifest["real_money"] is False
    assert manifest["real_email"] is False
    assert manifest["real_customer"] is False
    assert manifest["received_revenue"] is False
    assert manifest["control_center"]["stage"] == manifest["stage"]
    assert manifest["control_center"]["source"]["last_event_id"] in manifest["evidence_refs"]
    assert manifest["schema_fingerprints"] == {
        "confenge.delivery_order_requested.v1": "6464c124040bbadea9f719dcecacdcd3faa85febfa4610950f3791bb224fb0ba",
        "confenge.financial_gate.v1": "5c0bdecf80fdfe1101ba1606f8a5462f035aae7c2a2b0d262af86de7b6d4a903",
    }


def test_repeated_canary_command_converges_on_the_same_ids_and_state(tmp_path: Path):
    handoff = json.loads(HANDOFF_FIXTURE.read_text(encoding="utf-8"))
    kwargs = {
        "handoff": handoff,
        "state_dir": tmp_path,
        "repo_paths": {"warmbly": ROOT, "governance": ROOT, "web_cfg": ROOT},
        "projector": "python",
        "producer_mode": "test-golden",
    }
    first = run_canary(**kwargs)
    second = run_canary(**kwargs)
    for field in (
        "proposal_id",
        "accepted_snapshot_hash",
        "work_order_id",
        "stage",
        "qa",
        "delivery",
        "acceptance",
        "outcome",
        "control_center",
    ):
        assert first[field] == second[field]
    assert second["duplicate_business_mutations"] == 0
    assert second["work_order_count"] == 1
    assert second["replay_converged"] is True
