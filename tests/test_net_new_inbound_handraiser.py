"""Drive the shipped NET_NEW_INBOUND_HANDRAISER authority and admit path."""

from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path

import pytest

from commercial.inbound import (
    AUTHORITY_PATH,
    DRAFT_AUTHORITY_PATH,
    DRAFT_CANONICAL_NAME,
    ModelOnlyHandraiserStore,
    decision_contains_pii,
    evaluate_consumer_pin,
    evaluate_net_new_inbound_handraiser,
    evaluate_owner_readbacks,
    load_authority,
    load_draft_authority,
    load_draft_consumer_matrix,
    policy_hash,
)
from scripts.validate_commercial_authority import ValidationError, load_json, schema_validate

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "commercial" / "fixtures" / "net-new-inbound-handraiser"
POLICY_SCHEMA = ROOT / "schemas" / "net-new-inbound-handraiser.v1.schema.json"
REQUEST_SCHEMA = ROOT / "schemas" / "net-new-inbound-handraiser-request.v1.schema.json"
ADMISSION_SCHEMA = ROOT / "schemas" / "net-new-inbound-handraiser-admission.v1.schema.json"
DRAFT_POLICY_SCHEMA = ROOT / "schemas" / "net-new-inbound-handraiser.1.0.0-draft.20260904.schema.json"
DRAFT_REQUEST_SCHEMA = ROOT / "schemas" / "net-new-inbound-handraiser-request.1.0.0-draft.20260904.schema.json"
DRAFT_ADMISSION_SCHEMA = ROOT / "schemas" / "net-new-inbound-handraiser-admission.1.0.0-draft.20260904.schema.json"
NUCLEI = (
    "expert_evidence_assistance",
    "property_valuation",
    "building_engineering_documentation",
    "occupational_safety",
    "public_works_b2g",
)
QUALIFICATION_STATES = (
    "NEEDS_CONTEXT",
    "POTENTIAL_FIT",
    "CONFLICT_CHECK_REQUIRED",
    "DOCUMENT_GAP",
    "CAPACITY_REVIEW",
    "PARTNER_REQUIRED",
    "OUT_OF_SCOPE",
    "QCO",
)
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


def draft_policy():
    return load_draft_authority()


def validate_draft_policy(value):
    schema_validate(value, load_json(DRAFT_POLICY_SCHEMA))


def validate_draft_decision(value):
    schema_validate(value, load_json(DRAFT_ADMISSION_SCHEMA))


def _assert_draft_closed_and_safe(decision, request):
    validate_draft_decision(decision)
    assert decision["decision"] in CLOSED_STATES
    assert decision["canonical_name"] == DRAFT_CANONICAL_NAME
    assert decision["policy_version"] == "1.0.0-draft.20260904"
    assert decision["outbound_eligible"] is False
    assert decision["auto_send"] is False
    assert decision["smtp_authorized"] is False
    assert decision["followup_authorized"] is False
    assert decision["account_required_for_acceptance"] is False
    assert decision["contains_pii"] is False
    assert decision["mutation_mode"] == "MODEL_ONLY"
    assert decision["consumer_authorization"]["outbound_eligible"] is False
    assert decision["consumer_authorization"]["auto_send"] is False
    assert decision["consumer_authorization"]["smtp_authorized"] is False
    assert decision["metrics"]["smtp_authorized"] is False
    assert decision["metrics"]["outbound_eligible"] is False
    assert decision["metrics"]["auto_send"] is False
    assert decision["readback"]["required"] is True
    assert decision["readback"]["http_2xx_is_not_acceptance"] is True
    assert decision["readback"]["decision_id"] == decision["decision_id"]
    assert "http_status" not in decision
    assert not any(code in decision["reason_codes"] for code in ACCOUNT_DISCARD_CODES)
    assert "CONFLICT_UNKNOWN_AS_CLEAR" not in decision["reason_codes"]
    assert decision["conflict_screening"]["status"] != "CLEAR" or decision["qualification_state"] != "CONFLICT_CHECK_REQUIRED"
    if decision["conflict_screening"]["status"] == "UNKNOWN":
        assert decision["qualification_state"] in {"CONFLICT_CHECK_REQUIRED", "NONE"}
    assert "content" not in (decision.get("sensitive_data") or {})
    assert decision_contains_pii(decision, request) is False
    blob = json.dumps(decision)
    assert not any(sample in blob for sample in PII_SAMPLES)
    assert "sensitive-secret" not in blob


