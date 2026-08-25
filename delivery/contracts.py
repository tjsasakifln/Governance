"""Cross-repository delivery handoff contract and compatibility adapter."""

from __future__ import annotations

import re
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any

from .errors import ContractError

DELIVERY_REQUEST_SCHEMA = "confenge.delivery_order_requested.v1"
FINANCIAL_GATE_SCHEMA = "confenge.financial_gate.v1"

_HASH_RE = re.compile(r"^(sha256:)?[a-f0-9]{64}$")
_FINANCIAL_STATES = {"UNKNOWN", "SYNTHETIC_VALID", "AUTHORIZED"}
_FINANCIAL_FIELDS = {
    "schema_version", "state", "synthetic", "source_event_id", "received_revenue", "evidence_refs"
}

_REQUIRED_TEXT_FIELDS = (
    "event_id",
    "correlation_id",
    "causation_id",
    "idempotency_key",
    "organization_id",
    "account_id",
    "client_ref",
    "opportunity_id",
    "qco_id",
    "proposal_id",
    "offer_id",
    "offer_version",
    "deliverable_id",
    "deliverable_version",
    "scope_version",
    "price_version",
    "terms_version",
    "occurred_at",
)
_DELIVERY_REQUEST_FIELDS = {
    "schema_version",
    "synthetic",
    "proposal_version",
    "accepted_snapshot_hash",
    "financial_gate",
    "onboarding_ref",
    "evidence_refs",
    *_REQUIRED_TEXT_FIELDS,
}


def _utc(value: str, field: str) -> str:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (AttributeError, ValueError) as error:
        raise ContractError(f"{field} must be an ISO-8601 instant") from error
    if parsed.tzinfo is None:
        raise ContractError(f"{field} must include a timezone")
    return parsed.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def validate_financial_gate(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise ContractError("financial_gate must be an object")
    if raw.get("schema_version") != FINANCIAL_GATE_SCHEMA:
        raise ContractError(f"financial_gate.schema_version must be {FINANCIAL_GATE_SCHEMA}")
    unknown_fields = set(raw) - _FINANCIAL_FIELDS
    if unknown_fields:
        raise ContractError(f"financial_gate has unknown fields: {sorted(unknown_fields)}")
    state = raw.get("state")
    if state not in _FINANCIAL_STATES:
        raise ContractError(f"unsupported financial gate state: {state!r}")
    if not isinstance(raw.get("synthetic"), bool):
        raise ContractError("financial_gate.synthetic must be boolean")
    if raw.get("received_revenue") is not False:
        raise ContractError("financial evidence can never become received revenue")
    if state == "SYNTHETIC_VALID" and not raw["synthetic"]:
        raise ContractError("SYNTHETIC_VALID requires synthetic=true")
    if state == "AUTHORIZED" and raw["synthetic"]:
        raise ContractError("AUTHORIZED is reserved for reconciled non-synthetic evidence")
    source_event_id = raw.get("source_event_id")
    if source_event_id is not None and (not isinstance(source_event_id, str) or not source_event_id):
        raise ContractError("financial_gate.source_event_id must be non-empty or null")
    if state == "UNKNOWN" and source_event_id is not None:
        raise ContractError("UNKNOWN financial gate requires source_event_id=null")
    refs = raw.get("evidence_refs")
    if not isinstance(refs, list) or not all(isinstance(item, str) and item for item in refs):
        raise ContractError("financial_gate.evidence_refs must contain non-empty references")
    if state != "UNKNOWN" and not refs:
        raise ContractError("a valid financial gate requires evidence_refs")
    if len(set(refs)) != len(refs):
        raise ContractError("financial_gate.evidence_refs must be unique")
    return deepcopy(raw)


def validate_delivery_order_requested(raw: Any) -> dict[str, Any]:
    """Validate the Warmbly -> Governance envelope without inferring truth."""

    if not isinstance(raw, dict):
        raise ContractError("delivery request must be an object")
    if raw.get("schema_version") != DELIVERY_REQUEST_SCHEMA:
        raise ContractError(f"schema_version must be {DELIVERY_REQUEST_SCHEMA}")
    unknown_fields = set(raw) - _DELIVERY_REQUEST_FIELDS
    if unknown_fields:
        raise ContractError(f"delivery request has unknown fields: {sorted(unknown_fields)}")
    if not isinstance(raw.get("synthetic"), bool):
        raise ContractError("synthetic must be boolean")
    for field in _REQUIRED_TEXT_FIELDS:
        value = raw.get(field)
        if not isinstance(value, str) or not value.strip():
            raise ContractError(f"{field} must be a non-empty string")
    version = raw.get("proposal_version")
    if not isinstance(version, int) or isinstance(version, bool) or version < 1:
        raise ContractError("proposal_version must be a positive integer")
    snapshot_hash = raw.get("accepted_snapshot_hash")
    if not isinstance(snapshot_hash, str) or _HASH_RE.fullmatch(snapshot_hash) is None:
        raise ContractError("accepted_snapshot_hash must be a lowercase sha256 hex digest")
    onboarding_ref = raw.get("onboarding_ref")
    if onboarding_ref is not None and not isinstance(onboarding_ref, str):
        raise ContractError("onboarding_ref must be a string or null")
    refs = raw.get("evidence_refs")
    if not isinstance(refs, list) or not all(isinstance(item, str) and item for item in refs):
        raise ContractError("evidence_refs must contain non-empty references")
    if len(set(refs)) != len(refs):
        raise ContractError("evidence_refs must be unique")
    gate = validate_financial_gate(raw.get("financial_gate"))
    if raw["synthetic"] != gate["synthetic"]:
        raise ContractError("handoff synthetic flag must match financial_gate.synthetic")
    clean = deepcopy(raw)
    clean["accepted_snapshot_hash"] = (
        snapshot_hash if snapshot_hash.startswith("sha256:") else f"sha256:{snapshot_hash}"
    )
    clean["occurred_at"] = _utc(raw["occurred_at"], "occurred_at")
    clean["financial_gate"] = gate
    return clean


def validate_admission(raw: Any) -> dict[str, Any]:
    """Validate the readiness/capacity verdict supplied by Governance owners."""

    if not isinstance(raw, dict):
        raise ContractError("admission must be an object")
    required = {
        "decision",
        "readiness_state",
        "readiness_ref",
        "capacity_hold_id",
        "capacity_snapshot_id",
        "calendar_version",
        "due_at",
    }
    missing = sorted(required - raw.keys())
    if missing:
        raise ContractError(f"admission missing fields: {', '.join(missing)}")
    if raw["decision"] not in {"CAN_ACCEPT", "CANNOT_ACCEPT", "UNKNOWN"}:
        raise ContractError("invalid admission decision")
    for field in required - {"decision"}:
        if not isinstance(raw[field], str) or not raw[field]:
            raise ContractError(f"admission.{field} must be a non-empty string")
    return deepcopy(raw)
