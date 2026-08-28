from __future__ import annotations

import importlib.util
import sys
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
VALIDATOR_PATH = ROOT / "scripts" / "validate_commercial_authority.py"
EVALUATOR_PATH = ROOT / "commercial" / "outbound" / "first_touch_v2.py"
V1_POLICY = ROOT / "commercial" / "outbound" / "cfg-first-touch-routing.v1.json"
V2_POLICY = ROOT / "commercial" / "outbound" / "cfg-first-touch-routing.v2.json"
V1_SCHEMA = ROOT / "schemas" / "cfg-first-touch-routing.v1.schema.json"
V2_SCHEMA = ROOT / "schemas" / "cfg-first-touch-routing.v2.schema.json"
FIXTURE_DIR = ROOT / "commercial" / "fixtures" / "first-touch-routing-v2"


def load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


v = load_module(VALIDATOR_PATH, "validate_commercial_authority")
ev = load_module(EVALUATOR_PATH, "first_touch_v2")

NOW = datetime(2020, 1, 15, 12, 0, 0, tzinfo=timezone.utc)


def iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def policy_v1():
    return v.load_json(V1_POLICY)


def policy_v2():
    return v.load_json(V2_POLICY)


def validate_v1(value):
    v.schema_validate(value, v.load_json(V1_SCHEMA))


def validate_v2(value):
    v.schema_validate(value, v.load_json(V2_SCHEMA))


def clear_flags(**overrides) -> ev.FailClosedFlags:
    payload = {
        "explicit_deactivation": False,
        "membership_leave_proven": False,
        "party_role_conflict": False,
        "recipient_expired": False,
        "evidence_expired": False,
        "suppression": False,
        "opt_out_or_dnc": False,
        "hard_bounce": False,
        "compliance_risk": False,
        "policy_drift": False,
        "binding_mismatch": False,
        "transport_blocked": False,
    }
    payload.update(overrides)
    return ev.FailClosedFlags(**payload)


def binding(age_seconds: int, **overrides) -> ev.CommercialAuthorityBinding:
    payload = {
        "present": True,
        "basis_source_run_id": "run-bound",
        "basis_snapshot_hash": "snap-bound",
        "basis_membership_hash": "mem-aaa",
        "basis_publication_semantic_hash": "sem-aaa",
        "producer_identity": "producer-aaa",
        "source_run_id": "run-bound",
        "snapshot_id": "snap-bound",
        "membership_hash": "mem-aaa",
        "validated_at": iso(NOW - timedelta(seconds=age_seconds)),
        "valid_until": iso(NOW + timedelta(days=8)),
        "authority_ref": "commercial-authority/run-bound",
        "authority_hash": "auth-hash-aaa",
        "observed_membership_hash": "mem-aaa",
        "observed_publication_semantic_hash": "sem-aaa",
        "observed_producer_identity": "producer-aaa",
    }
    payload.update(overrides)
    return ev.CommercialAuthorityBinding(**payload)


def source(state: str, age_seconds: int | None = 0) -> ev.SourceHealthObservation:
    return ev.SourceHealthObservation(
        declared_state=state,
        crawler_state=state,
        target_fit_maintenance_state=state,
        publication_state=state,
        age_seconds=age_seconds,
        ref="extra-cli/source-health",
    )


def evaluate(requested="CFG-FIRST-TOUCH-ROUTING-v2", **kwargs):
    inp = ev.EvaluationInput(now=NOW, requested_policy_version=requested, **kwargs)
    return ev.evaluate(policy_v2(), inp)


def test_v1_still_validates_unchanged():
    value = policy_v1()
    validate_v1(value)
    assert value["canonical_name"] == "CFG-FIRST-TOUCH-ROUTING-v1"
    assert value["hard_gates"]["identity_and_party_role"]["source_run_must_be_current"] is True
    assert value["hard_gates"]["evidence"]["source_run_current"] is True
    mutated = deepcopy(value)
    mutated["canonical_name"] = "CFG-FIRST-TOUCH-ROUTING-v2"
    with pytest.raises(v.ValidationError, match="expected const"):
        validate_v1(mutated)


