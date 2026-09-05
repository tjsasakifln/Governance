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
DRAFT_AUTHORITY_PATH = (
    Path(__file__).resolve().parent / "net-new-inbound-handraiser.1.0.0-draft.20260904.json"
)
DRAFT_CONSUMER_MATRIX_PATH = (
    Path(__file__).resolve().parent / "consumer-matrix.1.0.0-draft.20260904.json"
)
REQUEST_SCHEMA_VERSION = "net-new-inbound-handraiser-request.v1"
DECISION_SCHEMA_VERSION = "net-new-inbound-handraiser-admission.v1"
DRAFT_REQUEST_SCHEMA_VERSION = "net-new-inbound-handraiser-request.1.0.0-draft.20260904"
DRAFT_DECISION_SCHEMA_VERSION = "net-new-inbound-handraiser-admission.1.0.0-draft.20260904"
CANONICAL_POLICY_ID = "NET_NEW_INBOUND_HANDRAISER"
CANONICAL_POLICY_VERSION = "v1"
CANONICAL_POLICY_NAME = "NET_NEW_INBOUND_HANDRAISER-v1"
DRAFT_POLICY_VERSION = "1.0.0-draft.20260904"
DRAFT_CANONICAL_NAME = "NET_NEW_INBOUND_HANDRAISER/1.0.0-draft.20260904"
DRAFT_ACCEPTED_VERSIONS = frozenset({DRAFT_POLICY_VERSION, DRAFT_CANONICAL_NAME})
OLD_POLICY_VERSIONS = frozenset({"v0", "v2", "v3"})
LIVE_INTELLIGENCE_ORIGINS = frozenset({"intel_watch", "intel_seed", "PNCP_LIVE"})
FIRST_TOUCH_POLICY_IDS = frozenset({"CFG-FIRST-TOUCH-ROUTING"})
OLD_CANONICAL_NAMES = frozenset({"NET_NEW_INBOUND_HANDRAISER-v1", "NET_NEW_INBOUND_HANDRAISER-v0"})
PROTECTED_NON_CLEAR_STATUSES = frozenset({"UNKNOWN", "HIT", "DECLINE", "NOT_SCREENED"})
DECLINE_CLASS_STATUSES = frozenset({"HIT", "DECLINE"})
WARMBLY_CONSUMER_PREFIXES = ("Warmbly", "warmbly")
MEETCFG_CONSUMER_PREFIXES = ("MeetCFG", "Meetcfg", "meetcfg")
LOCATION_FORBIDDEN_FIELDS = frozenset(
    {"street", "address", "cep", "zip", "lat", "lon", "latitude", "longitude", "email"}
)
SENSITIVE_CONTENT_KEYS = frozenset({"content", "raw", "text", "payload", "body", "message"})
ISO_Z_RE = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")
OPAQUE_REF_RE = re.compile(r"^[A-Za-z0-9:._-]{1,128}$")
# site_location.city/uf are the only free-form strings the policy lets through
# unhashed, so they are validated by value and not only by key. A street, CEP,
# CPF, phone number or e-mail stuffed into `city` is not a minimized location.
CITY_MAX_LEN = 80
CITY_FORBIDDEN_CHARS = frozenset("0123456789@,;:/\\#|<>[]{}()\"=+*&%$!?\t\r\n")
UF_RE = re.compile(r"^[A-Z]{2}$")
IBGE_RE = re.compile(r"^[0-9]{7}$")
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


def load_draft_authority(path: Path | None = None) -> dict[str, Any]:
    target = path or DRAFT_AUTHORITY_PATH
    return json.loads(target.read_text(encoding="utf-8"))


def _claims_draft(payload: Mapping[str, Any]) -> bool:
    schema = _nonempty_str(payload.get("schema_version"))
    version = _nonempty_str(payload.get("policy_version"))
    name = _nonempty_str(payload.get("canonical_name"))
    return (
        schema == DRAFT_REQUEST_SCHEMA_VERSION
        or version in DRAFT_ACCEPTED_VERSIONS
        or name == DRAFT_CANONICAL_NAME
    )


