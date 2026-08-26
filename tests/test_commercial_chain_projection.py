from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path

from commercial.projection import WEB_CFG_DELIVERABLES_BLOB, project_commercial_chain
from scripts.validate_commercial_authority import schema_validate


NOW = "2026-08-26T03:00:00Z"
ROOT = Path(__file__).resolve().parents[1]


def base_facts():
    return {
        "correlation_id": "corr-commercial-001",
        "offer": {
            "deliverable_id": "CFG-D02",
            "registry_blob": WEB_CFG_DELIVERABLES_BLOB,
            "evidence_refs": ["web-cfg:blob:99e77f"],
        },
        "proposal": {
            "proposal_id": "proposal-001",
            "version": 1,
            "correlation_id": "corr-commercial-001",
            "evidence_refs": ["warmbly:proposal:001:v1"],
        },
        "acceptance": {
            "acceptance_id": "acceptance-001",
            "state": "ACCEPTED",
            "correlation_id": "corr-commercial-001",
            "accepted_at": "2026-08-26T02:00:00Z",
            "evidence_refs": ["web-cfg:acceptance:001"],
        },
        "capacity": {"staffed_capacity_state": "UNKNOWN", "evidence_refs": []},
    }


def test_proposal_acceptance_does_not_become_payment_or_revenue():
    result = project_commercial_chain(base_facts(), projected_at=NOW)
    assert result["hops"]["acceptance"]["state"] == "PROVEN"
    assert result["payment"] == {
        "state": "UNKNOWN",
        "provider_proven": False,
        "paid": False,
        "received_revenue": False,
    }
    assert result["mutations_performed"] == 0
    assert {item["bucket"] for item in result["exceptions"]} == {
        "payment_provider_ambiguity",
        "capacity_unknown",
    }


def test_created_confirmed_and_received_are_distinct():
    expected = {
        "PAYMENT_CREATED": (False, False),
        "PAYMENT_CONFIRMED": (True, False),
        "PAYMENT_RECEIVED": (True, True),
    }
    for state, (paid, received) in expected.items():
        facts = base_facts()
        facts["capacity"] = {"staffed_capacity_state": "KNOWN", "evidence_refs": ["capacity:real"]}
        facts["financial_gate"] = {
            "state": "AUTHORIZED",
            "synthetic": False,
            "evidence_refs": ["warmbly:financial-gate:001"],
        }
        facts["provider"] = {
            "payment_id": "pay_opaque001",
            "provider_event_id": f"evt-{state.lower()}",
            "event_type": state,
            "correlation_id": "corr-commercial-001",
            "occurred_at": "2026-08-26T02:30:00Z",
            "evidence_refs": [f"asaas:event:{state.lower()}"],
        }
        result = project_commercial_chain(facts, projected_at=NOW)
        assert result["payment"]["state"] == state
        assert result["payment"]["paid"] is paid
        assert result["payment"]["received_revenue"] is received


def test_missing_provider_stays_unknown_and_synthetic_received_is_not_revenue():
    missing = project_commercial_chain(base_facts(), projected_at=NOW)
    assert missing["hops"]["provider"]["state"] == "UNKNOWN"
    assert missing["payment"]["state"] == "UNKNOWN"

    synthetic = base_facts()
    synthetic["synthetic"] = True
    synthetic["financial_gate"] = {
        "state": "SYNTHETIC_VALID",
        "synthetic": True,
        "evidence_refs": ["fixture:financial-gate"],
    }
    synthetic["provider"] = {
        "payment_id": "pay_synthetic",
        "provider_event_id": "evt-synthetic",
        "event_type": "PAYMENT_RECEIVED",
        "synthetic": True,
        "evidence_refs": ["fixture:payment-received"],
    }
    result = project_commercial_chain(synthetic, projected_at=NOW)
    assert result["hops"]["financial_gate"]["state"] == "SYNTHETIC"
    assert result["hops"]["provider"]["state"] == "UNKNOWN"
    assert result["payment"]["received_revenue"] is False
    assert result["readiness"] == "BLOCKED"


def test_runtime_correlation_mismatch_becomes_exception():
    facts = base_facts()
    facts["proposal"]["correlation_id"] = "corr-other"
    result = project_commercial_chain(facts, projected_at=NOW)
    mismatch = next(item for item in result["exceptions"] if item["bucket"] == "runtime_mismatch")
    assert mismatch["owner"] == "commercial_ops"
    assert mismatch["freshness"] == "ERROR"
    assert mismatch["evidence"] == ["correlation:corr-commercial-001", "correlation:corr-other"]


def test_projection_and_every_exception_validate_against_versioned_schemas():
    result = project_commercial_chain(base_facts(), projected_at=NOW)
    chain_schema = json.loads((ROOT / "schemas" / "commercial-chain-projection.v1.schema.json").read_text())
    exception_schema = json.loads((ROOT / "schemas" / "operational-exception.v1.schema.json").read_text())
    for exception in result["exceptions"]:
        schema_validate(exception, exception_schema)
    locally_resolved = deepcopy(chain_schema)
    locally_resolved["properties"]["exceptions"]["items"] = exception_schema
    schema_validate(result, locally_resolved)