def test_draft_authority_is_versioned_fail_closed_and_does_not_rewrite_v1():
    value = draft_policy()
    validate_draft_policy(value)
    assert value["canonical_name"] == DRAFT_CANONICAL_NAME
    assert value["policy_version"] == "1.0.0-draft.20260904"
    assert value["does_not_rewrite_v1"] is True
    assert value["v1_remains_exact_match_authority"] is True
    assert value["activation"]["v1_string_does_not_activate_this_version"] is True
    assert value["activation"]["missing_version_disposition"] == "FAIL_CLOSED"
    assert value["qualification_states"] == list(QUALIFICATION_STATES)
    assert value["inputs"]["admitted_nuclei"] == list(NUCLEI)
    assert value["invariants"]["outbound_eligible_default"] is False
    assert value["invariants"]["auto_send"] is False
    assert value["invariants"]["conflict_unknown_never_becomes_clear"] is True
    assert value["safety"]["pncp_live_commercial_authority"] is False
    assert value["safety"]["live_intelligence_as_inbound"] is False
    assert "intel_watch" not in value["inputs"]["admitted_origins"]
    assert "crm" in value["boundary"]["governance_must_not"]
    assert "durable_data_plane" in value["boundary"]["governance_must_not"]
    assert DRAFT_AUTHORITY_PATH.is_file()
    v1 = policy()
    assert v1["canonical_name"] == "NET_NEW_INBOUND_HANDRAISER-v1"
    assert v1["canonical_name"] != value["canonical_name"]

    weakened = deepcopy(value)
    weakened["invariants"]["auto_send"] = True
    with pytest.raises(ValidationError, match="expected const"):
        validate_draft_policy(weakened)


@pytest.mark.parametrize("nucleus", NUCLEI)
def test_draft_five_nuclei_are_admitted_inbound_only(nucleus: str):
    request = load_fixture(f"accepted.{nucleus}.draft-20260904.json")
    schema_validate(request, load_json(DRAFT_REQUEST_SCHEMA))
    decision = admit(request)
    _assert_draft_closed_and_safe(decision, request)
    assert decision["decision"] == "ACCEPTED"
    assert decision["nucleus_id"] == nucleus
    assert decision["offer_candidate_id"] == "private_project_technical_readiness_assessment"
    assert decision["intake_source"] == "CONFENGE_WEB"
    assert decision["inbound_only"] is True
    assert decision["outbound_eligible"] is False
    assert decision["auto_send"] is False
    assert decision["qualification_state"] in QUALIFICATION_STATES
    assert decision["identity_authorization"] == "INBOUND_ONLY"


def test_draft_missing_account_is_not_discarded():
    request = load_fixture("accepted.missing-account.draft-20260904.json")
    schema_validate(request, load_json(DRAFT_REQUEST_SCHEMA))
    request_with_pii = deepcopy(request)
    request_with_pii["email"] = "visitor@example.com"
    request_with_pii["display_name"] = "Visitante Exemplo"
    decision = admit(request_with_pii)
    _assert_draft_closed_and_safe(decision, request_with_pii)
    assert decision["decision"] == "ACCEPTED"
    assert decision["account_present"] is False
    assert decision["inbound_only"] is True
    assert "ACCOUNT_MISSING" not in decision["reason_codes"]


