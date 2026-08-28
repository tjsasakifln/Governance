from __future__ import annotations

import importlib.util
import sys
from copy import deepcopy
from datetime import date, datetime, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
VALIDATOR_PATH = ROOT / "scripts" / "validate_commercial_authority.py"
EVALUATOR_PATH = ROOT / "commercial" / "outbound" / "first_touch_v3.py"
V1_POLICY = ROOT / "commercial" / "outbound" / "cfg-first-touch-routing.v1.json"
V2_POLICY = ROOT / "commercial" / "outbound" / "cfg-first-touch-routing.v2.json"
V3_POLICY = ROOT / "commercial" / "outbound" / "cfg-first-touch-routing.v3.json"
V2_SCHEMA = ROOT / "schemas" / "cfg-first-touch-routing.v2.schema.json"
V3_SCHEMA = ROOT / "schemas" / "cfg-first-touch-routing.v3.schema.json"
FIXTURE_DIR = ROOT / "commercial" / "fixtures" / "first-touch-routing-v3"
EXPECTATIONS = ROOT / "commercial" / "outbound" / "consumer-expectations.v3.json"
CONSUMER_CONTRACT = ROOT / "commercial" / "CONSUMER-CONTRACT.md"
CONSUMER_HANDOFF = ROOT / "commercial" / "CONSUMER-HANDOFF.md"
ADR = ROOT / "decisions" / "ADR-CFG-FIRST-TOUCH-ROUTING-001.md"

CANONICAL_RULE = (
    "CONFENGE commercial qualification is based on qualifying public engineering "
    "contracting evidence within a rolling three-year window. PNCP/source freshness "
    "is acquisition health and MUST NOT by itself revoke, hold, dequeue or block "
    "transport for an otherwise valid commercially-qualified member."
)


def load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


v = load_module(VALIDATOR_PATH, "validate_commercial_authority")
ev = load_module(EVALUATOR_PATH, "first_touch_v3")

NOW = datetime(2026, 8, 28, 12, 0, 0, tzinfo=timezone.utc)


def policy_v3():
    return v.load_json(V3_POLICY)


def validate_v3(value):
    v.schema_validate(value, v.load_json(V3_SCHEMA))


