#!/usr/bin/env python3
"""Validate sanitized proof manifests for synchronous outreach agent batches.

This validator coordinates evidence only. It does not read the datalake, search
the web, generate copy, import drafts, approve, schedule, or send anything.
Operational data remains in extra-cli/Warmbly; Governance receives opaque
hashes and aggregate counts that can be reviewed without publishing contacts.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PROOF = ROOT / "commercial" / "fixtures" / "agent-outreach-batch-proof.example.v1.json"

SCHEMA_VERSION = "confenge.agent-outreach-batch-proof.v1"
HASH_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
OPAQUE_REF_RE = re.compile(r"^hmac-sha256:[0-9a-f]{64}$")
TOKEN_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
ISO_Z_RE = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")
EMAIL_RE = re.compile(r"(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?![A-Za-z0-9.-])")
URL_RE = re.compile(r"https?://", re.IGNORECASE)
CNPJ_RE = re.compile(r"(?<!\d)(?:\d{2}[.\s-]?\d{3}[.\s-]?\d{3}[/\s-]?\d{4}[-\s]?\d{2}|\d{14})(?!\d)")

LANE_STATUSES = frozenset({"OBSERVED", "NO_MATCH", "ERROR"})
RECONCILIATION_STATUSES = frozenset(
    {
        "DATALAKE_WEB_CORROBORATED",
        "DATALAKE_ONLY",
        "WEB_ONLY",
        "CONFLICT",
        "UNKNOWN",
    }
)
TERMINAL_OUTCOMES = frozenset(
    {"IMPORTED_NEEDS_REVIEW", "BLOCKED", "DUPLICATE", "INVALID", "RETRY_REQUIRED"}
)
RECIPIENT_CLASSES = frozenset(
    {"DIRECT_PERSON", "ROLE_OR_DEPARTMENT", "GENERIC_COMPANY", "PUBLIC_COMPANY_FREEMAIL"}
)
SUMMARY_KEYS = (
    "reserved_count",
    "completed_count",
    "newly_processed",
    "datalake_attempted",
    "web_attempted",
    "reconciled_count",
    "draft_generated",
    "imported_needs_review",
    "blocked",
    "duplicate",
    "invalid",
    "retry_required",
)
FORBIDDEN_DATA_KEYS = frozenset(
    {
        "cnpj",
        "email",
        "mailbox",
        "recipient",
        "recipient_address",
        "company",
        "company_name",
        "contact_name",
        "subject",
        "body",
        "body_text",
        "url",
        "source_url",
    }
)
TOP_LEVEL_KEYS = frozenset(
    {
        "schema_version",
        "agent_batch_id",
        "source_run_id",
        "source_run_hash",
        "lead_ref_scheme",
        "lead_ref_key_version",
        "executor_ref",
        "started_at",
        "completed_at",
        "reservation_expires_at",
        "policy_version",
        "template_version",
        "evidence_version",
        "universe",
        "safety",
        "summary",
        "members",
    }
)


class ValidationError(ValueError):
    """The proof cannot support the claimed batch result."""


def canonical_json(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def sha256_ref(value: Any) -> str:
    return f"sha256:{hashlib.sha256(canonical_json(value)).hexdigest()}"


def expected_idempotency_key(
    source_run_id: str,
    source_run_hash: str,
    lead_ref: str,
    lead_ref_key_version: str,
    evidence_version: str,
    template_version: str,
    policy_version: str,
) -> str:
    """Derive the public-safe source-run+lead+evidence+template+policy identity.

    ``lead_ref`` is the operational system's stable, secret-keyed CNPJ reference.
    The raw CNPJ never enters the public proof, while rerunning the same tuple
    still produces exactly the same key.
    """

    return sha256_ref(
        {
            "source_run_id": source_run_id,
            "source_run_hash": source_run_hash,
            "lead_ref": lead_ref,
            "lead_ref_key_version": lead_ref_key_version,
            "evidence_version": evidence_version,
            "template_version": template_version,
            "policy_version": policy_version,
        }
    )


def _mapping(value: Any, path: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ValidationError(f"{path} must be an object")
    return value


def _exact_keys(value: Mapping[str, Any], expected: Iterable[str], path: str) -> None:
    expected_set = frozenset(expected)
    missing = sorted(expected_set - value.keys())
    extra = sorted(value.keys() - expected_set)
    if missing or extra:
        raise ValidationError(f"{path} keys diverge: missing={missing} extra={extra}")


def _token(value: Any, path: str) -> str:
    if not isinstance(value, str) or not TOKEN_RE.fullmatch(value):
        raise ValidationError(f"{path} must be a bounded opaque token")
    return value


def _hash(value: Any, path: str) -> str:
    if not isinstance(value, str) or not HASH_RE.fullmatch(value):
        raise ValidationError(f"{path} must be sha256:<64 lowercase hex>")
    return value


def _opaque_ref(value: Any, path: str) -> str:
    if not isinstance(value, str) or not OPAQUE_REF_RE.fullmatch(value):
        raise ValidationError(f"{path} must be an HMAC-SHA256 opaque reference")
    return value


def _nonnegative_int(value: Any, path: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValidationError(f"{path} must be a non-negative integer")
    return value


def _timestamp(value: Any, path: str) -> datetime:
    if not isinstance(value, str) or not ISO_Z_RE.fullmatch(value):
        raise ValidationError(f"{path} must be UTC with whole seconds and Z")
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValidationError(f"{path} is not a real UTC calendar instant") from error


def assert_sanitized(value: Any, path: str = "$") -> None:
    if isinstance(value, Mapping):
        for key, child in value.items():
            key_text = str(key)
            if key_text.lower() in FORBIDDEN_DATA_KEYS:
                raise ValidationError(f"{path}.{key_text} is operational/contact data and cannot be committed")
            assert_sanitized(child, f"{path}.{key_text}")
        return
    if isinstance(value, list):
        for index, child in enumerate(value):
            assert_sanitized(child, f"{path}[{index}]")
        return
    if isinstance(value, str):
        # Typed digest/HMAC references can contain long decimal runs by chance;
        # they are proof material rather than raw CNPJ values.
        if HASH_RE.fullmatch(value) or OPAQUE_REF_RE.fullmatch(value):
            return
        if EMAIL_RE.search(value):
            raise ValidationError(f"{path} contains an email address")
        if URL_RE.search(value):
            raise ValidationError(f"{path} contains a source URL")
        if CNPJ_RE.search(value):
            raise ValidationError(f"{path} contains a CNPJ")


def _validate_lane(value: Any, path: str, started: datetime, completed: datetime) -> Mapping[str, Any]:
    lane = _mapping(value, path)
    _exact_keys(lane, {"status", "observed_at", "attempt_hash", "evidence_count"}, path)
    if lane["status"] not in LANE_STATUSES:
        raise ValidationError(f"{path}.status is not an attempted lane result")
    observed = _timestamp(lane["observed_at"], f"{path}.observed_at")
    if observed < started or observed > completed:
        raise ValidationError(f"{path}.observed_at falls outside the batch execution window")
    _hash(lane["attempt_hash"], f"{path}.attempt_hash")
    count = _nonnegative_int(lane["evidence_count"], f"{path}.evidence_count")
    if lane["status"] == "OBSERVED" and count == 0:
        raise ValidationError(f"{path} claims OBSERVED without evidence")
    return lane


def _validate_draft(value: Any, path: str) -> Mapping[str, Any]:
    draft = _mapping(value, path)
    _exact_keys(
        draft,
        {"state", "recipient_class", "content_hash", "evidence_bundle_hash", "import_receipt_hash"},
        path,
    )
    if draft["state"] != "NEEDS_REVIEW":
        raise ValidationError(f"{path}.state must be NEEDS_REVIEW; approval/scheduling/send is forbidden")
    if draft["recipient_class"] not in RECIPIENT_CLASSES:
        raise ValidationError(f"{path}.recipient_class is not an attributable-company route")
    for key in ("content_hash", "evidence_bundle_hash", "import_receipt_hash"):
        _hash(draft[key], f"{path}.{key}")
    if len({draft["content_hash"], draft["evidence_bundle_hash"], draft["import_receipt_hash"]}) != 3:
        raise ValidationError(f"{path} reuses one hash for semantically distinct artifacts")
    return draft


def validate_document(document: Any) -> dict[str, Any]:
    assert_sanitized(document)
    doc = _mapping(document, "$")
    _exact_keys(doc, TOP_LEVEL_KEYS, "$")
    if doc["schema_version"] != SCHEMA_VERSION:
        raise ValidationError("$.schema_version is not the batch proof v1 contract")
    for key in (
        "agent_batch_id",
        "source_run_id",
        "lead_ref_key_version",
        "executor_ref",
        "policy_version",
        "template_version",
        "evidence_version",
    ):
        _token(doc[key], f"$.{key}")
    _hash(doc["source_run_hash"], "$.source_run_hash")
    if doc["lead_ref_scheme"] != "HMAC_SHA256_V1":
        raise ValidationError("$.lead_ref_scheme must be HMAC_SHA256_V1")
    started = _timestamp(doc["started_at"], "$.started_at")
    completed = _timestamp(doc["completed_at"], "$.completed_at")
    expires = _timestamp(doc["reservation_expires_at"], "$.reservation_expires_at")
    if completed < started:
        raise ValidationError("batch completed before it started")
    if expires < completed:
        raise ValidationError("batch completed after its reservation expired")

    universe = _mapping(doc["universe"], "$.universe")
    _exact_keys(
        universe,
        {
            "target_confirmed_total",
            "batch_reserved",
            "unique_processed_total_before_batch",
            "unique_processed_total_after_batch",
            "remaining_after_batch",
        },
        "$.universe",
    )
    total = _nonnegative_int(universe["target_confirmed_total"], "$.universe.target_confirmed_total")
    reserved = _nonnegative_int(universe["batch_reserved"], "$.universe.batch_reserved")
    processed_before = _nonnegative_int(
        universe["unique_processed_total_before_batch"], "$.universe.unique_processed_total_before_batch"
    )
    processed_after = _nonnegative_int(
        universe["unique_processed_total_after_batch"], "$.universe.unique_processed_total_after_batch"
    )
    remaining = _nonnegative_int(universe["remaining_after_batch"], "$.universe.remaining_after_batch")
    if reserved > total:
        raise ValidationError("$.universe.batch_reserved exceeds the TARGET_CONFIRMED denominator")
    if processed_before > total or processed_after > total or processed_after < processed_before:
        raise ValidationError("$.universe processed totals are not monotonic within the denominator")
    if remaining != total - processed_after:
        raise ValidationError("$.universe does not reconcile processed and remaining against the denominator")

    safety = _mapping(doc["safety"], "$.safety")
    _exact_keys(
        safety,
        {
            "llm_api_calls",
            "runtime_generation",
            "provider_mutations",
            "approvals",
            "scheduled",
            "sent",
            "auto_send_changed",
            "kill_switch_changed",
            "operational_data_included",
        },
        "$.safety",
    )
    for key in ("llm_api_calls", "provider_mutations", "approvals", "scheduled", "sent"):
        if _nonnegative_int(safety[key], f"$.safety.{key}") != 0:
            raise ValidationError(f"$.safety.{key} must be zero")
    for key in ("runtime_generation", "auto_send_changed", "kill_switch_changed", "operational_data_included"):
        if safety[key] is not False:
            raise ValidationError(f"$.safety.{key} must be false")

    members = doc["members"]
    if not isinstance(members, list) or not members:
        raise ValidationError("$.members must contain the entire reserved batch")
    if len(members) > 500:
        raise ValidationError("$.members may reserve at most 500 leads per synchronous agent batch")
    if reserved != len(members):
        raise ValidationError("$.universe.batch_reserved does not equal the member count")

    lead_refs: set[str] = set()
    idempotency_keys: set[str] = set()
    import_receipt_hashes: set[str] = set()
    outcome_counts = {outcome: 0 for outcome in TERMINAL_OUTCOMES}
    reconciled_count = 0
    generated_count = 0
    newly_processed = 0
    for index, raw_member in enumerate(members):
        path = f"$.members[{index}]"
        member = _mapping(raw_member, path)
        base_keys = {
            "lead_ref",
            "denominator_effect",
            "lanes",
            "reconciliation_status",
            "critical_conflict",
            "outcome",
            "idempotency_key",
        }
        outcome = member.get("outcome")
        expected_keys = base_keys | ({"draft"} if outcome == "IMPORTED_NEEDS_REVIEW" else {"blocker"})
        _exact_keys(member, expected_keys, path)
        lead_ref = _opaque_ref(member["lead_ref"], f"{path}.lead_ref")
        if lead_ref in lead_refs:
            raise ValidationError(f"{path}.lead_ref is reserved twice in one batch")
        lead_refs.add(lead_ref)
        denominator_effect = member["denominator_effect"]
        if denominator_effect not in {"NEWLY_PROCESSED", "ALREADY_PROCESSED"}:
            raise ValidationError(f"{path}.denominator_effect is invalid")
        if denominator_effect == "NEWLY_PROCESSED":
            newly_processed += 1

        lanes = _mapping(member["lanes"], f"{path}.lanes")
        _exact_keys(lanes, {"datalake", "web"}, f"{path}.lanes")
        datalake = _validate_lane(lanes["datalake"], f"{path}.lanes.datalake", started, completed)
        web = _validate_lane(lanes["web"], f"{path}.lanes.web", started, completed)

        reconciliation = member["reconciliation_status"]
        if reconciliation not in RECONCILIATION_STATUSES:
            raise ValidationError(f"{path}.reconciliation_status is invalid")
        if not isinstance(member["critical_conflict"], bool):
            raise ValidationError(f"{path}.critical_conflict must be boolean")
        lane_statuses = (datalake["status"], web["status"])
        if "ERROR" in lane_statuses and reconciliation != "UNKNOWN":
            raise ValidationError(f"{path}.reconciliation_status must be UNKNOWN after a lane error")
        expected_lane_statuses = {
            "DATALAKE_WEB_CORROBORATED": ("OBSERVED", "OBSERVED"),
            "DATALAKE_ONLY": ("OBSERVED", "NO_MATCH"),
            "WEB_ONLY": ("NO_MATCH", "OBSERVED"),
            "CONFLICT": ("OBSERVED", "OBSERVED"),
        }
        if reconciliation in expected_lane_statuses and lane_statuses != expected_lane_statuses[reconciliation]:
            raise ValidationError(f"{path}.reconciliation_status contradicts the two lane results")
        if member["critical_conflict"] and reconciliation != "CONFLICT":
            raise ValidationError(f"{path}.critical_conflict requires reconciliation_status CONFLICT")
        if outcome not in TERMINAL_OUTCOMES:
            raise ValidationError(f"{path}.outcome is not terminal")
        outcome_counts[outcome] += 1
        if reconciliation not in {"CONFLICT", "UNKNOWN"}:
            reconciled_count += 1

        expected_key = expected_idempotency_key(
            doc["source_run_id"],
            doc["source_run_hash"],
            lead_ref,
            doc["lead_ref_key_version"],
            doc["evidence_version"],
            doc["template_version"],
            doc["policy_version"],
        )
        if member["idempotency_key"] != expected_key:
            raise ValidationError(
                f"{path}.idempotency_key does not match source-run+lead-key+evidence+template+policy"
            )
        if member["idempotency_key"] in idempotency_keys:
            raise ValidationError(f"{path}.idempotency_key is duplicated")
        idempotency_keys.add(member["idempotency_key"])

        if outcome == "IMPORTED_NEEDS_REVIEW":
            if datalake["status"] == "ERROR" or web["status"] == "ERROR":
                raise ValidationError(f"{path} imported a draft while an evidence lane failed")
            if reconciliation in {"CONFLICT", "UNKNOWN"} or member["critical_conflict"]:
                raise ValidationError(f"{path} imported a draft without safe reconciliation")
            draft = _validate_draft(member["draft"], f"{path}.draft")
            receipt_hash = draft["import_receipt_hash"]
            if receipt_hash in import_receipt_hashes:
                raise ValidationError(f"{path}.draft.import_receipt_hash is reused by another member")
            import_receipt_hashes.add(receipt_hash)
            generated_count += 1
        else:
            blocker = _mapping(member["blocker"], f"{path}.blocker")
            _exact_keys(blocker, {"code", "next_action_code", "evidence_hash"}, f"{path}.blocker")
            _token(blocker["code"], f"{path}.blocker.code")
            _token(blocker["next_action_code"], f"{path}.blocker.next_action_code")
            _hash(blocker["evidence_hash"], f"{path}.blocker.evidence_hash")

    summary = _mapping(doc["summary"], "$.summary")
    _exact_keys(summary, SUMMARY_KEYS, "$.summary")
    for key in SUMMARY_KEYS:
        _nonnegative_int(summary[key], f"$.summary.{key}")
    expected_summary = {
        "reserved_count": len(members),
        "completed_count": len(members),
        "newly_processed": newly_processed,
        "datalake_attempted": len(members),
        "web_attempted": len(members),
        "reconciled_count": reconciled_count,
        "draft_generated": generated_count,
        "imported_needs_review": outcome_counts["IMPORTED_NEEDS_REVIEW"],
        "blocked": outcome_counts["BLOCKED"],
        "duplicate": outcome_counts["DUPLICATE"],
        "invalid": outcome_counts["INVALID"],
        "retry_required": outcome_counts["RETRY_REQUIRED"],
    }
    if dict(summary) != expected_summary:
        raise ValidationError(f"$.summary does not reconcile members: expected={expected_summary}")
    if processed_after != processed_before + newly_processed:
        raise ValidationError("$.universe processed delta does not equal members marked NEWLY_PROCESSED")

    return {
        "agent_batch_id": doc["agent_batch_id"],
        "source_run_id": doc["source_run_id"],
        "source_run_hash": doc["source_run_hash"],
        "lead_ref_key_version": doc["lead_ref_key_version"],
        "target_confirmed_total": total,
        "started_at": started,
        "completed_at": completed,
        "reservation_expires_at": expires,
        "member_outcomes": [
            (
                member["lead_ref"],
                member["idempotency_key"],
                member["outcome"],
                member.get("draft", {}).get("import_receipt_hash"),
            )
            for member in members
        ],
        "manifest_hash": sha256_ref(doc),
    }


def validate_documents(documents: Sequence[Any]) -> list[dict[str, Any]]:
    results = [validate_document(document) for document in documents]
    batch_ids: set[str] = set()
    windows: dict[str, list[tuple[datetime, datetime, str]]] = {}
    imported_by_key: dict[str, str] = {}
    imported_by_receipt: dict[str, str] = {}
    source_runs: dict[str, tuple[str, int, str]] = {}
    for result in results:
        batch_id = result["agent_batch_id"]
        if batch_id in batch_ids:
            raise ValidationError(f"agent_batch_id {batch_id} is duplicated")
        batch_ids.add(batch_id)
        source_run_id = result["source_run_id"]
        source_identity = (
            result["source_run_hash"],
            result["target_confirmed_total"],
            result["lead_ref_key_version"],
        )
        if source_run_id in source_runs and source_runs[source_run_id] != source_identity:
            raise ValidationError(f"source_run_id {source_run_id} has divergent identity or denominator")
        source_runs[source_run_id] = source_identity
        for lead_ref, key, outcome, receipt_hash in result["member_outcomes"]:
            for prior_start, prior_expiry, prior_batch in windows.get(lead_ref, []):
                if result["started_at"] < prior_expiry and prior_start < result["reservation_expires_at"]:
                    raise ValidationError(
                        f"lead {lead_ref} has overlapping reservations in {prior_batch} and {batch_id}"
                    )
            windows.setdefault(lead_ref, []).append(
                (result["started_at"], result["reservation_expires_at"], batch_id)
            )
            if outcome == "IMPORTED_NEEDS_REVIEW":
                if key in imported_by_key:
                    raise ValidationError(
                        f"idempotency key was imported by both {imported_by_key[key]} and {batch_id}"
                    )
                imported_by_key[key] = batch_id
                if receipt_hash in imported_by_receipt:
                    raise ValidationError(
                        f"import receipt was claimed by both {imported_by_receipt[receipt_hash]} and {batch_id}"
                    )
                imported_by_receipt[receipt_hash] = batch_id
    return results


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths", nargs="*", type=Path, default=[DEFAULT_PROOF])
    args = parser.parse_args(argv)
    paths = args.paths or [DEFAULT_PROOF]
    try:
        documents = [load_json(path) for path in paths]
        results = validate_documents(documents)
    except (OSError, json.JSONDecodeError, ValidationError) as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 1
    print(
        json.dumps(
            {
                "ok": True,
                "schema_version": SCHEMA_VERSION,
                "manifests": [
                    {
                        "path": str(path),
                        "agent_batch_id": result["agent_batch_id"],
                        "manifest_hash": result["manifest_hash"],
                    }
                    for path, result in zip(paths, results, strict=True)
                ],
            },
            ensure_ascii=False,
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