def test_v2_is_a_new_version_and_does_not_rewrite_v1_bytes():
    value = policy_v2()
    validate_v2(value)
    assert value["canonical_name"] == "CFG-FIRST-TOUCH-ROUTING-v2"
    assert value["policy_version"] == "v2"
    assert value["additive_to"] == "CFG-FIRST-TOUCH-ROUTING-v1"
    assert value["v1_history_rewritten"] is False
    assert V1_POLICY.read_bytes() != V2_POLICY.read_bytes()
    unknown = deepcopy(value)
    unknown["silent_auto_send"] = True
    with pytest.raises(v.ValidationError, match="unknown critical field"):
        validate_v2(unknown)


def test_v2_separates_three_authorities():
    value = policy_v2()
    assert value["separated_authorities"]["source_operational_health_is_commercial_decision"] is False
    assert value["separated_authorities"]["source_degradation_revokes_proven_commercial_authorization"] is False
    assert set(value["source_operational_health"]["states"]) == {"FRESH", "DEGRADED", "STALE", "UNKNOWN"}
    assert set(value["commercial_authority"]["states"]) == {
        "CURRENT",
        "DEGRADED",
        "FROZEN_FOR_NEW_ADMISSION",
        "EXPIRED",
        "UNKNOWN",
    }
    assert "pause" in value["transport_authority"]["observed_fields"]
    assert "kill_switch" in value["transport_authority"]["observed_fields"]
    assert value["transport_authority"]["first_window_go_authorized_by_this_policy"] is False


def test_versioned_thresholds_drive_first_window_from_relative_clocks():
    bands = policy_v2()["commercial_authority"]["first_window_thresholds_seconds"]
    classify = ev.classify_first_window
    assert classify(0, bands) == "CURRENT"
    assert classify(bands["CURRENT"]["max_inclusive"], bands) == "CURRENT"
    assert classify(bands["CURRENT"]["max_inclusive"] + 1, bands) == "DEGRADED"
    assert classify(bands["DEGRADED"]["max_inclusive"], bands) == "DEGRADED"
    assert classify(bands["DEGRADED"]["max_inclusive"] + 1, bands) == "FROZEN_FOR_NEW_ADMISSION"
    assert classify(bands["FROZEN_FOR_NEW_ADMISSION"]["max_inclusive"], bands) == "FROZEN_FOR_NEW_ADMISSION"
    assert classify(bands["FROZEN_FOR_NEW_ADMISSION"]["max_inclusive"] + 1, bands) == "EXPIRED"
    assert classify(None, bands) == "UNKNOWN"

    current = evaluate(
        source_health=source("STALE", age_seconds=400000),
        commercial_binding=binding(3600),
        fail_closed=clear_flags(),
        already_bound_materialized=True,
    )
    assert current["commercial_authority"]["state"] == "CURRENT"
    assert current["source_health"]["state"] == "STALE"
    assert current["commercial_authority"]["new_admission_allowed"] is True
    assert "SOURCE_HEALTH_DEGRADED_NOT_COMMERCIAL_REVOCATION" in current["reason_codes"]

    degraded = evaluate(
        source_health=source("FRESH", age_seconds=10),
        commercial_binding=binding(bands["DEGRADED"]["max_inclusive"]),
        fail_closed=clear_flags(),
        already_bound_materialized=True,
    )
    assert degraded["commercial_authority"]["state"] == "DEGRADED"
    assert degraded["source_health"]["state"] == "FRESH"
    assert degraded["commercial_authority"]["new_admission_allowed"] is True

    frozen = evaluate(
        source_health=source("FRESH", age_seconds=10),
        commercial_binding=binding(bands["FROZEN_FOR_NEW_ADMISSION"]["max_inclusive"]),
        fail_closed=clear_flags(),
        already_bound_materialized=True,
        explicit_binding_still_valid=True,
    )
    assert frozen["commercial_authority"]["state"] == "FROZEN_FOR_NEW_ADMISSION"
    assert frozen["commercial_authority"]["new_admission_allowed"] is False
    assert frozen["commercial_authority"]["existing_bound_touch_transport_allowed"] is True

    expired = evaluate(
        source_health=source("FRESH", age_seconds=10),
        commercial_binding=binding(bands["EXPIRED"]["min_exclusive"] + 1),
        fail_closed=clear_flags(),
        already_bound_materialized=True,
        explicit_binding_still_valid=True,
    )
    assert expired["commercial_authority"]["state"] == "EXPIRED"
    assert expired["commercial_authority"]["new_admission_allowed"] is False
    assert expired["commercial_authority"]["existing_bound_touch_transport_allowed"] is False