def test_draft_conflict_unknown_never_becomes_clear():
    request = load_fixture("accepted.conflict-unknown.draft-20260904.json")
    schema_validate(request, load_json(DRAFT_REQUEST_SCHEMA))
    decision = admit(request)
    _assert_draft_closed_and_safe(decision, request)
    assert decision["decision"] == "ACCEPTED"
    assert decision["conflict_screening"]["status"] == "UNKNOWN"
    assert decision["qualification_state"] == "CONFLICT_CHECK_REQUIRED"
    coerced = deepcopy(request)
    coerced["conflict_screening"]["claimed_clear"] = True
    coerced_decision = admit(coerced)
    _assert_draft_closed_and_safe(coerced_decision, coerced)
    assert coerced_decision["decision"] == "REJECTED_WITH_REASON"
    assert "CONFLICT_CLEAR_COERCION_FORBIDDEN" in coerced_decision["reason_codes"]
    assert coerced_decision["conflict_screening"]["status"] != "CLEAR"


def test_draft_sensitive_content_never_enters_public_envelope():
    request = load_fixture("rejected.sensitive-content.draft-20260904.json")
    schema_validate(request, load_json(DRAFT_REQUEST_SCHEMA))
    poisoned = deepcopy(request)
    poisoned["sensitive_data"]["content"] = "sensitive-secret privilege notes"
    decision = admit(poisoned)
    _assert_draft_closed_and_safe(decision, poisoned)
    assert decision["decision"] == "REJECTED_WITH_REASON"
    assert "SENSITIVE_CONTENT_FORBIDDEN" in decision["reason_codes"]
    assert "content" not in decision["sensitive_data"]
    assert "sensitive-secret" not in json.dumps(decision)


def test_draft_live_intelligence_is_not_inbound():
    request = load_fixture("rejected.live-intelligence.draft-20260904.json")
    schema_validate(request, load_json(DRAFT_REQUEST_SCHEMA))
    decision = admit(request)
    _assert_draft_closed_and_safe(decision, request)
    assert decision["decision"] == "REJECTED_WITH_REASON"
    assert "LIVE_INTELLIGENCE_NOT_INBOUND" in decision["reason_codes"]
    assert decision["inbound_only"] is False
    assert decision["consumer_authorization"]["create_inbound_only_identity"] is False


def test_draft_first_touch_and_outbound_inheritance_are_rejected():
    first_touch = load_fixture("rejected.first-touch-inheritance.draft-20260904.json")
    schema_validate(first_touch, load_json(DRAFT_REQUEST_SCHEMA))
    first_touch_decision = admit(first_touch)
    _assert_draft_closed_and_safe(first_touch_decision, first_touch)
    assert first_touch_decision["decision"] == "REJECTED_WITH_REASON"
    assert "FIRST_TOUCH_INHERITANCE_FORBIDDEN" in first_touch_decision["reason_codes"]
    assert first_touch_decision["outbound_eligible"] is False
    assert first_touch_decision["auto_send"] is False

    outbound = load_fixture("rejected.outbound-eligible.draft-20260904.json")
    schema_validate(outbound, load_json(DRAFT_REQUEST_SCHEMA))
    outbound_decision = admit(outbound)
    _assert_draft_closed_and_safe(outbound_decision, outbound)
    assert outbound_decision["decision"] == "REJECTED_WITH_REASON"
    assert "OUTBOUND_INHERITANCE_FORBIDDEN" in outbound_decision["reason_codes"]
    assert "AUTO_SEND_FORBIDDEN" in outbound_decision["reason_codes"]
    assert outbound_decision["outbound_eligible"] is False
    assert outbound_decision["auto_send"] is False


