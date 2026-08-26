from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path

import pytest

from commercial.e2e import (
    E2EContractError,
    acceptance_binding_hash,
    proposal_snapshot_hash,
    validate_acceptance_binding,
    validate_checkout_fixture,
    validate_provider_event,
)
from commercial.e2e_canary import ACCEPTANCE, CHECKOUT, PROPOSAL, PROVIDER_EVENTS, run_e2e_canary
from scripts.validate_commercial_authority import schema_validate


ROOT = Path(__file__).resolve().parents[1]


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def schema(name: str):
    return load(ROOT / "schemas" / name)


def test_adapter_fixtures_bind_one_immutable_identity_and_validate_schemas():
    proposal = load(PROPOSAL)
    acceptance = load(ACCEPTANCE)
    checkout = load(CHECKOUT)
    events = load(PROVIDER_EVENTS)["events"]

    assert proposal_snapshot_hash(proposal) == proposal["accepted_snapshot_hash"]
    assert acceptance_binding_hash(acceptance) == acceptance["record_hash"]
    validate_acceptance_binding(acceptance, proposal)
    validate_checkout_fixture(checkout, acceptance=acceptance)
    schema_validate(acceptance, schema("acceptance-binding.v1.schema.json"))
    schema_validate(checkout, schema("checkout-fixture.v1.schema.json"))
    for event in events:
        validate_provider_event(event, correlation_id=proposal["correlation_id"])
        schema_validate(event, schema("provider-event-fixture.v1.schema.json"))
        assert event["provider_object_id"] is None
        assert event["real_money"] is False
        assert event["correlation_id"] == proposal["correlation_id"]


def test_v3_authority_pin_is_current_additive_and_keeps_every_live_gate_closed():
    overlay = load(ROOT / "commercial" / "authority" / "authority-overlay.v3.json")
    schema_validate(overlay, schema("commercial-authority-overlay.v3.schema.json"))
    assert overlay["supersedes"]["preserved"] is True
    assert overlay["catalog_boundary"]["no_parallel_catalog"] is True
    assert overlay["catalog_boundary"]["deliverables_registry"]["blob_sha"] == "32576ad2e704881368699ceacdefc6c783dcfa00"
    assert overlay["catalog_boundary"]["naming_authority"]["blob_sha"] == "ee97d54155536378041693153d0c9316baa6596b"
    assert overlay["boundaries"]["production_checkout_enabled"] is False
    assert overlay["boundaries"]["real_money_mutation_approved"] is False
    assert overlay["boundaries"]["provider_object_id"] is None


def test_proposal_acceptance_and_checkout_tampering_fail_closed():
    proposal = load(PROPOSAL)
    acceptance = load(ACCEPTANCE)
    bad_acceptance = deepcopy(acceptance)
    bad_acceptance["proposal_version"] += 1
    with pytest.raises(E2EContractError, match="diverges"):
        validate_acceptance_binding(bad_acceptance, proposal)

    bad_hash = deepcopy(acceptance)
    bad_hash["record_hash"] = "sha256:" + "0" * 64
    with pytest.raises(E2EContractError, match="hash mismatch"):
        validate_acceptance_binding(bad_hash, proposal)

    bad_checkout = load(CHECKOUT)
    bad_checkout["production_checkout_enabled"] = True
    with pytest.raises(E2EContractError, match="disabled"):
        validate_checkout_fixture(bad_checkout, acceptance=acceptance)


def test_single_reproducible_chain_covers_finance_onboarding_work_order_and_closeout(tmp_path: Path):
    first = run_e2e_canary(state_dir=tmp_path)
    second = run_e2e_canary(state_dir=tmp_path)
    assert first["chain_hops"] == second["chain_hops"]
    assert first["commercial_reconciliation"] == second["commercial_reconciliation"]
    assert first["delivery_manifest"]["work_order_id"] == second["delivery_manifest"]["work_order_id"]
    assert second["delivery_manifest"]["replay_converged"] is True
    assert second["delivery_manifest"]["capacity_after_close"] == "RELEASED"
    assert first["correlation_id"] == first["delivery_manifest"]["correlation_id"] == "corr_fixture"
    assert first["financial_semantics"]["branches"] == {
        "PAYMENT_CREATED": "PAYMENT_CREATED",
        "PAYMENT_CONFIRMED": "PAYMENT_CONFIRMED",
        "PAYMENT_RECEIVED": "PAYMENT_RECEIVED",
        "OVERDUE": "OVERDUE",
        "REFUNDED": "REFUNDED",
        "CANCELED": "CANCELED",
        "UNKNOWN": "UNKNOWN",
    }
    assert first["financial_semantics"]["positive_path_terminal_state"] == "PAYMENT_CONFIRMED"
    assert first["financial_semantics"]["received_revenue_cents"] == 0
    assert first["financial_semantics"]["synthetic_received_branch_revenue_cents"] == 0
    assert first["reliability"] == {
        "confirmed_before_created": "HELD",
        "confirmed_replayed_after_created": "APPLIED",
        "duplicate": "DUPLICATE",
        "late_created_retry": "RETAINED",
        "rollback_replay_converged": True,
        "event_deduplication_id": "evt_sbx_payment_confirmed_001",
        "chain_identity_is_deduplication_id": False,
    }
    assert first["gates"]["onboarding_before_financial"]["state"] == "BLOCKED"
    assert first["gates"]["onboarding_without_capacity"]["state"] == "BLOCKED"
    assert first["gates"]["onboarding_eligible"]["starts_automatically"] is False
    assert first["delivery_manifest"]["work_order_count"] == 1
    assert first["delivery_manifest"]["qa_negative_path"] == "FAILED"
    assert first["delivery_manifest"]["stage"] == "CLOSED"
    assert first["delivery_manifest"]["outcome"] == "UNKNOWN"
    for key, value in first["invariants"].items():
        if key in {"second_catalog_created", "second_ledger_created"}:
            assert value is False
        else:
            assert value is True


def test_receipts_reconciliation_control_center_and_pack_validate(tmp_path: Path):
    evidence = run_e2e_canary(state_dir=tmp_path)
    receipt_schema = schema("semantic-receipt.v1.schema.json")
    for receipt in evidence["commercial_reconciliation"]["receipts"]:
        schema_validate(receipt, receipt_schema)

    reconciliation_schema = schema("financial-reconciliation.v1.schema.json")
    reconciliation_schema["$defs"] = {"receipt": receipt_schema}
    reconciliation_schema["properties"]["receipts"]["items"] = {"$ref": "#/$defs/receipt"}
    schema_validate(evidence["commercial_reconciliation"], reconciliation_schema)
    schema_validate(evidence["control_center"], schema("commercial-chain-projection.v2.schema.json"))
    schema_validate(evidence, schema("commercial-e2e-evidence.v1.schema.json"))
    expected_keys = {"source", "freshness", "state", "receipt", "exception"}
    assert all(set(hop) == expected_keys for hop in evidence["control_center"]["hops"].values())
    assert evidence["control_center"]["mutations_performed"] == 0