def test_source_degradation_does_not_revoke_proven_binding():
    result = evaluate(
        source_health=source("STALE", age_seconds=500000),
        commercial_binding=binding(1200),
        fail_closed=clear_flags(),
        already_bound_materialized=True,
    )
    assert result["source_health"]["state"] == "STALE"
    assert result["source_health"]["is_commercial_decision"] is False
    assert result["commercial_authority"]["state"] == "CURRENT"
    assert result["commercial_authority"]["new_admission_allowed"] is True
    assert result["commercial_authority"]["existing_bound_touch_transport_allowed"] is True
    assert result["activated"] is True


def test_fail_closed_blockers_hold_inside_grace():
    codes = policy_v2()["fail_closed_blockers"]["codes"]
    attr_for = ev.FAIL_CLOSED_FLAG_MAP
    for code in codes:
        result = evaluate(
            source_health=source("FRESH", age_seconds=10),
            commercial_binding=binding(600),
            fail_closed=clear_flags(**{attr_for[code]: True}),
            already_bound_materialized=True,
        )
        assert result["commercial_authority"]["state"] == "CURRENT"
        assert result["commercial_authority"]["new_admission_allowed"] is False
        assert result["commercial_authority"]["existing_bound_touch_transport_allowed"] is False
        assert code in result["reason_codes"]
        assert "FAIL_CLOSED_INSIDE_GRACE" in result["reason_codes"]

    unknown = evaluate(
        source_health=source("FRESH", age_seconds=10),
        commercial_binding=binding(600),
        fail_closed=ev.FailClosedFlags(),
        already_bound_materialized=True,
    )
    assert unknown["commercial_authority"]["new_admission_allowed"] is False
    assert any(item.endswith("_UNKNOWN") for item in unknown["reason_codes"])


def test_frozen_requires_explicit_still_valid_and_never_infers_from_absence():
    base = dict(
        source_health=source("FRESH", age_seconds=10),
        commercial_binding=binding(4 * 86400),
        fail_closed=clear_flags(),
    )
    inferred = evaluate(**base, already_bound_materialized=True, explicit_binding_still_valid=None)
    assert inferred["commercial_authority"]["state"] == "FROZEN_FOR_NEW_ADMISSION"
    assert inferred["commercial_authority"]["new_admission_allowed"] is False
    assert inferred["commercial_authority"]["existing_bound_touch_transport_allowed"] is False
    assert "BINDING_STILL_VALID_NOT_DECLARED" in inferred["reason_codes"]

    denied = evaluate(**base, already_bound_materialized=True, explicit_binding_still_valid=False)
    assert denied["commercial_authority"]["existing_bound_touch_transport_allowed"] is False

    not_bound = evaluate(**base, already_bound_materialized=False, explicit_binding_still_valid=True)
    assert not_bound["commercial_authority"]["existing_bound_touch_transport_allowed"] is False
    assert "NOT_ALREADY_BOUND" in not_bound["reason_codes"]

    blocked = evaluate(
        **{**base, "fail_closed": clear_flags(suppression=True)},
        already_bound_materialized=True,
        explicit_binding_still_valid=True,
    )
    assert blocked["commercial_authority"]["existing_bound_touch_transport_allowed"] is False

    allowed = evaluate(**base, already_bound_materialized=True, explicit_binding_still_valid=True)
    assert allowed["commercial_authority"]["new_admission_allowed"] is False
    assert allowed["commercial_authority"]["existing_bound_touch_transport_allowed"] is True


