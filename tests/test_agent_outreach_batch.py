"""Adversarial tests for synchronous agent-batch proof manifests."""

from __future__ import annotations

import ast
import importlib.util
import json
import subprocess
import sys
from copy import deepcopy
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
VALIDATOR_PATH = ROOT / "scripts" / "validate_agent_outreach_batch.py"
FIXTURE_PATH = ROOT / "commercial" / "fixtures" / "agent-outreach-batch-proof.example.v1.json"
SCHEMA_PATH = ROOT / "schemas" / "agent-outreach-batch-proof.v1.schema.json"
CNPJ_FIXTURE = ".".join(("12", "345", "678")) + "/" + "0001" + "-" + "90"


def load_validator():
    spec = importlib.util.spec_from_file_location("validate_agent_outreach_batch", VALIDATOR_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


v = load_validator()


def proof():
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def test_sanitized_example_is_a_complete_reconciled_proof():
    result = v.validate_document(proof())
    assert result["agent_batch_id"] == "agent-batch-fixture-001"
    assert result["manifest_hash"].startswith("sha256:")
    assert len(result["member_outcomes"]) == 2


def test_schema_fail_closes_and_only_allows_needs_review_drafts():
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    assert schema["additionalProperties"] is False
    assert schema["$defs"]["member"]["additionalProperties"] is False
    assert schema["$defs"]["draft"]["properties"]["state"] == {"const": "NEEDS_REVIEW"}
    safety = schema["properties"]["safety"]["properties"]
    assert safety["llm_api_calls"] == {"const": 0}
    assert safety["approvals"] == {"const": 0}
    assert safety["scheduled"] == {"const": 0}
    assert safety["sent"] == {"const": 0}


def test_idempotency_is_stable_for_the_same_public_safe_tuple_and_changes_with_versions():
    doc = proof()
    member = doc["members"][0]
    expected = v.expected_idempotency_key(
        doc["source_run_id"], member["lead_ref"], doc["evidence_version"], doc["template_version"]
    )
    assert expected == member["idempotency_key"]
    assert expected == v.expected_idempotency_key(
        doc["source_run_id"], member["lead_ref"], doc["evidence_version"], doc["template_version"]
    )
    assert expected != v.expected_idempotency_key(
        doc["source_run_id"], member["lead_ref"], "web-datalake-bundle.v2", doc["template_version"]
    )


def test_omitting_either_required_lane_fails_closed():
    doc = proof()
    del doc["members"][0]["lanes"]["web"]
    with pytest.raises(v.ValidationError, match="lanes.*keys diverge"):
        v.validate_document(doc)


def test_lane_failure_cannot_import_a_draft():
    doc = proof()
    doc["members"][0]["lanes"]["web"]["status"] = "ERROR"
    doc["members"][0]["lanes"]["web"]["evidence_count"] = 0
    with pytest.raises(v.ValidationError, match="evidence lane failed"):
        v.validate_document(doc)


@pytest.mark.parametrize("reconciliation,critical", [("CONFLICT", False), ("UNKNOWN", False), ("DATALAKE_ONLY", True)])
def test_conflict_unknown_or_critical_flag_cannot_import(reconciliation, critical):
    doc = proof()
    doc["members"][0]["reconciliation_status"] = reconciliation
    doc["members"][0]["critical_conflict"] = critical
    with pytest.raises(v.ValidationError, match="without safe reconciliation"):
        v.validate_document(doc)


@pytest.mark.parametrize("state", ["APPROVED", "QUEUED", "SENT", "DRAFTED"])
def test_generation_proof_can_only_end_in_needs_review(state):
    doc = proof()
    doc["members"][0]["draft"]["state"] = state
    with pytest.raises(v.ValidationError, match="must be NEEDS_REVIEW"):
        v.validate_document(doc)


@pytest.mark.parametrize(
    "key,value,match",
    [
        ("email", "fixture@example.invalid", "operational/contact data"),
        ("company_name", "Empresa Fixture", "operational/contact data"),
        ("note", "fixture@example.invalid", "email address"),
        ("note", "https://example.invalid/contact", "source URL"),
        ("note", CNPJ_FIXTURE, "CNPJ"),
    ],
)
def test_public_proof_rejects_contacts_identity_and_source_urls(key, value, match):
    doc = proof()
    doc["members"][0][key] = value
    with pytest.raises(v.ValidationError, match=match):
        v.validate_document(doc)


def test_summary_and_denominator_cannot_drift_from_members():
    doc = proof()
    doc["summary"]["imported_needs_review"] = 2
    with pytest.raises(v.ValidationError, match="summary does not reconcile"):
        v.validate_document(doc)

    doc = proof()
    doc["universe"]["remaining_after_batch"] = 0
    with pytest.raises(v.ValidationError, match="does not reconcile processed and remaining"):
        v.validate_document(doc)

    doc = proof()
    doc["universe"]["target_confirmed_total"] = 1
    with pytest.raises(v.ValidationError, match="exceeds the TARGET_CONFIRMED denominator"):
        v.validate_document(doc)


def test_one_synchronous_batch_is_bounded_to_500_members():
    doc = proof()
    doc["members"] = doc["members"] * 251
    doc["universe"]["batch_reserved"] = len(doc["members"])
    with pytest.raises(v.ValidationError, match="at most 500"):
        v.validate_document(doc)


@pytest.mark.parametrize(
    "field,value",
    [
        ("llm_api_calls", 1),
        ("provider_mutations", 1),
        ("approvals", 1),
        ("scheduled", 1),
        ("sent", 1),
        ("runtime_generation", True),
        ("auto_send_changed", True),
        ("kill_switch_changed", True),
        ("operational_data_included", True),
    ],
)
def test_every_forbidden_side_effect_is_fail_closed(field, value):
    doc = proof()
    doc["safety"][field] = value
    with pytest.raises(v.ValidationError, match=field):
        v.validate_document(doc)


def test_same_lead_cannot_be_reserved_twice_in_one_batch():
    doc = proof()
    doc["members"][1]["lead_ref"] = doc["members"][0]["lead_ref"]
    with pytest.raises(v.ValidationError, match="reserved twice"):
        v.validate_document(doc)


def test_two_agent_batches_cannot_overlap_on_the_same_lead():
    first = proof()
    second = deepcopy(first)
    second["agent_batch_id"] = "agent-batch-fixture-002"
    second["started_at"] = "2026-08-25T10:10:00Z"
    second["completed_at"] = "2026-08-25T10:25:00Z"
    second["reservation_expires_at"] = "2026-08-25T11:10:00Z"
    for member in second["members"]:
        for lane in member["lanes"].values():
            lane["observed_at"] = "2026-08-25T10:12:00Z"
    with pytest.raises(v.ValidationError, match="overlapping reservations"):
        v.validate_documents([first, second])


def test_two_batches_cannot_claim_the_same_import_receipt_tuple_twice():
    first = proof()
    second = deepcopy(first)
    second["agent_batch_id"] = "agent-batch-fixture-003"
    second["started_at"] = "2026-08-25T10:16:00Z"
    second["completed_at"] = "2026-08-25T10:31:00Z"
    second["reservation_expires_at"] = "2026-08-25T11:16:00Z"
    for member in second["members"]:
        for lane in member["lanes"].values():
            lane["observed_at"] = "2026-08-25T10:20:00Z"
    with pytest.raises(v.ValidationError, match="idempotency key was imported"):
        v.validate_documents([first, second])


def test_cli_validates_the_shipped_fixture_and_fails_on_a_leak(tmp_path):
    valid = subprocess.run(
        [sys.executable, str(VALIDATOR_PATH), str(FIXTURE_PATH)],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    assert valid.returncode == 0, valid.stderr
    assert json.loads(valid.stdout)["ok"] is True

    leaked = proof()
    leaked["members"][0]["note"] = "fixture@example.invalid"
    leaked_path = tmp_path / "leaked.json"
    leaked_path.write_text(json.dumps(leaked), encoding="utf-8")
    invalid = subprocess.run(
        [sys.executable, str(VALIDATOR_PATH), str(leaked_path)],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    assert invalid.returncode == 1
    assert json.loads(invalid.stderr)["ok"] is False


def test_validator_has_no_network_database_or_model_client_imports():
    source = VALIDATOR_PATH.read_text(encoding="utf-8")
    tree = ast.parse(source)
    imported = {
        alias.name.split(".")[0]
        for node in ast.walk(tree)
        if isinstance(node, ast.Import)
        for alias in node.names
    }
    imported.update(
        node.module.split(".")[0]
        for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom) and node.module
    )
    assert imported.isdisjoint({"requests", "httpx", "urllib", "socket", "psycopg", "openai", "anthropic"})
    assert "subprocess" not in imported