def test_draft_missing_and_unknown_version_fail_closed():
    missing = load_fixture("accepted.missing-account.draft-20260904.json")
    missing.pop("policy_version")
    missing_decision = admit(missing)
    _assert_draft_closed_and_safe(missing_decision, missing)
    assert missing_decision["decision"] == "UNKNOWN"
    assert "POLICY_VERSION_MISSING" in missing_decision["reason_codes"]
    assert missing_decision["consumer_authorization"]["create_inbound_only_identity"] is False

    unknown = load_fixture("unknown.unknown-version.draft-20260904.json")
    unknown_decision = admit(unknown)
    _assert_draft_closed_and_safe(unknown_decision, unknown)
    assert unknown_decision["decision"] == "UNKNOWN"
    assert "POLICY_VERSION_UNKNOWN" in unknown_decision["reason_codes"]

    v1_claim = load_fixture("accepted.missing-account.draft-20260904.json")
    v1_claim["policy_version"] = "v1"
    v1_claim["canonical_name"] = "NET_NEW_INBOUND_HANDRAISER-v1"
    v1_decision = admit(v1_claim)
    _assert_draft_closed_and_safe(v1_decision, v1_claim)
    assert v1_decision["decision"] == "REJECTED_WITH_REASON"
    assert "POLICY_VERSION_NOT_ADMITTED" in v1_decision["reason_codes"]


def test_draft_missing_nucleus_is_unknown_and_retains_receipt():
    request = load_fixture("unknown.missing-nucleus.draft-20260904.json")
    decision = admit(request)
    _assert_draft_closed_and_safe(decision, request)
    assert decision["decision"] == "UNKNOWN"
    assert "NUCLEUS_UNKNOWN" in decision["reason_codes"]
    assert decision["receipt_id"] == request["receipt_id"]
    assert decision["rollback"]["receipts_retained"] is True
    assert decision["readback"]["receipt_id"] == request["receipt_id"]


def test_draft_consent_refused_retains_minimal_evidence():
    request = load_fixture("rejected.consent-refused.draft-20260904.json")
    schema_validate(request, load_json(DRAFT_REQUEST_SCHEMA))
    decision = admit(request)
    _assert_draft_closed_and_safe(decision, request)
    assert decision["decision"] == "REJECTED_WITH_REASON"
    assert "CONSENT_REFUSED" in decision["reason_codes"]
    assert decision["receipt_id"] == request["receipt_id"]
    assert decision["idempotency_key"] == request["idempotency_key"]
    assert decision["rollback"]["delete_forbidden"] is True


def test_draft_qualification_states_are_closed():
    request = load_fixture("accepted.expert_evidence_assistance.draft-20260904.json")
    qco = admit(request)
    assert qco["qualification_state"] == "QCO"

    gap = deepcopy(request)
    gap["idempotency_key"] = "nihr:web:draft-gap-001"
    gap["receipt_id"] = "rcpt_draft_gap_001"
    gap["document_availability_class"] = "GAP"
    gap_decision = admit(gap)
    assert gap_decision["decision"] == "ACCEPTED"
    assert gap_decision["qualification_state"] == "DOCUMENT_GAP"

    partner = deepcopy(request)
    partner["idempotency_key"] = "nihr:web:draft-partner-001"
    partner["receipt_id"] = "rcpt_draft_partner_001"
    partner["partner_required"] = True
    partner_decision = admit(partner)
    assert partner_decision["qualification_state"] == "PARTNER_REQUIRED"

    capacity = deepcopy(request)
    capacity["idempotency_key"] = "nihr:web:draft-capacity-001"
    capacity["receipt_id"] = "rcpt_draft_capacity_001"
    capacity["capacity_review_required"] = True
    capacity_decision = admit(capacity)
    assert capacity_decision["qualification_state"] == "CAPACITY_REVIEW"

    needs = deepcopy(request)
    needs["idempotency_key"] = "nihr:web:draft-needs-001"
    needs["receipt_id"] = "rcpt_draft_needs_001"
    needs["decision_role"] = "UNKNOWN"
    needs_decision = admit(needs)
    assert needs_decision["qualification_state"] == "NEEDS_CONTEXT"

    fit = deepcopy(request)
    fit["idempotency_key"] = "nihr:web:draft-fit-001"
    fit["receipt_id"] = "rcpt_draft_fit_001"
    fit["decision_role"] = "INFLUENCER"
    fit_decision = admit(fit)
    assert fit_decision["qualification_state"] == "POTENTIAL_FIT"

    out = deepcopy(request)
    out["idempotency_key"] = "nihr:web:draft-oos-001"
    out["receipt_id"] = "rcpt_draft_oos_001"
    out["nucleus_id"] = "not_a_nucleus"
    out_decision = admit(out)
    assert out_decision["decision"] == "REJECTED_WITH_REASON"
    assert "NUCLEUS_NOT_ADMITTED" in out_decision["reason_codes"]
    assert out_decision["qualification_state"] == "NONE"

    for row in (qco, gap_decision, partner_decision, capacity_decision, needs_decision, fit_decision):
        _assert_draft_closed_and_safe(row, request)
        assert row["qualification_state"] in QUALIFICATION_STATES


