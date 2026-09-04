"""Drive the shipped NET_NEW_INBOUND_HANDRAISER authority and admit path."""

from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path

import pytest

from commercial.inbound import (
    AUTHORITY_PATH,
    ModelOnlyHandraiserStore,
    decision_contains_pii,
    evaluate_net_new_inbound_handraiser,
    evaluate_owner_readbacks,
    load_authority,
    policy_hash,
)
from scripts.validate_commercial_authority import ValidationError, load_json, schema_validate

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "commercial" / "fixtures" / "net-new-inbound-handraiser"
POLICY_SCHEMA = ROOT / "schemas" / "net-new-inbound-handraiser.v1.schema.json"
REQUEST_SCHEMA = ROOT / "schemas" / "net-new-inbound-handraiser-request.v1.schema.json"
ADMISSION_SCHEMA = ROOT / "schemas" / "net-new-inbound-handraiser-admission.v1.schema.json"
EVALUATED_AT = "2026-09-03T12:00:00Z"
CLOSED_STATES = ("ACCEPTED", "REJECTED_WITH_REASON", "UNKNOWN")
ACCOUNT_DISCARD_CODES = ("ACCOUNT_MISSING", "ACCOUNT_REQUIRED", "ACCOUNT_NOT_FOUND")
PII_SAMPLES = ("visitor@example.com", "Visitante Exemplo", "Nome Chutado")


