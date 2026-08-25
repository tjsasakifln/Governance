"""Deterministic sandbox producer and QA for CFG-DIAG-EXP-v1.

The producer accepts references only and never fetches customer data.  It
creates an immutable manifest that a Work Order can register as an artifact
reference.  This is the operational path for the synthetic canary, not a claim
that a real customer delivery has occurred.
"""

from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from typing import Any, Mapping

from delivery.readiness import content_hash


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_TEMPLATE = ROOT / "templates" / "cfg-diag-exp-v1.production-template.json"
DEFAULT_CHECKLIST = ROOT / "qa" / "cfg-diag-exp-v1.qa-checklist.json"
REQUIRED_INPUT_REFS = (
    "organization_identity_ref",
    "expansion_scope_ref",
    "public_portfolio_ref",
    "data_use_authorization_ref",
    "operational_channel_ref",
)


class ProductionError(ValueError):
    """Raised when the sandbox producer receives incomplete evidence refs."""


def _load(path: str | Path) -> dict[str, Any]:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def produce_sandbox_artifact(
    *,
    input_refs: Mapping[str, str],
    source_artifact_refs: list[str],
    produced_at: str,
    correlation_id: str,
    template_path: str | Path = DEFAULT_TEMPLATE,
) -> dict[str, Any]:
    """Build a deterministic synthetic artifact bundle manifest."""

    template = _load(template_path)
    if template.get("deliverable_id") != "CFG-DIAG-EXP-v1" or template.get("version") != "v1":
        raise ProductionError("template binding diverges from CFG-DIAG-EXP-v1/v1")
    missing = [key for key in REQUIRED_INPUT_REFS if not input_refs.get(key)]
    if missing:
        raise ProductionError(f"missing required input refs: {missing}")
    if not source_artifact_refs or not all(isinstance(ref, str) and ref for ref in source_artifact_refs):
        raise ProductionError("at least one public-source artifact ref is required")

    artifact = {
        "schema_version": "confenge.delivery_artifact_manifest.v1",
        "deliverable_id": "CFG-DIAG-EXP-v1",
        "deliverable_version": "v1",
        "scope_version": "CFG-SCOPE-DIAG-EXP-v1",
        "synthetic": True,
        "delivery_mode": "SANDBOX",
        "correlation_id": correlation_id,
        "produced_at": produced_at,
        "template_ref": "delivery/templates/cfg-diag-exp-v1.production-template.json",
        "input_refs": {key: input_refs[key] for key in REQUIRED_INPUT_REFS},
        "source_artifact_refs": list(source_artifact_refs),
        "sections": [
            {
                "section_id": section["section_id"],
                "component_ref": section["component_ref"],
                "state": "SANDBOX_GENERATED",
                "evidence_refs": list(source_artifact_refs),
            }
            for section in template["sections"]
        ],
        "real_customer": False,
        "real_email": False,
        "real_money": False,
    }
    artifact["artifact_ref"] = content_hash(artifact)
    return artifact


def run_qa(
    artifact: Mapping[str, Any],
    *,
    checked_at: str,
    actor_ref: str,
    checklist_path: str | Path = DEFAULT_CHECKLIST,
) -> dict[str, Any]:
    """Execute the checked-in QA checklist and return an evidence-bearing verdict."""

    checklist = _load(checklist_path)
    failures: list[str] = []
    if artifact.get("synthetic") is not True or artifact.get("delivery_mode") != "SANDBOX":
        failures.append("SYNTHETIC_SANDBOX_ONLY")
    if (artifact.get("deliverable_id"), artifact.get("deliverable_version")) != ("CFG-DIAG-EXP-v1", "v1"):
        failures.append("DELIVERABLE_BINDING")
    if any(not artifact.get("input_refs", {}).get(key) for key in REQUIRED_INPUT_REFS):
        failures.append("REQUIRED_INPUT_REFS")
    if not artifact.get("source_artifact_refs"):
        failures.append("SOURCE_EVIDENCE_REFS")
    expected_sections = {item["section_id"] for item in checklist["expected_sections"]}
    actual_sections = {item.get("section_id") for item in artifact.get("sections", [])}
    if actual_sections != expected_sections:
        failures.append("SECTION_COMPLETENESS")
    unhashed = deepcopy(dict(artifact))
    claimed_hash = unhashed.pop("artifact_ref", None)
    if claimed_hash != content_hash(unhashed):
        failures.append("ARTIFACT_INTEGRITY")
    if artifact.get("real_customer") or artifact.get("real_email") or artifact.get("real_money"):
        failures.append("REAL_WORLD_SIDE_EFFECT")

    return {
        "schema_version": "confenge.delivery_qa_result.v1",
        "deliverable_id": "CFG-DIAG-EXP-v1",
        "deliverable_version": "v1",
        "artifact_ref": artifact.get("artifact_ref"),
        "checklist_version": checklist["checklist_version"],
        "checked_at": checked_at,
        "actor_ref": actor_ref,
        "qa_state": "PASSED" if not failures else "FAILED",
        "failed_checks": failures,
        "executed_checks": [item["check_id"] for item in checklist["checks"]],
        "synthetic": True,
    }
