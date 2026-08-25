"""Fail-closed delivery-readiness contracts.

The generated inventory stores only registry identities, pointers and hashes.
It deliberately does not copy names, prices, public copy, inputs or scope from
the web-cfg catalog.  Operational evidence for the sandbox canary lives in a
separate Governance-owned profile.
"""

from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping


class ReadinessError(ValueError):
    """Raised when readiness evidence is incomplete or contradictory."""


READY_STATES = frozenset({"PRODUCTION_READY", "DELIVERY_VALIDATED"})


def canonical_json(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def content_hash(value: Any) -> str:
    return f"sha256:{hashlib.sha256(canonical_json(value)).hexdigest()}"


def _parse_instant(value: str, field: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (AttributeError, ValueError) as exc:
        raise ReadinessError(f"{field} must be an ISO-8601 instant") from exc
    if parsed.tzinfo is None:
        raise ReadinessError(f"{field} must include a timezone")
    return parsed.astimezone(timezone.utc)


def _external_issue_ref(value: str | None) -> str | None:
    if not value:
        return None
    if value.startswith("#"):
        return f"tjsasakifln/web-cfg{value}"
    return value


def generate_fail_closed_snapshot(
    registry_path: str | Path,
    *,
    authority_ref: str,
    source_revision: str,
    generated_at: str,
) -> dict[str, Any]:
    """Generate 54 identity-only UNKNOWN rows from a supplied web-cfg registry.

    No default path may turn a registry row into a delivery-ready row.  The
    caller supplies the source revision and timestamp so repeated generation is
    byte-for-byte deterministic.
    """

    path = Path(registry_path)
    raw = path.read_bytes()
    try:
        registry = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ReadinessError("registry must be valid JSON") from exc
    _parse_instant(generated_at, "generated_at")

    if registry.get("schema") != "confenge.deliverables-registry/1.0":
        raise ReadinessError("unsupported web-cfg deliverables registry schema")
    rows = registry.get("deliverables")
    if not isinstance(rows, list) or len(rows) != 54 or registry.get("catalog_count") != 54:
        raise ReadinessError("canonical registry must contain exactly 54 deliverables")

    records: list[dict[str, Any]] = []
    identities: set[tuple[str, str]] = set()
    for index, row in enumerate(rows):
        deliverable_id = row.get("deliverable_id")
        deliverable_version = row.get("version")
        if not isinstance(deliverable_id, str) or not isinstance(deliverable_version, str):
            raise ReadinessError(f"registry row {index} lacks deliverable identity/version")
        identity = (deliverable_id, deliverable_version)
        if identity in identities:
            raise ReadinessError(f"duplicate registry identity: {identity}")
        identities.add(identity)

        evidence_refs = [authority_ref]
        source_issue = _external_issue_ref(row.get("source_issue"))
        blocking_issue = _external_issue_ref(row.get("blocking_issue"))
        if source_issue:
            evidence_refs.append(source_issue)
        if blocking_issue:
            evidence_refs.append(blocking_issue)

        blocker_code = "REGISTRY_BLOCKER_REQUIRES_EVALUATION" if blocking_issue else "OPERATIONAL_EVIDENCE_UNKNOWN"
        records.append(
            {
                "deliverable_id": deliverable_id,
                "deliverable_version": deliverable_version,
                "registry_pointer": f"/deliverables/{index}",
                "registry_record_hash": content_hash(row),
                "readiness_state": "UNKNOWN",
                "state_reason": "NOT_OPERATIONALLY_EVALUATED",
                "blockers": [
                    {
                        "code": blocker_code,
                        "owner": "tjsasakifln/Governance#122",
                        "evidence_refs": evidence_refs,
                        "next_step": (
                            "evaluate the registry blocker and then materialize operational evidence"
                            if blocking_issue
                            else "materialize template, producer, QA, owner, effort and dependencies"
                        ),
                    }
                ],
                "evidence_refs": evidence_refs,
            }
        )

    return {
        "schema_version": "confenge.delivery_readiness_inventory.v1",
        "registry_authority": {
            "ref": authority_ref,
            "source_revision": source_revision,
            "registry_version": registry.get("registry_version"),
            "content_hash": f"sha256:{hashlib.sha256(raw).hexdigest()}",
        },
        "generated_at": generated_at,
        "record_count": 54,
        "records": records,
    }


def validate_operational_profile(profile: Mapping[str, Any]) -> None:
    """Validate evidence required for a PRODUCTION_READY canary profile."""

    if profile.get("schema_version") != "confenge.delivery_readiness.v1":
        raise ReadinessError("unsupported operational readiness schema")
    for field in (
        "deliverable_id",
        "deliverable_version",
        "registry_ref",
        "registry_hash",
        "scope",
        "inputs_required",
        "exclusions",
        "public_source_refs",
        "producer",
        "production_template_ref",
        "qa",
        "responsible_owner",
        "estimated_effort",
        "dependencies",
        "tests",
        "freshness",
    ):
        if not profile.get(field):
            raise ReadinessError(f"operational profile missing {field}")

    if profile.get("readiness_state") not in READY_STATES:
        raise ReadinessError("operational profile is not ready")
    if profile.get("blockers"):
        raise ReadinessError("ready operational profile cannot have active blockers")
    if not str(profile["registry_hash"]).startswith("sha256:"):
        raise ReadinessError("registry_hash must be a sha256 reference")

    scope = profile["scope"]
    if not scope.get("version") or not scope.get("definition_ref") or not scope.get("component_refs"):
        raise ReadinessError("scope must pin version, definition and components")
    if not all(item.get("required") is True and item.get("input_id") for item in profile["inputs_required"]):
        raise ReadinessError("every declared input must have an id and be explicitly required")

    producer = profile["producer"]
    if not all(producer.get(key) for key in ("implementation_ref", "workflow_ref", "version")):
        raise ReadinessError("producer must pin implementation, workflow and version")
    qa = profile["qa"]
    if not qa.get("checklist_ref") or not qa.get("version"):
        raise ReadinessError("QA checklist/version must be pinned")

    effort = profile["estimated_effort"]
    if not isinstance(effort.get("amount"), int) or effort["amount"] <= 0:
        raise ReadinessError("estimated effort must be a positive integer")
    if not isinstance(effort.get("lead_time_business_days"), int) or effort["lead_time_business_days"] <= 0:
        raise ReadinessError("lead time must be a positive number of business days")
    unavailable = [item.get("dependency_id", "UNKNOWN") for item in profile["dependencies"] if item.get("state") != "AVAILABLE"]
    if unavailable:
        raise ReadinessError(f"operational dependencies unavailable: {unavailable}")

    freshness = profile["freshness"]
    _parse_instant(freshness.get("evaluated_at"), "freshness.evaluated_at")
    _parse_instant(freshness.get("expires_at"), "freshness.expires_at")


def readiness_for_admission(profile: Mapping[str, Any] | None, *, evaluated_at: str) -> dict[str, Any]:
    """Return a fail-closed readiness verdict for capacity admission."""

    now = _parse_instant(evaluated_at, "evaluated_at")
    if not profile or profile.get("readiness_state") == "UNKNOWN":
        return {"verdict": "UNKNOWN", "reason_codes": ["READINESS_UNKNOWN"]}
    if profile.get("readiness_state") not in READY_STATES:
        return {"verdict": "CANNOT_ACCEPT", "reason_codes": ["READINESS_NOT_READY"]}
    try:
        validate_operational_profile(profile)
    except ReadinessError:
        return {"verdict": "UNKNOWN", "reason_codes": ["READINESS_EVIDENCE_INVALID"]}
    expires = _parse_instant(profile["freshness"]["expires_at"], "freshness.expires_at")
    if now >= expires:
        return {"verdict": "UNKNOWN", "reason_codes": ["READINESS_STALE"]}
    return {
        "verdict": "READY",
        "reason_codes": [],
        "readiness_state": profile["readiness_state"],
        "readiness_ref": profile["readiness_ref"],
        "readiness_hash": content_hash(profile),
    }


def promote_to_delivery_validated(
    profile: Mapping[str, Any],
    *,
    canary_evidence: Mapping[str, Any],
    promoted_at: str,
) -> dict[str, Any]:
    """Return a new DELIVERY_VALIDATED profile after a closed sandbox canary."""

    validate_operational_profile(profile)
    _parse_instant(promoted_at, "promoted_at")
    if profile.get("readiness_state") != "PRODUCTION_READY":
        raise ReadinessError("only PRODUCTION_READY can be delivery validated")
    if readiness_for_admission(profile, evaluated_at=promoted_at)["verdict"] != "READY":
        raise ReadinessError("stale or invalid readiness cannot be delivery validated")
    required_evidence = {
        "synthetic": True,
        "stage": "CLOSED",
        "qa_state": "PASSED",
        "delivery_state": "SANDBOX",
        "acceptance_state": "ACCEPTED_SANDBOX",
    }
    for field, expected in required_evidence.items():
        if canary_evidence.get(field) != expected:
            raise ReadinessError(f"canary evidence requires {field}={expected}")
    for field in ("work_order_id", "evidence_ref"):
        if not canary_evidence.get(field):
            raise ReadinessError(f"canary evidence missing {field}")

    promoted = deepcopy(dict(profile))
    promoted["readiness_state"] = "DELIVERY_VALIDATED"
    promoted["state_reason"] = "SANDBOX_CANARY_WORK_ORDER_CLOSED"
    promoted["canary_ref"] = {
        "work_order_id": canary_evidence["work_order_id"],
        "evidence_ref": canary_evidence["evidence_ref"],
        "completed_at": promoted_at,
        "synthetic": True,
    }
    promoted["evidence_refs"] = list(promoted.get("evidence_refs", [])) + [canary_evidence["evidence_ref"]]
    promoted["freshness"]["evaluated_at"] = promoted_at
    return promoted