def test_unknown_and_v1_version_strings_do_not_activate_v2():
    for requested in (None, "", "v1", "CFG-FIRST-TOUCH-ROUTING-v1", "v3", "CFG-FIRST-TOUCH-ROUTING-v9"):
        result = evaluate(
            requested=requested,
            source_health=source("FRESH", age_seconds=10),
            commercial_binding=binding(60),
            fail_closed=clear_flags(),
            already_bound_materialized=True,
        )
        assert result["activated"] is False
        assert result["commercial_authority"]["new_admission_allowed"] is False
        assert result["smtp_send_allowed"] is False
        assert result["provider_dispatch_authorized"] is False

    exact = evaluate(
        requested="v2",
        source_health=source("FRESH", age_seconds=10),
        commercial_binding=binding(60),
        fail_closed=clear_flags(),
        already_bound_materialized=True,
    )
    assert exact["activated"] is True


def test_missing_commercial_authority_and_binding_mismatch_fail_closed():
    missing = evaluate(
        source_health=source("FRESH", age_seconds=10),
        commercial_binding=ev.CommercialAuthorityBinding(present=False),
        fail_closed=clear_flags(),
    )
    assert missing["commercial_authority"]["state"] == "UNKNOWN"
    assert missing["commercial_authority"]["new_admission_allowed"] is False
    assert "MISSING_COMMERCIAL_AUTHORITY" in missing["reason_codes"]

    mismatch = evaluate(
        source_health=source("FRESH", age_seconds=10),
        commercial_binding=binding(60, observed_membership_hash="mem-other"),
        fail_closed=clear_flags(),
        already_bound_materialized=True,
    )
    assert mismatch["commercial_authority"]["new_admission_allowed"] is False
    assert "BINDING_MISMATCH" in mismatch["reason_codes"]


def test_delegated_v2_audit_fields_and_no_forged_human():
    required = set(policy_v2()["audit"]["required_fields"])
    expected = {
        "policy_id",
        "policy_version",
        "authority_reference",
        "executor",
        "source_health_ref",
        "commercial_authority_ref",
        "commercial_authority_hash",
        "basis_source_run_id",
        "membership_hash",
        "lead_account_cnpj_root_ref",
        "recipient",
        "route_class",
        "evidence_hash",
        "evidence_validity",
        "content_hash",
        "composer_version",
        "template_version",
        "prompt_version",
        "suppression_snapshot",
        "transport_snapshot_ref",
        "approval_timestamp",
        "scheduling_result",
        "due_at",
        "idempotency_key",
        "runtime_release_sha",
    }
    assert expected.issubset(required)
    record = {field: f"value-{field}" for field in required}
    record["reason_codes"] = ["ALL_HARD_GATES_PASS"]
    record["contract_role_reason_codes"] = ["CONTRACTOR_ROLE_CONFIRMED"]
    assert ev.validate_delegated_decision(policy_v2(), record) == []
    forged = dict(record, human_approved_by="founder")
    assert "HUMAN_ACTOR_FORGED" in ev.validate_delegated_decision(policy_v2(), forged)
    empty = ev.validate_delegated_decision(policy_v2(), {})
    assert set(required).issubset(empty)


def test_canary_never_authorizes_smtp_or_provider_dispatch():
    scope = policy_v2()["scope"]
    assert scope["provider_dispatch_authorized"] is False
    assert scope["followups_authorized"] is False
    canary = policy_v2()["canary"]
    assert canary["smtp_send_allowed"] is False
    assert canary["sent_count_required"] == 0
    assert canary["provider_send_mutation_allowed"] is False
    assert canary["dispatch_global_paused_required"] is True
    assert canary["kill_switch_preserved_required"] is True
    assert canary["queued_readback_required"] is True
    result = evaluate(
        source_health=source("FRESH", age_seconds=10),
        commercial_binding=binding(60),
        fail_closed=clear_flags(),
        already_bound_materialized=True,
        transport=ev.TransportObservation(first_window_go=True, paused=False, kill_switch=False),
    )
    assert result["smtp_send_allowed"] is False
    assert result["provider_dispatch_authorized"] is False
    assert result["transport_authority"]["first_window_go"] is False
    weakened = policy_v2()
    weakened["scope"]["provider_dispatch_authorized"] = True
    with pytest.raises(v.ValidationError):
        validate_v2(weakened)