def load_fixture(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def admit(request, *, store=None, intake_paused=False, evaluated_at=EVALUATED_AT):
    return evaluate_net_new_inbound_handraiser(
        request,
        store=store,
        intake_paused=intake_paused,
        evaluated_at=evaluated_at,
    )


def policy():
    return load_authority()


def validate_policy(value):
    schema_validate(value, load_json(POLICY_SCHEMA))


def validate_decision(value):
    schema_validate(value, load_json(ADMISSION_SCHEMA))


def test_authority_is_closed_versioned_and_machine_readable():
    value = policy()
    validate_policy(value)
    assert value["canonical_name"] == "NET_NEW_INBOUND_HANDRAISER-v1"
    assert value["policy_id"] == "NET_NEW_INBOUND_HANDRAISER"
    assert value["policy_version"] == "v1"
    assert value["status"] == "ACTIVE"
    assert value["schema_version"] == "net-new-inbound-handraiser.v1"
    assert value["activation"]["missing_version_disposition"] == "FAIL_CLOSED"
    assert value["closed_states"] == list(CLOSED_STATES)
    assert AUTHORITY_PATH.is_file()

    unknown = deepcopy(value)
    unknown["silent_auto_send"] = True
    with pytest.raises(ValidationError, match="unknown critical field"):
        validate_policy(unknown)


def test_producer_consumer_boundary_is_explicit():
    boundary = policy()["boundary"]
    assert boundary["admission_owner"] == "Governance"
    assert boundary["producer"] == "web-cfg"
    assert boundary["producer_origin"] == "CONFENGE_WEB"
    assert boundary["producers_by_origin"]["CONFENGE_WEB"] == "web-cfg"
    assert boundary["producers_by_origin"]["confenge_web"] == "web-cfg"
    assert boundary["producers_by_origin"]["intel_watch"] == "extra-cli"
    assert boundary["producers_by_origin"]["intel_seed"] == "extra-cli"
    assert boundary["producer_issues"]["extra-cli"] == "tjsasakifln/extra-cli#530"
    assert boundary["record_queue_outcome_owner"] == "Warmbly"
    assert boundary["consumer"] == "Warmbly"
    assert boundary["consumer_issue"] == "tjsasakifln/warmbly#47"
    assert boundary["view_only_consumer"] == "MeetCFG"
    assert boundary["view_only_consumer_issue"] == "tjsasakifln/MeetCFG#1"
    assert boundary["policy_governance"] == "Governance/NET_NEW_INBOUND_HANDRAISER-v1"
    assert boundary["parallel_crm_authorized"] is False
    assert "discard_for_missing_account" in boundary["producer_must_not"]
    assert "discard_for_missing_account" in boundary["consumer_must_not"]
    assert "send_smtp" in boundary["consumer_must_not"]
    assert "create_inbound_only_identity_on_accepted" in boundary["consumer_may"]
    assert "crm" in boundary["governance_must_not"]
    assert "durable_data_plane" in boundary["governance_must_not"]


def test_reason_codes_idempotency_readback_and_rollback_are_locked():
    value = policy()
    assert value["reason_codes"]["accepted"] == ["ADMISSION_GATES_SATISFIED"]
    assert "INTAKE_PAUSED" in value["reason_codes"]["rejected"]
    assert "IDEMPOTENCY_PAYLOAD_CONFLICT" in value["reason_codes"]["rejected"]
    assert "FUZZY_IDENTITY_FORBIDDEN" in value["reason_codes"]["rejected"]
    assert "IDENTITY_CONFLICT" in value["reason_codes"]["rejected"]
    assert "POLICY_VERSION_NOT_ADMITTED" in value["reason_codes"]["rejected"]
    assert "POLICY_VERSION_MISSING" in value["reason_codes"]["unknown"]
    assert "POLICY_VERSION_UNKNOWN" in value["reason_codes"]["unknown"]
    assert set(ACCOUNT_DISCARD_CODES) <= set(value["reason_codes"]["never_emitted"])
    assert value["idempotency"] == {
        "key_required": True,
        "semantics": "EXACTLY_ONCE_LOGICAL",
        "same_key_same_material": "REPLAY_ORIGINAL_DECISION",
        "same_key_different_material": "REJECTED_WITH_REASON",
        "same_key_different_material_reason": "IDEMPOTENCY_PAYLOAD_CONFLICT",
        "distinct_keys": "DISTINCT_LOGICAL_ADMISSIONS",
        "store_mode": "MODEL_ONLY",
        "production_ledger_authorized": False,
    }
    required_readback = set(value["readback"]["required_fields"])
    assert {
        "decision",
        "reason_codes",
        "idempotency_key",
        "correlation_id",
        "receipt_id",
        "inbound_only",
        "outbound_eligible",
        "smtp_authorized",
        "identity_authorization",
    } <= required_readback
    assert value["rollback"]["refuse_reason_code"] == "INTAKE_PAUSED"
    assert value["rollback"]["delete_forbidden"] is True
    assert value["rollback"]["outbound_promotion_forbidden"] is True
    assert value["rollback"]["retain_receipts"] is True


def test_weakened_invariants_fail_closed_on_schema():
    for path, value in (
        (("invariants", "smtp_authorized"), True),
        (("invariants", "outbound_eligible_default"), True),
        (("invariants", "account_required_for_acceptance"), True),
        (("invariants", "pii_in_metrics"), True),
        (("invariants", "fuzzy_identity_by_name"), True),
        (("safety", "e2e_claimed"), True),
        (("evaluation", "replay_semantics"), "BEST_EFFORT"),
    ):
        weakened = policy()
        cursor = weakened
        for key in path[:-1]:
            cursor = cursor[key]
        cursor[path[-1]] = value
        with pytest.raises(ValidationError, match="expected const"):
            validate_policy(weakened)


@pytest.mark.parametrize(
    "name",
    [
        "accepted.missing-account.v1.json",
        "accepted.with-subject-ref.v1.json",
        "accepted.warmbly-confenge-web.v1.json",
        "accepted.extra-cli-intel-watch.v1.json",
        "rejected.consent-refused.v1.json",
        "rejected.fuzzy-identity.v1.json",
        "rejected.intent-not-admitted.v1.json",
        "rejected.identity-conflict.v1.json",
        "rejected.old-policy-version.v1.json",
        "unknown.missing-contact.v1.json",
        "unknown.stale-freshness.v1.json",
        "unknown.missing-policy-version.v1.json",
        "unknown.missing-policy-version-with-id.v1.json",
        "unknown.unknown-policy-version.v1.json",
    ],
)
def test_golden_request_fixtures_validate(name: str):
    schema_validate(load_fixture(name), load_json(REQUEST_SCHEMA))


def _assert_closed_and_safe(decision, request):
    validate_decision(decision)
    assert decision["decision"] in CLOSED_STATES
    assert decision["outbound_eligible"] is False
    assert decision["smtp_authorized"] is False
    assert decision["followup_authorized"] is False
    assert decision["account_required_for_acceptance"] is False
    assert decision["contains_pii"] is False
    assert decision["mutation_mode"] == "MODEL_ONLY"
    assert decision["consumer_authorization"]["outbound_eligible"] is False
    assert decision["consumer_authorization"]["smtp_authorized"] is False
    assert decision["metrics"]["smtp_authorized"] is False
    assert decision["metrics"]["outbound_eligible"] is False
    assert not any(code in decision["reason_codes"] for code in ACCOUNT_DISCARD_CODES)
    assert decision_contains_pii(decision, request) is False
    blob = json.dumps(decision)
    assert not any(sample in blob for sample in PII_SAMPLES)


def test_golden_accepted_missing_account_is_not_discarded():
    request = load_fixture("accepted.missing-account.v1.json")
    request_with_pii = deepcopy(request)
    request_with_pii["email"] = "visitor@example.com"
    request_with_pii["display_name"] = "Visitante Exemplo"
    decision = admit(request_with_pii)
    _assert_closed_and_safe(decision, request_with_pii)
    assert decision["decision"] == "ACCEPTED"
    assert decision["reason_codes"] == ["ADMISSION_GATES_SATISFIED"]
    assert decision["account_present"] is False
    assert decision["inbound_only"] is True
    assert decision["identity_authorization"] == "INBOUND_ONLY"
    assert decision["consumer_authorization"]["create_inbound_only_identity"] is True
    assert decision["consumer_authorization"]["surface_on_commercial_queue"] is True
    assert decision["replayed"] is False


def test_golden_accepted_with_subject_ref_stays_inbound_only():
    request = load_fixture("accepted.with-subject-ref.v1.json")
    decision = admit(request)
    _assert_closed_and_safe(decision, request)
    assert decision["decision"] == "ACCEPTED"
    assert decision["subject_ref"] == "subj:web:handraiser:001"
    assert decision["inbound_only"] is True
    assert decision["outbound_eligible"] is False


@pytest.mark.parametrize(
    ("name", "reason"),
    [
        ("rejected.consent-refused.v1.json", "CONSENT_REFUSED"),
        ("rejected.fuzzy-identity.v1.json", "FUZZY_IDENTITY_FORBIDDEN"),
        ("rejected.intent-not-admitted.v1.json", "INTENT_KIND_NOT_ADMITTED"),
    ],
)
def test_golden_rejected_vectors(name: str, reason: str):
    request = load_fixture(name)
    decision = admit(request)
    _assert_closed_and_safe(decision, request)
    assert decision["decision"] == "REJECTED_WITH_REASON"
    assert reason in decision["reason_codes"]
    assert decision["identity_authorization"] == "NONE"
    assert decision["consumer_authorization"]["create_inbound_only_identity"] is False
    assert decision["smtp_authorized"] is False


@pytest.mark.parametrize(
    ("name", "reason"),
    [
        ("unknown.missing-contact.v1.json", "CONTACT_EVIDENCE_UNKNOWN"),
        ("unknown.stale-freshness.v1.json", "FRESHNESS_STALE"),
    ],
)
def test_golden_unknown_vectors(name: str, reason: str):
    request = load_fixture(name)
    decision = admit(request)
    _assert_closed_and_safe(decision, request)
    assert decision["decision"] == "UNKNOWN"
    assert reason in decision["reason_codes"]
    assert decision["identity_authorization"] == "NONE"


def test_missing_idempotency_and_ambiguous_intent_are_unknown():
    missing = load_fixture("accepted.missing-account.v1.json")
    missing.pop("idempotency_key")
    missing_decision = admit(missing)
    _assert_closed_and_safe(missing_decision, missing)
    assert missing_decision["decision"] == "UNKNOWN"
    assert "IDEMPOTENCY_KEY_MISSING" in missing_decision["reason_codes"]

    ambiguous = load_fixture("accepted.missing-account.v1.json")
    ambiguous["intent_kinds"] = ["HUMAN_REVIEW", "DEEP_DIVE"]
    ambiguous_decision = admit(ambiguous)
    _assert_closed_and_safe(ambiguous_decision, ambiguous)
    assert ambiguous_decision["decision"] == "UNKNOWN"
    assert "INTENT_KIND_AMBIGUOUS" in ambiguous_decision["reason_codes"]


def test_absence_beats_reject_and_never_uses_account_as_discard():
    request = load_fixture("rejected.consent-refused.v1.json")
    request.pop("origin")
    decision = admit(request)
    _assert_closed_and_safe(decision, request)
    assert decision["decision"] == "UNKNOWN"
    assert "ORIGIN_UNKNOWN" in decision["reason_codes"]
    assert "CONSENT_REFUSED" in decision["reason_codes"]


def test_rollback_pauses_new_intake_keeps_receipts_and_does_not_promote():
    store = ModelOnlyHandraiserStore()
    request = load_fixture("accepted.missing-account.v1.json")
    first = admit(request, store=store)
    assert first["decision"] == "ACCEPTED"
    replay_while_paused = admit(request, store=store, intake_paused=True)
    assert replay_while_paused["decision"] == "ACCEPTED"
    assert replay_while_paused["replayed"] is True
    assert replay_while_paused["rollback"]["receipts_retained"] is True

    fresh = deepcopy(request)
    fresh["idempotency_key"] = "nihr:web:paused-new-001"
    fresh["receipt_id"] = "rcpt_paused_new_001"
    paused = admit(fresh, store=store, intake_paused=True)
    assert paused["decision"] == "REJECTED_WITH_REASON"
    assert "INTAKE_PAUSED" in paused["reason_codes"]
    assert paused["rollback"] == {
        "intake_paused": True,
        "receipts_retained": True,
        "delete_forbidden": True,
        "outbound_promotion_forbidden": True,
    }
    assert paused["outbound_eligible"] is False
    assert store.accepted_logical_count() == 1


def test_idempotency_conflict_does_not_create_a_second_admission():
    store = ModelOnlyHandraiserStore()
    request = load_fixture("accepted.missing-account.v1.json")
    first = admit(request, store=store)
    conflict = deepcopy(request)
    conflict["intent_kind"] = "HUMAN_REVIEW"
    second = admit(conflict, store=store)
    assert first["decision"] == "ACCEPTED"
    assert second["decision"] == "REJECTED_WITH_REASON"
    assert "IDEMPOTENCY_PAYLOAD_CONFLICT" in second["reason_codes"]
    assert len(store) == 1
    assert store.accepted_logical_count() == 1


def test_100_same_key_replays_collapse_to_one_logical_admission():
    store = ModelOnlyHandraiserStore()
    request = load_fixture("accepted.missing-account.v1.json")
    first = admit(request, store=store)
    replays = [admit(request, store=store) for _ in range(99)]
    assert first["decision"] == "ACCEPTED"
    assert first["replayed"] is False
    assert len(store) == 1
    assert store.accepted_logical_count() == 1
    assert {row["decision"] for row in replays} == {"ACCEPTED"}
    assert all(row["replayed"] is True for row in replays)
    assert {row["logical_admission_id"] for row in [first, *replays]} == {first["logical_admission_id"]}
    assert {row["decision_id"] for row in [first, *replays]} == {first["decision_id"]}


def test_100_distinct_keys_do_not_drop_relevant_intent():
    store = ModelOnlyHandraiserStore()
    base = load_fixture("accepted.missing-account.v1.json")
    decisions = []
    for index in range(100):
        request = deepcopy(base)
        request["idempotency_key"] = f"nihr:web:distinct-{index:03d}"
        request["correlation_id"] = f"corr_distinct_{index:03d}"
        request["receipt_id"] = f"rcpt_distinct_{index:03d}"
        decisions.append(admit(request, store=store))
    assert len(store) == 100
    assert store.accepted_logical_count() == 100
    assert all(row["decision"] == "ACCEPTED" for row in decisions)
    assert len({row["logical_admission_id"] for row in decisions}) == 100
    assert all(row["inbound_only"] is True and row["outbound_eligible"] is False for row in decisions)


def test_missing_authority_returns_unknown_not_exception():
    request = load_fixture("accepted.missing-account.v1.json")
    decision = evaluate_net_new_inbound_handraiser(
        request, authority={}, evaluated_at=EVALUATED_AT
    )
    _assert_closed_and_safe(decision, request)
    assert decision["decision"] == "UNKNOWN"
    assert "AUTHORITY_UNAVAILABLE" in decision["reason_codes"]
    assert decision["consumer_authorization"]["create_inbound_only_identity"] is False


def test_blank_or_missing_match_method_is_unknown():
    request = load_fixture("accepted.missing-account.v1.json")
    request["contact_evidence"]["identity_match_method"] = "  "
    decision = admit(request)
    _assert_closed_and_safe(decision, request)
    assert decision["decision"] == "UNKNOWN"
    assert "CONTACT_EVIDENCE_UNKNOWN" in decision["reason_codes"]
    assert decision["consumer_authorization"]["create_inbound_only_identity"] is False


def test_email_in_correlation_is_unknown_and_not_serialized():
    request = load_fixture("accepted.missing-account.v1.json")
    request["correlation_id"] = "visitor@example.com"
    decision = admit(request)
    blob = json.dumps(decision)
    assert "visitor@example.com" not in blob
    _assert_closed_and_safe(decision, request)
    assert decision["decision"] == "UNKNOWN"
    assert "REQUEST_INVALID" in decision["reason_codes"]
    assert decision["correlation_id"] is None
    assert decision["contains_pii"] is False
    assert decision["consumer_authorization"]["create_inbound_only_identity"] is False


def test_explicit_subject_ref_without_subject_is_unknown():
    request = load_fixture("accepted.with-subject-ref.v1.json")
    request["subject_ref"] = None
    decision = admit(request)
    _assert_closed_and_safe(decision, request)
    assert decision["decision"] == "UNKNOWN"
    assert "SUBJECT_REFERENCE_AMBIGUOUS" in decision["reason_codes"]


def test_warmbly_emitted_origin_and_intent_are_admitted():
    request = load_fixture("accepted.warmbly-confenge-web.v1.json")
    decision = admit(request)
    _assert_closed_and_safe(decision, request)
    assert decision["decision"] == "ACCEPTED"
    assert decision["origin"] == "confenge_web"
    assert decision["intent_kind"] == "REQUEST_DEEP_DIVE"
    assert decision["inbound_only"] is True
    assert decision["outbound_eligible"] is False
    assert policy()["boundary"]["producers_by_origin"][decision["origin"]] == "web-cfg"


def test_extra_cli_intel_watch_origin_is_admitted_inbound_only():
    request = load_fixture("accepted.extra-cli-intel-watch.v1.json")
    decision = admit(request)
    _assert_closed_and_safe(decision, request)
    assert decision["decision"] == "ACCEPTED"
    assert decision["origin"] == "intel_watch"
    assert decision["intent_kind"] == "REQUEST_HUMAN_REVIEW"
    assert decision["inbound_only"] is True
    assert policy()["boundary"]["producers_by_origin"][decision["origin"]] == "extra-cli"


def test_missing_old_unknown_policy_version_fail_closed():
    missing = admit(load_fixture("unknown.missing-policy-version.v1.json"))
    assert missing["decision"] == "UNKNOWN"
    assert "POLICY_VERSION_MISSING" in missing["reason_codes"]
    assert missing["consumer_authorization"]["create_inbound_only_identity"] is False
    assert missing["outbound_eligible"] is False

    old = admit(load_fixture("rejected.old-policy-version.v1.json"))
    assert old["decision"] == "REJECTED_WITH_REASON"
    assert "POLICY_VERSION_NOT_ADMITTED" in old["reason_codes"]
    assert old["inbound_only"] is False
    assert old["outbound_eligible"] is False

    unknown = admit(load_fixture("unknown.unknown-policy-version.v1.json"))
    assert unknown["decision"] == "UNKNOWN"
    assert "POLICY_VERSION_UNKNOWN" in unknown["reason_codes"]
    assert unknown["consumer_authorization"]["surface_on_commercial_queue"] is False

    id_without_version = admit(load_fixture("unknown.missing-policy-version-with-id.v1.json"))
    _assert_closed_and_safe(id_without_version, load_fixture("unknown.missing-policy-version-with-id.v1.json"))
    assert id_without_version["decision"] == "UNKNOWN"
    assert "POLICY_VERSION_MISSING" in id_without_version["reason_codes"]
    assert id_without_version["consumer_authorization"]["create_inbound_only_identity"] is False
    assert id_without_version["outbound_eligible"] is False
    assert id_without_version["inbound_only"] is False


def test_identity_conflict_is_explicit_and_not_a_second_admission():
    request = load_fixture("rejected.identity-conflict.v1.json")
    decision = admit(request)
    _assert_closed_and_safe(decision, request)
    assert decision["decision"] == "REJECTED_WITH_REASON"
    assert "IDENTITY_CONFLICT" in decision["reason_codes"]
    assert decision["identity_authorization"] == "NONE"


def test_warmbly_readback_shape_never_grants_outbound():
    accepted = load_fixture("readback.warmbly-accepted.v1.json")
    rejected = load_fixture("readback.warmbly-rejected.v1.json")
    for row in (accepted, rejected):
        assert row["outbound_eligible"] is False
        assert row["smtp_authorized"] is False
        assert row["followup_authorized"] is False
        assert "email" not in row
        assert "name" not in row
    assert accepted["inbound_only"] is True
    assert accepted["queued"] is True
    assert rejected["queued"] is False
    assert rejected["reason"] == "UNKNOWN"


def test_owner_readbacks_keep_issue_65_open_on_schema_mismatch_collection():
    evidence = load_fixture("e2e-owner-readbacks.v1.json")
    verdict = evaluate_owner_readbacks(evidence)
    assert verdict["WARM_BLY_POLICY_ACK"] == "PASS"
    assert verdict["MEETCFG_CONSUMER_ACK"] == "PASS"
    assert verdict["residual"] == "SCHEMA_MISMATCH_COLLECTION"
    assert verdict["residual_owner"] == "Warmbly"
    assert verdict["closeable"] is False
    assert verdict["ISSUE_65"] == "OPEN_WITH_EXACT_REASON:SCHEMA_MISMATCH_COLLECTION"
    assert verdict["smtp_authorized"] is False
    assert verdict["new_control_plane"] is False


def test_policy_hash_is_stable_canonical_sha256():
    digest = policy_hash()
    assert digest.startswith("sha256:")
    assert len(digest) == 71
    assert digest == policy_hash(load_authority())
    matrix = json.loads(
        (ROOT / "commercial" / "inbound" / "consumer-matrix.v1.json").read_text(encoding="utf-8")
    )
    assert matrix["canonical_name"] == "NET_NEW_INBOUND_HANDRAISER-v1"
    assert matrix["policy_hash"] == digest
    assert matrix["missing_old_unknown_fail_closed"] is True
    assert {row["id"] for row in matrix["consumers"]} >= {
        "Warmbly#47",
        "MeetCFG#1",
        "web-cfg#61",
        "extra-cli#530",
    }


def test_ci_workflow_runs_this_module():
    workflow = (ROOT / ".github" / "workflows" / "commercial-authority.yml").read_text(encoding="utf-8")
    pytest_line = next(line.strip() for line in workflow.splitlines() if "python -m pytest" in line)
    assert "tests/test_net_new_inbound_handraiser.py" in pytest_line
    assert "tests/test_first_touch_routing_policy.py" in pytest_line
