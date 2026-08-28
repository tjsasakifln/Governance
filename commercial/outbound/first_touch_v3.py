"""Pure evaluator for CFG-FIRST-TOUCH-ROUTING-v3 (COMMERCIAL_AUTHORITY/2.0).

v3 replaces the v2 age bands with the canonical CONFENGE rule: a company is
commercially qualified when public evidence shows it was the CONTRACTED
SUPPLIER on a public engineering work or service whose contracting act falls
inside a rolling three-year window. There is no TTL and no grace period.

Source/PNCP freshness is acquisition health. It is observed and alarmable, it
is never a commercial decision, it never revokes a proven qualification, and it
never grants authority by fallback. This module never authorizes SMTP or
provider dispatch.
"""

from __future__ import annotations

import calendar
import hashlib
import importlib.util
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Mapping, Sequence


def _load_adapter():
    path = Path(__file__).resolve().with_name("commercial_authority_adapter.py")
    spec = importlib.util.spec_from_file_location("commercial_authority_adapter", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_adapter = _load_adapter()
adapt_commercial_authority = _adapter.adapt_commercial_authority

POLICY_CANONICAL = "CFG-FIRST-TOUCH-ROUTING-v3"
POLICY_VERSION = "v3"
V1_CANONICAL = "CFG-FIRST-TOUCH-ROUTING-v1"
V2_CANONICAL = "CFG-FIRST-TOUCH-ROUTING-v2"

COMMERCIAL_AUTHORITY_CONTRACT = "COMMERCIAL_AUTHORITY/2.0"
COMMERCIAL_AUTHORITY_POLICY = "COMMERCIAL_AUTHORITY_POLICY/2.0"
QUALIFICATION_WINDOW_YEARS = 3

SOURCE_STATES = ("FRESH", "DEGRADED", "STALE", "MISSING", "UNKNOWN")
SOURCE_RANK = {"FRESH": 0, "DEGRADED": 1, "STALE": 2, "MISSING": 3}

COMMERCIAL_STATES = ("QUALIFIED", "EXPIRED", "REVOKED", "UNKNOWN")
QUALIFIED = "QUALIFIED"
EXPIRED = "EXPIRED"
REVOKED = "REVOKED"
UNKNOWN = "UNKNOWN"

PARTY_ROLE_SUPPLIER = "SUPPLIER"
SUPPLIER_ROLE_ALIASES = ("SUPPLIER", "FORNECEDORA", "CONTRATADA")
FORBIDDEN_PARTY_ROLES = ("BUYER", "CONTRACTING_AUTHORITY", "CONTRATANTE", "ORGAO")

QUALIFYING_DATE_PRECEDENCE = (
    "data_assinatura",
    "data_inicio",
    "data_publicacao",
    "data_publicacao_fonte",
)
EXCLUDED_DATE_FIELDS = ("data_fim",)

# Runtime reason codes. Same spelling as the Warmbly fail-closed reasons.
REASON_MISSING = "commercial_authority_missing"
REASON_EXPIRED = "commercial_qualification_expired"
REASON_REVOKED = "commercial_qualification_revoked"
REASON_EVIDENCE_DRIFT = "commercial_qualification_evidence_drift"
REASON_ROLE_INVALID = "commercial_qualification_party_role_invalid"
REASON_WINDOW_INVALID = "commercial_qualification_window_invalid"
REASON_POLICY_UNSUPPORTED = "commercial_authority_policy_unsupported"
REASON_QUALIFIED = "COMMERCIAL_QUALIFIED"

# The v1 blocker this policy retires. Source health may never emit a blocker.
REMOVED_READINESS_BLOCKER = "source_health_not_fresh_strict_fallback"

QUALIFICATION_BLOCKER_FOR_REASON = {
    REASON_MISSING: "COMMERCIAL_QUALIFICATION_MISSING",
    REASON_EXPIRED: "COMMERCIAL_QUALIFICATION_EXPIRED",
    REASON_REVOKED: "COMMERCIAL_QUALIFICATION_REVOKED",
    REASON_EVIDENCE_DRIFT: "COMMERCIAL_QUALIFICATION_EVIDENCE_DRIFT",
    REASON_ROLE_INVALID: "COMMERCIAL_QUALIFICATION_PARTY_ROLE_INVALID",
    REASON_WINDOW_INVALID: "COMMERCIAL_QUALIFICATION_WINDOW_INVALID",
    REASON_POLICY_UNSUPPORTED: "COMMERCIAL_AUTHORITY_POLICY_UNSUPPORTED",
}

FAIL_CLOSED_FLAG_MAP = {
    "EXPLICIT_DEACTIVATION": "explicit_deactivation",
    "MEMBERSHIP_LEAVE_PROVEN": "membership_leave_proven",
    "PARTY_ROLE_CONFLICT": "party_role_conflict",
    "RECIPIENT_EXPIRED": "recipient_expired",
    "SUPPRESSION": "suppression",
    "OPT_OUT_DNC": "opt_out_or_dnc",
    "HARD_BOUNCE": "hard_bounce",
    "COMPLIANCE_RISK": "compliance_risk",
    "POLICY_DRIFT": "policy_drift",
    "BINDING_MISMATCH": "binding_mismatch",
    "TRANSPORT_BLOCKED": "transport_blocked",
}

EXCEPTION_REASON_GROUPS = (
    "COMMERCIAL_QUALIFICATION_EXPIRED",
    "COMMERCIAL_QUALIFICATION_REVOKED",
    "COMMERCIAL_QUALIFICATION_EVIDENCE_DRIFT",
    "COMMERCIAL_QUALIFICATION_PARTY_ROLE_INVALID",
    "COMMERCIAL_QUALIFICATION_WINDOW_INVALID",
    "COMMERCIAL_AUTHORITY_POLICY_UNSUPPORTED",
    "MEMBERSHIP_DRIFT",
    "RECIPIENT_EXPIRED",
    "PARTY_ROLE_CONFLICT",
    "SUPPRESSION",
    "POLICY_DRIFT",
    "TRANSPORT_BLOCKED",
    "READBACK_UNKNOWN",
)

# Founder-facing readback for a late acquisition source. A stale market feed is
# an acquisition-plan condition, never an outbound block.
ACQUISITION_PLAN_CONDITION_PT_BR = (
    "Atualização de mercado atrasada; novos leads podem não estar refletidos."
)
ACQUISITION_PLAN_UNKNOWN_PT_BR = (
    "Atualização de mercado não observada; novos leads podem não estar refletidos."
)
ACQUISITION_PLAN_FRESH_PT_BR = "Atualização de mercado em dia."
FORBIDDEN_SOURCE_HEALTH_READBACKS = (
    "Outbound bloqueado.",
    "Outbound bloqueado",
    "OUTBOUND BLOQUEADO",
)


def parse_utc(value: str | None) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    raw = value[:-1] + "+00:00" if value.endswith("Z") else value
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def parse_qualifying_date(value: str | None) -> date | None:
    """Accept a bare contracting date or a full timestamp. Never a duration."""
    if not value or not isinstance(value, str):
        return None
    text = value.strip()
    if not text:
        return None
    moment = parse_utc(text)
    if moment is not None:
        return moment.date()
    try:
        return date.fromisoformat(text)
    except ValueError:
        return None


def add_years_forward(day: date, years: int) -> date:
    """Go's AddDate normalization: 2024-02-29 + 3y is 2027-03-01, never 02-28."""
    year = day.year + years
    last = calendar.monthrange(year, day.month)[1]
    if day.day <= last:
        return date(year, day.month, day.day)
    overflow = day.day - last
    month = day.month + 1
    if month > 12:
        month, year = 1, year + 1
    return date(year, month, overflow)


def qualified_until_for(contract_date: date) -> date:
    """Derived expiry of one qualifying fact. No grace period is ever added."""
    return add_years_forward(contract_date, QUALIFICATION_WINDOW_YEARS)


def within_qualification_window(contract_date: date, now: datetime) -> bool:
    return now.astimezone(timezone.utc).date() < qualified_until_for(contract_date)


def age_seconds(now: datetime, then: datetime | None) -> int | None:
    if then is None:
        return None
    return int((now - then).total_seconds())


def _in_closed(age: int, band: Mapping[str, Any]) -> bool:
    return int(band["min_inclusive"]) <= age <= int(band["max_inclusive"])


def _in_open_closed(age: int, band: Mapping[str, Any]) -> bool:
    return int(band["min_exclusive"]) < age <= int(band["max_inclusive"])


def _in_open(age: int, band: Mapping[str, Any]) -> bool:
    return age > int(band["min_exclusive"])


def classify_source_age(age: int | None, bands: Mapping[str, Any]) -> str:
    if age is None or age < 0:
        return "UNKNOWN"
    if _in_closed(age, bands["FRESH"]):
        return "FRESH"
    if _in_open_closed(age, bands["DEGRADED"]):
        return "DEGRADED"
    if _in_open(age, bands["STALE"]):
        return "STALE"
    return "UNKNOWN"


def acquisition_plan_condition(source_state: str) -> str:
    """Source health rendered for the founder. Never an outbound verdict."""
    if source_state == "FRESH":
        return ACQUISITION_PLAN_FRESH_PT_BR
    if source_state in ("DEGRADED", "STALE"):
        return ACQUISITION_PLAN_CONDITION_PT_BR
    return ACQUISITION_PLAN_UNKNOWN_PT_BR


def activates_v3(requested: str | None, policy: Mapping[str, Any]) -> bool:
    accepted = tuple(policy["activation"]["accepted_version_strings"])
    if not requested:
        return False
    if requested in ("v1", V1_CANONICAL, "v2", V2_CANONICAL, "CFG-FIRST-TOUCH-ROUTING"):
        return False
    return requested in accepted


def recognized_authority_policy(version: str | None) -> bool:
    """Only the versions this policy actually implements. Unknown fails closed."""
    return (version or "").strip() in (COMMERCIAL_AUTHORITY_POLICY, COMMERCIAL_AUTHORITY_CONTRACT)


@dataclass(frozen=True)
class SourceHealthObservation:
    declared_state: str | None = None
    crawler_state: str | None = None
    target_fit_maintenance_state: str | None = None
    publication_state: str | None = None
    age_seconds: int | None = None
    lag_seconds: int | None = None
    ref: str | None = None


@dataclass(frozen=True)
class RootQualification:
    """The per-CNPJ-root qualifying fact, exactly as the producer persists it."""

    cnpj_root8: str | None = None
    target_fit_class: str | None = None
    party_role: str | None = None
    qualifying_contract_id: str | None = None
    qualifying_contract_date: str | None = None
    qualifying_date_field: str | None = None
    qualifying_contract_count: int | None = None
    qualified_until: str | None = None
    qualification_evidence_hash: str | None = None
    qualification_evidence_reference: str | None = None
    provenance: str | None = None
    deactivated: bool = False
    deactivation_reason: str | None = None
    # Every contracting act the producer counted. The declared qualifying date
    # must be the newest of these, so "at least one inside the window" stays
    # deterministic instead of depending on which row the producer looked at.
    qualifying_contract_dates: tuple[str, ...] = ()


@dataclass(frozen=True)
class PopulationAuthority:
    """The extra-cli population attestation. It carries no TTL."""

    present: bool = False
    contract_version: str | None = COMMERCIAL_AUTHORITY_CONTRACT
    policy_version: str | None = COMMERCIAL_AUTHORITY_POLICY
    qualification_window_years: int | None = QUALIFICATION_WINDOW_YEARS
    qualification_evidence_hash: str | None = None
    basis_source_run_id: str | None = None
    basis_snapshot_hash: str | None = None
    basis_membership_hash: str | None = None
    basis_publication_semantic_hash: str | None = None
    producer_identity: str | None = None
    authority_ref: str | None = None
    authority_hash: str | None = None
    observed_membership_hash: str | None = None
    observed_publication_semantic_hash: str | None = None
    observed_producer_identity: str | None = None
    revoked: bool = False

    def wire(self) -> dict[str, Any]:
        return {
            "basis_source_run_id": self.basis_source_run_id,
            "basis_snapshot_hash": self.basis_snapshot_hash,
            "basis_membership_hash": self.basis_membership_hash,
            "basis_publication_semantic_hash": self.basis_publication_semantic_hash,
            "producer_identity": self.producer_identity,
            "authority_hash": self.authority_hash,
        }


@dataclass(frozen=True)
class FailClosedFlags:
    explicit_deactivation: bool | None = None
    membership_leave_proven: bool | None = None
    party_role_conflict: bool | None = None
    recipient_expired: bool | None = None
    suppression: bool | None = None
    opt_out_or_dnc: bool | None = None
    hard_bounce: bool | None = None
    compliance_risk: bool | None = None
    policy_drift: bool | None = None
    binding_mismatch: bool | None = None
    transport_blocked: bool | None = None


@dataclass(frozen=True)
class TransportObservation:
    mailbox_eligible: bool | None = None
    rates_observed: bool | None = None
    min_wait_observed: bool | None = None
    business_window_observed: bool | None = None
    paused: bool | None = None
    pause_reason: str | None = None
    paused_by: str | None = None
    paused_at: str | None = None
    pause_source: str | None = None
    kill_switch: bool | None = None
    suppression_clear: bool | None = None
    worker_provider_observed: bool | None = None
    first_window_go: bool | None = None
    snapshot_ref: str | None = None


@dataclass(frozen=True)
class EvaluationInput:
    now: datetime
    requested_policy_version: str | None
    source_health: SourceHealthObservation = field(default_factory=SourceHealthObservation)
    authority: PopulationAuthority = field(default_factory=PopulationAuthority)
    qualification: RootQualification | None = None
    fail_closed: FailClosedFlags = field(default_factory=FailClosedFlags)
    transport: TransportObservation = field(default_factory=TransportObservation)


def hash_root_qualification(root: RootQualification) -> str:
    """Binds every material qualification byte. Mirrors the runtime digest."""
    parts = [
        (root.cnpj_root8 or "").strip(),
        (root.party_role or "").strip().upper(),
        (root.qualifying_contract_id or "").strip(),
        (root.qualifying_contract_date or "").strip(),
        (root.qualifying_date_field or "").strip(),
        (root.qualified_until or "").strip(),
        (root.qualification_evidence_reference or "").strip(),
    ]
    return hashlib.sha256("\x00".join(parts).encode("utf-8")).hexdigest()


def source_health_state(obs: SourceHealthObservation, policy: Mapping[str, Any]) -> str:
    if obs.declared_state in SOURCE_STATES:
        return obs.declared_state
    bands = policy["source_operational_health"]["age_bands_seconds"]
    age = obs.age_seconds if obs.age_seconds is not None else obs.lag_seconds
    derived_age = classify_source_age(age, bands)
    components = [
        obs.crawler_state if obs.crawler_state in SOURCE_STATES else "UNKNOWN",
        obs.target_fit_maintenance_state if obs.target_fit_maintenance_state in SOURCE_STATES else "UNKNOWN",
        obs.publication_state if obs.publication_state in SOURCE_STATES else "UNKNOWN",
        derived_age,
    ]
    if any(item == "UNKNOWN" for item in components):
        return "UNKNOWN"
    return max(components, key=lambda item: SOURCE_RANK[item])


def evaluate_population_authority(authority: PopulationAuthority) -> dict[str, Any]:
    """Population-level attestation. Absence and unknown versions fail closed."""
    if not authority.present:
        return {"state": UNKNOWN, "reason_codes": [REASON_MISSING]}
    declared = authority.policy_version or authority.contract_version
    if not recognized_authority_policy(authority.policy_version) and not recognized_authority_policy(
        authority.contract_version
    ):
        return {"state": UNKNOWN, "reason_codes": [REASON_POLICY_UNSUPPORTED], "policy_version": declared}
    window = authority.qualification_window_years
    if window is not None and window != QUALIFICATION_WINDOW_YEARS:
        return {"state": UNKNOWN, "reason_codes": [REASON_WINDOW_INVALID], "policy_version": declared}
    wire = adapt_commercial_authority(authority.wire())
    mismatched = bool(wire["conflicts"]) or not wire["complete"]
    for observed, canonical in (
        (authority.observed_membership_hash, wire["basis_membership_hash"]),
        (authority.observed_publication_semantic_hash, wire["basis_publication_semantic_hash"]),
        (authority.observed_producer_identity, wire["producer_identity"]),
    ):
        if observed and canonical != observed:
            mismatched = True
    if mismatched:
        return {"state": UNKNOWN, "reason_codes": ["BINDING_MISMATCH"], "policy_version": declared, "wire": wire}
    if authority.revoked:
        return {"state": REVOKED, "reason_codes": [REASON_REVOKED], "policy_version": declared, "wire": wire}
    return {"state": QUALIFIED, "reason_codes": [REASON_QUALIFIED], "policy_version": declared, "wire": wire}


def evaluate_root_qualification(root: RootQualification | None, now: datetime) -> dict[str, Any]:
    """The canonical three-year rule for one company. Pure in evidence and now."""
    out: dict[str, Any] = {
        "present": False,
        "state": UNKNOWN,
        "cnpj_root8": None,
        "party_role": None,
        "qualifying_contract_id": None,
        "qualifying_contract_date": None,
        "qualifying_date_field": None,
        "qualifying_contract_count": None,
        "qualified_until": None,
        "qualification_evidence_hash": None,
        "reason_codes": [REASON_MISSING],
    }
    if root is None:
        return out
    now = now.astimezone(timezone.utc)
    out["present"] = True
    out["cnpj_root8"] = (root.cnpj_root8 or "").strip() or None
    out["party_role"] = (root.party_role or "").strip().upper() or None
    out["qualifying_contract_id"] = (root.qualifying_contract_id or "").strip() or None
    out["qualifying_date_field"] = (root.qualifying_date_field or "").strip() or None
    out["qualifying_contract_count"] = root.qualifying_contract_count
    out["qualification_evidence_hash"] = (root.qualification_evidence_hash or "").strip().lower() or None

    role = out["party_role"] or ""
    if role in FORBIDDEN_PARTY_ROLES or role not in SUPPLIER_ROLE_ALIASES:
        out["reason_codes"] = [REASON_ROLE_INVALID]
        return out
    # Explicit deactivation beats every other signal, including a live contract.
    if root.deactivated:
        out["state"] = REVOKED
        out["reason_codes"] = [REASON_REVOKED]
        return out
    observed = hash_root_qualification(root)
    if not out["qualification_evidence_hash"] or out["qualification_evidence_hash"] != observed:
        out["reason_codes"] = [REASON_EVIDENCE_DRIFT]
        return out
    contract_date = parse_qualifying_date(root.qualifying_contract_date)
    if contract_date is None:
        out["reason_codes"] = [REASON_EVIDENCE_DRIFT]
        return out
    out["qualifying_contract_date"] = contract_date.isoformat()
    if out["qualifying_date_field"] not in QUALIFYING_DATE_PRECEDENCE:
        out["reason_codes"] = [REASON_EVIDENCE_DRIFT]
        return out
    # Several contracts may qualify. The company stays QUALIFIED while at least
    # one contracting act is inside the window, so the declared date must be the
    # newest one the producer counted.
    if root.qualifying_contract_dates:
        parsed = [parse_qualifying_date(item) for item in root.qualifying_contract_dates]
        if any(item is None for item in parsed):
            out["reason_codes"] = [REASON_EVIDENCE_DRIFT]
            return out
        newest = max(item for item in parsed if item is not None)
        if newest != contract_date:
            out["reason_codes"] = [REASON_EVIDENCE_DRIFT]
            return out
        if root.qualifying_contract_count is not None and root.qualifying_contract_count != len(parsed):
            out["reason_codes"] = [REASON_EVIDENCE_DRIFT]
            return out
    expected = qualified_until_for(contract_date)
    declared = parse_qualifying_date(root.qualified_until)
    if declared is None or declared != expected:
        out["reason_codes"] = [REASON_WINDOW_INVALID]
        return out
    out["qualified_until"] = expected.isoformat()
    if not within_qualification_window(contract_date, now):
        out["state"] = EXPIRED
        out["reason_codes"] = [REASON_EXPIRED]
        return out
    out["state"] = QUALIFIED
    out["reason_codes"] = [REASON_QUALIFIED]
    return out


def fail_closed_reasons(flags: FailClosedFlags, policy: Mapping[str, Any]) -> list[str]:
    codes = list(policy["fail_closed_blockers"]["operator_flag_codes"])
    unknown_blocks = bool(policy["fail_closed_blockers"]["unknown_flag_blocks"])
    reasons: list[str] = []
    for code in codes:
        value = getattr(flags, FAIL_CLOSED_FLAG_MAP[code])
        if value is True:
            reasons.append(code)
        elif value is None and unknown_blocks:
            reasons.append(f"{code}_UNKNOWN")
    return reasons


def pause_actor(transport: TransportObservation) -> str:
    return transport.paused_by or "UNKNOWN"


def pause_source(transport: TransportObservation) -> str:
    return transport.pause_source or "UNKNOWN"


def validate_delegated_decision(policy: Mapping[str, Any], record: Mapping[str, Any]) -> list[str]:
    missing: list[str] = []
    for field_name in policy["audit"]["required_fields"]:
        value = record.get(field_name)
        if value is None or value == "" or value == []:
            missing.append(field_name)
    if record.get("human_approved_by"):
        missing.append("HUMAN_ACTOR_FORGED")
    if record.get("approval_source") == "HUMAN_APPROVE" and record.get("policy_version") in (
        POLICY_VERSION,
        POLICY_CANONICAL,
    ):
        missing.append("DELEGATED_RECORDED_AS_HUMAN")
    return missing


def _inactive_result(policy: Mapping[str, Any], inp: EvaluationInput, reasons: list[str]) -> dict[str, Any]:
    return {
        "activated": False,
        "policy_id": policy["policy_id"],
        "policy_version": policy["policy_version"],
        "canonical_name": policy["canonical_name"],
        "source_health": {
            "state": UNKNOWN,
            "is_commercial_decision": False,
            "is_transport_blocker": False,
            "presentation_class": "ACQUISITION_PLAN",
            "acquisition_plan_condition": acquisition_plan_condition(UNKNOWN),
            "ref": inp.source_health.ref,
        },
        "commercial_qualification": {
            "state": UNKNOWN,
            "new_admission_allowed": False,
            "transport_allowed": False,
            "policy_version": None,
            "cnpj_root8": None,
            "party_role": None,
            "qualifying_contract_id": None,
            "qualifying_contract_date": None,
            "qualifying_date_field": None,
            "qualifying_contract_count": None,
            "qualified_until": None,
            "qualification_evidence_hash": None,
            "ref": None,
            "hash": None,
        },
        "transport_authority": {
            "paused": inp.transport.paused,
            "paused_by": pause_actor(inp.transport),
            "paused_at": inp.transport.paused_at,
            "pause_source": pause_source(inp.transport),
            "kill_switch": inp.transport.kill_switch,
            "first_window_go": False,
            "snapshot_ref": inp.transport.snapshot_ref,
        },
        "transport_conjunction": {
            "members": list(policy["transport_conjunction"]["members"]),
            "excluded_members": list(policy["transport_conjunction"]["excluded_members"]),
            "passed": False,
        },
        "exception_reason_groups": [],
        "reason_codes": list(dict.fromkeys(reasons)),
        "provider_dispatch_authorized": False,
        "smtp_send_allowed": False,
    }


def evaluate(policy: Mapping[str, Any], inp: EvaluationInput) -> dict[str, Any]:
    if not activates_v3(inp.requested_policy_version, policy):
        reason = "UNKNOWN_POLICY_VERSION" if inp.requested_policy_version else "MISSING_POLICY_VERSION"
        return _inactive_result(policy, inp, [reason])

    reasons: list[str] = []
    source_state = source_health_state(inp.source_health, policy)
    blockers = fail_closed_reasons(inp.fail_closed, policy)
    reasons.extend(blockers)

    population = evaluate_population_authority(inp.authority)
    root = evaluate_root_qualification(inp.qualification, inp.now)

    # The population attestation proves the corpus; the root fact proves the
    # company. The worse of the two decides, and neither can be inferred.
    if population["state"] == UNKNOWN:
        state = UNKNOWN
        qualification_reasons = list(population["reason_codes"])
    elif population["state"] == REVOKED or root["state"] == REVOKED:
        state = REVOKED
        qualification_reasons = [REASON_REVOKED]
    elif root["state"] == QUALIFIED:
        state = QUALIFIED
        qualification_reasons = [REASON_QUALIFIED]
    else:
        state = root["state"]
        qualification_reasons = list(root["reason_codes"])

    for code in qualification_reasons:
        if code == REASON_QUALIFIED:
            continue
        reasons.append(code)
        mapped = QUALIFICATION_BLOCKER_FOR_REASON.get(code, code)
        if mapped not in blockers:
            blockers.append(mapped)
        if mapped not in reasons:
            reasons.append(mapped)

    if inp.fail_closed.explicit_deactivation is True and state != REVOKED:
        state = REVOKED
        if REASON_REVOKED not in reasons:
            reasons.append(REASON_REVOKED)

    # Acquisition health is reported, never converted into a commercial verdict.
    if source_state in ("DEGRADED", "STALE", "MISSING") and state == QUALIFIED:
        reasons.append("SOURCE_HEALTH_DEGRADED_NOT_COMMERCIAL_REVOCATION")

    gates_pass = len(blockers) == 0
    allowed = state == QUALIFIED and gates_pass
    if not gates_pass and state == QUALIFIED:
        reasons.append("FAIL_CLOSED_OVER_QUALIFIED_MEMBER")

    exception_groups: list[str] = []
    for code, group in (
        ("COMMERCIAL_QUALIFICATION_EXPIRED", "COMMERCIAL_QUALIFICATION_EXPIRED"),
        ("COMMERCIAL_QUALIFICATION_REVOKED", "COMMERCIAL_QUALIFICATION_REVOKED"),
        ("COMMERCIAL_QUALIFICATION_EVIDENCE_DRIFT", "COMMERCIAL_QUALIFICATION_EVIDENCE_DRIFT"),
        ("COMMERCIAL_QUALIFICATION_PARTY_ROLE_INVALID", "COMMERCIAL_QUALIFICATION_PARTY_ROLE_INVALID"),
        ("COMMERCIAL_QUALIFICATION_WINDOW_INVALID", "COMMERCIAL_QUALIFICATION_WINDOW_INVALID"),
        ("COMMERCIAL_AUTHORITY_POLICY_UNSUPPORTED", "COMMERCIAL_AUTHORITY_POLICY_UNSUPPORTED"),
        ("MEMBERSHIP_LEAVE_PROVEN", "MEMBERSHIP_DRIFT"),
        ("RECIPIENT_EXPIRED", "RECIPIENT_EXPIRED"),
        ("PARTY_ROLE_CONFLICT", "PARTY_ROLE_CONFLICT"),
        ("SUPPRESSION", "SUPPRESSION"),
        ("POLICY_DRIFT", "POLICY_DRIFT"),
        ("TRANSPORT_BLOCKED", "TRANSPORT_BLOCKED"),
    ):
        if code in blockers or f"{code}_UNKNOWN" in blockers:
            exception_groups.append(group)

    wire = population.get("wire") or {}
    return {
        "activated": True,
        "policy_id": policy["policy_id"],
        "policy_version": policy["policy_version"],
        "canonical_name": policy["canonical_name"],
        "source_health": {
            "state": source_state,
            "is_commercial_decision": False,
            "is_transport_blocker": False,
            "presentation_class": "ACQUISITION_PLAN",
            "acquisition_plan_condition": acquisition_plan_condition(source_state),
            "ref": inp.source_health.ref,
            "age_seconds": inp.source_health.age_seconds
            if inp.source_health.age_seconds is not None
            else inp.source_health.lag_seconds,
        },
        "commercial_qualification": {
            "state": state,
            "new_admission_allowed": allowed,
            "transport_allowed": allowed,
            "policy_version": population.get("policy_version"),
            "cnpj_root8": root["cnpj_root8"],
            "party_role": root["party_role"],
            "qualifying_contract_id": root["qualifying_contract_id"],
            "qualifying_contract_date": root["qualifying_contract_date"],
            "qualifying_date_field": root["qualifying_date_field"],
            "qualifying_contract_count": root["qualifying_contract_count"],
            "qualified_until": root["qualified_until"],
            "qualification_evidence_hash": root["qualification_evidence_hash"],
            "basis_source_run_id": wire.get("basis_source_run_id"),
            "basis_snapshot_hash": wire.get("basis_snapshot_hash"),
            "basis_membership_hash": wire.get("basis_membership_hash"),
            "basis_publication_semantic_hash": wire.get("basis_publication_semantic_hash"),
            "producer_identity": wire.get("producer_identity"),
            "ref": inp.authority.authority_ref if inp.authority.present else None,
            "hash": inp.authority.authority_hash if inp.authority.present else None,
        },
        "transport_authority": {
            "paused": inp.transport.paused,
            "paused_by": pause_actor(inp.transport),
            "paused_at": inp.transport.paused_at,
            "pause_source": pause_source(inp.transport),
            "kill_switch": inp.transport.kill_switch,
            "first_window_go": False,
            "snapshot_ref": inp.transport.snapshot_ref,
            "mailbox_eligible": inp.transport.mailbox_eligible,
        },
        "transport_conjunction": {
            "members": list(policy["transport_conjunction"]["members"]),
            "excluded_members": list(policy["transport_conjunction"]["excluded_members"]),
            "passed": allowed,
        },
        "exception_reason_groups": list(dict.fromkeys(exception_groups)),
        "reason_codes": list(dict.fromkeys(reasons)),
        "provider_dispatch_authorized": False,
        "smtp_send_allowed": False,
    }


READINESS_FIELDS = (
    "governance_policy_ready",
    "control_center_readback_ready",
    "commercial_authority_observable",
    "source_health_observable",
    "reservoir_observable",
    "queue_observable",
    "transport_pause_observable",
    "kill_switch_observable",
    "mailbox_capacity_observable",
    "exceptions_operable",
    "cross_contract_version",
    "blocking_reasons",
    "decision",
)

READINESS_DECISIONS = ("READY_FOR_FINAL_CONVERGENCE", "BLOCKED")

OBSERVABILITY_FLAGS = (
    "governance_policy_ready",
    "control_center_readback_ready",
    "commercial_authority_observable",
    "source_health_observable",
    "reservoir_observable",
    "queue_observable",
    "transport_pause_observable",
    "kill_switch_observable",
    "mailbox_capacity_observable",
    "exceptions_operable",
)

FIRST_WINDOW_VERDICTS = (
    "READY_FOR_GO_ADJUDICATION",
    "ARMED_FOR_NEXT_BUSINESS_WINDOW",
    "TRANSPORT_ACTIVE_IN_WINDOW",
    "BLOCKED",
)


def project_first_commercial_window_readiness(observation: Mapping[str, Any]) -> dict[str, Any]:
    """Observability readiness. Source health is observed, never a blocker."""
    blocking: list[str] = []
    flags: dict[str, bool] = {}
    for name in OBSERVABILITY_FLAGS:
        raw = observation.get(name)
        if raw is True:
            flags[name] = True
        elif raw is False:
            flags[name] = False
            blocking.append(name.upper() + "_ABSENT")
        else:
            flags[name] = False
            blocking.append(name.upper() + "_UNKNOWN")
    version = observation.get("cross_contract_version")
    if not isinstance(version, str) or not version.strip():
        version = "UNKNOWN"
        blocking.append("CROSS_CONTRACT_VERSION_UNKNOWN")
    extra = observation.get("blocking_reasons")
    if isinstance(extra, list):
        blocking.extend(str(item) for item in extra if item)
    # A retired blocker never reappears through a consumer payload.
    blocking = [item for item in blocking if item != REMOVED_READINESS_BLOCKER]
    blocking = list(dict.fromkeys(blocking))
    decision = "READY_FOR_FINAL_CONVERGENCE" if not blocking else "BLOCKED"
    return {
        "schema_version": "first-commercial-window-readiness.v1",
        **flags,
        "cross_contract_version": version,
        "blocking_reasons": blocking,
        "decision": decision,
        "smtp_authorized": False,
        "provider_dispatch_authorized": False,
        "first_window_go": False,
    }


def project_first_window_verdict(
    *,
    commercial_state: str,
    source_state: str,
    in_send_window: bool | None,
    blockers: Sequence[str] = (),
) -> dict[str, Any]:
    """First-window verdict. Source health never contributes a blocker here."""
    emitted = [item for item in blockers if item and item != REMOVED_READINESS_BLOCKER]
    if commercial_state != QUALIFIED:
        reason = {
            EXPIRED: REASON_EXPIRED,
            REVOKED: REASON_REVOKED,
            UNKNOWN: REASON_MISSING,
        }.get(commercial_state, REASON_MISSING)
        if reason not in emitted:
            emitted.append(reason)
    emitted = list(dict.fromkeys(emitted))
    if emitted:
        verdict = "BLOCKED"
    elif in_send_window is True:
        verdict = "TRANSPORT_ACTIVE_IN_WINDOW"
    else:
        verdict = "ARMED_FOR_NEXT_BUSINESS_WINDOW"
    return {
        "verdict": verdict,
        "blockers": emitted,
        "commercial_authority": commercial_state,
        "source_health": source_state,
        "source_health_is_blocker": False,
        "acquisition_plan_condition": acquisition_plan_condition(source_state),
        "smtp_authorized": False,
        "provider_dispatch_authorized": False,
    }
