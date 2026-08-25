from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path

import pytest

from delivery.contracts import (
    ContractError,
    validate_delivery_order_requested,
    validate_financial_gate,
)

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "delivery" / "fixtures" / "delivery_order_requested.synthetic.v1.json"


def request() -> dict:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def test_handoff_contract_preserves_cross_repo_identity_for_the_canonical_work_order():
    clean = validate_delivery_order_requested(request())
    assert clean["proposal_id"] == "220f817a-5b2b-5799-b403-2ce8c731e4bf"
    assert clean["qco_id"] == "qco-synthetic-cfg-diag-exp-001"
    assert clean["offer_id"] == "CFG-DIAG-EXP-v1"
    assert clean["deliverable_id"] == "CFG-DIAG-EXP-v1"


def test_financial_gate_absent_or_unknown_fails_contract_or_remains_unknown():
    absent = request()
    del absent["financial_gate"]
    with pytest.raises(ContractError, match="financial_gate"):
        validate_delivery_order_requested(absent)

    unknown = request()
    unknown["financial_gate"] = {
        "schema_version": "confenge.financial_gate.v1",
        "state": "UNKNOWN",
        "synthetic": True,
        "source_event_id": None,
        "received_revenue": False,
        "evidence_refs": [],
    }
    assert validate_delivery_order_requested(unknown)["financial_gate"]["state"] == "UNKNOWN"


def test_synthetic_event_cannot_become_received_revenue():
    gate = deepcopy(request()["financial_gate"])
    gate["received_revenue"] = True
    with pytest.raises(ContractError, match="never become received revenue"):
        validate_financial_gate(gate)

    authorized = deepcopy(request()["financial_gate"])
    authorized.update({"state": "AUTHORIZED", "synthetic": False, "received_revenue": True})
    with pytest.raises(ContractError, match="never become received revenue"):
        validate_financial_gate(authorized)


def test_accepted_hash_and_version_are_not_inferred():
    invalid_hash = request()
    invalid_hash["accepted_snapshot_hash"] = "UNKNOWN"
    with pytest.raises(ContractError, match="sha256"):
        validate_delivery_order_requested(invalid_hash)
    invalid_version = request()
    invalid_version["proposal_version"] = 0
    with pytest.raises(ContractError, match="positive integer"):
        validate_delivery_order_requested(invalid_version)


def test_handoff_normalizes_compatible_hash_and_time_but_rejects_unknown_fields():
    compatible = request()
    compatible["accepted_snapshot_hash"] = compatible["accepted_snapshot_hash"].removeprefix("sha256:")
    compatible["occurred_at"] = "2026-08-25T09:05:00-03:00"
    clean = validate_delivery_order_requested(compatible)
    assert clean["accepted_snapshot_hash"].startswith("sha256:")
    assert clean["occurred_at"] == "2026-08-25T12:05:00.000Z"

    unexpected = request()
    unexpected["customer_email"] = "must-not-enter-delivery"
    with pytest.raises(ContractError, match="unknown fields"):
        validate_delivery_order_requested(unexpected)