def clear_flags(**overrides) -> ev.FailClosedFlags:
    payload = {
        "explicit_deactivation": False,
        "membership_leave_proven": False,
        "party_role_conflict": False,
        "recipient_expired": False,
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


def authority(**overrides) -> ev.PopulationAuthority:
    payload = {
        "present": True,
        "contract_version": ev.COMMERCIAL_AUTHORITY_CONTRACT,
        "policy_version": ev.COMMERCIAL_AUTHORITY_POLICY,
        "qualification_window_years": 3,
        "qualification_evidence_hash": "a" * 64,
        "basis_source_run_id": "run-bound",
        "basis_snapshot_hash": "snap-bound",
        "basis_membership_hash": "mem-aaa",
        "basis_publication_semantic_hash": "sem-aaa",
        "producer_identity": "producer-aaa",
        "authority_ref": "commercial-authority/run-bound",
        "authority_hash": "auth-hash-aaa",
        "observed_membership_hash": "mem-aaa",
        "observed_publication_semantic_hash": "sem-aaa",
        "observed_producer_identity": "producer-aaa",
    }
    payload.update(overrides)
    return ev.PopulationAuthority(**payload)


def qualification(
    contract_date: str,
    *,
    party_role: str = "SUPPLIER",
    qualifying_date_field: str = "data_assinatura",
    deactivated: bool = False,
    deactivation_reason: str | None = None,
    qualified_until_override: str | None = None,
    evidence_hash_drift: bool = False,
    contract_dates: tuple[str, ...] = (),
    qualifying_contract_count: int | None = None,
) -> ev.RootQualification:
    derived = ev.qualified_until_for(date.fromisoformat(contract_date)).isoformat()
    root = ev.RootQualification(
        cnpj_root8="12345678",
        target_fit_class="ENGENHARIA_OBRAS",
        party_role=party_role,
        qualifying_contract_id="contrato-0001",
        qualifying_contract_date=contract_date,
        qualifying_date_field=qualifying_date_field,
        qualifying_contract_count=qualifying_contract_count if qualifying_contract_count is not None else 1,
        qualified_until=qualified_until_override or derived,
        qualification_evidence_reference="extra-cli:v_contracts_canonical_v2:contrato-0001",
        provenance="extra-cli:v_contracts_canonical_v2",
        deactivated=deactivated,
        deactivation_reason=deactivation_reason,
        qualifying_contract_dates=tuple(contract_dates),
    )
    digest = ev.hash_root_qualification(root)
    if evidence_hash_drift:
        digest = digest[:-1] + ("0" if digest[-1] != "0" else "1")
    return ev.RootQualification(**{**root.__dict__, "qualification_evidence_hash": digest})


def source(state: str, age_seconds: int | None = 0) -> ev.SourceHealthObservation:
    return ev.SourceHealthObservation(
        declared_state=state,
        crawler_state=state,
        target_fit_maintenance_state=state,
        publication_state=state,
        age_seconds=age_seconds,
        ref="extra-cli/source-health",
    )


def evaluate(requested="CFG-FIRST-TOUCH-ROUTING-v3", **kwargs):
    kwargs.setdefault("authority", authority())
    kwargs.setdefault("fail_closed", clear_flags())
    inp = ev.EvaluationInput(now=NOW, requested_policy_version=requested, **kwargs)
    return ev.evaluate(policy_v3(), inp)


# --------------------------------------------------------------------------
# The published v1 and v2 policies are not reinterpreted by v3.
# --------------------------------------------------------------------------


def test_v3_is_a_new_version_and_does_not_rewrite_v1_or_v2_bytes():
    value = policy_v3()
    validate_v3(value)
    assert value["canonical_name"] == "CFG-FIRST-TOUCH-ROUTING-v3"
    assert value["policy_version"] == "v3"
    assert value["additive_to"] == "CFG-FIRST-TOUCH-ROUTING-v2"
    assert value["v1_history_rewritten"] is False
    assert value["v2_history_rewritten"] is False
    assert V1_POLICY.read_bytes() != V3_POLICY.read_bytes()
    assert V2_POLICY.read_bytes() != V3_POLICY.read_bytes()
    # v2 still validates against its own schema, byte for byte.
    v.schema_validate(v.load_json(V2_POLICY), v.load_json(V2_SCHEMA))
    assert v.load_json(V2_POLICY)["canonical_name"] == "CFG-FIRST-TOUCH-ROUTING-v2"
    unknown = deepcopy(value)
    unknown["silent_auto_send"] = True
    with pytest.raises(v.ValidationError, match="unknown critical field"):
        validate_v3(unknown)


def test_v3_states_the_canonical_rule_verbatim():
    assert policy_v3()["canonical_rule"] == CANONICAL_RULE
    assert CANONICAL_RULE in v.load_json(EXPECTATIONS)["canonical_rule"]
    for doc in (CONSUMER_CONTRACT, CONSUMER_HANDOFF, ADR):
        assert CANONICAL_RULE in doc.read_text(encoding="utf-8"), doc.name


def test_v3_abolishes_the_v1_age_bands_and_every_ttl():
    block = policy_v3()["commercial_qualification"]
    assert block["states"] == ["QUALIFIED", "EXPIRED", "REVOKED", "UNKNOWN"]
    assert block["ttl_seconds"] is None
    assert block["grace_period_seconds"] is None
    assert block["v1_age_bands_abolished"] is True
    assert block["abolished_v1_bands"] == ["CURRENT", "DEGRADED", "FROZEN_FOR_NEW_ADMISSION", "EXPIRED_BY_AGE"]
    assert policy_v3()["revocation"]["grace_period_seconds"] is None
    assert "frozen_for_new_admission" not in policy_v3()
    assert block["rolling_window_years"] == 3
    assert ev.COMMERCIAL_STATES == ("QUALIFIED", "EXPIRED", "REVOKED", "UNKNOWN")


def test_v1_v2_and_unknown_version_strings_do_not_activate_v3():
    for requested in (None, "", "v1", "CFG-FIRST-TOUCH-ROUTING-v1", "v2", "CFG-FIRST-TOUCH-ROUTING-v2", "v9"):
        result = evaluate(
            requested=requested,
            source_health=source("FRESH", 10),
            qualification=qualification("2025-06-02"),
        )
        assert result["activated"] is False, requested
        assert result["commercial_qualification"]["transport_allowed"] is False
        assert result["smtp_send_allowed"] is False
        assert result["provider_dispatch_authorized"] is False
    for requested in ("v3", "CFG-FIRST-TOUCH-ROUTING-v3"):
        assert evaluate(requested=requested, source_health=source("FRESH", 10), qualification=qualification("2025-06-02"))["activated"] is True


# --------------------------------------------------------------------------
# (a) STALE source + valid commercial authority is not blocked.
# --------------------------------------------------------------------------


def test_stale_source_with_valid_commercial_authority_is_not_blocked():
    result = evaluate(
        source_health=source("STALE", 1_200_000),
        qualification=qualification("2024-01-15"),
    )
    assert result["source_health"]["state"] == "STALE"
    assert result["source_health"]["is_commercial_decision"] is False
    assert result["source_health"]["is_transport_blocker"] is False
    assert result["commercial_qualification"]["state"] == "QUALIFIED"
    assert result["commercial_qualification"]["transport_allowed"] is True
    assert result["commercial_qualification"]["new_admission_allowed"] is True
    assert result["transport_conjunction"]["passed"] is True
    assert ev.REMOVED_READINESS_BLOCKER not in result["reason_codes"]
    assert ev.REASON_MISSING not in result["reason_codes"]
    assert result["exception_reason_groups"] == []
    # The stale feed is reported as an acquisition-plan condition, not a block.
    assert result["source_health"]["presentation_class"] == "ACQUISITION_PLAN"
    assert result["source_health"]["acquisition_plan_condition"] == ev.ACQUISITION_PLAN_CONDITION_PT_BR
    assert "bloquead" not in result["source_health"]["acquisition_plan_condition"].lower()


def test_source_health_is_outside_the_transport_conjunction():
    policy = policy_v3()
    assert policy["transport_authority"]["source_health_in_transport_conjunction"] is False
    members = policy["transport_conjunction"]["members"]
    for excluded in policy["transport_conjunction"]["excluded_members"]:
        assert excluded not in members
    assert "commercial_qualification_three_year_rule" in members
    assert "supplier_party_role" in members
    assert policy["fail_closed_blockers"]["source_health_is_never_a_blocker"] is True
    for state in ("FRESH", "DEGRADED", "STALE", "MISSING", "UNKNOWN"):
        result = evaluate(source_health=source(state, None), qualification=qualification("2025-06-02"))
        assert result["commercial_qualification"]["transport_allowed"] is True, state
        assert ev.REMOVED_READINESS_BLOCKER not in result["reason_codes"], state


def test_first_window_verdict_accepts_stale_source_with_qualified_authority():
    armed = ev.project_first_window_verdict(
        commercial_state="QUALIFIED", source_state="STALE", in_send_window=False
    )
    assert armed["verdict"] == "ARMED_FOR_NEXT_BUSINESS_WINDOW"
    assert armed["blockers"] == []
    assert armed["source_health_is_blocker"] is False
    assert armed["acquisition_plan_condition"] == ev.ACQUISITION_PLAN_CONDITION_PT_BR

    active = ev.project_first_window_verdict(
        commercial_state="QUALIFIED", source_state="STALE", in_send_window=True
    )
    assert active["verdict"] == "TRANSPORT_ACTIVE_IN_WINDOW"
    assert active["blockers"] == []

    retired = ev.project_first_window_verdict(
        commercial_state="QUALIFIED",
        source_state="STALE",
        in_send_window=True,
        blockers=[ev.REMOVED_READINESS_BLOCKER],
    )
    assert retired["verdict"] == "TRANSPORT_ACTIVE_IN_WINDOW"
    assert retired["blockers"] == []


def test_readiness_never_carries_the_retired_freshness_blocker():
    ready = ev.project_first_commercial_window_readiness(v.load_json(FIXTURE_DIR / "readiness-ready.v1.json"))
    assert ready["decision"] == "READY_FOR_FINAL_CONVERGENCE"
    assert ready["blocking_reasons"] == []

    stale = ev.project_first_commercial_window_readiness(
        v.load_json(FIXTURE_DIR / "readiness-stale-source-qualified.v1.json")
    )
    assert stale["decision"] == "READY_FOR_FINAL_CONVERGENCE"
    assert ev.REMOVED_READINESS_BLOCKER not in stale["blocking_reasons"]

    blocked = ev.project_first_commercial_window_readiness(v.load_json(FIXTURE_DIR / "readiness-blocked.v1.json"))
    assert blocked["decision"] == "BLOCKED"
    assert "CONTROL_CENTER_READBACK_NOT_PROVEN" in blocked["blocking_reasons"]
    assert blocked["smtp_authorized"] is False


# --------------------------------------------------------------------------
# (b) FRESH source without commercial authority is never authorized.
# --------------------------------------------------------------------------


def test_fresh_source_without_commercial_authority_is_not_authorized():
    missing_population = evaluate(
        source_health=source("FRESH", 10),
        authority=ev.PopulationAuthority(present=False),
        qualification=qualification("2025-06-02"),
    )
    assert missing_population["source_health"]["state"] == "FRESH"
    assert missing_population["commercial_qualification"]["state"] == "UNKNOWN"
    assert missing_population["commercial_qualification"]["transport_allowed"] is False
    assert ev.REASON_MISSING in missing_population["reason_codes"]

    missing_root = evaluate(source_health=source("FRESH", 10), qualification=None)
    assert missing_root["commercial_qualification"]["state"] == "UNKNOWN"
    assert missing_root["commercial_qualification"]["new_admission_allowed"] is False
    assert ev.REASON_MISSING in missing_root["reason_codes"]

    unsupported = evaluate(
        source_health=source("FRESH", 10),
        authority=authority(policy_version="COMMERCIAL_AUTHORITY_POLICY/1.0", contract_version="COMMERCIAL_AUTHORITY/1.0"),
        qualification=qualification("2025-06-02"),
    )
    assert unsupported["commercial_qualification"]["transport_allowed"] is False
    assert ev.REASON_POLICY_UNSUPPORTED in unsupported["reason_codes"]


def test_freshness_never_grants_authority_by_fallback():
    policy = policy_v3()
    assert policy["separated_authorities"]["source_freshness_grants_commercial_authority_by_fallback"] is False
    assert policy["hard_gates"]["evidence"]["source_freshness_required"] is False
    assert policy["hard_gates"]["identity_and_party_role"]["source_health_must_be_fresh"] is False
    for state in ("FRESH", "DEGRADED", "STALE", "MISSING", "UNKNOWN"):
        result = evaluate(source_health=source(state, 10), qualification=None)
        assert result["commercial_qualification"]["transport_allowed"] is False, state
        assert ev.REASON_MISSING in result["reason_codes"], state


# --------------------------------------------------------------------------
# (c) The rolling three-year window.
# --------------------------------------------------------------------------


def test_contract_outside_the_three_year_window_is_not_qualified():
    outside = evaluate(source_health=source("FRESH", 10), qualification=qualification("2022-08-27"))
    assert outside["commercial_qualification"]["state"] == "EXPIRED"
    assert outside["commercial_qualification"]["transport_allowed"] is False
    assert ev.REASON_EXPIRED in outside["reason_codes"]

    # 2023-08-29 + 3y = 2026-08-29, still ahead of the 2026-08-28 clock.
    inside = evaluate(source_health=source("FRESH", 10), qualification=qualification("2023-08-29"))
    assert inside["commercial_qualification"]["state"] == "QUALIFIED"
    assert inside["commercial_qualification"]["qualified_until"] == "2026-08-29"

    # 2023-08-28 + 3y = 2026-08-28, which is today: the window has closed.
    edge = evaluate(source_health=source("FRESH", 10), qualification=qualification("2023-08-28"))
    assert edge["commercial_qualification"]["state"] == "EXPIRED"


def test_qualified_until_is_derived_and_never_declared_by_the_producer():
    assert ev.qualified_until_for(date(2024, 2, 29)) == date(2027, 3, 1)
    assert ev.qualified_until_for(date(2025, 6, 2)) == date(2028, 6, 2)
    assert policy_v3()["commercial_qualification"]["qualified_until_declared_by_producer"] is False
    declared = evaluate(
        source_health=source("FRESH", 10),
        qualification=qualification("2022-08-27", qualified_until_override="2030-01-01"),
    )
    assert declared["commercial_qualification"]["transport_allowed"] is False
    assert ev.REASON_WINDOW_INVALID in declared["reason_codes"]

    leap = qualification("2024-02-29")
    assert leap.qualified_until == "2027-03-01"
    assert evaluate(source_health=source("FRESH", 10), qualification=leap)["commercial_qualification"]["state"] == "QUALIFIED"


def test_qualifying_date_precedence_excludes_data_fim():
    assert ev.QUALIFYING_DATE_PRECEDENCE == (
        "data_assinatura",
        "data_inicio",
        "data_publicacao",
        "data_publicacao_fonte",
    )
    assert ev.EXCLUDED_DATE_FIELDS == ("data_fim",)
    block = policy_v3()["commercial_qualification"]
    assert block["qualifying_date_precedence"] == list(ev.QUALIFYING_DATE_PRECEDENCE)
    assert block["excluded_date_fields"] == ["data_fim"]
    assert block["qualifying_source_view"] == "v_contracts_canonical_v2"
    for field_name in ev.QUALIFYING_DATE_PRECEDENCE:
        ok = evaluate(
            source_health=source("FRESH", 10),
            qualification=qualification("2025-06-02", qualifying_date_field=field_name),
        )
        assert ok["commercial_qualification"]["state"] == "QUALIFIED", field_name
        assert ok["commercial_qualification"]["qualifying_date_field"] == field_name
    rejected = evaluate(
        source_health=source("FRESH", 10),
        qualification=qualification("2025-06-02", qualifying_date_field="data_fim"),
    )
    assert rejected["commercial_qualification"]["transport_allowed"] is False
    assert ev.REASON_EVIDENCE_DRIFT in rejected["reason_codes"]


def test_several_qualifying_contracts_keep_the_company_qualified():
    many = evaluate(
        source_health=source("STALE", 900_000),
        qualification=qualification(
            "2025-02-10",
            contract_dates=("2019-04-01", "2021-11-30", "2025-02-10"),
            qualifying_contract_count=3,
        ),
    )
    assert many["commercial_qualification"]["state"] == "QUALIFIED"
    assert many["commercial_qualification"]["qualifying_contract_count"] == 3

    all_old = evaluate(
        source_health=source("FRESH", 10),
        qualification=qualification(
            "2021-11-30",
            contract_dates=("2019-04-01", "2021-11-30"),
            qualifying_contract_count=2,
        ),
    )
    assert all_old["commercial_qualification"]["state"] == "EXPIRED"

    # Declaring an older act while a newer one exists is evidence drift.
    understated = evaluate(
        source_health=source("FRESH", 10),
        qualification=qualification(
            "2021-11-30",
            contract_dates=("2021-11-30", "2025-02-10"),
            qualifying_contract_count=2,
        ),
    )
    assert ev.REASON_EVIDENCE_DRIFT in understated["reason_codes"]


# --------------------------------------------------------------------------
# (d) The contracting body never qualifies.
# --------------------------------------------------------------------------


def test_buyer_or_contracting_body_is_never_qualified():
    for role in ("BUYER", "CONTRACTING_AUTHORITY", "CONTRATANTE", "ORGAO"):
        result = evaluate(
            source_health=source("FRESH", 10),
            qualification=qualification("2025-06-02", party_role=role),
        )
        assert result["commercial_qualification"]["state"] == "UNKNOWN", role
        assert result["commercial_qualification"]["transport_allowed"] is False, role
        assert ev.REASON_ROLE_INVALID in result["reason_codes"], role
    for role in ("SUPPLIER", "FORNECEDORA", "CONTRATADA"):
        ok = evaluate(
            source_health=source("FRESH", 10),
            qualification=qualification("2025-06-02", party_role=role),
        )
        assert ok["commercial_qualification"]["state"] == "QUALIFIED", role
    block = policy_v3()["commercial_qualification"]
    assert block["qualifying_party_role"] == "SUPPLIER"
    assert block["contracting_body_never_qualifies"] is True
    assert block["forbidden_party_roles"] == ["BUYER", "CONTRACTING_AUTHORITY", "CONTRATANTE", "ORGAO"]


# --------------------------------------------------------------------------
# (e) Explicit revocation blocks.
# --------------------------------------------------------------------------


def test_explicit_revocation_blocks_immediately():
    deactivated = evaluate(
        source_health=source("FRESH", 10),
        qualification=qualification("2025-06-02", deactivated=True, deactivation_reason="founder removed the account"),
    )
    assert deactivated["commercial_qualification"]["state"] == "REVOKED"
    assert deactivated["commercial_qualification"]["transport_allowed"] is False
    assert ev.REASON_REVOKED in deactivated["reason_codes"]

    flagged = evaluate(
        source_health=source("FRESH", 10),
        qualification=qualification("2025-06-02"),
        fail_closed=clear_flags(explicit_deactivation=True),
    )
    assert flagged["commercial_qualification"]["state"] == "REVOKED"
    assert flagged["commercial_qualification"]["transport_allowed"] is False
    assert "EXPLICIT_DEACTIVATION" in flagged["reason_codes"]

    producer = evaluate(
        source_health=source("FRESH", 10),
        authority=authority(revoked=True),
        qualification=qualification("2025-06-02"),
    )
    assert producer["commercial_qualification"]["state"] == "REVOKED"
    assert producer["commercial_qualification"]["transport_allowed"] is False

    assert policy_v3()["revocation"]["explicit_deactivation_blocks_immediately"] is True
    assert policy_v3()["revocation"]["time_alone_restores_nothing"] is True


# --------------------------------------------------------------------------
# Compliance conjunction, evidence integrity, audit, canary.
# --------------------------------------------------------------------------


def test_every_operator_blocker_holds_a_qualified_member():
    codes = policy_v3()["fail_closed_blockers"]["operator_flag_codes"]
    for code in codes:
        result = evaluate(
            source_health=source("FRESH", 10),
            qualification=qualification("2025-06-02"),
            fail_closed=clear_flags(**{ev.FAIL_CLOSED_FLAG_MAP[code]: True}),
        )
        assert result["commercial_qualification"]["transport_allowed"] is False, code
        assert result["commercial_qualification"]["new_admission_allowed"] is False, code
        assert code in result["reason_codes"], code
        assert result["transport_conjunction"]["passed"] is False, code

    unknown = evaluate(
        source_health=source("FRESH", 10),
        qualification=qualification("2025-06-02"),
        fail_closed=ev.FailClosedFlags(),
    )
    assert unknown["commercial_qualification"]["transport_allowed"] is False
    assert any(item.endswith("_UNKNOWN") for item in unknown["reason_codes"])


def test_evidence_and_binding_drift_fail_closed():
    drifted = evaluate(
        source_health=source("FRESH", 10),
        qualification=qualification("2025-06-02", evidence_hash_drift=True),
    )
    assert drifted["commercial_qualification"]["transport_allowed"] is False
    assert ev.REASON_EVIDENCE_DRIFT in drifted["reason_codes"]

    for field_name in ("observed_membership_hash", "observed_publication_semantic_hash", "observed_producer_identity"):
        mismatch = evaluate(
            source_health=source("FRESH", 10),
            authority=authority(**{field_name: "drifted-value"}),
            qualification=qualification("2025-06-02"),
        )
        assert mismatch["commercial_qualification"]["transport_allowed"] is False, field_name
        assert "BINDING_MISMATCH" in mismatch["reason_codes"], field_name

    bad_window = evaluate(
        source_health=source("FRESH", 10),
        authority=authority(qualification_window_years=5),
        qualification=qualification("2025-06-02"),
    )
    assert bad_window["commercial_qualification"]["transport_allowed"] is False
    assert ev.REASON_WINDOW_INVALID in bad_window["reason_codes"]


def test_delegated_v3_audit_fields_and_no_forged_human():
    required = set(policy_v3()["audit"]["required_fields"])
    expected = {
        "policy_id",
        "policy_version",
        "commercial_authority_policy_version",
        "commercial_qualification_state",
        "cnpj_root8",
        "party_role",
        "qualifying_contract_id",
        "qualifying_contract_date",
        "qualifying_date_field",
        "qualifying_contract_count",
        "qualified_until",
        "qualification_evidence_hash",
        "qualification_evidence_reference",
        "recipient",
        "route_class",
        "idempotency_key",
        "runtime_release_sha",
    }
    assert expected.issubset(required)
    record = {name: f"value-{name}" for name in required}
    record["reason_codes"] = ["ALL_HARD_GATES_PASS"]
    record["contract_role_reason_codes"] = ["CONTRACTOR_ROLE_CONFIRMED"]
    assert ev.validate_delegated_decision(policy_v3(), record) == []
    forged = dict(record, human_approved_by="founder")
    assert "HUMAN_ACTOR_FORGED" in ev.validate_delegated_decision(policy_v3(), forged)
    assert set(required).issubset(ev.validate_delegated_decision(policy_v3(), {}))


def test_v3_never_authorizes_smtp_or_provider_dispatch():
    policy = policy_v3()
    assert policy["scope"]["provider_dispatch_authorized"] is False
    assert policy["scope"]["followups_authorized"] is False
    assert policy["canary"]["smtp_send_allowed"] is False
    assert policy["canary"]["sent_count_required"] == 0
    result = evaluate(
        source_health=source("FRESH", 10),
        qualification=qualification("2025-06-02"),
        transport=ev.TransportObservation(first_window_go=True, paused=False, kill_switch=False),
    )
    assert result["smtp_send_allowed"] is False
    assert result["provider_dispatch_authorized"] is False
    assert result["transport_authority"]["first_window_go"] is False
    weakened = policy_v3()
    weakened["scope"]["provider_dispatch_authorized"] = True
    with pytest.raises(v.ValidationError):
        validate_v3(weakened)


def test_pause_actor_absent_is_unknown_not_invented():
    result = evaluate(
        source_health=source("FRESH", 10),
        qualification=qualification("2025-06-02"),
        transport=ev.TransportObservation(paused=True, pause_reason="founder hold"),
    )
    assert result["transport_authority"]["paused_by"] == "UNKNOWN"
    assert result["transport_authority"]["pause_source"] == "UNKNOWN"


def test_contract_fixtures_cover_the_v3_matrix():
    cases = v.load_json(FIXTURE_DIR / "matrix.v1.json")
    declared = set(v.load_json(EXPECTATIONS)["cases"])
    assert {row["case_id"] for row in cases} == declared
    for row in cases:
        bind = row.get("qualification")
        root = None
        if bind:
            root = qualification(
                bind["contract_date"],
                party_role=bind.get("party_role", "SUPPLIER"),
                qualifying_date_field=bind.get("qualifying_date_field", "data_assinatura"),
                deactivated=bool(bind.get("deactivated")),
                deactivation_reason=bind.get("deactivation_reason"),
                qualified_until_override=bind.get("qualified_until_override"),
                evidence_hash_drift=bool(bind.get("evidence_hash_drift")),
                contract_dates=tuple(bind.get("contract_dates", ())),
                qualifying_contract_count=bind.get("qualifying_contract_count"),
            )
        auth_payload = row.get("authority")
        auth = ev.PopulationAuthority(present=False) if auth_payload is not None and auth_payload.get("present") is False else authority(**{k: val for k, val in (auth_payload or {}).items() if k != "present"})
        obs = row["source_health"]
        result = evaluate(
            requested=row["requested_policy"],
            source_health=source(obs["state"], obs.get("age_seconds")),
            authority=auth,
            qualification=root,
            fail_closed=clear_flags(**row.get("fail_closed", {})),
            transport=ev.TransportObservation(**row.get("transport", {})),
        )
        expect = row["expect"]
        assert result["activated"] is expect["activated"], row["case_id"]
        assert result["source_health"]["state"] == expect["source_state"], row["case_id"]
        assert result["commercial_qualification"]["state"] == expect["commercial_state"], row["case_id"]
        assert result["commercial_qualification"]["new_admission_allowed"] is expect["new_admission_allowed"], row["case_id"]
        assert result["commercial_qualification"]["transport_allowed"] is expect["transport_allowed"], row["case_id"]
        for code in expect.get("reason_codes_contains", []):
            assert code in result["reason_codes"], f"{row['case_id']} missing {code}"
        for code in expect.get("reason_codes_excludes", []):
            assert code not in result["reason_codes"], f"{row['case_id']} must not emit {code}"
        assert result["smtp_send_allowed"] is False
        assert result["provider_dispatch_authorized"] is False


def test_source_health_readback_is_acquisition_plan_never_an_outbound_block():
    policy = policy_v3()
    health = policy["source_operational_health"]
    assert health["presentation_class"] == "ACQUISITION_PLAN"
    assert health["is_transport_blocker"] is False
    assert health["is_admission_blocker"] is False
    assert health["founder_readback_pt_br"] == ev.ACQUISITION_PLAN_CONDITION_PT_BR
    assert health["replaced_readiness_blocker"] == {
        "removed": ev.REMOVED_READINESS_BLOCKER,
        "replacement": ev.REASON_MISSING,
    }
    for forbidden in health["forbidden_founder_readback_pt_br"]:
        assert forbidden in ev.FORBIDDEN_SOURCE_HEALTH_READBACKS
        for state in ("FRESH", "DEGRADED", "STALE", "MISSING", "UNKNOWN"):
            assert forbidden not in ev.acquisition_plan_condition(state)
    assert ev.acquisition_plan_condition("DEGRADED") == ev.ACQUISITION_PLAN_CONDITION_PT_BR
    assert ev.acquisition_plan_condition("STALE") == ev.ACQUISITION_PLAN_CONDITION_PT_BR
    assert ev.acquisition_plan_condition("FRESH") == ev.ACQUISITION_PLAN_FRESH_PT_BR