def test_pause_actor_absent_is_unknown_not_invented():
    result = evaluate(
        source_health=source("FRESH", age_seconds=10),
        commercial_binding=binding(60),
        fail_closed=clear_flags(),
        transport=ev.TransportObservation(paused=True, pause_reason="founder hold"),
    )
    assert result["transport_authority"]["paused_by"] == "UNKNOWN"
    assert result["transport_authority"]["pause_source"] == "UNKNOWN"


def test_contract_fixtures_cover_the_v1_v2_unknown_matrix():
    cases = v.load_json(FIXTURE_DIR / "matrix.v1.json")
    assert {row["case_id"] for row in cases} >= {
        "v1-legacy",
        "v2-current",
        "v2-degraded",
        "v2-frozen",
        "v2-expired",
        "unknown-policy",
        "missing-commercial-authority",
        "binding-mismatch",
        "stale-source-valid-authority",
        "valid-source-expired-recipient",
        "explicit-suppression",
        "delegated-queued",
        "human-exception-queued",
        "readback-unknown",
    }
    for row in cases:
        requested = row["requested_policy"]
        flags = clear_flags(**row.get("fail_closed", {}))
        source_payload = row["source_health"]
        bind = row.get("commercial_binding")
        commercial = (
            ev.CommercialAuthorityBinding(present=False)
            if not bind
            else binding(
                bind["age_seconds"],
                **{key: value for key, value in bind.items() if key != "age_seconds"},
            )
        )
        result = evaluate(
            requested=requested,
            source_health=source(source_payload["state"], source_payload.get("age_seconds", 0)),
            commercial_binding=commercial,
            fail_closed=flags,
            already_bound_materialized=row.get("already_bound_materialized", False),
            explicit_binding_still_valid=row.get("explicit_binding_still_valid"),
            transport=ev.TransportObservation(**row.get("transport", {})),
        )
        expect = row["expect"]
        assert result["activated"] is expect["activated"], row["case_id"]
        assert result["commercial_authority"]["state"] == expect["commercial_state"], row["case_id"]
        assert result["source_health"]["state"] == expect["source_state"], row["case_id"]
        assert result["commercial_authority"]["new_admission_allowed"] is expect["new_admission_allowed"], row["case_id"]
        assert (
            result["commercial_authority"]["existing_bound_touch_transport_allowed"]
            is expect["existing_bound_touch_transport_allowed"]
        ), row["case_id"]
        for code in expect.get("reason_codes_contains", []):
            assert code in result["reason_codes"], f"{row['case_id']} missing {code}"
        assert result["smtp_send_allowed"] is False
        assert result["provider_dispatch_authorized"] is False


def test_v2_binding_fields_are_the_producer_canonical_names():
    fields = policy_v2()["commercial_authority"]["binding_fields"]
    assert "basis_source_run_id" in fields
    assert "basis_snapshot_hash" in fields
    assert "basis_membership_hash" in fields
    assert "basis_publication_semantic_hash" in fields
    assert "producer_identity" in fields
    assert policy_v2()["commercial_authority"]["alias_conflict_disposition"] == "FAIL_CLOSED"
    assert "basis_publication_semantic_hash" in policy_v2()["commercial_authority"]["alias_must_not_drop"]
    assert "producer_identity" in policy_v2()["commercial_authority"]["alias_must_not_drop"]