def test_draft_100_same_key_replays_collapse_to_one_logical_admission():
    store = ModelOnlyHandraiserStore()
    request = load_fixture("accepted.missing-account.draft-20260904.json")
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
    assert all(row["outbound_eligible"] is False and row["auto_send"] is False for row in [first, *replays])


def test_draft_100_distinct_keys_remain_distinct():
    store = ModelOnlyHandraiserStore()
    base = load_fixture("accepted.missing-account.draft-20260904.json")
    decisions = []
    for index in range(100):
        request = deepcopy(base)
        request["idempotency_key"] = f"nihr:web:draft-distinct-{index:03d}"
        request["correlation_id"] = f"corr_draft_distinct_{index:03d}"
        request["receipt_id"] = f"rcpt_draft_distinct_{index:03d}"
        decisions.append(admit(request, store=store))
    assert len(store) == 100
    assert store.accepted_logical_count() == 100
    assert all(row["decision"] == "ACCEPTED" for row in decisions)
    assert len({row["logical_admission_id"] for row in decisions}) == 100
    assert all(row["inbound_only"] is True and row["outbound_eligible"] is False for row in decisions)


def test_draft_v1_intel_watch_fixture_still_uses_v1_path():
    request = load_fixture("accepted.extra-cli-intel-watch.v1.json")
    decision = admit(request)
    _assert_closed_and_safe(decision, request)
    assert decision["canonical_name"] == "NET_NEW_INBOUND_HANDRAISER-v1"
    assert decision["decision"] == "ACCEPTED"
    assert decision["origin"] == "intel_watch"