def policy_hash(authority: Mapping[str, Any] | None = None) -> str:
    payload = authority if authority is not None else load_authority()
    digest = hashlib.sha256(canonical_json(payload).encode("utf-8")).hexdigest()
    return f"sha256:{digest}"


def _canonical_conflict_status(status: str | None) -> str | None:
    if status in DECLINE_CLASS_STATUSES:
        return "HIT"
    return status


def load_draft_consumer_matrix(path: Path | None = None) -> dict[str, Any]:
    target = path or DRAFT_CONSUMER_MATRIX_PATH
    return json.loads(target.read_text(encoding="utf-8"))


def _consumer_plane(consumer_id: str | None) -> str | None:
    if consumer_id is None:
        return None
    if consumer_id.startswith(WARMBLY_CONSUMER_PREFIXES):
        return "Warmbly"
    if consumer_id.startswith(MEETCFG_CONSUMER_PREFIXES):
        return "Meetcfg"
    return None


def evaluate_consumer_pin(
    pin: Mapping[str, Any] | None,
    *,
    authority: Mapping[str, Any] | None = None,
    matrix: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Ratify a Warmbly/Meetcfg pin. Missing or divergent version/hash fail closed."""

    # Fail closed on a broken, missing, or incomplete authority, exactly like the
    # request path (_evaluate_draft). A passed-in document that is not the live
    # draft authority must never ratify a pin: falling back to
    # DRAFT_CANONICAL_NAME while hashing the passed-in document would produce a
    # self-inconsistent ACCEPTED.
    authority_unavailable = False
    if authority is None:
        try:
            authority = load_draft_authority()
        except (OSError, ValueError):
            authority = {}
            authority_unavailable = True
    if (
        not isinstance(authority, Mapping)
        or _nonempty_str(authority.get("canonical_name")) != DRAFT_CANONICAL_NAME
    ):
        authority = {}
        authority_unavailable = True

    if matrix is None:
        try:
            matrix = load_draft_consumer_matrix()
        except (OSError, ValueError):
            matrix = {}
            authority_unavailable = True
    if not isinstance(matrix, Mapping):
        matrix = {}
        authority_unavailable = True

    live_name = DRAFT_CANONICAL_NAME
    live_hash = None if authority_unavailable else policy_hash(authority)
    payload = pin if isinstance(pin, Mapping) else {}
    consumer_id = _nonempty_str(payload.get("consumer_id"))
    pin_name = _nonempty_str(payload.get("canonical_name"))
    pin_hash = _nonempty_str(payload.get("policy_hash"))
    plane = _consumer_plane(consumer_id)

    known_ids = {
        row.get("id")
        for row in (matrix.get("consumers") or [])
        if isinstance(row, Mapping) and _nonempty_str(row.get("id"))
    }
    reasons: list[str] = []
    decision_state = "ACCEPTED"

    if authority_unavailable:
        decision_state = "UNKNOWN"
        reasons.append("AUTHORITY_UNAVAILABLE")
    elif not isinstance(pin, Mapping) or consumer_id is None or plane is None:
        decision_state = "UNKNOWN"
        reasons.append("REQUEST_INVALID")
    elif consumer_id not in known_ids and consumer_id not in {plane, plane.lower()}:
        decision_state = "UNKNOWN"
        reasons.append("REQUEST_INVALID")
    elif pin_name is None or pin_hash is None:
        decision_state = "UNKNOWN"
        reasons.append("POLICY_VERSION_MISSING")
    elif pin_name in OLD_CANONICAL_NAMES or pin_name in OLD_POLICY_VERSIONS or pin_name == CANONICAL_POLICY_NAME:
        decision_state = "REJECTED_WITH_REASON"
        reasons.append("POLICY_VERSION_NOT_ADMITTED")
    elif pin_name != live_name or pin_hash != live_hash:
        decision_state = "UNKNOWN"
        reasons.append("POLICY_VERSION_UNKNOWN")
    else:
        reasons.append("ADMISSION_GATES_SATISFIED")

    return {
        "schema_version": "net-new-inbound-handraiser-consumer-pin.1.0.0-draft.20260904",
        "policy_id": CANONICAL_POLICY_ID,
        "policy_version": DRAFT_POLICY_VERSION,
        "canonical_name": live_name,
        "policy_hash": live_hash,
        "consumer_id": consumer_id,
        "consumer_plane": plane,
        "pin": {"canonical_name": pin_name, "policy_hash": pin_hash},
        "decision": decision_state,
        "reason_codes": reasons,
        "outbound_eligible": False,
        "auto_send": False,
        "smtp_authorized": False,
        "followup_authorized": False,
        "identity_authorization": "NONE",
        "mutation_mode": "MODEL_ONLY",
        "commercial_action_authorized": False,
        "queue_persist_authorized": False,
        "crm_authorized": False,
        "checkout_authorized": False,
        "proposal_authorized": False,
        "schedule_authorized": False,
        "readback": {"required": True, "http_2xx_is_not_acceptance": True},
        "rollback": {
            "intake_paused": False,
            "receipts_retained": True,
            "delete_forbidden": True,
            "outbound_promotion_forbidden": True,
            "refuse_reason_code": "INTAKE_PAUSED",
        },
    }


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


def _is_city_name(value: str) -> bool:
    """True only for something that looks like a municipality name.

    Rejects digits and punctuation used by street addresses, CEPs, CPFs, phone
    numbers and e-mails while still admitting real Brazilian municipalities
    (``Embu-Guacu``, ``Santa Barbara d'Oeste``, ``Olho d'Agua das Flores``).
    """
    if not value or len(value) > CITY_MAX_LEN:
        return False
    return not any(char in CITY_FORBIDDEN_CHARS for char in value)


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

    def __bool__(self) -> bool:
        # A store object is always truthy. Only `is None` may decide whether a
        # caller constructs a default store: an empty store that reads as falsy
        # makes `store or ModelOnlyHandraiserStore()` silently discard the first
        # admission and break exactly-once logical replay.
        return True

    def accepted_logical_count(self) -> int:
        return sum(
            1
            for record in self._by_key.values()
            if record["decision"]["decision"] == "ACCEPTED"
        )

    def keys(self) -> tuple[str, ...]:
        return tuple(self._by_key.keys())


def _material_hash(view: Any) -> str:
    """Deterministic digest of a material view, safe on non-JSON payloads."""
    try:
        blob = canonical_json(view)
    except (TypeError, ValueError):
        try:
            blob = json.dumps(
                view, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=repr
            )
        except (TypeError, ValueError):
            blob = repr(view)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def _material_view(request: Mapping[str, Any]) -> dict[str, Any]:
    """Material identity of a request: the whole request, never a projection.

    The material hash decides whether a repeated idempotency key replays the
    original decision. Any projection risks omitting a field that a hard gate
    inspects, and every omitted field is a replay bypass: a first clean
    ACCEPTED followed by the same key carrying sensitive content, an
    unminimized location, an ambiguous intent, or a different schema_version
    would inherit the ACCEPTED instead of being evaluated fresh and rejected.

    Hashing the entire request removes that class of bug by construction. It
    only ever moves outcomes from REPLAY_ORIGINAL_DECISION toward fresh
    evaluation or IDEMPOTENCY_PAYLOAD_CONFLICT, which is the fail-closed
    direction.
    """
    if not isinstance(request, Mapping):
        return {}
    return dict(request)


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

    if isinstance(request, Mapping) and _claims_draft(request):
        return _evaluate_draft(
            request,
            store=store,
            authority=authority,
            intake_paused=intake_paused,
            evaluated_at=evaluated_at,
        )

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
    if claimed_version is None:
        unknown("POLICY_VERSION_MISSING")
    elif claimed_version in accepted_versions:
        pass
    elif claimed_version in OLD_POLICY_VERSIONS or (
        claimed_version.startswith("v") and claimed_version != CANONICAL_POLICY_VERSION
    ):
        reject("POLICY_VERSION_NOT_ADMITTED")
    else:
        unknown("POLICY_VERSION_UNKNOWN")
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
    material_hash = _material_hash(material)

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


def _material_view_draft(request: Mapping[str, Any]) -> dict[str, Any]:
    """Draft material identity. Same whole-request rule as the v1 path."""
    return _material_view(request)


def _derive_qualification(
    *,
    nucleus_id: str | None,
    admitted_nuclei: set[str],
    conflict_status: str | None,
    document_class: str | None,
    partner_required: bool,
    capacity_review_required: bool,
    decision_role: str | None,
    urgency: str | None,
    why_now: str | None,
) -> str:
    if nucleus_id is not None and nucleus_id not in admitted_nuclei:
        return "OUT_OF_SCOPE"
    if conflict_status in PROTECTED_NON_CLEAR_STATUSES:
        return "CONFLICT_CHECK_REQUIRED"
    if partner_required:
        return "PARTNER_REQUIRED"
    if capacity_review_required:
        return "CAPACITY_REVIEW"
    if document_class == "GAP":
        return "DOCUMENT_GAP"
    if (
        decision_role == "UNKNOWN"
        or urgency == "UNKNOWN"
        or why_now == "UNKNOWN"
        or document_class == "UNKNOWN"
    ):
        return "NEEDS_CONTEXT"
    if conflict_status == "CLEAR" and document_class == "COMPLETE" and decision_role == "DECISION_MAKER":
        return "QCO"
    return "POTENTIAL_FIT"


def _evaluate_draft(
    request: Mapping[str, Any],
    *,
    store: ModelOnlyHandraiserStore | None,
    authority: Mapping[str, Any] | None,
    intake_paused: bool,
    evaluated_at: str,
) -> dict[str, Any]:
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
            authority = load_draft_authority()
        except (OSError, json.JSONDecodeError):
            authority = {}
            unknown("AUTHORITY_UNAVAILABLE")
    elif not isinstance(authority, Mapping):
        authority = {}
        unknown("AUTHORITY_UNAVAILABLE")
    elif authority.get("canonical_name") == CANONICAL_POLICY_NAME:
        unknown("AUTHORITY_UNAVAILABLE")
        authority = {}

    if not isinstance(authority, Mapping) or authority.get("canonical_name") != DRAFT_CANONICAL_NAME:
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
    admitted_nuclei = set(inputs.get("admitted_nuclei") or ())
    admitted_offers = set(inputs.get("admitted_offer_candidates") or ())
    admitted_intake = set(inputs.get("admitted_intake_sources") or ())
    admitted_party = set(inputs.get("admitted_party_kinds") or ())
    admitted_roles = set(inputs.get("admitted_decision_roles") or ())
    admitted_urgency = set(inputs.get("admitted_urgency") or ())
    admitted_why = set(inputs.get("admitted_why_now_classes") or ())
    admitted_deliverable = set(inputs.get("admitted_desired_deliverables") or ())
    admitted_docs = set(inputs.get("admitted_document_availability_classes") or ())
    admitted_sensitive = set(inputs.get("admitted_sensitive_classes") or ())
    admitted_conflict = set(inputs.get("admitted_conflict_statuses") or ())
    never_emitted = set(codes.get("never_emitted") or ACCOUNT_DISCARD_CODES)

    payload: Mapping[str, Any] = request if isinstance(request, Mapping) else {}
    if payload.get("schema_version") != DRAFT_REQUEST_SCHEMA_VERSION:
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
    intake_source = payload.get("intake_source")
    landing = payload.get("landing_asset")
    nucleus_raw = payload.get("nucleus_id")
    offer_raw = payload.get("offer_candidate_id")
    party_raw = payload.get("party_kind")
    role_raw = payload.get("decision_role")
    location = payload.get("site_location")
    urgency_raw = payload.get("urgency")
    why_raw = payload.get("why_now_class")
    deliverable_raw = payload.get("desired_decision_or_deliverable")
    docs_raw = payload.get("document_availability_class")
    sensitive = payload.get("sensitive_data")
    conflict = payload.get("conflict_screening")

    extra_intents = payload.get("intent_kinds")
    if isinstance(intent, list) or (extra_intents is not None and extra_intents != intent):
        unknown("INTENT_KIND_AMBIGUOUS")

    accepted_versions = set(activation.get("accepted_version_strings") or DRAFT_ACCEPTED_VERSIONS)
    accepted_ids = set(activation.get("accepted_policy_ids") or {CANONICAL_POLICY_ID})
    claimed_id = _nonempty_str(payload.get("policy_id"))
    claimed_version = _nonempty_str(payload.get("policy_version"))
    claimed_name = _nonempty_str(payload.get("canonical_name"))
    if claimed_version is None:
        unknown("POLICY_VERSION_MISSING")
    elif claimed_version in accepted_versions:
        pass
    elif claimed_version in {CANONICAL_POLICY_VERSION, CANONICAL_POLICY_NAME} or claimed_version in OLD_POLICY_VERSIONS:
        reject("POLICY_VERSION_NOT_ADMITTED")
    else:
        unknown("POLICY_VERSION_UNKNOWN")
    if claimed_id is not None and claimed_id not in accepted_ids:
        if claimed_id in FIRST_TOUCH_POLICY_IDS or claimed_id in {"ACQUISITION_PRESSURE"}:
            reject("POLICY_VERSION_NOT_ADMITTED")
            reject("FIRST_TOUCH_INHERITANCE_FORBIDDEN")
        else:
            unknown("POLICY_ID_UNKNOWN")
    if claimed_name is not None and claimed_name not in accepted_versions:
        if claimed_name.startswith("CFG-FIRST-TOUCH-ROUTING"):
            reject("FIRST_TOUCH_INHERITANCE_FORBIDDEN")
            reject("POLICY_VERSION_NOT_ADMITTED")
        elif claimed_name.startswith("NET_NEW_INBOUND_HANDRAISER") or claimed_name in OLD_POLICY_VERSIONS:
            reject("POLICY_VERSION_NOT_ADMITTED")
        else:
            unknown("POLICY_VERSION_UNKNOWN")

    origin_s, origin_invalid = _safe_token(origin)
    lane_s, lane_invalid = _safe_token(lane)
    intent_s, intent_invalid = _safe_token(intent)
    key_s, key_invalid = _safe_token(idempotency_key)
    corr_s, corr_invalid = _safe_token(correlation_id)
    receipt_s, receipt_invalid = _safe_token(receipt_id)
    intake_s, intake_invalid = _safe_token(intake_source)
    nucleus_s, nucleus_invalid = _safe_token(nucleus_raw)
    offer_s, offer_invalid = _safe_token(offer_raw)
    party_s, party_invalid = _safe_token(party_raw)
    role_s, role_invalid = _safe_token(role_raw)
    urgency_s, urgency_invalid = _safe_token(urgency_raw)
    why_s, why_invalid = _safe_token(why_raw)
    deliverable_s, deliverable_invalid = _safe_token(deliverable_raw)
    docs_s, docs_invalid = _safe_token(docs_raw)

    if (
        origin_invalid
        or lane_invalid
        or intent_invalid
        or key_invalid
        or corr_invalid
        or receipt_invalid
        or intake_invalid
        or nucleus_invalid
        or offer_invalid
        or party_invalid
        or role_invalid
        or urgency_invalid
        or why_invalid
        or deliverable_invalid
        or docs_invalid
    ):
        unknown("REQUEST_INVALID")

    if origin_s is None and not origin_invalid:
        unknown("ORIGIN_UNKNOWN")
    elif origin_s in LIVE_INTELLIGENCE_ORIGINS:
        reject("LIVE_INTELLIGENCE_NOT_INBOUND")
        reject("ORIGIN_NOT_ADMITTED")
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

    if intake_s is None and not intake_invalid:
        unknown("SOURCE_UNKNOWN")
    elif intake_s is not None and intake_s not in admitted_intake:
        reject("ORIGIN_NOT_ADMITTED")

    if nucleus_raw in {None, ""}:
        unknown("NUCLEUS_UNKNOWN")
        nucleus_s = None
    elif nucleus_s is None:
        unknown("NUCLEUS_UNKNOWN")
    elif nucleus_s not in admitted_nuclei:
        reject("NUCLEUS_NOT_ADMITTED")

    if offer_raw in {None, ""}:
        unknown("OFFER_CANDIDATE_UNKNOWN")
        offer_s = None
    elif offer_s is None:
        unknown("OFFER_CANDIDATE_UNKNOWN")
    elif offer_s not in admitted_offers:
        reject("OFFER_CANDIDATE_NOT_ADMITTED")

    if party_raw in {None, ""} or party_s is None:
        unknown("PARTY_KIND_UNKNOWN")
        party_s = None
    elif party_s not in admitted_party:
        unknown("PARTY_KIND_UNKNOWN")
        party_s = None

    # inputs.required lists all five of these. Absence is ambiguity, and the
    # policy's absence_or_ambiguity disposition is UNKNOWN, so an omitted field
    # must fail closed instead of silently reaching ACCEPTED.
    if role_raw in {None, ""} or role_s is None:
        unknown("REQUEST_INVALID")
        role_s = None
    elif admitted_roles and role_s not in admitted_roles:
        unknown("REQUEST_INVALID")
        role_s = None

    if urgency_raw in {None, ""} or urgency_s is None:
        unknown("REQUEST_INVALID")
        urgency_s = None
    elif admitted_urgency and urgency_s not in admitted_urgency:
        unknown("REQUEST_INVALID")
        urgency_s = None

    if why_raw in {None, ""} or why_s is None:
        unknown("REQUEST_INVALID")
        why_s = None
    elif admitted_why and why_s not in admitted_why:
        unknown("REQUEST_INVALID")
        why_s = None

    if deliverable_raw in {None, ""} or deliverable_s is None:
        unknown("REQUEST_INVALID")
        deliverable_s = None
    elif admitted_deliverable and deliverable_s not in admitted_deliverable:
        unknown("REQUEST_INVALID")
        deliverable_s = None

    if docs_raw in {None, ""} or docs_s is None:
        unknown("REQUEST_INVALID")
        docs_s = None
    elif admitted_docs and docs_s not in admitted_docs:
        unknown("REQUEST_INVALID")
        docs_s = None

    landing_out: dict[str, str] | None = None
    if not isinstance(landing, Mapping):
        unknown("LANDING_ASSET_UNKNOWN")
    else:
        landing_id, landing_id_invalid = _safe_token(landing.get("id"))
        landing_kind, landing_kind_invalid = _safe_token(landing.get("kind"))
        if landing_id_invalid or landing_kind_invalid or landing_id is None or landing_kind is None:
            unknown("LANDING_ASSET_UNKNOWN")
        else:
            landing_out = {"id": landing_id, "kind": landing_kind}

    location_out: dict[str, str] | None = None
    if location is None:
        unknown("REQUEST_INVALID")
    elif not isinstance(location, Mapping):
        unknown("REQUEST_INVALID")
    else:
        if any(str(key).lower() in LOCATION_FORBIDDEN_FIELDS for key in location):
            reject("LOCATION_NOT_MINIMIZED")
        if any(str(key).lower() in PII_KEYS for key in location):
            reject("LOCATION_NOT_MINIMIZED")
        city = _nonempty_str(location.get("city"))
        uf = _nonempty_str(location.get("uf"))
        ibge = _nonempty_str(location.get("ibge_municipality_code"))
        if city is None or uf is None:
            unknown("REQUEST_INVALID")
        elif not _is_city_name(city) or UF_RE.match(uf) is None:
            # Key-only screening is not enough: a street address, CPF or phone
            # number stuffed into the `city` value is still an unminimized
            # location and must never be echoed into the decision envelope.
            reject("LOCATION_NOT_MINIMIZED")
        elif ibge is not None and IBGE_RE.match(ibge) is None:
            reject("LOCATION_NOT_MINIMIZED")
        else:
            location_out = {"city": city, "uf": uf}
            if ibge is not None:
                location_out["ibge_municipality_code"] = ibge

    sensitive_present = False
    sensitive_class: str | None = None
    sensitive_ref: str | None = None
    if not isinstance(sensitive, Mapping):
        unknown("SENSITIVE_CLASS_UNKNOWN")
    else:
        if any(str(key).lower() in SENSITIVE_CONTENT_KEYS for key in sensitive):
            reject("SENSITIVE_CONTENT_FORBIDDEN")
        if any(str(key).lower() in PII_KEYS for key in sensitive):
            reject("SENSITIVE_CONTENT_FORBIDDEN")
        sensitive_present = sensitive.get("present") is True
        sensitive_class = _nonempty_str(sensitive.get("class"))
        raw_sensitive_ref = sensitive.get("protected_ref")
        if raw_sensitive_ref not in {None, ""}:
            sensitive_ref = _opaque_ref(raw_sensitive_ref)
            if sensitive_ref is None:
                # A protected_ref that is not an opaque token carries the
                # protected content itself, not a pointer to it. The wire schema
                # cannot catch this (it types protected_ref as a free string),
                # so the evaluator is the only gate.
                reject("SENSITIVE_CONTENT_FORBIDDEN")
        if sensitive_class is None:
            unknown("SENSITIVE_CLASS_UNKNOWN")
        elif admitted_sensitive and sensitive_class not in admitted_sensitive:
            unknown("SENSITIVE_CLASS_UNKNOWN")
            sensitive_class = None
        elif sensitive_present and sensitive_class == "NONE":
            unknown("SENSITIVE_CLASS_UNKNOWN")

    conflict_status: str | None = None
    conflict_ref: str | None = None
    if not isinstance(conflict, Mapping):
        unknown("CONFLICT_STATUS_MISSING")
    else:
        conflict_status = _canonical_conflict_status(_nonempty_str(conflict.get("status")))
        if conflict_status is None:
            unknown("CONFLICT_STATUS_MISSING")
        elif admitted_conflict and conflict_status not in admitted_conflict:
            unknown("CONFLICT_STATUS_MISSING")
            conflict_status = None
        if conflict.get("claimed_clear") is True and (
            conflict_status in PROTECTED_NON_CLEAR_STATUSES
            or _nonempty_str(conflict.get("status")) in PROTECTED_NON_CLEAR_STATUSES
        ):
            reject("CONFLICT_CLEAR_COERCION_FORBIDDEN")
            if conflict_status == "CLEAR":
                conflict_status = _canonical_conflict_status(_nonempty_str(conflict.get("status")))
        if conflict.get("protected_ref") not in {None, ""}:
            conflict_ref = _opaque_ref(conflict.get("protected_ref"))
            if conflict_ref is None:
                unknown("REQUEST_INVALID")

    if payload.get("outbound_eligible") is True:
        reject("OUTBOUND_INHERITANCE_FORBIDDEN")
    if payload.get("auto_send") is True:
        reject("AUTO_SEND_FORBIDDEN")

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

    material = _material_view_draft(payload)
    material_hash = _material_hash(material)

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
        qualification_state = "NONE"
    elif rejected_reasons:
        decision_state = "REJECTED_WITH_REASON"
        reason_codes = rejected_reasons
        qualification_state = "NONE"
    else:
        decision_state = "ACCEPTED"
        reason_codes = ["ADMISSION_GATES_SATISFIED"]
        qualification_state = _derive_qualification(
            nucleus_id=nucleus_s,
            admitted_nuclei=admitted_nuclei,
            conflict_status=conflict_status,
            document_class=docs_s,
            partner_required=payload.get("partner_required") is True,
            capacity_review_required=payload.get("capacity_review_required") is True,
            decision_role=role_s,
            urgency=urgency_s,
            why_now=why_s,
        )

    reason_codes = [code for code in reason_codes if code not in never_emitted]
    if not reason_codes:
        decision_state = "UNKNOWN"
        reason_codes = ["REQUEST_INVALID"]
        qualification_state = "NONE"

    if qualification_state == "CONFLICT_CHECK_REQUIRED" and conflict_status == "CLEAR":
        conflict_status = "UNKNOWN"
    raw_conflict = payload.get("conflict_screening") if isinstance(payload.get("conflict_screening"), Mapping) else {}
    raw_conflict_status = _nonempty_str(raw_conflict.get("status")) if isinstance(raw_conflict, Mapping) else None
    if conflict_status == "CLEAR" and raw_conflict_status in PROTECTED_NON_CLEAR_STATUSES:
        conflict_status = _canonical_conflict_status(raw_conflict_status)

    accepted = decision_state == "ACCEPTED"
    identity_authorization = "INBOUND_ONLY" if accepted else "NONE"
    logical_basis = {
        "policy_id": CANONICAL_POLICY_ID,
        "policy_version": DRAFT_POLICY_VERSION,
        "idempotency_key": key_s,
        "material_hash": material_hash,
    }
    decision_id = _stable_id("nihr", logical_basis)

    decision = {
        "schema_version": DRAFT_DECISION_SCHEMA_VERSION,
        "policy_id": CANONICAL_POLICY_ID,
        "policy_version": DRAFT_POLICY_VERSION,
        "canonical_name": DRAFT_CANONICAL_NAME,
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
        "intake_source": intake_s,
        "landing_asset": landing_out,
        "nucleus_id": nucleus_s,
        "offer_candidate_id": offer_s,
        "party_kind": party_s,
        "decision_role": role_s,
        "site_location": location_out,
        "urgency": urgency_s,
        "why_now_class": why_s,
        "desired_decision_or_deliverable": deliverable_s,
        "document_availability_class": docs_s,
        "sensitive_data": {
            "present": bool(sensitive_present),
            "class": sensitive_class,
            "protected_ref": sensitive_ref,
        },
        "conflict_screening": {
            "status": conflict_status,
            "protected_ref": conflict_ref,
        },
        "qualification_state": qualification_state,
        "subject_ref": subject_ref,
        "account_present": bool(account_present),
        "inbound_only": True if accepted else False,
        "outbound_eligible": False,
        "auto_send": False,
        "smtp_authorized": False,
        "followup_authorized": False,
        "account_required_for_acceptance": False,
        "identity_authorization": identity_authorization,
        "owner": {
            "admission": "Governance",
            "record_queue_outcome": "Warmbly",
            "accepted_context_consumer": "Meetcfg",
        },
        "readback": {
            "required": True,
            "http_2xx_is_not_acceptance": True,
            "receipt_id": receipt_s,
            "decision_id": decision_id,
        },
        "retention": {
            "purpose": "INBOUND_ADMISSION",
            "class": "COMMERCIAL_INTAKE",
        },
        "downstream_correlation": {
            "correlation_id": corr_s,
            "receipt_id": receipt_s,
            "logical_admission_id": decision_id,
        },
        "consumer_authorization": {
            "create_inbound_only_identity": accepted,
            "surface_on_commercial_queue": accepted,
            "outbound_eligible": False,
            "auto_send": False,
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
            "nucleus_id": nucleus_s,
            "qualification_state": qualification_state,
            "inbound_only": True if accepted else False,
            "outbound_eligible": False,
            "auto_send": False,
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
        decision["qualification_state"] = "NONE"
        decision["consumer_authorization"]["create_inbound_only_identity"] = False
        decision["consumer_authorization"]["surface_on_commercial_queue"] = False
        decision["metrics"]["decision"] = "UNKNOWN"
        decision["metrics"]["reason_codes"] = list(reasons)
        decision["metrics"]["inbound_only"] = False
        decision["metrics"]["qualification_state"] = "NONE"
        decision["contains_pii"] = False

    if store is not None and key_s is not None:
        existing = store.get(key_s)
        if existing is None:
            store.put(key_s, material_hash, decision)
        elif existing["material_hash"] != material_hash:
            pass

    return decision


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Evaluate NET_NEW_INBOUND_HANDRAISER admission")
    parser.add_argument("--fixture", help="Path to a request JSON fixture")
    parser.add_argument("--consumer-pin", help="Path to a Warmbly/Meetcfg consumer pin JSON")
    parser.add_argument("--evaluated-at", default="2026-09-03T12:00:00Z")
    parser.add_argument("--intake-paused", action="store_true")
    args = parser.parse_args(argv)
    if args.consumer_pin:
        pin = json.loads(Path(args.consumer_pin).read_text(encoding="utf-8"))
        decision = evaluate_consumer_pin(pin)
    elif args.fixture:
        request = json.loads(Path(args.fixture).read_text(encoding="utf-8"))
        decision = evaluate_net_new_inbound_handraiser(
            request,
            store=ModelOnlyHandraiserStore(),
            intake_paused=args.intake_paused,
            evaluated_at=args.evaluated_at,
        )
    else:
        parser.error("one of --fixture or --consumer-pin is required")
    sys.stdout.write(canonical_json(decision) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