def test_lossless_alias_adapter_never_drops_semantic_or_producer():
    adapter = load_module(ROOT / "commercial" / "outbound" / "commercial_authority_adapter.py", "ca_adapter")
    extra_cli = {
        "basis_source_run_id": "run-snapshot-a",
        "basis_snapshot_hash": "snapshot-a",
        "basis_membership_hash": "membership-a",
        "basis_publication_semantic_hash": "semantic-a",
        "producer_identity": "producer-a",
        "state": "CURRENT",
    }
    adapted = adapter.adapt_commercial_authority(extra_cli)
    assert adapted["complete"] is True
    assert adapted["source_run_id"] == "run-snapshot-a"
    assert adapted["snapshot_id"] == "snapshot-a"
    assert adapted["membership_hash"] == "membership-a"
    assert adapted["basis_publication_semantic_hash"] == "semantic-a"
    assert adapted["producer_identity"] == "producer-a"

    alias_only = adapter.adapt_commercial_authority(
        {
            "source_run_id": "run-snapshot-a",
            "snapshot_id": "snapshot-a",
            "membership_hash": "membership-a",
            "basis_publication_semantic_hash": "semantic-a",
            "producer_identity": "producer-a",
        }
    )
    assert alias_only["basis_source_run_id"] == "run-snapshot-a"
    assert alias_only["complete"] is True

    conflict = adapter.adapt_commercial_authority(
        {
            "basis_source_run_id": "run-a",
            "source_run_id": "run-b",
            "basis_snapshot_hash": "snapshot-a",
            "basis_membership_hash": "membership-a",
            "basis_publication_semantic_hash": "semantic-a",
            "producer_identity": "producer-a",
        }
    )
    assert conflict["complete"] is False
    assert "basis_source_run_id" in conflict["conflicts"]

    dropped = adapter.adapt_commercial_authority(
        {
            "source_run_id": "run-a",
            "snapshot_id": "snap-a",
            "membership_hash": "mem-a",
        }
    )
    assert dropped["complete"] is False
    assert dropped["basis_publication_semantic_hash"] is None
    assert dropped["producer_identity"] is None


def test_one_byte_drift_of_semantic_producer_or_membership_fails_closed():
    adapter = load_module(ROOT / "commercial" / "outbound" / "commercial_authority_adapter.py", "ca_adapter")
    happy = evaluate(
        source_health=source("FRESH", age_seconds=10),
        commercial_binding=binding(60),
        fail_closed=clear_flags(),
        already_bound_materialized=True,
    )
    assert happy["commercial_authority"]["new_admission_allowed"] is True
    assert happy["commercial_authority"]["basis_publication_semantic_hash"] == "sem-aaa"
    assert happy["commercial_authority"]["producer_identity"] == "producer-aaa"
    assert happy["commercial_authority"]["source_run_id"] == happy["commercial_authority"]["basis_source_run_id"]

    for field, observed in (
        ("observed_membership_hash", adapter.one_byte_drift("mem-aaa")),
        ("observed_publication_semantic_hash", adapter.one_byte_drift("sem-aaa")),
        ("observed_producer_identity", adapter.one_byte_drift("producer-aaa")),
    ):
        closed = evaluate(
            source_health=source("FRESH", age_seconds=10),
            commercial_binding=binding(60, **{field: observed}),
            fail_closed=clear_flags(),
            already_bound_materialized=True,
        )
        assert closed["commercial_authority"]["new_admission_allowed"] is False, field
        assert "BINDING_MISMATCH" in closed["reason_codes"], field


def test_extra_cli_example_fixture_roundtrip_preserves_producer_binding():
    adapter = load_module(ROOT / "commercial" / "outbound" / "commercial_authority_adapter.py", "ca_adapter")
    example = v.load_json(FIXTURE_DIR.parent / "cross-contract" / "extra-cli-warmbly-manifest-authority.json")
    adapted = adapter.adapt_commercial_authority(example["commercial_authority"])
    assert adapted["complete"] is True
    assert adapted["basis_source_run_id"] == example["source"]["run_id"]
    assert adapted["basis_snapshot_hash"] == example["source"]["snapshot_hash"]
    assert adapted["basis_membership_hash"] == example["authoritative_target_membership"]["membership_hash"]
    assert adapted["basis_publication_semantic_hash"] == "semantic-a"
    assert adapted["producer_identity"] == "producer-a"
    drifted = adapter.adapt_commercial_authority(
        {
            **example["commercial_authority"],
            "basis_publication_semantic_hash": adapter.one_byte_drift("semantic-a"),
        }
    )
    assert drifted["basis_publication_semantic_hash"] != "semantic-a"