def test_draft_consumer_pin_matches_live_hash_and_does_not_copy_schema():
    digest = policy_hash(draft_policy())
    assert digest.startswith("sha256:")
    assert len(digest) == 71
    matrix = json.loads(
        (ROOT / "commercial" / "inbound" / "consumer-matrix.1.0.0-draft.20260904.json").read_text(
            encoding="utf-8"
        )
    )
    assert matrix["canonical_name"] == DRAFT_CANONICAL_NAME
    assert matrix["policy_hash"] == digest
    assert matrix["do_not_copy_schema"] is True
    pin = (ROOT / "commercial" / "inbound" / "CONSUMER-PIN.1.0.0-draft.20260904.md").read_text(
        encoding="utf-8"
    )
    assert DRAFT_CANONICAL_NAME in pin
    assert "Do not copy the schema" in pin
    conformance = json.loads(
        (ROOT / "commercial" / "inbound" / "consumer-conformance.1.0.0-draft.20260904.json").read_text(
            encoding="utf-8"
        )
    )
    assert conformance["policy_hash"] == digest
    for _name, row in conformance["fixtures"].items():
        payload = json.loads((ROOT / row["path"]).read_text(encoding="utf-8"))
        computed = "sha256:" + __import__("hashlib").sha256(
            json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()
        assert row["content_hash"] == computed


def test_draft_conflict_hit_and_decline_are_not_coerced_to_clear():
    request = load_fixture("accepted.conflict-hit.draft-20260904.json")
    schema_validate(request, load_json(DRAFT_REQUEST_SCHEMA))
    decision = admit(request)
    _assert_draft_closed_and_safe(decision, request)
    assert decision["decision"] == "ACCEPTED"
    assert decision["conflict_screening"]["status"] == "HIT"
    assert decision["conflict_screening"]["status"] != "CLEAR"
    assert decision["qualification_state"] == "CONFLICT_CHECK_REQUIRED"
    assert decision["conflict_screening"]["protected_ref"] == "conflict:ref:hit:001"
    assert "content" not in (decision.get("conflict_screening") or {})
    assert decision["outbound_eligible"] is False
    assert decision["auto_send"] is False

    decline = deepcopy(request)
    decline["idempotency_key"] = "nihr:web:draft-accepted-conflict-decline-001"
    decline["receipt_id"] = "rcpt_draft_accepted_conflict_decline_001"
    decline["conflict_screening"]["status"] = "DECLINE"
    decline_decision = admit(decline)
    _assert_draft_closed_and_safe(decline_decision, decline)
    assert decline_decision["decision"] == "ACCEPTED"
    assert decline_decision["conflict_screening"]["status"] == "HIT"
    assert decline_decision["conflict_screening"]["status"] != "CLEAR"
    assert decline_decision["qualification_state"] == "CONFLICT_CHECK_REQUIRED"
    assert decline_decision["outbound_eligible"] is False
    assert decline_decision["auto_send"] is False

    for payload in (request, decline):
        coerced = deepcopy(payload)
        coerced["conflict_screening"]["claimed_clear"] = True
        coerced_decision = admit(coerced)
        _assert_draft_closed_and_safe(coerced_decision, coerced)
        assert coerced_decision["decision"] == "REJECTED_WITH_REASON"
        assert "CONFLICT_CLEAR_COERCION_FORBIDDEN" in coerced_decision["reason_codes"]
        assert coerced_decision["conflict_screening"]["status"] != "CLEAR"
        assert coerced_decision["conflict_screening"]["status"] in {"HIT", "UNKNOWN", "NOT_SCREENED"}
        assert coerced_decision["outbound_eligible"] is False
        assert coerced_decision["auto_send"] is False


def _assert_no_commercial_action(decision):
    assert decision["outbound_eligible"] is False
    assert decision["auto_send"] is False
    assert decision["smtp_authorized"] is False
    assert decision["followup_authorized"] is False
    assert decision["mutation_mode"] == "MODEL_ONLY"
    assert decision.get("commercial_action_authorized", False) is False
    for key in (
        "queue_persist_authorized",
        "crm_authorized",
        "checkout_authorized",
        "proposal_authorized",
        "schedule_authorized",
    ):
        if key in decision:
            assert decision[key] is False
    blob = json.dumps(decision)
    for needle in ("smtp://", "CRM_CREATED", "QUEUE_PERSISTED", "PROPOSAL_GENERATED", "SCHEDULED_SEND"):
        assert needle not in blob


def test_draft_closed_classes_never_authorize_commercial_action():
    store = ModelOnlyHandraiserStore()
    assert store.mutation_mode == "MODEL_ONLY"
    accepted_req = load_fixture("accepted.missing-account.draft-20260904.json")
    rejected_req = load_fixture("rejected.consent-refused.draft-20260904.json")
    unknown_req = load_fixture("unknown.unknown-version.draft-20260904.json")
    accepted = admit(accepted_req, store=store)
    rejected = admit(rejected_req, store=store)
    unknown = admit(unknown_req, store=store)
    for decision, request in ((accepted, accepted_req), (rejected, rejected_req), (unknown, unknown_req)):
        _assert_draft_closed_and_safe(decision, request)
        _assert_no_commercial_action(decision)
        assert decision["consumer_authorization"]["smtp_authorized"] is False
        assert decision["consumer_authorization"]["auto_send"] is False
        assert decision["consumer_authorization"]["outbound_eligible"] is False
    assert draft_policy()["evaluation"]["mutation_mode"] == "MODEL_ONLY"
    assert draft_policy()["idempotency"]["production_ledger_authorized"] is False
    assert "crm" in draft_policy()["boundary"]["governance_must_not"]
    assert "commercial_queue" in draft_policy()["boundary"]["governance_must_not"]
    assert "smtp" in draft_policy()["boundary"]["governance_must_not"]
    source = (ROOT / "commercial" / "inbound" / "admit.py").read_text(encoding="utf-8")
    for needle in ("import smtplib", "import httpx", "requests.post", "create_checkout", "create_lead"):
        assert needle not in source


def test_draft_warmbly_and_meetcfg_pins_fail_closed_on_missing_or_divergent():
    live_hash = policy_hash(draft_policy())
    matrix = load_draft_consumer_matrix()
    assert {row["id"] for row in matrix["consumers"]} >= {"Warmbly#47", "MeetCFG#1"}
    assert matrix["policy_hash"] == live_hash

    warmbly = evaluate_consumer_pin(load_fixture("pin.warmbly.matching.draft-20260904.json"))
    meetcfg = evaluate_consumer_pin(load_fixture("pin.meetcfg.matching.draft-20260904.json"))
    for row in (warmbly, meetcfg):
        assert row["decision"] == "ACCEPTED"
        assert row["reason_codes"] == ["ADMISSION_GATES_SATISFIED"]
        assert row["canonical_name"] == DRAFT_CANONICAL_NAME
        assert row["policy_hash"] == live_hash
        _assert_no_commercial_action(row)
        assert row["queue_persist_authorized"] is False
        assert row["crm_authorized"] is False
        assert row["checkout_authorized"] is False
        assert row["proposal_authorized"] is False
        assert row["schedule_authorized"] is False

    missing_hash = evaluate_consumer_pin(load_fixture("pin.warmbly.missing-hash.draft-20260904.json"))
    assert missing_hash["decision"] == "UNKNOWN"
    assert "POLICY_VERSION_MISSING" in missing_hash["reason_codes"]
    _assert_no_commercial_action(missing_hash)

    missing_name = evaluate_consumer_pin(load_fixture("pin.meetcfg.missing-name.draft-20260904.json"))
    assert missing_name["decision"] == "UNKNOWN"
    assert "POLICY_VERSION_MISSING" in missing_name["reason_codes"]
    _assert_no_commercial_action(missing_name)

    divergent_hash = evaluate_consumer_pin(load_fixture("pin.warmbly.divergent-hash.draft-20260904.json"))
    assert divergent_hash["decision"] == "UNKNOWN"
    assert "POLICY_VERSION_UNKNOWN" in divergent_hash["reason_codes"]
    assert divergent_hash["policy_hash"] == live_hash
    _assert_no_commercial_action(divergent_hash)

    divergent_name = evaluate_consumer_pin(load_fixture("pin.meetcfg.divergent-name.draft-20260904.json"))
    assert divergent_name["decision"] == "REJECTED_WITH_REASON"
    assert "POLICY_VERSION_NOT_ADMITTED" in divergent_name["reason_codes"]
    _assert_no_commercial_action(divergent_name)

    mutated = deepcopy(load_fixture("pin.warmbly.matching.draft-20260904.json"))
    mutated["policy_hash"] = live_hash[:-1] + ("0" if live_hash[-1] != "0" else "1")
    mutated_decision = evaluate_consumer_pin(mutated)
    assert mutated_decision["decision"] == "UNKNOWN"
    assert mutated_decision["decision"] != "ACCEPTED"
    _assert_no_commercial_action(mutated_decision)
