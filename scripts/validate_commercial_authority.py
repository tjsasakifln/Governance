#!/usr/bin/env python3
"""Validate CONFENGE commercial-offer authority artifacts.

This is a proof package, not an application. It loads versioned JSON,
canonicalizes it, hashes it, and fail-closes on invariant violations.

Usage:
    python scripts/validate_commercial_authority.py
    python scripts/validate_commercial_authority.py --write-hashes
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import re
import sys
from copy import deepcopy
from pathlib import Path
from typing import Any, Iterable, Mapping

EFFECTIVE_AT = "2026-08-17T00:00:00Z"
TERMS_VERSION = "CFG-TERMS-B2B-2026-08-17-v1"
CANONICAL_OFFER_CODES = (
    "CFG-DIAG-EXP-v1",
    "CFG-DIRB2G-FLEX-v1",
    "CFG-DIRB2G-180-v1",
    "CFG-DIRB2G-365-v1",
)
OFFER_STATES = frozenset({"DRAFT", "APPROVED", "ACTIVE", "PAUSED", "RETIRED"})
GATE_STATES = frozenset({"UNKNOWN", "PENDING", "APPROVED", "REJECTED", "WAIVED"})
REQUIRED_GATES_FOR_ACTIVE = (
    "legal_terms_forum",
    "tax_nfse",
    "capacity_inventory",
    "security_environments",
    "publication_brand",
)
CREATED_PROVIDER_EVENTS = frozenset(
    {
        "customer_created",
        "checkout_created",
        "subscription_created",
        "payment_created",
    }
)
RECEIVED_REVENUE_EVENTS = frozenset({"payment_confirmed", "payment_received"})
MONEY_KEYS = frozenset(
    {
        "amount_cents",
        "total_commitment_cents",
        "base_cents_per_started_month",
    }
)
SECRET_PATTERNS = (
    re.compile(r"\$aact_[A-Za-z0-9_]+"),
    re.compile(r"\bsk_(?:live|test)_[A-Za-z0-9]+"),
    re.compile(r"asaas[_-]?api[_-]?key", re.I),
    re.compile(r"checkout\.asaas\.com", re.I),
    re.compile(r"asaas\.com/c/", re.I),
    re.compile(r"\b(?:cus|sub|pay)_[A-Za-z0-9]{8,}\b"),
    re.compile(r"\b\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}\b"),
    re.compile(r"\b\d{3}\.\d{3}\.\d{3}-\d{2}\b"),
)

ARTIFACT_SPECS: tuple[dict[str, str], ...] = (
    {
        "path": "commercial/offers/catalog.v1.json",
        "schema_version": "offer-catalog.v1",
    },
    {
        "path": "commercial/offers/catalog.public.v1.json",
        "schema_version": "offer-catalog.v1",
    },
    {
        "path": "commercial/exceptions/extra-historical.v1.json",
        "schema_version": "commercial-exception.v1",
    },
    {
        "path": "commercial/terms/CFG-TERMS-B2B-2026-08-17-v1.md",
        "schema_version": TERMS_VERSION,
    },
    {
        "path": "commercial/terms/CFG-TERMS-B2B-2026-08-17-v1.manifest.json",
        "schema_version": "terms-manifest.v1",
    },
    {
        "path": "commercial/gates/production-gates.v1.json",
        "schema_version": "production-gates.v1",
    },
    {
        "path": "commercial/capacity/capacity-policy.v1.json",
        "schema_version": "capacity-policy.v1",
    },
    {
        "path": "decisions/ADR-CFG-OFFER-CATALOG-001.md",
        "schema_version": "ADR-CFG-OFFER-CATALOG-001",
    },
    {
        "path": "schemas/offer-catalog.v1.schema.json",
        "schema_version": "offer-catalog.v1.schema",
    },
    {
        "path": "schemas/production-gates.v1.schema.json",
        "schema_version": "production-gates.v1.schema",
    },
    {
        "path": "schemas/authority-manifest.v1.schema.json",
        "schema_version": "authority-manifest.v1.schema",
    },
    {
        "path": "commercial/CONSUMER-HANDOFF.md",
        "schema_version": "consumer-handoff.v1",
    },
)


class ValidationError(Exception):
    """Fail-closed commercial authority error."""


def repo_root(start: Path | None = None) -> Path:
    here = (start or Path(__file__)).resolve()
    if here.is_file():
        here = here.parent
    for candidate in (here, *here.parents):
        if (candidate / "commercial" / "offers" / "catalog.v1.json").is_file():
            return candidate
    raise ValidationError("cannot locate Governance commercial authority root")


def canonical_json(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def content_hash_bytes(data: bytes) -> str:
    return f"sha256:{sha256_hex(data)}"


def content_hash_json(obj: Any) -> str:
    return content_hash_bytes(canonical_json(obj).encode("utf-8"))


def content_hash_text(text: str) -> str:
    return content_hash_bytes(text.replace("\r\n", "\n").replace("\r", "\n").encode("utf-8"))


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def load_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def is_int_money(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def resolve_ref(schema: Mapping[str, Any], root: Mapping[str, Any]) -> Mapping[str, Any]:
    ref = schema.get("$ref")
    if not ref:
        return schema
    if not isinstance(ref, str) or not ref.startswith("#/$defs/"):
        raise ValidationError(f"unsupported $ref: {ref}")
    name = ref.split("/")[-1]
    defs = root.get("$defs")
    if not isinstance(defs, Mapping) or name not in defs:
        raise ValidationError(f"unresolved $ref: {ref}")
    return defs[name]


def schema_validate(instance: Any, schema: Mapping[str, Any], root: Mapping[str, Any] | None = None, path: str = "$") -> None:
    root = root or schema
    schema = resolve_ref(schema, root)

    if "if" in schema and "then" in schema:
        try:
            schema_validate(instance, schema["if"], root, path)
        except ValidationError:
            pass
        else:
            schema_validate(instance, schema["then"], root, path)

    for sub in schema.get("allOf") or ():
        schema_validate(instance, sub, root, path)

    if "const" in schema and instance != schema["const"]:
        raise ValidationError(f"{path}: expected const {schema['const']!r}, got {instance!r}")

    if "enum" in schema and instance not in schema["enum"]:
        raise ValidationError(f"{path}: {instance!r} not in enum {schema['enum']}")

    expected_type = schema.get("type")
    if expected_type is not None:
        _assert_json_type(instance, expected_type, path)

    if isinstance(instance, str) and "pattern" in schema:
        if re.search(schema["pattern"], instance) is None:
            raise ValidationError(f"{path}: {instance!r} does not match {schema['pattern']}")
    if isinstance(instance, str) and instance is not None and "minLength" in schema:
        if len(instance) < int(schema["minLength"]):
            raise ValidationError(f"{path}: shorter than minLength")

    if is_int_money(instance) or isinstance(instance, int) and not isinstance(instance, bool):
        if "minimum" in schema and instance < schema["minimum"]:
            raise ValidationError(f"{path}: below minimum")
        if "maximum" in schema and instance > schema["maximum"]:
            raise ValidationError(f"{path}: above maximum")

    if isinstance(instance, list):
        if "minItems" in schema and len(instance) < int(schema["minItems"]):
            raise ValidationError(f"{path}: fewer items than minItems")
        if "maxItems" in schema and len(instance) > int(schema["maxItems"]):
            raise ValidationError(f"{path}: more items than maxItems")
        item_schema = schema.get("items")
        if isinstance(item_schema, Mapping):
            for i, item in enumerate(instance):
                schema_validate(item, item_schema, root, f"{path}[{i}]")

    if isinstance(instance, dict):
        props = schema.get("properties") or {}
        required = schema.get("required") or []
        for key in required:
            if key not in instance:
                raise ValidationError(f"{path}: missing required {key}")
        additional = schema.get("additionalProperties", True)
        for key, value in instance.items():
            if key in props:
                schema_validate(value, props[key], root, f"{path}.{key}")
            elif additional is False:
                raise ValidationError(f"{path}: unknown critical field {key}")


def _assert_json_type(instance: Any, expected: Any, path: str) -> None:
    types = expected if isinstance(expected, list) else [expected]
    if instance is None:
        if "null" in types:
            return
        raise ValidationError(f"{path}: expected {expected}, got null")
    if isinstance(instance, bool):
        if "boolean" in types:
            return
        raise ValidationError(f"{path}: expected {expected}, got boolean")
    if isinstance(instance, int) and "integer" in types:
        return
    if isinstance(instance, float):
        raise ValidationError(f"{path}: monetary/numeric float is forbidden, got {instance!r}")
    if isinstance(instance, str) and "string" in types:
        return
    if isinstance(instance, list) and "array" in types:
        return
    if isinstance(instance, dict) and "object" in types:
        return
    if "number" in types and isinstance(instance, int):
        return
    raise ValidationError(f"{path}: expected {expected}, got {type(instance).__name__}")


def reject_float_money(obj: Any, path: str = "$") -> None:
    if isinstance(obj, float):
        raise ValidationError(f"{path}: float is forbidden")
    if isinstance(obj, dict):
        for key, value in obj.items():
            child = f"{path}.{key}"
            if key in MONEY_KEYS or key.endswith("_cents"):
                if isinstance(value, float) or (value is not None and not is_int_money(value)):
                    raise ValidationError(f"{child}: money must be integer centavos, got {value!r}")
            reject_float_money(value, child)
    elif isinstance(obj, list):
        for i, value in enumerate(obj):
            reject_float_money(value, f"{path}[{i}]")


def scan_forbidden_secrets(text: str) -> list[str]:
    hits: list[str] = []
    for pattern in SECRET_PATTERNS:
        found = pattern.findall(text)
        hits.extend(str(item) for item in found)
    return hits


def exception_may_serialize_public(exception: Mapping[str, Any]) -> bool:
    if exception.get("public_serialization_allowed") is True:
        return False if exception.get("visibility") == "PRIVATE" else bool(exception.get("is_public_offer"))
    return False


def build_public_catalog(full_catalog: Mapping[str, Any], exceptions_doc: Mapping[str, Any]) -> dict[str, Any]:
    for exception in exceptions_doc.get("exceptions") or ():
        if exception_may_serialize_public(exception):
            raise ValidationError(
                f"exception {exception.get('exception_id')} cannot serialize to the public catalog"
            )
        if exception.get("public_serialization_allowed") is not False:
            raise ValidationError("private exceptions must set public_serialization_allowed=false")
    public = deepcopy(dict(full_catalog))
    public["visibility"] = "PUBLIC_CANDIDATE"
    public["publication_status"] = "NOT_PUBLISHED"
    public["offers"] = [deepcopy(offer) for offer in full_catalog.get("offers") or () if offer.get("public") is True]
    for offer in public["offers"]:
        if offer.get("amount_cents") == 1000000 and offer.get("cycle") == "MONTHLY":
            raise ValidationError("public catalog must not contain the Extra 1000000 cents/month condition")
    return public


def assert_public_catalog_matches(full_catalog: Mapping[str, Any], public_catalog: Mapping[str, Any], exceptions_doc: Mapping[str, Any]) -> None:
    derived = build_public_catalog(full_catalog, exceptions_doc)
    derived_offers = {offer["offer_code"]: offer for offer in derived["offers"]}
    public_offers = {offer["offer_code"]: offer for offer in public_catalog.get("offers") or ()}
    if set(derived_offers) != set(public_offers):
        raise ValidationError("public catalog offer set does not match derived public offers")
    if public_catalog.get("visibility") != "PUBLIC_CANDIDATE":
        raise ValidationError("public catalog visibility must be PUBLIC_CANDIDATE until publication is approved")
    if public_catalog.get("publication_status") != "NOT_PUBLISHED":
        raise ValidationError("public catalog is not published")
    for offer in public_catalog.get("offers") or ():
        if offer.get("amount_cents") == 1000000 and offer.get("billing_mode") == "RECURRING":
            raise ValidationError("no public offer may be 1000000 cents/month")
        if "EXTRA" in str(offer.get("offer_code", "")).upper() or "HISTORICAL_LIGHTHOUSE" in json.dumps(offer):
            raise ValidationError("Extra exception leaked into public catalog")


def assert_offer_invariants(offer: Mapping[str, Any]) -> None:
    reject_float_money(offer)
    status = offer.get("status")
    if status not in OFFER_STATES:
        raise ValidationError(f"invalid offer status: {status!r}")
    if offer.get("silent_renewal") is not False:
        raise ValidationError(f"{offer.get('offer_code')}: silent renewal is forbidden")
    if "endDate" in offer or offer.get("end_date"):
        raise ValidationError(f"{offer.get('offer_code')}: endDate must not be invented")
    if offer.get("currency") != "BRL":
        raise ValidationError("currency must be BRL")
    if offer.get("terms_version") != TERMS_VERSION:
        raise ValidationError("offer terms_version mismatch")
    if not is_int_money(offer.get("amount_cents")):
        raise ValidationError("amount_cents must be integer centavos")

    if offer.get("offer_code") == "CFG-DIAG-EXP-v1":
        if offer.get("billing_mode") != "ONE_TIME" or offer.get("amount_cents") != 800000:
            raise ValidationError("Diagnóstico amount/mode mismatch")
        if offer.get("consumes_recurring_slot") is not False:
            raise ValidationError("Diagnóstico must not consume a recurring slot")
        credit = offer.get("commercial_credit") or {}
        if credit.get("amount_cents") != 200000 or credit.get("cumulative") is not False:
            raise ValidationError("Diagnóstico credit must be 200000 non-cumulative")
        if credit.get("window_days_after_delivery") != 60:
            raise ValidationError("Diagnóstico credit window must be 60 days")
        if offer.get("delivery_business_days_min") != 10 or offer.get("delivery_business_days_max") != 15:
            raise ValidationError("Diagnóstico delivery window must be 10-15 business days")

    if offer.get("offer_code") == "CFG-DIRB2G-FLEX-v1":
        if offer.get("billing_mode") != "RECURRING" or offer.get("cycle") != "MONTHLY":
            raise ValidationError("Flex billing mismatch")
        if offer.get("amount_cents") != 2000000:
            raise ValidationError("Flex amount_cents must be 2000000")
        if offer.get("max_payments") is not None or offer.get("commitment_months") is not None:
            raise ValidationError("Flex must not invent max_payments or commitment_months")
        if offer.get("total_commitment_cents") is not None:
            raise ValidationError("Flex must not invent total_commitment_cents")
        if offer.get("notice_days") != 30:
            raise ValidationError("Flex notice_days must be 30")

    if offer.get("offer_code") == "CFG-DIRB2G-180-v1":
        _assert_fixed_commitment(offer, amount=1500000, payments=6, total=9000000)
        reco = offer.get("recomposition") or {}
        if reco.get("base_cents_per_started_month") != 500000:
            raise ValidationError("180 recomposition-base must be 500000 cents")

    if offer.get("offer_code") == "CFG-DIRB2G-365-v1":
        _assert_fixed_commitment(offer, amount=1250000, payments=12, total=15000000)
        reco = offer.get("recomposition") or {}
        if reco.get("base_cents_per_started_month") != 750000:
            raise ValidationError("365 recomposition-base must be 750000 cents")

    if offer.get("billing_mode") == "RECURRING" and is_int_money(offer.get("max_payments")):
        expected = offer["max_payments"] * offer["amount_cents"]
        if offer.get("total_commitment_cents") != expected:
            raise ValidationError(
                f"{offer.get('offer_code')}: total_commitment_cents must equal max_payments * amount_cents"
            )
        if offer.get("commitment_months") != offer.get("max_payments"):
            raise ValidationError("commitment_months must match max_payments")
        if offer.get("silent_renewal") is True:
            raise ValidationError("silent renewal after max_payments is forbidden")


def _assert_fixed_commitment(offer: Mapping[str, Any], *, amount: int, payments: int, total: int) -> None:
    if offer.get("billing_mode") != "RECURRING" or offer.get("cycle") != "MONTHLY":
        raise ValidationError(f"{offer.get('offer_code')}: recurring monthly required")
    if offer.get("amount_cents") != amount:
        raise ValidationError(f"{offer.get('offer_code')}: amount_cents must be {amount}")
    if offer.get("max_payments") != payments or offer.get("commitment_months") != payments:
        raise ValidationError(f"{offer.get('offer_code')}: must be exactly {payments} payments")
    if offer.get("total_commitment_cents") != total or total != payments * amount:
        raise ValidationError(f"{offer.get('offer_code')}: total must be {payments} * parcela = {total}")


def assert_catalog_invariants(catalog: Mapping[str, Any]) -> None:
    reject_float_money(catalog)
    if catalog.get("schema_version") != "offer-catalog.v1":
        raise ValidationError("catalog schema_version mismatch")
    if catalog.get("catalog_authority") != "APPROVED":
        raise ValidationError("this campaign requires catalog_authority=APPROVED")
    if catalog.get("terms_version") != TERMS_VERSION:
        raise ValidationError("catalog terms_version mismatch")
    if catalog.get("currency") != "BRL":
        raise ValidationError("catalog currency must be BRL")
    offers = catalog.get("offers") or []
    codes = [offer.get("offer_code") for offer in offers]
    if sorted(codes) != sorted(CANONICAL_OFFER_CODES):
        raise ValidationError(f"canonical offer set mismatch: {codes}")
    if len(set(codes)) != len(codes):
        raise ValidationError("duplicate offer_code")
    for offer in offers:
        assert_offer_invariants(offer)
        if offer.get("status") == "ACTIVE":
            raise ValidationError("ACTIVE is illegal by catalog presence alone; validate against gates")
    scope = catalog.get("standard_scope") or {}
    if scope.get("bid_room", {}).get("simultaneous_wip_accepted_opportunities_max") != 4:
        raise ValidationError("Bid Room WIP must be 4")
    if scope.get("contract_defense", {}).get("active_public_works_or_contracts") != 1:
        raise ValidationError("Contract Defense must be one active contract")


def gates_pending_for_active(gates_doc: Mapping[str, Any]) -> list[str]:
    by_id = {gate["gate_id"]: gate for gate in gates_doc.get("gates") or ()}
    pending: list[str] = []
    for gate_id in REQUIRED_GATES_FOR_ACTIVE:
        gate = by_id.get(gate_id)
        if gate is None or gate.get("state") != "APPROVED":
            pending.append(gate_id)
    if gates_doc.get("public_activation_approved") is not True:
        pending.append("public_activation_approved")
    if gates_doc.get("production_checkout_enabled") is True:
        # checkout flag cannot flip on while required gates are unknown
        pass
    return pending


def offer_may_be_active(offer: Mapping[str, Any], gates_doc: Mapping[str, Any]) -> bool:
    if offer.get("status") == "RETIRED":
        return False
    if gates_pending_for_active(gates_doc):
        return False
    if gates_doc.get("catalog_authority") != "APPROVED":
        return False
    return True


def assert_gates_invariants(gates_doc: Mapping[str, Any]) -> None:
    reject_float_money(gates_doc)
    expected_flags = {
        "catalog_authority": "APPROVED",
        "production_checkout_enabled": False,
        "production_webhook_enabled": False,
        "real_money_mutation_approved": False,
        "public_activation_approved": False,
        "sandbox_preparation_approved": True,
        "manual_preparation_approved": True,
        "unknown_is_not_approval": True,
    }
    for key, value in expected_flags.items():
        if gates_doc.get(key) != value:
            raise ValidationError(f"gate flag {key} must be {value!r}")
    seen: set[str] = set()
    for gate in gates_doc.get("gates") or ():
        if gate.get("state") not in GATE_STATES:
            raise ValidationError(f"invalid gate state: {gate.get('state')!r}")
        if gate.get("state") == "UNKNOWN" and gate.get("state") == "APPROVED":
            raise ValidationError("UNKNOWN cannot be APPROVED")
        if not gate.get("approver") or not gate.get("required_evidence"):
            raise ValidationError(f"gate {gate.get('gate_id')} missing approver/evidence")
        if gate.get("gate_id") in REQUIRED_GATES_FOR_ACTIVE and gate.get("state") == "APPROVED":
            raise ValidationError("do not fabricate required-gate approval in this campaign")
        if gate.get("gate_id") in REQUIRED_GATES_FOR_ACTIVE and gate.get("state") not in {"UNKNOWN", "PENDING"}:
            if gate.get("state") == "APPROVED":
                raise ValidationError("required production gates remain UNKNOWN")
        seen.add(gate["gate_id"])
        if gate.get("state") == "UNKNOWN":
            # absence of rejection is not approval — already encoded
            pass
    for required in (
        "legal_terms_forum",
        "tax_nfse",
        "capacity_inventory",
        "security_environments",
        "publication_brand",
        "finance_operator_mutation",
        "extra_exception_change",
    ):
        if required not in seen:
            raise ValidationError(f"missing gate {required}")
    if not gates_pending_for_active(gates_doc):
        raise ValidationError("required gates must remain pending in this campaign")


def assert_no_active_while_gates_pending(catalog: Mapping[str, Any], gates_doc: Mapping[str, Any]) -> None:
    pending = gates_pending_for_active(gates_doc)
    for offer in catalog.get("offers") or ():
        if offer.get("status") == "ACTIVE" and pending:
            raise ValidationError(
                f"{offer.get('offer_code')}: ACTIVE rejected while gates pending: {pending}"
            )
        if offer.get("status") == "ACTIVE" and not offer_may_be_active(offer, gates_doc):
            raise ValidationError(f"{offer.get('offer_code')}: ACTIVE rejected by fail-closed gates")


def assert_capacity_invariants(policy: Mapping[str, Any]) -> None:
    recurring = policy.get("recurring") or {}
    if recurring.get("global_active_slots") != 50:
        raise ValidationError("recurring global cap must be 50 slots")
    if recurring.get("standard_contract_slots") != 1:
        raise ValidationError("one standard contract consumes one slot")
    if recurring.get("hold_hours") != 72:
        raise ValidationError("hold must be 72 hours")
    if recurring.get("final_reservation_requires") != "confirmed_first_payment":
        raise ValidationError("final reservation requires confirmed first payment")
    one_off = policy.get("one_off") or {}
    if one_off.get("fixed_commercial_cap") is not None:
        raise ValidationError("one-offs have no fixed commercial cap")
    if one_off.get("standard_clock_business_hours") != 48:
        raise ValidationError("standard one-off clock is 48 business hours")
    onboarding = policy.get("onboarding") or {}
    if onboarding.get("requires_confirmed_first_payment") is not True:
        raise ValidationError("onboarding requires confirmed first payment")
    revenue = policy.get("revenue") or {}
    for key in (
        "created_customer_is_received_revenue",
        "created_checkout_is_received_revenue",
        "created_subscription_is_received_revenue",
        "created_payment_is_received_revenue",
    ):
        if revenue.get(key) is not False:
            raise ValidationError(f"{key} must be false")


def recurring_checkout_allowed(
    *,
    offer: Mapping[str, Any],
    gates_doc: Mapping[str, Any],
    policy: Mapping[str, Any],
    available_slots: int,
    hold: Mapping[str, Any] | None,
    catalog_authority: str,
) -> bool:
    if offer.get("billing_mode") != "RECURRING":
        return False
    if offer.get("status") not in {"APPROVED", "ACTIVE"}:
        return False
    if catalog_authority != "APPROVED":
        return False
    if gates_doc.get("production_checkout_enabled") is not True:
        return False
    if any(gate.get("gate_id") == "capacity_inventory" and gate.get("state") != "APPROVED" for gate in gates_doc.get("gates") or ()):
        return False
    valid_hold = bool(
        hold
        and hold.get("status") == "VALID"
        and hold.get("offer_code") == offer.get("offer_code")
        and hold.get("cnpj")
        and hold.get("start_window")
    )
    if available_slots < int((policy.get("recurring") or {}).get("standard_contract_slots") or 1) and not valid_hold:
        return False
    return True


def onboarding_allowed(*, payment_confirmed: bool, terms_accepted: bool, recurring: bool, capacity_reserved: bool) -> bool:
    if not payment_confirmed or not terms_accepted:
        return False
    if recurring and not capacity_reserved:
        return False
    return True


def is_received_revenue(event_type: str) -> bool:
    if event_type in CREATED_PROVIDER_EVENTS:
        return False
    return event_type in RECEIVED_REVENUE_EVENTS


def price_change_requires_new_version(existing: Mapping[str, Any], candidate: Mapping[str, Any]) -> bool:
    if existing.get("amount_cents") == candidate.get("amount_cents"):
        return False
    if existing.get("offer_code") == candidate.get("offer_code"):
        return True
    if existing.get("offer_version") == candidate.get("offer_version") and _family(existing) == _family(candidate):
        return True
    return False


def assert_price_change(existing: Mapping[str, Any], candidate: Mapping[str, Any]) -> None:
    if price_change_requires_new_version(existing, candidate):
        raise ValidationError("price change requires a new offer_version")


def _family(offer: Mapping[str, Any]) -> str:
    code = str(offer.get("offer_code") or "")
    return code.rsplit("-", 1)[0]


def retired_remains_historical(previous: Mapping[str, Any], current: Mapping[str, Any]) -> None:
    prev = {offer["offer_code"]: offer for offer in previous.get("offers") or ()}
    curr = {offer["offer_code"]: offer for offer in current.get("offers") or ()}
    for code, offer in prev.items():
        if offer.get("status") != "RETIRED":
            continue
        if code not in curr:
            raise ValidationError(f"RETIRED offer {code} must remain historical")
        if curr[code].get("status") != "RETIRED":
            raise ValidationError(f"RETIRED offer {code} cannot leave RETIRED at the same version")
        if curr[code].get("amount_cents") != offer.get("amount_cents"):
            raise ValidationError(f"RETIRED offer {code} amount is historical and immutable")


def assert_terms_manifest(manifest: Mapping[str, Any]) -> None:
    if manifest.get("terms_version") != TERMS_VERSION:
        raise ValidationError("terms_version mismatch")
    if manifest.get("obligation_kind") != "MEANS":
        raise ValidationError("obligation must be MEANS")
    if manifest.get("late_penalty_percent_once") != 2:
        raise ValidationError("late penalty must be 2% once")
    if manifest.get("interest_percent_per_month_simple") != 1:
        raise ValidationError("interest must be 1% simple per month")
    if manifest.get("compound_contractual_interest") is not False:
        raise ValidationError("contractual interest must not compound")
    if manifest.get("tax_premise_is_confirmed_regime") is not False:
        raise ValidationError("6% tax premise is not a confirmed regime")
    if manifest.get("nfse_production_blocked") is not True:
        raise ValidationError("NFS-e production must stay blocked")
    if manifest.get("first_confirmed_charge_before_kickoff") is not True:
        raise ValidationError("first confirmed charge must precede kickoff")
    if manifest.get("silent_renewal_after_max_payments") is not False:
        raise ValidationError("180/365 must not silently renew")


def assert_exceptions(doc: Mapping[str, Any]) -> None:
    if doc.get("public_serialization_allowed") is not False:
        raise ValidationError("exception registry must not be public-serializable")
    extras = doc.get("exceptions") or []
    if len(extras) != 1:
        raise ValidationError("expected exactly one Extra historical exception")
    extra = extras[0]
    if extra.get("amount_cents") != 1000000 or extra.get("commitment_months") != 6:
        raise ValidationError("Extra historical condition must be 1000000 cents x 6 months")
    if extra.get("is_coupon") or extra.get("is_mfc") or extra.get("auto_equalization") or extra.get("is_public_offer"):
        raise ValidationError("Extra is not coupon, MFC, equalization or a public offer")
    if extra.get("change_requires_addendum") is not True or extra.get("change_requires_explicit_authority") is not True:
        raise ValidationError("Extra change requires addendum and explicit authority")
    if exception_may_serialize_public(extra):
        raise ValidationError("Extra exception cannot serialize to the public catalog")


def assert_authority_flags(manifest: Mapping[str, Any]) -> None:
    expected = {
        "catalog_authority": "APPROVED",
        "production_checkout_enabled": False,
        "production_webhook_enabled": False,
        "real_money_mutation_approved": False,
        "public_activation_approved": False,
        "sandbox_preparation_approved": True,
        "manual_preparation_approved": True,
        "terms_version": TERMS_VERSION,
    }
    for key, value in expected.items():
        if manifest.get(key) != value:
            raise ValidationError(f"authority flag {key} must be {value!r}")


def hash_artifact(root: Path, relpath: str) -> str:
    path = root / relpath
    if not path.is_file():
        raise ValidationError(f"missing artifact {relpath}")
    if path.suffix == ".json":
        return content_hash_json(load_json(path))
    return content_hash_text(load_text(path))


def build_authority_artifacts(root: Path) -> list[dict[str, str]]:
    artifacts = []
    for spec in ARTIFACT_SPECS:
        artifacts.append(
            {
                "path": spec["path"],
                "schema_version": spec["schema_version"],
                "content_hash": hash_artifact(root, spec["path"]),
                "effective_at": EFFECTIVE_AT,
            }
        )
    return artifacts


def write_authority_manifest(root: Path, manifest: dict[str, Any]) -> None:
    path = root / "commercial" / "authority" / "authority-manifest.v1.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def default_authority_manifest(artifacts: list[dict[str, str]]) -> dict[str, Any]:
    return {
        "schema_version": "authority-manifest.v1",
        "authority_id": "CFG-OFFER-AUTHORITY-v1",
        "catalog_authority": "APPROVED",
        "terms_version": TERMS_VERSION,
        "production_checkout_enabled": False,
        "production_webhook_enabled": False,
        "real_money_mutation_approved": False,
        "public_activation_approved": False,
        "sandbox_preparation_approved": True,
        "manual_preparation_approved": True,
        "effective_at": EFFECTIVE_AT,
        "source_issue": "https://github.com/tjsasakifln/Governance/issues/1",
        "consumers": [
            {"id": "web-cfg#88", "role": "delivery_parent", "pin": "authority_hash"},
            {"id": "Warmbly#47", "role": "reconciliation_consumer", "pin": "authority_hash"},
        ],
        "artifacts": artifacts,
    }


def assert_manifest_hashes(root: Path, manifest: Mapping[str, Any]) -> None:
    expected = {item["path"]: item for item in build_authority_artifacts(root)}
    listed = {item["path"]: item for item in manifest.get("artifacts") or []}
    if set(expected) != set(listed):
        raise ValidationError(f"authority manifest artifact set mismatch: {sorted(set(expected) ^ set(listed))}")
    for path, item in expected.items():
        got = listed[path]
        if got.get("content_hash") != item["content_hash"]:
            raise ValidationError(f"content_hash mismatch for {path}")
        if got.get("schema_version") != item["schema_version"]:
            raise ValidationError(f"schema_version mismatch for {path}")
        if got.get("effective_at") != EFFECTIVE_AT:
            raise ValidationError(f"effective_at must be the decision timestamp, not a build clock: {path}")


def scan_tree_for_secrets(root: Path) -> None:
    roots = (
        root / "commercial",
        root / "schemas",
        root / "decisions",
        root / "scripts",
        root / "tests",
    )
    for base in roots:
        if not base.exists():
            continue
        for path in base.rglob("*"):
            if not path.is_file():
                continue
            if path.suffix not in {".json", ".md", ".py", ".yml", ".yaml"}:
                continue
            hits = scan_forbidden_secrets(path.read_text(encoding="utf-8"))
            if hits:
                raise ValidationError(f"forbidden secret/PII/checkout token in {path.relative_to(root)}: {hits}")


def authority_hash(manifest: Mapping[str, Any]) -> str:
    return content_hash_json(manifest)


def load_legal_validator(root: Path):
    path = root / "scripts" / "validate_legal_provisional.py"
    if not path.is_file():
        raise ValidationError("missing scripts/validate_legal_provisional.py")
    spec = importlib.util.spec_from_file_location("validate_legal_provisional", path)
    if spec is None or spec.loader is None:
        raise ValidationError("cannot load legal provisional validator")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def validate_package(root: Path | None = None) -> dict[str, Any]:
    root = repo_root(root)
    catalog_schema = load_json(root / "schemas" / "offer-catalog.v1.schema.json")
    gates_schema = load_json(root / "schemas" / "production-gates.v1.schema.json")
    manifest_schema = load_json(root / "schemas" / "authority-manifest.v1.schema.json")

    catalog = load_json(root / "commercial" / "offers" / "catalog.v1.json")
    public = load_json(root / "commercial" / "offers" / "catalog.public.v1.json")
    exceptions = load_json(root / "commercial" / "exceptions" / "extra-historical.v1.json")
    gates = load_json(root / "commercial" / "gates" / "production-gates.v1.json")
    capacity = load_json(root / "commercial" / "capacity" / "capacity-policy.v1.json")
    terms_manifest = load_json(root / "commercial" / "terms" / "CFG-TERMS-B2B-2026-08-17-v1.manifest.json")
    terms_text = load_text(root / "commercial" / "terms" / "CFG-TERMS-B2B-2026-08-17-v1.md")
    manifest = load_json(root / "commercial" / "authority" / "authority-manifest.v1.json")

    schema_validate(catalog, catalog_schema)
    schema_validate(public, catalog_schema)
    schema_validate(gates, gates_schema)
    schema_validate(manifest, manifest_schema)

    assert_catalog_invariants(catalog)
    assert_catalog_invariants(public)
    assert_exceptions(exceptions)
    assert_public_catalog_matches(catalog, public, exceptions)
    assert_gates_invariants(gates)
    assert_no_active_while_gates_pending(catalog, gates)
    assert_no_active_while_gates_pending(public, gates)
    assert_capacity_invariants(capacity)
    assert_terms_manifest(terms_manifest)
    assert_authority_flags(manifest)
    assert_manifest_hashes(root, manifest)
    scan_tree_for_secrets(root)

    if TERMS_VERSION not in terms_text or "obligation of means" not in terms_text.lower():
        raise ValidationError("terms text must declare version and obligation of means")

    digest = authority_hash(manifest)
    legal_mod = load_legal_validator(root)
    legal = legal_mod.validate_all_legal_packages(root)
    return {
        "root": str(root),
        "authority_hash": digest,
        "legal_package_hash": legal["prior_package_hash"],
        "founder_decided_hash": legal["founder_decided_hash"],
        "catalog_authority": manifest["catalog_authority"],
        "offers": [offer["offer_code"] for offer in catalog["offers"]],
        "pending_gates": gates_pending_for_active(gates),
    }


def write_hashes(root: Path | None = None) -> dict[str, Any]:
    root = repo_root(root)
    artifacts = build_authority_artifacts(root)
    # Hashing the manifest would include itself; write artifacts first, then validate.
    # Temporarily write a stub so hash_artifact can run on everything except the manifest
    # (the manifest is not in ARTIFACT_SPECS as a self-hash).
    manifest = default_authority_manifest(artifacts)
    write_authority_manifest(root, manifest)
    return validate_package(root)


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate CONFENGE commercial authority")
    parser.add_argument("--write-hashes", action="store_true", help="rewrite authority-manifest content hashes")
    parser.add_argument("--root", type=Path, default=None)
    args = parser.parse_args(list(argv) if argv is not None else None)
    try:
        result = write_hashes(args.root) if args.write_hashes else validate_package(args.root)
    except ValidationError as exc:
        print(f"VALIDATION_ERROR {exc}", file=sys.stderr)
        return 1
    print(f"AUTHORITY_HASH {result['authority_hash']}")
    print(f"LEGAL_PACKAGE_HASH {result['legal_package_hash']}")
    print(f"FOUNDER_DECIDED_HASH {result['founder_decided_hash']}")
    print(f"CATALOG_AUTHORITY {result['catalog_authority']}")
    print("OFFERS " + ",".join(result["offers"]))
    print("PENDING_GATES " + ",".join(result["pending_gates"]))
    print("PRODUCTION_CHECKOUT_ENABLED false")
    print("REAL_MONEY_MUTATION_APPROVED false")
    print("PUBLIC_ACTIVATION_APPROVED false")
    return 0


if __name__ == "__main__":
    sys.exit(main())
