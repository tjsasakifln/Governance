"""Pure NET_NEW_INBOUND_HANDRAISER admission evaluator.

Governance owns the versioned policy and this function. Warmbly remains the
commercial-registry consumer. This module does not persist a production
ledger, send mail, or open a CRM.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, Sequence

AUTHORITY_PATH = Path(__file__).resolve().parent / "net-new-inbound-handraiser.v1.json"
REQUEST_SCHEMA_VERSION = "net-new-inbound-handraiser-request.v1"
DECISION_SCHEMA_VERSION = "net-new-inbound-handraiser-admission.v1"
CANONICAL_POLICY_ID = "NET_NEW_INBOUND_HANDRAISER"
CANONICAL_POLICY_VERSION = "v1"
CANONICAL_POLICY_NAME = "NET_NEW_INBOUND_HANDRAISER-v1"
OLD_POLICY_VERSIONS = frozenset({"v0", "v2", "v3"})
ISO_Z_RE = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")
OPAQUE_REF_RE = re.compile(r"^[A-Za-z0-9:._-]{1,128}$")
PII_KEYS = frozenset(
    {
        "email",
        "e-mail",
        "phone",
        "telephone",
        "mobile",
        "whatsapp",
        "display_name",
        "full_name",
        "given_name",
        "family_name",
        "first_name",
        "last_name",
        "name",
        "cpf",
        "raw_message",
        "message_body",
        "message_text",
        "ip",
        "ip_address",
        "user_agent",
        "address",
    }
)
ACCOUNT_DISCARD_CODES = frozenset(
    {"ACCOUNT_MISSING", "ACCOUNT_REQUIRED", "ACCOUNT_NOT_FOUND"}
)


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def load_authority(path: Path | None = None) -> dict[str, Any]:
    target = path or AUTHORITY_PATH
    return json.loads(target.read_text(encoding="utf-8"))


def policy_hash(authority: Mapping[str, Any] | None = None) -> str:
    payload = authority if authority is not None else load_authority()
    digest = hashlib.sha256(canonical_json(payload).encode("utf-8")).hexdigest()
    return f"sha256:{digest}"


def _stable_id(prefix: str, value: Any) -> str:
    digest = hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()
    return f"{prefix}_{digest[:32]}"


def _parse_instant(value: Any) -> datetime | None:
    if not isinstance(value, str) or not ISO_Z_RE.match(value):
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def _nonempty_str(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _opaque_ref(value: Any) -> str | None:
    text = _nonempty_str(value)
    if text is None:
        return None
    if not OPAQUE_REF_RE.match(text) or "@" in text:
        return None
    return text


def _safe_token(value: Any) -> tuple[str | None, bool]:
    """Return (token, invalid). Non-empty values that are not opaque tokens are invalid."""
    if value in {None, ""}:
        return None, False
    token = _opaque_ref(value)
    if token is None:
        return None, True
    return token, False


def _scrub_pii_values(node: Any, forbidden_values: Sequence[str]) -> Any:
    if isinstance(node, Mapping):
        return {
            key: _scrub_pii_values(item, forbidden_values)
            for key, item in node.items()
            if str(key).lower() not in PII_KEYS
        }
    if isinstance(node, list):
        return [_scrub_pii_values(item, forbidden_values) for item in node]
    if isinstance(node, str):
        if "@" in node or any(item and item in node for item in forbidden_values):
            return None
        return node
    return node


def _pii_values(payload: Any) -> list[str]:
    values: list[str] = []

    def walk(node: Any) -> None:
        if isinstance(node, Mapping):
            for key, item in node.items():
                if str(key).lower() in PII_KEYS and isinstance(item, str) and len(item) >= 3:
                    values.append(item)
                else:
                    walk(item)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(payload)
    return values


def _flatten_keys(payload: Any) -> set[str]:
    keys: set[str] = set()

    def walk(node: Any) -> None:
        if isinstance(node, Mapping):
            for key, item in node.items():
                keys.add(str(key))
                walk(item)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(payload)
    return keys


def decision_contains_pii(decision: Mapping[str, Any], request: Mapping[str, Any]) -> bool:
    blob = canonical_json(decision)
    if any(key.lower() in PII_KEYS for key in _flatten_keys(decision)):
        return True
    return any(value in blob for value in _pii_values(request))


class ModelOnlyHandraiserStore:
    """In-memory exactly-once proof store. Not a production ledger."""

    mutation_mode = "MODEL_ONLY"

    def __init__(self) -> None:
        self._by_key: dict[str, dict[str, Any]] = {}

    def get(self, idempotency_key: str) -> dict[str, Any] | None:
        record = self._by_key.get(idempotency_key)
        return deepcopy(record) if record is not None else None

    def put(self, idempotency_key: str, material_hash: str, decision: Mapping[str, Any]) -> None:
        self._by_key[idempotency_key] = {
            "material_hash": material_hash,
            "decision": deepcopy(dict(decision)),
        }

    def __len__(self) -> int:
        return len(self._by_key)

    def accepted_logical_count(self) -> int:
        return sum(
            1
            for record in self._by_key.values()
            if record["decision"]["decision"] == "ACCEPTED"
        )

    def keys(self) -> tuple[str, ...]:
        return tuple(self._by_key.keys())


def _material_view(request: Mapping[str, Any]) -> dict[str, Any]:
    contact = request.get("contact_evidence") if isinstance(request.get("contact_evidence"), Mapping) else None
    consent = request.get("consent_evidence") if isinstance(request.get("consent_evidence"), Mapping) else None
    source = request.get("source") if isinstance(request.get("source"), Mapping) else None
    freshness = request.get("freshness") if isinstance(request.get("freshness"), Mapping) else None
    return {
        "origin": request.get("origin"),
        "acquisition_lane": request.get("acquisition_lane"),
        "intent_kind": request.get("intent_kind"),
        "idempotency_key": request.get("idempotency_key"),
        "correlation_id": request.get("correlation_id"),
        "receipt_id": request.get("receipt_id"),
        "subject_ref": request.get("subject_ref"),
        "account_ref": request.get("account_ref"),
        "opt_out": request.get("opt_out"),
        "contact_evidence": {
            "present": None if contact is None else contact.get("present"),
            "channel": None if contact is None else contact.get("channel"),
            "evidence_ref": None if contact is None else contact.get("evidence_ref"),
            "identity_match_method": None if contact is None else contact.get("identity_match_method"),
        },
        "consent_evidence": {
            "captured": None if consent is None else consent.get("captured"),
            "basis": None if consent is None else consent.get("basis"),
            "evidence_ref": None if consent is None else consent.get("evidence_ref"),
        },
        "source": None
        if source is None
        else {"system": source.get("system"), "issue_ref": source.get("issue_ref")},
        "freshness": None
        if freshness is None
        else {
            "as_of": freshness.get("as_of"),
            "max_age_seconds": freshness.get("max_age_seconds"),
        },
        "policy_id": request.get("policy_id"),
        "policy_version": request.get("policy_version"),
        "canonical_name": request.get("canonical_name"),
    }


def _replay(stored: Mapping[str, Any]) -> dict[str, Any]:
    decision = deepcopy(stored["decision"])
    decision["replayed"] = True
    metrics = dict(decision.get("metrics") or {})
    metrics["replayed"] = True
    decision["metrics"] = metrics
    return decision


def evaluate_net_new_inbound_handraiser(
    request: Mapping[str, Any] | None,
    *,
    store: ModelOnlyHandraiserStore | None = None,
    authority: Mapping[str, Any] | None = None,
    intake_paused: bool = False,
    evaluated_at: str,
) -> dict[str, Any]:
    """Admit a net-new inbound hand-raiser. Returns one closed state only."""

    unknown_reasons: list[str] = []
    rejected_reasons: list[str] = []

    def unknown(code: str) -> None:
        if code not in unknown_reasons:
            unknown_reasons.append(code)

    def reject(code: str) -> None:
        if code not in rejected_reasons:
            rejected_reasons.append(code)

    if authority is None:
        try:
            authority = load_authority()
        except (OSError, json.JSONDecodeError):
            authority = {}
            unknown("AUTHORITY_UNAVAILABLE")

    if not isinstance(authority, Mapping) or authority.get("canonical_name") != CANONICAL_POLICY_NAME:
        unknown("AUTHORITY_UNAVAILABLE")
        inputs: Mapping[str, Any] = {}
        codes: Mapping[str, Any] = {}
        activation: Mapping[str, Any] = {}
    else:
        inputs = authority.get("inputs") if isinstance(authority.get("inputs"), Mapping) else {}
        codes = authority.get("reason_codes") if isinstance(authority.get("reason_codes"), Mapping) else {}
        activation = authority.get("activation") if isinstance(authority.get("activation"), Mapping) else {}

    admitted_origins = set(inputs.get("admitted_origins") or ())
    admitted_lanes = set(inputs.get("admitted_acquisition_lanes") or ())
    admitted_intents = set(inputs.get("admitted_intent_kinds") or ())
    admitted_consent = set(inputs.get("admitted_consent_bases") or ())
    admitted_match = set(inputs.get("admitted_identity_match_methods") or ())
    forbidden_match = set(inputs.get("forbidden_identity_match_methods") or ())
    never_emitted = set(codes.get("never_emitted") or ACCOUNT_DISCARD_CODES)

    payload: Mapping[str, Any] = request if isinstance(request, Mapping) else {}
    if not isinstance(request, Mapping):
        unknown("REQUEST_INVALID")
    elif payload.get("schema_version") != REQUEST_SCHEMA_VERSION:
        unknown("REQUEST_INVALID")

    origin = payload.get("origin")
    lane = payload.get("acquisition_lane")
    intent = payload.get("intent_kind")
    idempotency_key = payload.get("idempotency_key")
    correlation_id = payload.get("correlation_id")
    receipt_id = payload.get("receipt_id")
    subject_raw = payload.get("subject_ref")
    account_raw = payload.get("account_ref")
    contact = payload.get("contact_evidence")
    consent = payload.get("consent_evidence")
    source = payload.get("source")
    freshness = payload.get("freshness")

    extra_intents = payload.get("intent_kinds")
    if isinstance(intent, list) or (extra_intents is not None and extra_intents != intent):
        unknown("INTENT_KIND_AMBIGUOUS")

    accepted_versions = set(activation.get("accepted_version_strings") or {CANONICAL_POLICY_VERSION, CANONICAL_POLICY_NAME})
    accepted_ids = set(activation.get("accepted_policy_ids") or {CANONICAL_POLICY_ID})
    claimed_id = _nonempty_str(payload.get("policy_id"))
    claimed_version = _nonempty_str(payload.get("policy_version"))
    claimed_name = _nonempty_str(payload.get("canonical_name"))
    if claimed_id is None and claimed_version is None and claimed_name is None:
        unknown("POLICY_VERSION_MISSING")
    else:
        if claimed_id is not None and claimed_id not in accepted_ids:
            if claimed_id in {"CFG-FIRST-TOUCH-ROUTING", "ACQUISITION_PRESSURE"}:
                reject("POLICY_VERSION_NOT_ADMITTED")
            else:
                unknown("POLICY_ID_UNKNOWN")
        if claimed_name is not None and claimed_name not in accepted_versions:
            if claimed_name.startswith("NET_NEW_INBOUND_HANDRAISER-") or claimed_name in OLD_POLICY_VERSIONS:
                reject("POLICY_VERSION_NOT_ADMITTED")
            else:
                unknown("POLICY_VERSION_UNKNOWN")
        if claimed_version is not None:
            if claimed_version in accepted_versions:
                pass
            elif claimed_version in OLD_POLICY_VERSIONS or claimed_version.startswith("v") and claimed_version != CANONICAL_POLICY_VERSION:
                reject("POLICY_VERSION_NOT_ADMITTED")
            else:
                unknown("POLICY_VERSION_UNKNOWN")

    origin_s, origin_invalid = _safe_token(origin)
    lane_s, lane_invalid = _safe_token(lane)
    intent_s, intent_invalid = _safe_token(intent)
    key_s, key_invalid = _safe_token(idempotency_key)
    corr_s, corr_invalid = _safe_token(correlation_id)
    receipt_s, receipt_invalid = _safe_token(receipt_id)

    if origin_invalid or lane_invalid or intent_invalid or key_invalid or corr_invalid or receipt_invalid:
        unknown("REQUEST_INVALID")

    if origin_s is None and not origin_invalid:
        unknown("ORIGIN_UNKNOWN")
    elif origin_s is not None and origin_s not in admitted_origins:
        reject("ORIGIN_NOT_ADMITTED")

    if lane_s is None and not lane_invalid:
        unknown("ACQUISITION_LANE_UNKNOWN")
    elif lane_s is not None and lane_s not in admitted_lanes:
        reject("ACQUISITION_LANE_NOT_ADMITTED")

    if intent_invalid:
        pass
    elif intent_s is None:
        unknown("INTENT_KIND_UNKNOWN")
    elif intent_s not in admitted_intents:
        reject("INTENT_KIND_NOT_ADMITTED")

    if key_s is None and not key_invalid:
        unknown("IDEMPOTENCY_KEY_MISSING")
    if corr_s is None and not corr_invalid:
        unknown("CORRELATION_UNKNOWN")
    if receipt_s is None and not receipt_invalid:
        unknown("RECEIPT_UNKNOWN")

    subject_ref: str | None = None
    if subject_raw not in {None, ""}:
        subject_ref = _opaque_ref(subject_raw)
        if subject_ref is None:
            unknown("SUBJECT_REFERENCE_AMBIGUOUS")

    account_present = account_raw not in {None, ""}
    account_ref = None
    if account_present:
        account_ref = _opaque_ref(account_raw)
        if account_ref is None:
            unknown("SUBJECT_REFERENCE_AMBIGUOUS")
            account_present = False
        elif subject_ref is not None and account_ref != subject_ref:
            reject("IDENTITY_CONFLICT")

    match_method = None
    if not isinstance(contact, Mapping):
        unknown("CONTACT_EVIDENCE_UNKNOWN")
    else:
        match_method = _nonempty_str(contact.get("identity_match_method"))
        if (
            contact.get("present") is not True
            or not _nonempty_str(contact.get("evidence_ref"))
            or not _nonempty_str(contact.get("channel"))
            or match_method is None
        ):
            unknown("CONTACT_EVIDENCE_UNKNOWN")
        elif match_method in forbidden_match:
            reject("FUZZY_IDENTITY_FORBIDDEN")
        elif match_method not in admitted_match:
            unknown("CONTACT_EVIDENCE_UNKNOWN")
        elif match_method == "EXPLICIT_SUBJECT_REF" and subject_ref is None:
            unknown("SUBJECT_REFERENCE_AMBIGUOUS")

    if not isinstance(consent, Mapping):
        unknown("CONSENT_EVIDENCE_UNKNOWN")
    else:
        captured = consent.get("captured")
        basis = consent.get("basis")
        if captured is False:
            reject("CONSENT_REFUSED")
        elif captured is not True or not _nonempty_str(consent.get("evidence_ref")):
            unknown("CONSENT_EVIDENCE_UNKNOWN")
        elif _nonempty_str(basis) is None:
            unknown("CONSENT_AMBIGUOUS")
        elif basis not in admitted_consent:
            unknown("CONSENT_AMBIGUOUS")

    if "opt_out" in payload and payload.get("opt_out") not in {True, False}:
        unknown("REQUEST_INVALID")
    elif payload.get("opt_out") is True:
        reject("OPT_OUT_PRESENT")

    if source is not None:
        if not isinstance(source, Mapping) or not _nonempty_str(source.get("system")):
            unknown("SOURCE_UNKNOWN")

    evaluated = _parse_instant(evaluated_at)
    if evaluated is None:
        unknown("FRESHNESS_UNKNOWN")
    if freshness is not None:
        if not isinstance(freshness, Mapping):
            unknown("FRESHNESS_UNKNOWN")
        else:
            as_of = _parse_instant(freshness.get("as_of"))
            max_age = freshness.get("max_age_seconds")
            if (
                as_of is None
                or evaluated is None
                or not isinstance(max_age, int)
                or isinstance(max_age, bool)
                or max_age <= 0
            ):
                unknown("FRESHNESS_UNKNOWN")
            else:
                age = int((evaluated - as_of).total_seconds())
                if age < 0:
                    unknown("FRESHNESS_UNKNOWN")
                elif age > max_age:
                    unknown("FRESHNESS_STALE")

    material = _material_view(payload)
    material_hash = hashlib.sha256(canonical_json(material).encode("utf-8")).hexdigest()

    if store is not None and key_s is not None:
        existing = store.get(key_s)
        if existing is not None:
            if existing["material_hash"] == material_hash:
                return _replay(existing)
            reject("IDEMPOTENCY_PAYLOAD_CONFLICT")

    if intake_paused:
        reject("INTAKE_PAUSED")

    if unknown_reasons:
        decision_state = "UNKNOWN"
        reason_codes = unknown_reasons + [code for code in rejected_reasons if code not in unknown_reasons]
    elif rejected_reasons:
        decision_state = "REJECTED_WITH_REASON"
        reason_codes = rejected_reasons
    else:
        decision_state = "ACCEPTED"
        reason_codes = ["ADMISSION_GATES_SATISFIED"]

    reason_codes = [code for code in reason_codes if code not in never_emitted]
    if not reason_codes:
        decision_state = "UNKNOWN"
        reason_codes = ["REQUEST_INVALID"]

    accepted = decision_state == "ACCEPTED"
    identity_authorization = "INBOUND_ONLY" if accepted else "NONE"
    logical_basis = {
        "policy_id": "NET_NEW_INBOUND_HANDRAISER",
        "policy_version": "v1",
        "idempotency_key": key_s,
        "material_hash": material_hash,
    }
    decision_id = _stable_id("nihr", logical_basis)

    decision = {
        "schema_version": DECISION_SCHEMA_VERSION,
        "policy_id": "NET_NEW_INBOUND_HANDRAISER",
        "policy_version": "v1",
        "canonical_name": "NET_NEW_INBOUND_HANDRAISER-v1",
        "decision_id": decision_id,
        "logical_admission_id": decision_id,
        "decision": decision_state,
        "reason_codes": reason_codes,
        "idempotency_key": key_s,
        "correlation_id": corr_s,
        "receipt_id": receipt_s,
        "replayed": False,
        "origin": origin_s,
        "acquisition_lane": lane_s,
        "intent_kind": intent_s,
        "subject_ref": subject_ref,
        "account_present": bool(account_present),
        "inbound_only": True if accepted else False,
        "outbound_eligible": False,
        "smtp_authorized": False,
        "followup_authorized": False,
        "account_required_for_acceptance": False,
        "identity_authorization": identity_authorization,
        "consumer_authorization": {
            "create_inbound_only_identity": accepted,
            "surface_on_commercial_queue": accepted,
            "outbound_eligible": False,
            "smtp_authorized": False,
            "followup_authorized": False,
            "fuzzy_identity_by_name": False,
        },
        "metrics": {
            "decision": decision_state,
            "reason_codes": list(reason_codes),
            "replayed": False,
            "origin": origin_s,
            "acquisition_lane": lane_s,
            "intent_kind": intent_s,
            "inbound_only": True if accepted else False,
            "outbound_eligible": False,
            "smtp_authorized": False,
        },
        "rollback": {
            "intake_paused": bool(intake_paused),
            "receipts_retained": True,
            "delete_forbidden": True,
            "outbound_promotion_forbidden": True,
        },
        "contains_pii": False,
        "mutation_mode": "MODEL_ONLY",
        "evaluated_at": evaluated_at if _parse_instant(evaluated_at) else "1970-01-01T00:00:00Z",
    }

    if decision_contains_pii(decision, payload) or "@" in canonical_json(decision):
        decision = _scrub_pii_values(decision, _pii_values(payload))
        decision["decision"] = "UNKNOWN"
        reasons = [
            code
            for code in list(decision.get("reason_codes") or [])
            if code not in {"ADMISSION_GATES_SATISFIED"}
        ]
        if "REQUEST_INVALID" not in reasons:
            reasons.insert(0, "REQUEST_INVALID")
        if not reasons:
            reasons = ["REQUEST_INVALID"]
        decision["reason_codes"] = reasons
        decision["identity_authorization"] = "NONE"
        decision["inbound_only"] = False
        decision["consumer_authorization"]["create_inbound_only_identity"] = False
        decision["consumer_authorization"]["surface_on_commercial_queue"] = False
        decision["metrics"]["decision"] = "UNKNOWN"
        decision["metrics"]["reason_codes"] = list(reasons)
        decision["metrics"]["inbound_only"] = False
        decision["contains_pii"] = False

    if store is not None and key_s is not None:
        existing = store.get(key_s)
        if existing is None:
            store.put(key_s, material_hash, decision)
        elif existing["material_hash"] != material_hash:
            # Conflict is not a second logical admission.
            pass

    return decision


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Evaluate NET_NEW_INBOUND_HANDRAISER admission")
    parser.add_argument("--fixture", required=True, help="Path to a request JSON fixture")
    parser.add_argument("--evaluated-at", default="2026-09-03T12:00:00Z")
    parser.add_argument("--intake-paused", action="store_true")
    args = parser.parse_args(argv)
    request = json.loads(Path(args.fixture).read_text(encoding="utf-8"))
    decision = evaluate_net_new_inbound_handraiser(
        request,
        store=ModelOnlyHandraiserStore(),
        intake_paused=args.intake_paused,
        evaluated_at=args.evaluated_at,
    )
    sys.stdout.write(canonical_json(decision) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
