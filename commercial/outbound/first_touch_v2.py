"""Pure evaluator for CFG-FIRST-TOUCH-ROUTING-v2.

Inputs are a clock, a source-health observation, a commercial-authority binding,
fail-closed flags, and an optional explicit "binding still valid" declaration.
Outputs are the three separated authorities, first-window state, admission /
transport allowances, and named reason codes.

The shipped policy JSON is the source of truth for thresholds and activation.
This module never authorizes SMTP or provider dispatch.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Mapping

POLICY_CANONICAL = "CFG-FIRST-TOUCH-ROUTING-v2"
POLICY_VERSION = "v2"
V1_CANONICAL = "CFG-FIRST-TOUCH-ROUTING-v1"

SOURCE_STATES = ("FRESH", "DEGRADED", "STALE", "UNKNOWN")
COMMERCIAL_STATES = ("CURRENT", "DEGRADED", "FROZEN_FOR_NEW_ADMISSION", "EXPIRED", "UNKNOWN")
SOURCE_RANK = {"FRESH": 0, "DEGRADED": 1, "STALE": 2}

FAIL_CLOSED_FLAG_MAP = {
    "EXPLICIT_DEACTIVATION": "explicit_deactivation",
    "MEMBERSHIP_LEAVE_PROVEN": "membership_leave_proven",
    "PARTY_ROLE_CONFLICT": "party_role_conflict",
    "RECIPIENT_EXPIRED": "recipient_expired",
    "EVIDENCE_EXPIRED": "evidence_expired",
    "SUPPRESSION": "suppression",
    "OPT_OUT_DNC": "opt_out_or_dnc",
    "HARD_BOUNCE": "hard_bounce",
    "COMPLIANCE_RISK": "compliance_risk",
    "POLICY_DRIFT": "policy_drift",
    "BINDING_MISMATCH": "binding_mismatch",
    "TRANSPORT_BLOCKED": "transport_blocked",
}

EXCEPTION_REASON_GROUPS = (
    "SOURCE_HEALTH_DEGRADED",
    "COMMERCIAL_AUTHORITY_FROZEN",
    "COMMERCIAL_AUTHORITY_EXPIRED",
    "MEMBERSHIP_DRIFT",
    "RECIPIENT_EXPIRED",
    "EVIDENCE_EXPIRED",
    "PARTY_ROLE_CONFLICT",
    "SUPPRESSION",
    "POLICY_DRIFT",
    "TRANSPORT_BLOCKED",
    "READBACK_UNKNOWN",
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


def age_seconds(now: datetime, then: datetime | None) -> int | None:
    if then is None:
        return None
    delta = int((now - then).total_seconds())
    return delta


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


def classify_first_window(age: int | None, bands: Mapping[str, Any]) -> str:
    if age is None or age < 0:
        return "UNKNOWN"
    if _in_closed(age, bands["CURRENT"]):
        return "CURRENT"
    if _in_open_closed(age, bands["DEGRADED"]):
        return "DEGRADED"
    if _in_open_closed(age, bands["FROZEN_FOR_NEW_ADMISSION"]):
        return "FROZEN_FOR_NEW_ADMISSION"
    if _in_open(age, bands["EXPIRED"]):
        return "EXPIRED"
    return "UNKNOWN"


def activates_v2(requested: str | None, policy: Mapping[str, Any]) -> bool:
    activation = policy["activation"]
    accepted = tuple(activation["accepted_version_strings"])
    if not requested:
        return False
    if requested in ("v1", V1_CANONICAL, "CFG-FIRST-TOUCH-ROUTING"):
        return False
    return requested in accepted


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
class CommercialAuthorityBinding:
    present: bool = False
    source_run_id: str | None = None
    snapshot_id: str | None = None
    membership_hash: str | None = None
    validated_at: str | None = None
    valid_until: str | None = None
    authority_ref: str | None = None
    authority_hash: str | None = None
    observed_membership_hash: str | None = None


@dataclass(frozen=True)
class FailClosedFlags:
    explicit_deactivation: bool | None = None
    membership_leave_proven: bool | None = None
    party_role_conflict: bool | None = None
    recipient_expired: bool | None = None
    evidence_expired: bool | None = None
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
    commercial_binding: CommercialAuthorityBinding = field(default_factory=CommercialAuthorityBinding)
    fail_closed: FailClosedFlags = field(default_factory=FailClosedFlags)
    transport: TransportObservation = field(default_factory=TransportObservation)
    explicit_binding_still_valid: bool | None = None
    already_bound_materialized: bool = False


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


def fail_closed_reasons(flags: FailClosedFlags, policy: Mapping[str, Any]) -> list[str]:
    codes = list(policy["fail_closed_blockers"]["codes"])
    unknown_blocks = bool(policy["fail_closed_blockers"]["unknown_flag_blocks"])
    reasons: list[str] = []
    for code in codes:
        attr = FAIL_CLOSED_FLAG_MAP[code]
        value = getattr(flags, attr)
        if value is True:
            reasons.append(code)
        elif value is None and unknown_blocks:
            reasons.append(f"{code}_UNKNOWN")
    return reasons


def pause_actor(transport: TransportObservation) -> str:
    if transport.paused_by:
        return transport.paused_by
    return "UNKNOWN"


def pause_source(transport: TransportObservation) -> str:
    if transport.pause_source:
        return transport.pause_source
    return "UNKNOWN"


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


def evaluate(policy: Mapping[str, Any], inp: EvaluationInput) -> dict[str, Any]:
    reasons: list[str] = []
    activated = activates_v2(inp.requested_policy_version, policy)
    if not activated:
        reasons.append("UNKNOWN_POLICY_VERSION" if inp.requested_policy_version else "MISSING_POLICY_VERSION")
        return {
            "activated": False,
            "policy_id": policy["policy_id"],
            "policy_version": policy["policy_version"],
            "canonical_name": policy["canonical_name"],
            "source_health": {
                "state": "UNKNOWN",
                "is_commercial_decision": False,
                "ref": inp.source_health.ref,
            },
            "commercial_authority": {
                "state": "UNKNOWN",
                "new_admission_allowed": False,
                "existing_bound_touch_transport_allowed": False,
                "source_run_id": None,
                "membership_hash": None,
                "validated_at": None,
                "valid_until": None,
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
            "reason_codes": reasons,
            "provider_dispatch_authorized": False,
            "smtp_send_allowed": False,
        }

    source_state = source_health_state(inp.source_health, policy)
    binding = inp.commercial_binding
    blockers = fail_closed_reasons(inp.fail_closed, policy)
    reasons.extend(blockers)

    if binding.present and binding.membership_hash and binding.observed_membership_hash:
        if binding.membership_hash != binding.observed_membership_hash and "BINDING_MISMATCH" not in blockers:
            reasons.append("BINDING_MISMATCH")
            blockers.append("BINDING_MISMATCH")

    commercial_state = "UNKNOWN"
    validated_at = parse_utc(binding.validated_at) if binding.present else None
    valid_until = parse_utc(binding.valid_until) if binding.present else None
    age = age_seconds(inp.now, validated_at) if binding.present else None
    if not binding.present:
        reasons.append("MISSING_COMMERCIAL_AUTHORITY")
        commercial_state = "UNKNOWN"
    elif validated_at is None:
        reasons.append("COMMERCIAL_AUTHORITY_VALIDATED_AT_UNKNOWN")
        commercial_state = "UNKNOWN"
    else:
        commercial_state = classify_first_window(
            age, policy["commercial_authority"]["first_window_thresholds_seconds"]
        )
        if valid_until is not None and inp.now > valid_until and commercial_state != "EXPIRED":
            commercial_state = "EXPIRED"
            reasons.append("COMMERCIAL_AUTHORITY_PAST_VALID_UNTIL")

    # Source degradation does not rewrite commercial state.
    if source_state in ("DEGRADED", "STALE") and commercial_state in ("CURRENT", "DEGRADED"):
        reasons.append("SOURCE_HEALTH_DEGRADED_NOT_COMMERCIAL_REVOCATION")

    new_admission = False
    existing_bound = False
    gates_pass = len(blockers) == 0
    frozen = policy["frozen_for_new_admission"]
    explicit = inp.explicit_binding_still_valid

    if commercial_state == "CURRENT" and gates_pass:
        new_admission = True
        existing_bound = True
    elif commercial_state == "DEGRADED" and gates_pass:
        new_admission = True
        existing_bound = True
    elif commercial_state == "FROZEN_FOR_NEW_ADMISSION":
        new_admission = False
        if frozen["new_leads_promoted"] is True:
            raise AssertionError("policy forbids promoting new leads while frozen")
        if explicit is True and inp.already_bound_materialized and gates_pass:
            existing_bound = True
        else:
            if explicit is not True:
                reasons.append("BINDING_STILL_VALID_NOT_DECLARED")
            if not inp.already_bound_materialized:
                reasons.append("NOT_ALREADY_BOUND")
            existing_bound = False
        reasons.append("COMMERCIAL_AUTHORITY_FROZEN")
    elif commercial_state == "EXPIRED":
        new_admission = False
        existing_bound = False
        reasons.append("COMMERCIAL_AUTHORITY_EXPIRED")
    else:
        new_admission = False
        existing_bound = False

    if not gates_pass:
        new_admission = False
        existing_bound = False

    if commercial_state in ("CURRENT", "DEGRADED", "FROZEN_FOR_NEW_ADMISSION") and not gates_pass:
        reasons.append("FAIL_CLOSED_INSIDE_GRACE")

    exception_groups: list[str] = []
    if source_state == "DEGRADED":
        exception_groups.append("SOURCE_HEALTH_DEGRADED")
    if commercial_state == "FROZEN_FOR_NEW_ADMISSION":
        exception_groups.append("COMMERCIAL_AUTHORITY_FROZEN")
    if commercial_state == "EXPIRED":
        exception_groups.append("COMMERCIAL_AUTHORITY_EXPIRED")
    for code, group in (
        ("MEMBERSHIP_LEAVE_PROVEN", "MEMBERSHIP_DRIFT"),
        ("RECIPIENT_EXPIRED", "RECIPIENT_EXPIRED"),
        ("EVIDENCE_EXPIRED", "EVIDENCE_EXPIRED"),
        ("PARTY_ROLE_CONFLICT", "PARTY_ROLE_CONFLICT"),
        ("SUPPRESSION", "SUPPRESSION"),
        ("POLICY_DRIFT", "POLICY_DRIFT"),
        ("TRANSPORT_BLOCKED", "TRANSPORT_BLOCKED"),
    ):
        if code in blockers or f"{code}_UNKNOWN" in blockers:
            exception_groups.append(group)

    return {
        "activated": True,
        "policy_id": policy["policy_id"],
        "policy_version": policy["policy_version"],
        "canonical_name": policy["canonical_name"],
        "source_health": {
            "state": source_state,
            "is_commercial_decision": False,
            "ref": inp.source_health.ref,
            "age_seconds": inp.source_health.age_seconds if inp.source_health.age_seconds is not None else inp.source_health.lag_seconds,
        },
        "commercial_authority": {
            "state": commercial_state,
            "new_admission_allowed": new_admission,
            "existing_bound_touch_transport_allowed": existing_bound,
            "source_run_id": binding.source_run_id if binding.present else None,
            "membership_hash": binding.membership_hash if binding.present else None,
            "validated_at": binding.validated_at if binding.present else None,
            "valid_until": binding.valid_until if binding.present else None,
            "age_seconds": age,
            "ref": binding.authority_ref if binding.present else None,
            "hash": binding.authority_hash if binding.present else None,
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


def project_first_commercial_window_readiness(observation: Mapping[str, Any]) -> dict[str, Any]:
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
