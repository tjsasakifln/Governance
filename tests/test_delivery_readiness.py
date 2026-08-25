from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path

import pytest

from delivery.production.cfg_diag_exp import ProductionError, produce_sandbox_artifact, run_qa
from delivery.readiness import (
    ReadinessError,
    generate_fail_closed_snapshot,
    promote_to_delivery_validated,
    validate_operational_profile,
)


ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "delivery" / "fixtures"
AUTHORITY_REF = "github://tjsasakifln/web-cfg@fixture/data/commercial/deliverables-registry.v1.json"


def load(name: str):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def test_checked_inventory_has_exactly_54_unique_unknown_identity_only_rows():
    inventory = load("readiness-54.fail-closed.v1.json")
    assert inventory["record_count"] == len(inventory["records"]) == 54
    identities = {(row["deliverable_id"], row["deliverable_version"]) for row in inventory["records"]}
    assert identities == {(f"CFG-D{index:02d}", "v1") for index in range(1, 55)}
    assert {row["readiness_state"] for row in inventory["records"]} == {"UNKNOWN"}
    assert inventory["registry_authority"]["content_hash"] == "sha256:b4d85f4d32244e2d27c8a68b68e02041c7621bc23060ad4046217a35f86606cc"
    forbidden_catalog_copies = {"public_name", "price", "scope", "required_inputs", "exclusions", "route"}
    assert all(forbidden_catalog_copies.isdisjoint(row) for row in inventory["records"])
    assert all(row["blockers"] and row["evidence_refs"] for row in inventory["records"])


def test_generator_reads_supplied_registry_and_is_deterministic(tmp_path: Path):
    registry = {
        "schema": "confenge.deliverables-registry/1.0",
        "registry_version": "fixture-v1",
        "catalog_count": 54,
        "deliverables": [
            {
                "deliverable_id": f"CFG-D{index:02d}",
                "version": "v1",
                "public_name": f"must-not-copy-{index}",
                "price": {"amount_cents": index},
                "source_issue": "#331",
                "blocking_issue": "#156" if index in {11, 43} else None,
            }
            for index in range(1, 55)
        ],
    }
    registry_path = tmp_path / "registry.json"
    registry_path.write_text(json.dumps(registry), encoding="utf-8")
    kwargs = {
        "authority_ref": AUTHORITY_REF,
        "source_revision": "fixture",
        "generated_at": "2026-08-25T12:00:00Z",
    }
    first = generate_fail_closed_snapshot(registry_path, **kwargs)
    second = generate_fail_closed_snapshot(registry_path, **kwargs)
    assert first == second
    assert all("public_name" not in row and "price" not in row for row in first["records"])
    assert first["records"][10]["blockers"][0]["code"] == "REGISTRY_BLOCKER_REQUIRES_EVALUATION"
    assert first["records"][10]["evidence_refs"][-1] == "tjsasakifln/web-cfg#156"


def test_generator_rejects_missing_or_duplicate_registry_rows(tmp_path: Path):
    base = {
        "schema": "confenge.deliverables-registry/1.0",
        "registry_version": "fixture-v1",
        "catalog_count": 54,
        "deliverables": [{"deliverable_id": "CFG-D01", "version": "v1"}] * 54,
    }
    registry_path = tmp_path / "registry.json"
    registry_path.write_text(json.dumps(base), encoding="utf-8")
    with pytest.raises(ReadinessError, match="duplicate"):
        generate_fail_closed_snapshot(
            registry_path,
            authority_ref=AUTHORITY_REF,
            source_revision="fixture",
            generated_at="2026-08-25T12:00:00Z",
        )
    base["deliverables"] = base["deliverables"][:-1]
    registry_path.write_text(json.dumps(base), encoding="utf-8")
    with pytest.raises(ReadinessError, match="exactly 54"):
        generate_fail_closed_snapshot(
            registry_path,
            authority_ref=AUTHORITY_REF,
            source_revision="fixture",
            generated_at="2026-08-25T12:00:00Z",
        )


def test_diag_profile_is_the_only_materialized_production_ready_path():
    profile = load("cfg-diag-exp-v1.production-ready.json")
    validate_operational_profile(profile)
    assert profile["deliverable_id"] == "CFG-DIAG-EXP-v1"
    assert profile["scope"]["component_refs"] == [f"CFG-D{index:02d}/v1" for index in range(2, 9)]
    assert profile["readiness_state"] == "PRODUCTION_READY"
    assert profile["responsible_owner"]["synthetic"] is True
    assert profile["blockers"] == []
    assert profile["constraints"] == {
        "synthetic_only": True,
        "real_customer": False,
        "real_email": False,
        "real_money": False,
    }


def test_producer_and_qa_are_deterministic_and_fail_closed():
    inputs = {
        "organization_identity_ref": "fixture://redacted/org-001",
        "expansion_scope_ref": "fixture://redacted/scope-001",
        "public_portfolio_ref": "fixture://redacted/portfolio-001",
        "data_use_authorization_ref": "fixture://redacted/authorization-001",
        "operational_channel_ref": "fixture://redacted/channel-001",
    }
    kwargs = {
        "input_refs": inputs,
        "source_artifact_refs": ["fixture://extra-cli/public-sources-001"],
        "produced_at": "2026-08-25T15:00:00Z",
        "correlation_id": "corr_confenge_diag_canary_001",
    }
    first = produce_sandbox_artifact(**kwargs)
    second = produce_sandbox_artifact(**kwargs)
    assert first == second
    assert first["artifact_ref"].startswith("sha256:")
    qa = run_qa(first, checked_at="2026-08-25T16:00:00Z", actor_ref="fixture://actor/qa-001")
    assert qa["qa_state"] == "PASSED"
    assert qa["failed_checks"] == []

    with pytest.raises(ProductionError, match="organization_identity_ref"):
        produce_sandbox_artifact(**{**kwargs, "input_refs": {}})
    tampered = deepcopy(first)
    tampered["sections"].pop()
    failed = run_qa(tampered, checked_at="2026-08-25T16:00:00Z", actor_ref="fixture://actor/qa-001")
    assert failed["qa_state"] == "FAILED"
    assert set(failed["failed_checks"]) == {"SECTION_COMPLETENESS", "ARTIFACT_INTEGRITY"}


def test_delivery_validation_requires_closed_accepted_sandbox_canary_and_is_immutable():
    profile = load("cfg-diag-exp-v1.production-ready.json")
    evidence = {
        "synthetic": True,
        "work_order_id": "wo_confenge_diag_canary_001",
        "stage": "CLOSED",
        "qa_state": "PASSED",
        "delivery_state": "SANDBOX",
        "acceptance_state": "ACCEPTED_SANDBOX",
        "evidence_ref": "fixture://Governance/canary-manifest-001",
    }
    promoted = promote_to_delivery_validated(
        profile,
        canary_evidence=evidence,
        promoted_at="2026-08-25T18:00:00Z",
    )
    assert profile["readiness_state"] == "PRODUCTION_READY"
    assert profile["canary_ref"] is None
    assert promoted["readiness_state"] == "DELIVERY_VALIDATED"
    assert promoted["canary_ref"]["work_order_id"] == evidence["work_order_id"]

    bad = {**evidence, "acceptance_state": "UNKNOWN"}
    with pytest.raises(ReadinessError, match="acceptance_state"):
        promote_to_delivery_validated(
            profile,
            canary_evidence=bad,
            promoted_at="2026-08-25T18:00:00Z",
        )
