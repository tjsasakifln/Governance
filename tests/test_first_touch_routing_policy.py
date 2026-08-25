from __future__ import annotations

import importlib.util
from copy import deepcopy
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
VALIDATOR_PATH = ROOT / "scripts" / "validate_commercial_authority.py"
POLICY_PATH = ROOT / "commercial" / "outbound" / "cfg-first-touch-routing.v1.json"
SCHEMA_PATH = ROOT / "schemas" / "cfg-first-touch-routing.v1.schema.json"


def load_validator():
    spec = importlib.util.spec_from_file_location("validate_commercial_authority", VALIDATOR_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


v = load_validator()


def policy():
    return v.load_json(POLICY_PATH)


def validate(value):
    schema = v.load_json(SCHEMA_PATH)
    v.schema_validate(value, schema)


def test_policy_is_closed_versioned_and_machine_readable():
    value = policy()
    validate(value)
    assert value["canonical_name"] == "CFG-FIRST-TOUCH-ROUTING-v1"
    assert value["authority"]["decision_source"] == "DELEGATED_POLICY_APPROVE"
    assert value["authority"]["eligible_first_touch_requires_human_review"] is False
    assert value["authority"]["human_actor_impersonation_allowed"] is False

    unknown = deepcopy(value)
    unknown["silent_auto_send"] = True
    with pytest.raises(v.ValidationError, match="unknown critical field"):
        validate(unknown)


def test_scope_queues_but_never_authorizes_provider_dispatch_or_followups():
    scope = policy()["scope"]
    assert scope == {
        "channel": "EMAIL",
        "message_kind": "FIRST_TOUCH",
        "followups_authorized": False,
        "approval_authorized": True,
        "scheduling_authorized": True,
        "provider_dispatch_authorized": False,
    }

    for field in ("followups_authorized", "provider_dispatch_authorized"):
        bad = policy()
        bad["scope"][field] = True
        with pytest.raises(v.ValidationError):
            validate(bad)


def test_supplier_is_required_and_buyer_unknown_conflict_fail_closed():
    gate = policy()["hard_gates"]["identity_and_party_role"]
    assert gate["target_state"] == "TARGET_CONFIRMED"
    assert set(gate["allowed_target_party_roles"]) == {
        "SUPPLIER",
        "CONTRACTOR",
        "CONTRATADA",
        "FORNECEDORA",
    }
    assert {"BUYER", "CONTRACTING_AUTHORITY", "CONTRATANTE", "ORGAO"}.issubset(
        gate["forbidden_target_party_roles"]
    )
    assert gate["required_typed_status"] == "CONTRACTOR_ROLE_CONFIRMED"
    assert gate["supplier_exact_cnpj_or_typed_branch_binding_required"] is True
    assert gate["cnpj_root_only_match_disposition"] == "HOLD_NEEDS_REVIEW"
    assert gate["conflict_disposition"] == "PARTY_ROLE_CONFLICT"
    assert gate["unknown_disposition"] == "HOLD_NEEDS_REVIEW"
    assert gate["warmbly_may_reinterpret_raw_pncp"] is False

    weakened = policy()
    weakened["hard_gates"]["identity_and_party_role"]["required_typed_status"] = "PRESENT_IN_PNCP"
    with pytest.raises(v.ValidationError, match="expected const"):
        validate(weakened)


def test_all_recipient_classes_are_allowed_but_guesses_are_not_proof():
    gate = policy()["hard_gates"]["recipient"]
    assert set(gate["allowed_route_classes"]) == {
        "DIRECT_PERSON",
        "ROLE_OR_DEPARTMENT",
        "GENERIC_COMPANY",
        "PUBLIC_COMPANY_FREEMAIL",
    }
    assert gate["exact_recipient_required"] is True
    assert gate["company_association_evidence_required"] is True
    assert {"GUESSED_PATTERN", "MX_ONLY", "SYNTAX_ONLY", "UNATTRIBUTED_FREEMAIL"}.issubset(
        gate["forbidden_proof_only"]
    )

    weakened = policy()
    weakened["hard_gates"]["recipient"]["company_association_evidence_required"] = False
    with pytest.raises(v.ValidationError, match="expected const"):
        validate(weakened)


def test_policy_invalidates_every_material_binding_and_compliance_change():
    required = {
        "recipient",
        "route_class",
        "content_hash",
        "evidence_hash",
        "evidence_version",
        "source_run_id",
        "target_fit",
        "target_party_role",
        "template_version",
        "composer_version",
        "prompt_version",
        "policy_version",
        "suppression",
        "opt_out",
        "dnc",
        "hard_bounce",
        "organization_risk",
        "mailbox_eligibility",
    }
    assert required == set(policy()["drift_invalidation"]["material_fields"])


def test_audit_contract_has_no_fake_human_and_covers_decision_schedule_runtime():
    audit = policy()["audit"]
    assert audit["approved_by_type"] == "delegated_agent_or_system"
    assert audit["human_approved_by_must_be_empty"] is True
    required = set(audit["required_fields"])
    assert {
        "policy_id",
        "policy_version",
        "authority_reference",
        "executor",
        "source_run_id",
        "source_run_hash",
        "recipient",
        "route_class",
        "target_party_role",
        "supplier_identity_ref",
        "buyer_identity_ref",
        "evidence_hash",
        "content_hash",
        "approval_timestamp",
        "scheduling_result",
        "due_at",
        "reason_codes",
        "idempotency_key",
        "runtime_release_sha",
    }.issubset(required)


def test_reuses_existing_runtime_and_canary_stays_zero_smtp():
    reuse = policy()["runtime_reuse"]
    assert reuse["parallel_architecture_allowed"] is False
    assert all(value is True for key, value in reuse.items() if key != "parallel_architecture_allowed")

    canary = policy()["canary"]
    assert canary["dispatch_global_paused_required"] is True
    assert canary["kill_switch_preserved_required"] is True
    assert canary["queued_readback_required"] is True
    assert canary["smtp_send_allowed"] is False
    assert canary["sent_count_required"] == 0
    assert canary["provider_send_mutation_allowed"] is False


def test_failure_and_replay_are_fail_closed_per_item():
    value = policy()
    assert value["evaluation"]["mode"] == "ALL_HARD_GATES_MUST_PASS"
    assert value["evaluation"]["individual_failure_stops_batch"] is False
    assert value["evaluation"]["replay_semantics"] == "IDEMPOTENT_NO_DUPLICATE_APPROVAL_OR_SCHEDULING"
    assert value["failure"] == {
        "decision": "DO_NOT_APPROVE",
        "disposition": "HOLD_NEEDS_REVIEW_EXCEPTION",
        "concrete_reason_codes_required": True,
        "fail_closed": True,
    }
