#!/usr/bin/env python3
"""Validate CONFENGE commercial-offer authority artifacts.

This is a proof package, not an application. It loads versioned JSON,
canonicalizes it, hashes it, and fail-closes on invariant violations.

Usage:
    python scripts/validate_commercial_authority.py
    python scripts/validate_commercial_authority.py --write-hashes
    python scripts/validate_commercial_authority.py --check-mapping <payload.json>
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
NAMED_OFFER_FIELDS = (
    "offer_id",
    "offer_version",
    "public_name",
    "internal_code",
    "description_short",
    "description_asaas",
    "amount_cents",
    "currency",
    "billing_mode",
    "cycle",
    "commitment_months",
    "max_payments",
    "total_commitment_cents",
    "notice_days",
    "scope_version",
    "terms_version",
    "capacity_required",
    "capacity_units",
    "checkout_mode",
    "provider_mapping_status",
    "status",
    "effective_from",
    "effective_to",
    "approval_state",
    "change_reason",
)
PUBLIC_SURFACE_FIELDS = frozenset(
    {
        "offer_id",
        "offer_version",
        "public_name",
        "description_short",
        "amount_cents",
        "currency",
        "billing_mode",
        "cycle",
        "commitment_months",
        "max_payments",
        "total_commitment_cents",
        "notice_days",
        "checkout_mode",
        "status",
        "recommended",
        "silent_renewal",
        "scope_version",
        "terms_version",
        "deliverables",
        "commercial_credit",
        "delivery_business_days_min",
        "delivery_business_days_max",
        "recomposition",
    }
)
INTERNAL_FIELDS = frozenset(
    {
        "internal_code",
        "description_asaas",
        "provider_mapping_status",
        "approval_state",
        "change_reason",
        "capacity_required",
        "capacity_units",
        "effective_from",
        "effective_to",
        "sold_out",
        "funnel_role",
        "upsell_policy",
        "offer_code",
    }
)
CHECKOUT_BLOCKING_STATUSES = frozenset({"PAUSED", "RETIRED", "DRAFT"})
MAPPING_ID_FIELDS = ("asaas_product_id", "checkout_id", "subscription_mapping")
MAPPING_ALLOWED_OFFER_STATUSES = frozenset({"APPROVED", "ACTIVE"})
VERDICT_READY = "OFFER_CATALOG_AUTHORITY_READY_FOR_ASAAS_REGISTRATION"
VERDICT_BLOCKED = "OFFER_CATALOG_BLOCKED_ON_NAMED_FOUNDER_FIELDS"
OVERLAY_V2_VERDICT = "WEB_CFG_CATALOG_PINNED_ASAAS_AND_CAPACITY_BLOCKED"
COMPATIBILITY_CONTRACT_PATH = "commercial/compatibility/consumer-compatibility.v1.json"
COMPATIBILITY_FIXTURE_PATH = "commercial/fixtures/consumer-compatibility.ci.v1.json"
AUTHORITY_OVERLAY_V2_PATH = "commercial/authority/authority-overlay.v2.json"
AUTHORITY_OVERLAY_V2_SCHEMA_PATH = "schemas/commercial-authority-overlay.v2.schema.json"
AUTHORITY_OVERLAY_V3_PATH = "commercial/authority/authority-overlay.v3.json"
AUTHORITY_OVERLAY_V3_SCHEMA_PATH = "schemas/commercial-authority-overlay.v3.schema.json"
WEB_CFG_DELIVERABLES_BLOB = "99e77f51336e7fe63af0446d7577b3b20fe9a9b0"
WEB_CFG_NAMING_BLOB = "5f39620c0488625648aa9c3919a9eea3b8ce2004"
REQUIRED_COMPAT_DRIFTS = (
    "one_off_null_vs_0_1",
    "billing_enum_casing",
    "scope_version_local_freeze",
)
CONSUMER_SCOPE_ALIAS = "CFG-SCOPE-B2B-2026-08-17-v1"
CANONICAL_SCOPE_BY_OFFER = {
    "CFG-DIAG-EXP-v1": "CFG-SCOPE-DIAG-EXP-v1",
    "CFG-DIRB2G-FLEX-v1": "CFG-SCOPE-DIRB2G-STD-v1",
    "CFG-DIRB2G-180-v1": "CFG-SCOPE-DIRB2G-STD-v1",
    "CFG-DIRB2G-365-v1": "CFG-SCOPE-DIRB2G-STD-v1",
}
BILLING_ALIASES = {
    "one_time": "ONE_TIME",
    "subscription": "RECURRING",
}
PARTNER_PATH_MARKERS = (
    "partners/",
    "referral-cosell",
    "commission_schedule",
    "partner-program",
    "COMMISSION_SCHEDULE",
    "PARTNER_EVENT",
)
ISO_Z_RE = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")
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
RECEIVED_REVENUE_EVENTS = frozenset({"payment_received", "payment_received_in_cash"})
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
    re.compile(r"\b\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}\b"),
    re.compile(r"\b\d{3}\.\d{3}\.\d{3}-\d{2}\b"),
)
# Asaas resource identifiers (cus_/sub_/pay_) are mapping IDs, not secrets.
# They are accepted by --check-mapping and must not be treated as API keys.

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
    {
        "path": "commercial/CONSUMER-CONTRACT.md",
        "schema_version": "consumer-contract.v1",
    },
    {
        "path": "commercial/DECISIONS-CHANGELOG.md",
        "schema_version": "decisions-changelog.v1",
    },
    {
        "path": "commercial/FOUNDER-ASAAS-REGISTRATION.md",
        "schema_version": "founder-asaas-registration.v1",
    },
    {
        "path": "commercial/offers/catalog.human.v1.md",
        "schema_version": "offer-catalog.human.v1",
    },
    {
        "path": "commercial/offers/pending-founder-inputs.v1.json",
        "schema_version": "pending-founder-inputs.v1",
    },
    {
        "path": "commercial/providers/asaas-mapping.v1.json",
        "schema_version": "provider-mapping.v1",
    },
    {
        "path": "commercial/gates/diagnostico-limited-production.v1.json",
        "schema_version": "diagnostico-limited-production.v1",
    },
    {
        "path": "commercial/fixtures/consumer-catalog.example.v1.json",
        "schema_version": "consumer-catalog-fixture.v1",
    },
    {
        "path": "schemas/provider-mapping.v1.schema.json",
        "schema_version": "provider-mapping.v1.schema",
    },
    {
        "path": "schemas/diagnostico-limited-production.v1.schema.json",
        "schema_version": "diagnostico-limited-production.v1.schema",
    },
    {
        "path": COMPATIBILITY_CONTRACT_PATH,
        "schema_version": "consumer-compatibility.v1",
    },
    {
        "path": COMPATIBILITY_FIXTURE_PATH,
        "schema_version": "consumer-compatibility-fixture.v1",
    },
    {
        "path": "schemas/consumer-compatibility.v1.schema.json",
        "schema_version": "consumer-compatibility.v1.schema",
    },
    {
        "path": "schemas/mapping-copyback.v1.schema.json",
        "schema_version": "mapping-copyback.v1.schema",
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


# Public CNPJ of the contracting legal entity, verified 2026-08-18.
# It is identity, not a secret. Any other CNPJ/CPF in-tree remains forbidden.
ALLOWED_PUBLIC_IDENTITY_TOKENS = frozenset({"52.407.089/0001-09"})


def scan_forbidden_secrets(text: str) -> list[str]:
    hits: list[str] = []
    for pattern in SECRET_PATTERNS:
        found = pattern.findall(text)
        hits.extend(str(item) for item in found)
    return [hit for hit in hits if hit not in ALLOWED_PUBLIC_IDENTITY_TOKENS]


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
    derived_offers = {offer_id_of(offer): offer for offer in derived["offers"]}
    public_offers = {offer_id_of(offer): offer for offer in public_catalog.get("offers") or ()}
    if set(derived_offers) != set(public_offers):
        raise ValidationError("public catalog offer set does not match derived public offers")
    if public_catalog.get("visibility") != "PUBLIC_CANDIDATE":
        raise ValidationError("public catalog visibility must be PUBLIC_CANDIDATE until publication is approved")
    if public_catalog.get("publication_status") != "NOT_PUBLISHED":
        raise ValidationError("public catalog is not published")
    if canonical_json(derived) != canonical_json(public_catalog):
        raise ValidationError("public catalog must equal derived public catalog")
    for offer in public_catalog.get("offers") or ():
        if offer.get("amount_cents") == 1000000 and offer.get("billing_mode") == "RECURRING":
            raise ValidationError("no public offer may be 1000000 cents/month")
        code = str(offer.get("offer_code") or offer.get("offer_id") or "")
        if "EXTRA" in code.upper() or "HISTORICAL_LIGHTHOUSE" in json.dumps(offer):
            raise ValidationError("Extra exception leaked into public catalog")


def offer_id_of(offer: Mapping[str, Any]) -> str:
    return str(offer.get("offer_id") or offer.get("offer_code") or "")


def assert_named_offer_fields(offer: Mapping[str, Any]) -> None:
    for field in NAMED_OFFER_FIELDS:
        if field not in offer:
            raise ValidationError(f"{offer_id_of(offer)}: missing named field {field}")
    if offer.get("offer_id") != offer.get("offer_code"):
        raise ValidationError(f"{offer_id_of(offer)}: offer_id must equal offer_code")
    if offer.get("status") not in OFFER_STATES:
        raise ValidationError(f"invalid offer status: {offer.get('status')!r}")
    if offer.get("provider_mapping_status") not in {"PENDING", "MAPPED", "VERIFIED"}:
        raise ValidationError(f"{offer_id_of(offer)}: invalid provider_mapping_status")
    if offer.get("checkout_mode") not in {"DETACHED", "SUBSCRIPTION"}:
        raise ValidationError(f"{offer_id_of(offer)}: invalid checkout_mode")
    if not isinstance(offer.get("sold_out"), bool):
        raise ValidationError(f"{offer_id_of(offer)}: sold_out must be boolean")
    if offer.get("upsell_policy") not in (None, "NEXT_ACTION_NOT_PROMISE"):
        raise ValidationError("upsell must be next action, not a promise")


def required_commercial_fields_missing(offer: Mapping[str, Any]) -> list[str]:
    missing: list[str] = []
    for field in ("public_name", "amount_cents", "billing_mode", "scope_version"):
        value = offer.get(field)
        if value in (None, "", "PENDING_FOUNDER_INPUT"):
            missing.append(field)
    return missing


def assert_offer_invariants(offer: Mapping[str, Any]) -> None:
    reject_float_money(offer)
    assert_named_offer_fields(offer)
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

    if offer.get("capacity_required") is not bool(offer.get("consumes_recurring_slot")):
        raise ValidationError(f"{offer_id_of(offer)}: capacity_required must match consumes_recurring_slot")

    if offer.get("offer_code") == "CFG-DIAG-EXP-v1":
        if offer.get("billing_mode") != "ONE_TIME" or offer.get("amount_cents") != 800000:
            raise ValidationError("Diagnóstico amount/mode mismatch")
        if offer.get("consumes_recurring_slot") is not False:
            raise ValidationError("Diagnóstico must not consume a recurring slot")
        if offer.get("checkout_mode") != "DETACHED" or offer.get("capacity_units") != 0:
            raise ValidationError("Diagnóstico must be DETACHED with capacity_units 0")
        if offer.get("funnel_role") != "ENTRY_ONE_OFF":
            raise ValidationError("Diagnóstico funnel_role must be ENTRY_ONE_OFF")
        if offer.get("internal_code") != "CFG-DIAG-EXP":
            raise ValidationError("Diagnóstico internal_code mismatch")
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
        if offer.get("checkout_mode") != "SUBSCRIPTION" or offer.get("capacity_units") != 1:
            raise ValidationError("Flex must be SUBSCRIPTION with capacity_units 1")
        if offer.get("internal_code") != "CFG-DIRB2G-FLEX":
            raise ValidationError("Flex internal_code mismatch")

    if offer.get("offer_code") == "CFG-DIRB2G-180-v1":
        _assert_fixed_commitment(offer, amount=1500000, payments=6, total=9000000)
        reco = offer.get("recomposition") or {}
        if reco.get("base_cents_per_started_month") != 500000:
            raise ValidationError("180 recomposition-base must be 500000 cents")
        if offer.get("checkout_mode") != "SUBSCRIPTION" or offer.get("internal_code") != "CFG-DIRB2G-180":
            raise ValidationError("180 checkout_mode/internal_code mismatch")

    if offer.get("offer_code") == "CFG-DIRB2G-365-v1":
        _assert_fixed_commitment(offer, amount=1250000, payments=12, total=15000000)
        reco = offer.get("recomposition") or {}
        if reco.get("base_cents_per_started_month") != 750000:
            raise ValidationError("365 recomposition-base must be 750000 cents")
        if offer.get("checkout_mode") != "SUBSCRIPTION" or offer.get("internal_code") != "CFG-DIRB2G-365":
            raise ValidationError("365 checkout_mode/internal_code mismatch")

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
    ids = [offer.get("offer_id") for offer in offers]
    if sorted(codes) != sorted(CANONICAL_OFFER_CODES):
        raise ValidationError(f"canonical offer set mismatch: {codes}")
    if ids != codes:
        raise ValidationError("offer_id set must match offer_code set")
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


def assert_authority_overlay_v2(
    overlay: Mapping[str, Any],
    catalog: Mapping[str, Any],
    mapping: Mapping[str, Any],
    legacy_capacity: Mapping[str, Any],
) -> None:
    """Validate the additive no-catalog overlay against preserved v1 facts."""

    history = overlay.get("v1_history") or {}
    if history.get("preserved") is not True:
        raise ValidationError("authority overlay v2 must preserve v1 history")

    boundary = overlay.get("catalog_boundary") or {}
    if boundary.get("governance_catalog_role") != "NONE" or boundary.get("no_parallel_catalog") is not True:
        raise ValidationError("Governance must not claim a parallel public catalog in overlay v2")
    registry = boundary.get("deliverables_registry") or {}
    naming = boundary.get("naming_authority") or {}
    if registry.get("blob_sha") != WEB_CFG_DELIVERABLES_BLOB:
        raise ValidationError("overlay v2 deliverables registry pin drifted")
    if registry.get("deliverable_count") != 54 or registry.get("container_count") != 2:
        raise ValidationError("overlay v2 must pin 54 deliverables and 2 containers")
    if naming.get("blob_sha") != WEB_CFG_NAMING_BLOB:
        raise ValidationError("overlay v2 naming authority pin drifted")
    if (
        naming.get("effective_at") is not None
        or naming.get("human_test_state") != "NOT_STARTED"
        or naming.get("publication_state") != "DECIDED_NOT_PROVEN_EFFECTIVE"
    ):
        raise ValidationError("naming decision must not be promoted to proven publication")

    canonical_offer_ids = {item.get("offer_id") for item in catalog.get("offers") or ()}
    subset = overlay.get("historical_financial_subset") or {}
    if subset.get("classification") != "HISTORICAL_FINANCIAL_MAPPING_SUBSET":
        raise ValidationError("four v1 records must be classified as a historical financial subset")
    if subset.get("complete_public_catalog") is not False:
        raise ValidationError("historical financial subset must not claim complete catalog authority")
    if set(subset.get("offer_ids") or ()) != canonical_offer_ids or len(canonical_offer_ids) != 4:
        raise ValidationError("overlay v2 historical subset must match the four preserved v1 IDs")

    provider = overlay.get("provider_boundary") or {}
    provider_rows = provider.get("mappings") or []
    if provider.get("provider_lookup_performed") is not False or provider.get("checkout_gate") != "BLOCKED":
        raise ValidationError("unproved provider state must keep checkout BLOCKED")
    if {row.get("offer_id") for row in provider_rows} != canonical_offer_ids:
        raise ValidationError("overlay v2 provider rows must cover only the historical subset")
    for row in provider_rows:
        if row.get("mapping_state") not in {"MISSING", "UNKNOWN", "BLOCKED"}:
            raise ValidationError("provider mapping state must fail closed")
        if row.get("provider_object_state") not in {"MISSING", "UNKNOWN", "BLOCKED"}:
            raise ValidationError("provider object state must fail closed")
        if row.get("provider_object_id") is not None:
            raise ValidationError("overlay v2 must not invent or copy an unproved provider object ID")
    if any(not mapping_ids_pending(row) for row in mapping.get("mappings") or ()):
        raise ValidationError("checked-in Asaas mapping unexpectedly claims a provider object")

    capacity = overlay.get("capacity_boundary") or {}
    ceiling = capacity.get("policy_ceiling") or {}
    legacy_ceiling = (legacy_capacity.get("recurring") or {}).get("global_active_slots")
    if ceiling.get("units") != legacy_ceiling or ceiling.get("state") != "KNOWN":
        raise ValidationError("overlay v2 policy ceiling must pin, not reinterpret, v1")
    for field in ("staffed_capacity", "committed", "available"):
        fact = capacity.get(field) or {}
        if fact.get("state") != "UNKNOWN" or fact.get("units") is not None:
            raise ValidationError(f"{field} must remain UNKNOWN until real evidence is published")
    if capacity.get("admission") not in {"UNKNOWN", "CANNOT_ACCEPT"} or capacity.get("can_accept") is not False:
        raise ValidationError("unknown staffed capacity must fail closed for admission")
    if capacity.get("policy_ceiling") == capacity.get("staffed_capacity"):
        raise ValidationError("policy ceiling must never be copied into staffed capacity")

    semantics = overlay.get("payment_semantics") or {}
    if semantics.get("proposal_accepted") != "NOT_REVENUE":
        raise ValidationError("proposal acceptance must not be revenue")
    if semantics.get("PAYMENT_CREATED") != "PROVIDER_OBJECT_CREATED_NOT_PAID_NOT_RECEIVED":
        raise ValidationError("PAYMENT_CREATED semantics drifted")
    if semantics.get("PAYMENT_CONFIRMED") != "PAID_NOT_RECEIVED":
        raise ValidationError("PAYMENT_CONFIRMED must not be received revenue")
    if semantics.get("PAYMENT_RECEIVED") != "RECEIVED_REVENUE_REQUIRES_PROVIDER_PROOF":
        raise ValidationError("PAYMENT_RECEIVED must require provider proof")

    gates = overlay.get("activation_gates") or {}
    if any(gates.get(key) is not False for key in (
        "production_checkout_enabled",
        "real_money_mutation_approved",
        "provider_objects_proven",
        "staffed_capacity_published",
    )):
        raise ValidationError("overlay v2 activation gates must remain false")


def assert_authority_overlay_v3(
    overlay: Mapping[str, Any], catalog: Mapping[str, Any], gates: Mapping[str, Any]
) -> None:
    """Cross-check the current external pins without turning the overlay into a catalog."""

    boundary = overlay.get("catalog_boundary") or {}
    if boundary.get("governance_catalog_role") != "NONE" or boundary.get("no_parallel_catalog") is not True:
        raise ValidationError("authority overlay v3 must not create a parallel catalog")
    selected = overlay.get("canary_selection") or {}
    offer = next(
        (item for item in catalog.get("offers") or () if item.get("offer_id") == selected.get("offer_id")),
        None,
    )
    if not offer or selected.get("amount_cents") != offer.get("amount_cents"):
        raise ValidationError("authority overlay v3 canary price diverges from the preserved financial subset")
    if selected.get("synthetic_only") is not True or selected.get("catalog_promoted") is not False:
        raise ValidationError("authority overlay v3 canary must remain synthetic and unpromoted")
    boundaries = overlay.get("boundaries") or {}
    false_fields = (
        "provider_lookup_performed", "production_checkout_enabled", "real_money_mutation_approved",
        "smtp_used", "outbound_mutated", "second_catalog_created", "second_ledger_created",
    )
    if any(boundaries.get(field) is not False for field in false_fields):
        raise ValidationError("authority overlay v3 safety boundaries must remain false")
    if boundaries.get("provider_object_id") is not None:
        raise ValidationError("authority overlay v3 must not invent a provider object")
    if gates.get("production_checkout_enabled") is not False or gates.get("real_money_mutation_approved") is not False:
        raise ValidationError("production gates unexpectedly diverged from authority overlay v3")


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


def format_brl_cents(cents: int | None) -> str:
    if cents is None:
        return "n/a"
    if not is_int_money(cents):
        raise ValidationError(f"money must be integer centavos, got {cents!r}")
    reais, frac = divmod(cents, 100)
    grouped = f"{reais:,}".replace(",", ".")
    return f"R$ {grouped},{frac:02d}"


def mapping_ids_pending(row: Mapping[str, Any]) -> bool:
    return all(row.get(field) in (None, "") for field in MAPPING_ID_FIELDS)


def provider_mapping_ready(row: Mapping[str, Any], offer: Mapping[str, Any]) -> bool:
    if row.get("status") != "VERIFIED":
        return False
    if mapping_ids_pending(row):
        return False
    if offer.get("billing_mode") == "ONE_TIME":
        return bool(row.get("asaas_product_id") or row.get("checkout_id"))
    return bool(row.get("asaas_product_id") and row.get("subscription_mapping"))


def offer_checkout_blocked_by_lifecycle(offer: Mapping[str, Any]) -> bool:
    if offer.get("status") in CHECKOUT_BLOCKING_STATUSES:
        return True
    if offer.get("sold_out") is True:
        return True
    return False


def overlay_authorizes_diagnostico(overlay: Mapping[str, Any], offer: Mapping[str, Any]) -> bool:
    if overlay.get("approved_offer_id") != "CFG-DIAG-EXP-v1":
        return False
    if overlay.get("approved_amount_cents") != 800000:
        return False
    if overlay.get("approved_billing_mode") != "ONE_TIME":
        return False
    if overlay.get("production_checkout_approved") is not True:
        return False
    if overlay.get("recurring_checkout_approved") is True:
        return False
    if overlay.get("portfolio_terms_replaced") is True:
        return False
    if offer_id_of(offer) != "CFG-DIAG-EXP-v1":
        return False
    if offer.get("amount_cents") != 800000 or offer.get("billing_mode") != "ONE_TIME":
        return False
    return True


def assert_overlay_does_not_flip_portfolio_gates(overlay: Mapping[str, Any], gates_doc: Mapping[str, Any]) -> None:
    if overlay.get("does_not_flip_portfolio_gates") is not True:
        raise ValidationError("overlay must declare it does not flip portfolio gates")
    if overlay.get("portfolio_terms_replaced") is not False:
        raise ValidationError("Diagnóstico overlay must not replace portfolio terms")
    if overlay.get("recurring_checkout_approved") is not False:
        raise ValidationError("overlay must keep recurring checkout false")
    if overlay.get("automated_refund_approved") is not False:
        raise ValidationError("overlay must keep automated refund false")
    if overlay.get("automated_nfse_approved") is not False:
        raise ValidationError("overlay must keep automated NFS-e false")
    if overlay.get("legal_approved_claim_forbidden") is not True:
        raise ValidationError("overlay must forbid LEGAL_APPROVED claim")
    if overlay.get("scoped_terms_version") != "CFG-LEGAL-TERMS-DIAG-EXP-FOUNDER-v1":
        raise ValidationError("scoped Diagnóstico terms overlay identity mismatch")
    if overlay.get("portfolio_terms_version") != TERMS_VERSION:
        raise ValidationError("portfolio terms identity mismatch")
    if gates_doc.get("production_checkout_enabled") is True:
        raise ValidationError("Diagnóstico overlay must not flip portfolio production_checkout_enabled")
    if gates_doc.get("public_activation_approved") is True:
        raise ValidationError("Diagnóstico overlay must not flip portfolio public_activation_approved")
    if gates_doc.get("real_money_mutation_approved") is True:
        raise ValidationError("Diagnóstico overlay must not flip portfolio real_money_mutation_approved")


def commercial_checkout_permitted(
    *,
    offer: Mapping[str, Any],
    gates_doc: Mapping[str, Any],
    overlay: Mapping[str, Any],
) -> bool:
    if offer_checkout_blocked_by_lifecycle(offer):
        return False
    if offer.get("billing_mode") == "RECURRING":
        return False
    return overlay_authorizes_diagnostico(overlay, offer)


def checkout_may_create_provider_object(
    *,
    offer: Mapping[str, Any],
    gates_doc: Mapping[str, Any],
    overlay: Mapping[str, Any],
    mapping_row: Mapping[str, Any],
) -> bool:
    if not commercial_checkout_permitted(offer=offer, gates_doc=gates_doc, overlay=overlay):
        return False
    return provider_mapping_ready(mapping_row, offer)


def visitor_surface_fields(offer: Mapping[str, Any]) -> dict[str, Any]:
    return {key: deepcopy(offer[key]) for key in PUBLIC_SURFACE_FIELDS if key in offer}


def assert_mapping_invariants(mapping: Mapping[str, Any], catalog: Mapping[str, Any]) -> None:
    if mapping.get("provider") != "asaas":
        raise ValidationError("mapping provider must be asaas")
    if mapping.get("secrets_forbidden") is not True:
        raise ValidationError("mapping must forbid secrets")
    if mapping.get("external_reference_policy") != "cfg:{offer_id}:{correlation_id}":
        raise ValidationError("external_reference_policy mismatch")
    rows = mapping.get("mappings") or []
    ids = [row.get("offer_id") for row in rows]
    if sorted(ids) != sorted(CANONICAL_OFFER_CODES):
        raise ValidationError(f"mapping offer set mismatch: {ids}")
    by_id = {row["offer_id"]: row for row in rows}
    for offer in catalog.get("offers") or ():
        row = by_id[offer_id_of(offer)]
        pending = mapping_ids_pending(row)
        if pending and offer.get("provider_mapping_status") != "PENDING":
            raise ValidationError(f"{offer_id_of(offer)}: null mapping IDs require provider_mapping_status=PENDING")
        if row.get("status") == "PENDING_MANUAL_CADASTRO" and not pending:
            raise ValidationError(f"{offer_id_of(offer)}: PENDING_MANUAL_CADASTRO cannot carry provider IDs")
        payload = canonical_json(row)
        if scan_forbidden_secrets(payload):
            raise ValidationError(f"{offer_id_of(offer)}: mapping row contains forbidden secret/token")
        if not pending:
            if offer.get("provider_mapping_status") not in {"MAPPED", "VERIFIED"}:
                raise ValidationError(
                    f"{offer_id_of(offer)}: filled mapping IDs require catalog provider_mapping_status MAPPED or VERIFIED"
                )
            if row.get("status") not in {"MAPPED", "VERIFIED"}:
                raise ValidationError(f"{offer_id_of(offer)}: filled mapping IDs cannot stay PENDING_MANUAL_CADASTRO")
            assert_mapping_identifier_modality(row, offer)
            assert_mapping_row_secrets_and_urls(row)
    assert_mapping_table_isolation(mapping, catalog)


def assert_pending_founder_inputs(doc: Mapping[str, Any], catalog: Mapping[str, Any]) -> None:
    if doc.get("blocks_catalog_verdict") is not False:
        raise ValidationError("low-friction pending input must not block the documented v1 catalog")
    items = doc.get("items") or []
    if not items:
        raise ValidationError("pending founder inputs must record the absent low-friction SKU")
    low = items[0]
    if low.get("id") != "LOW_FRICTION_ENTRY_OFFER" or low.get("status") != "PENDING_FOUNDER_INPUT":
        raise ValidationError("low-friction SKU must remain PENDING_FOUNDER_INPUT")
    if low.get("must_not_invent") is not True:
        raise ValidationError("pending input must forbid invention")
    catalog_ids = {offer_id_of(offer) for offer in catalog.get("offers") or ()}
    if "PENDING_FOUNDER_INPUT" in catalog_ids:
        raise ValidationError("do not insert an invented pending offer_id into the catalog")


def assert_consumer_fixture(fixture: Mapping[str, Any], mapping: Mapping[str, Any]) -> None:
    consumers = fixture.get("consumers") or []
    if "web-cfg#88" not in consumers or "Warmbly#47" not in consumers:
        raise ValidationError("consumer fixture must name web-cfg#88 and Warmbly#47")
    if fixture.get("canonical_catalog") != "commercial/offers/catalog.v1.json":
        raise ValidationError("fixture canonical catalog path mismatch")
    for offer in fixture.get("offers") or ():
        for field in ("asaas_product_id", "checkout_id", "subscription_mapping"):
            if offer.get(field) not in (None, "", False):
                raise ValidationError("consumer fixture must not contain real provider IDs")
    for row in mapping.get("mappings") or ():
        if not mapping_ids_pending(row):
            raise ValidationError("current mapping template must not ship real provider IDs")
    text = canonical_json(fixture)
    if scan_forbidden_secrets(text):
        raise ValidationError("consumer fixture contains forbidden secret/token")


def compatibility_hash(contract: Mapping[str, Any]) -> str:
    return content_hash_json(contract)


def classify_consumer_value(
    field: str,
    value: Any,
    *,
    offer_id: str,
    canonical: Any,
    contract: Mapping[str, Any],
) -> str:
    """Classify a consumer field against Governance canonical.

    Returns ``canonical``, ``alias``, or ``foreign``. Aliases are never Governance truth.
    """
    if value == canonical:
        return "canonical"
    for drift in contract.get("accepted_consumer_aliases") or ():
        drift_id = drift.get("drift_id")
        if drift_id == "one_off_null_vs_0_1":
            applies = drift.get("applies_to") or []
            if offer_id in applies and field in (drift.get("canonical") or {}):
                for alias in drift.get("aliases") or ():
                    if field in alias and alias[field] == value:
                        return "alias"
        elif drift_id == "billing_enum_casing" and field == "billing_mode":
            for alias in drift.get("aliases") or ():
                if value in alias and alias[value] == canonical:
                    return "alias"
        elif drift_id == "scope_version_local_freeze" and field == "scope_version":
            for alias in drift.get("aliases") or ():
                if alias.get("value") == value:
                    return "alias"
    return "foreign"


def assert_no_silent_coercion(offer: Mapping[str, Any], contract: Mapping[str, Any]) -> None:
    oid = offer_id_of(offer)
    canon = contract.get("canonical_representation") or {}
    billing = offer.get("billing_mode")
    allowed_billing = list(canon.get("billing_mode") or ("ONE_TIME", "RECURRING"))
    if billing not in allowed_billing:
        raise ValidationError(f"{oid}: silent coercion of billing_mode {billing!r} is forbidden")
    expected_scope = (canon.get("scope_version_by_offer") or CANONICAL_SCOPE_BY_OFFER).get(oid)
    if offer.get("scope_version") != expected_scope:
        raise ValidationError(f"{oid}: silent coercion of local B2B scope_version is forbidden")
    if billing == "ONE_TIME":
        for field in canon.get("one_off_null_fields") or ():
            if offer.get(field) is not None:
                raise ValidationError(
                    f"{oid}: silent coercion of one-off 0/1 {field}={offer.get(field)!r} is forbidden"
                )


def assert_compatibility_contract(contract: Mapping[str, Any], catalog: Mapping[str, Any]) -> None:
    if contract.get("schema_version") != "consumer-compatibility.v1":
        raise ValidationError("compatibility contract schema_version mismatch")
    if contract.get("contract_id") != "CFG-CONSUMER-COMPAT-v1":
        raise ValidationError("compatibility contract_id mismatch")
    if contract.get("rule") != "GOVERNANCE_WINS":
        raise ValidationError("compatibility contract must declare GOVERNANCE_WINS")
    consumers = contract.get("consumers") or []
    if "web-cfg#88" not in consumers or "Warmbly#47" not in consumers:
        raise ValidationError("compatibility contract must name web-cfg#88 and Warmbly#47")
    if contract.get("canonical_catalog") != "commercial/offers/catalog.v1.json":
        raise ValidationError("compatibility contract canonical catalog path mismatch")
    if contract.get("pin_command") != "python scripts/validate_commercial_authority.py":
        raise ValidationError("compatibility contract pin_command mismatch")
    drifts = [item.get("drift_id") for item in contract.get("accepted_consumer_aliases") or ()]
    if list(REQUIRED_COMPAT_DRIFTS) != drifts and set(REQUIRED_COMPAT_DRIFTS) != set(drifts):
        missing = [item for item in REQUIRED_COMPAT_DRIFTS if item not in drifts]
        if missing:
            raise ValidationError(f"compatibility contract missing named drifts: {missing}")
    for drift in contract.get("accepted_consumer_aliases") or ():
        if drift.get("alias_only") is not True:
            raise ValidationError(f"{drift.get('drift_id')}: aliases are alias-only, never Governance truth")
    forbidden = contract.get("forbidden_silent_coercions") or []
    if len(forbidden) < 3:
        raise ValidationError("compatibility contract must list forbidden silent coercions")
    notes = contract.get("migration_notes") or []
    if not notes:
        raise ValidationError("compatibility contract must include migration/deprecation notes")
    if not contract.get("exact_hash_rule"):
        raise ValidationError("compatibility contract must state the exact-hash rule")
    canon = contract.get("canonical_representation") or {}
    scope_map = canon.get("scope_version_by_offer") or {}
    if scope_map != CANONICAL_SCOPE_BY_OFFER:
        raise ValidationError("compatibility canonical scope_version_by_offer mismatch")
    offers = {offer_id_of(offer): offer for offer in catalog.get("offers") or ()}
    for oid, expected_scope in CANONICAL_SCOPE_BY_OFFER.items():
        offer = offers.get(oid)
        if offer is None:
            raise ValidationError(f"compatibility contract names missing catalog offer {oid}")
        if offer.get("scope_version") != expected_scope:
            raise ValidationError(f"{oid}: catalog scope_version is not the compatibility canonical")
        if offer.get("billing_mode") not in (canon.get("billing_mode") or ()):
            raise ValidationError(f"{oid}: catalog billing_mode is not canonical")
        assert_no_silent_coercion(offer, contract)
        if oid == "CFG-DIAG-EXP-v1":
            for field in canon.get("one_off_null_fields") or ():
                if offer.get(field) is not None:
                    raise ValidationError(f"{oid}: canonical one-off {field} must be null")


def render_compatibility_fixture(
    contract: Mapping[str, Any],
    catalog: Mapping[str, Any],
    mapping: Mapping[str, Any],
) -> dict[str, Any]:
    offers: list[dict[str, Any]] = []
    by_map = {row["offer_id"]: row for row in mapping.get("mappings") or ()}
    for offer in catalog.get("offers") or ():
        oid = offer_id_of(offer)
        row = by_map[oid]
        if not mapping_ids_pending(row):
            raise ValidationError("compatibility fixture refuses real provider IDs")
        offers.append(
            {
                "offer_id": oid,
                "offer_version": offer.get("offer_version"),
                "public_name": offer.get("public_name"),
                "amount_cents": offer.get("amount_cents"),
                "currency": offer.get("currency"),
                "billing_mode": offer.get("billing_mode"),
                "cycle": offer.get("cycle"),
                "commitment_months": offer.get("commitment_months"),
                "max_payments": offer.get("max_payments"),
                "total_commitment_cents": offer.get("total_commitment_cents"),
                "notice_days": offer.get("notice_days"),
                "scope_version": offer.get("scope_version"),
                "terms_version": offer.get("terms_version"),
                "asaas_product_id": None,
                "checkout_id": None,
                "subscription_mapping": None,
            }
        )
    return {
        "schema_version": "consumer-compatibility-fixture.v1",
        "read_only": True,
        "consumers": ["web-cfg#88", "Warmbly#47"],
        "canonical_catalog": "commercial/offers/catalog.v1.json",
        "compatibility_contract": COMPATIBILITY_CONTRACT_PATH,
        "compatibility_hash": compatibility_hash(contract),
        "pin_command": "python scripts/validate_commercial_authority.py",
        "rule": "GOVERNANCE_WINS",
        "accepted_alias_drift_ids": [item["drift_id"] for item in contract.get("accepted_consumer_aliases") or ()],
        "offers": offers,
    }


def assert_compatibility_fixture(
    fixture: Mapping[str, Any],
    contract: Mapping[str, Any],
    catalog: Mapping[str, Any],
    mapping: Mapping[str, Any],
) -> None:
    expected = render_compatibility_fixture(contract, catalog, mapping)
    if canonical_json(fixture) != canonical_json(expected):
        raise ValidationError("compatibility CI fixture drifted from renderer")
    if fixture.get("read_only") is not True:
        raise ValidationError("compatibility CI fixture must be read-only")
    if "web-cfg#88" not in (fixture.get("consumers") or ()) or "Warmbly#47" not in (fixture.get("consumers") or ()):
        raise ValidationError("compatibility fixture must name web-cfg#88 and Warmbly#47")
    if fixture.get("compatibility_hash") != compatibility_hash(contract):
        raise ValidationError("compatibility fixture hash is not the shipped contract hash")
    if fixture.get("pin_command") != "python scripts/validate_commercial_authority.py":
        raise ValidationError("compatibility fixture pin_command mismatch")
    for offer in fixture.get("offers") or ():
        for field in MAPPING_ID_FIELDS:
            if offer.get(field) not in (None, "", False):
                raise ValidationError("compatibility fixture must not contain real provider IDs")
    if scan_forbidden_secrets(canonical_json(fixture)):
        raise ValidationError("compatibility fixture contains forbidden secret/token")


def assert_no_partner_in_catalog_manifest(manifest: Mapping[str, Any]) -> None:
    for item in manifest.get("artifacts") or ():
        path = str(item.get("path") or "")
        lowered = path.lower()
        for marker in PARTNER_PATH_MARKERS:
            if marker.lower() in lowered:
                raise ValidationError(f"catalog authority-manifest must not include Partner Program path {path}")


def looks_like_invented_url(value: Any) -> bool:
    if not isinstance(value, str) or not value:
        return False
    lowered = value.lower()
    if "://" in lowered or lowered.startswith("http:") or lowered.startswith("https:"):
        return True
    host = ".".join(("checkout", "asaas", "com"))
    path = "asaas.com" + "/c/"
    return host in lowered or path in lowered


def _id_present(value: Any) -> bool:
    return isinstance(value, str) and value.strip() != ""


def assert_mapping_identifier_modality(row: Mapping[str, Any], offer: Mapping[str, Any]) -> None:
    oid = offer_id_of(offer)
    product = row.get("asaas_product_id")
    checkout = row.get("checkout_id")
    subscription = row.get("subscription_mapping")
    if offer.get("billing_mode") == "ONE_TIME":
        if _id_present(subscription):
            raise ValidationError(f"{oid}: one-off vs recurring identifier mismatch")
        if not _id_present(product) or not _id_present(checkout):
            raise ValidationError(f"{oid}: one-off vs recurring identifier mismatch")
        return
    if offer.get("billing_mode") == "RECURRING":
        if _id_present(checkout):
            raise ValidationError(f"{oid}: one-off vs recurring identifier mismatch")
        if not _id_present(product) or not _id_present(subscription):
            raise ValidationError(f"{oid}: one-off vs recurring identifier mismatch")
        return
    raise ValidationError(f"{oid}: one-off vs recurring identifier mismatch")


def assert_mapping_row_secrets_and_urls(row: Mapping[str, Any]) -> None:
    oid = str(row.get("offer_id") or "")
    for field in MAPPING_ID_FIELDS:
        value = row.get(field)
        if not _id_present(value):
            continue
        if looks_like_invented_url(value):
            raise ValidationError(f"{oid}: invented URL is forbidden")
        if scan_forbidden_secrets(str(value)):
            raise ValidationError(f"{oid}: mapping contains secret")
    payload = canonical_json({field: row.get(field) for field in MAPPING_ID_FIELDS})
    if scan_forbidden_secrets(payload):
        raise ValidationError(f"{oid}: mapping contains secret")


def assert_mapping_table_isolation(mapping: Mapping[str, Any], catalog: Mapping[str, Any]) -> None:
    offers = {offer_id_of(offer): offer for offer in catalog.get("offers") or ()}
    rows = mapping.get("mappings") or []
    environments: set[str] = set()
    seen_ids: dict[str, str] = {}
    for row in rows:
        oid = str(row.get("offer_id") or "")
        if oid not in offers:
            raise ValidationError(f"unknown offer {oid}")
        offer = offers[oid]
        filled = not mapping_ids_pending(row)
        env = row.get("environment")
        if env not in {"SANDBOX", "PRODUCTION"}:
            raise ValidationError(f"{oid}: mapping environment must be SANDBOX or PRODUCTION")
        environments.add(str(env))
        if filled:
            if offer.get("status") not in MAPPING_ALLOWED_OFFER_STATUSES:
                raise ValidationError(f"{oid}: status does not allow mapping")
            assert_mapping_identifier_modality(row, offer)
            assert_mapping_row_secrets_and_urls(row)
            for field in MAPPING_ID_FIELDS:
                value = row.get(field)
                if not _id_present(value):
                    continue
                owner = seen_ids.get(str(value))
                if owner and owner != oid:
                    raise ValidationError(f"duplicate provider ID {value!r} on incompatible offers")
                seen_ids[str(value)] = oid
    if "SANDBOX" in environments and "PRODUCTION" in environments:
        raise ValidationError("sandbox/production mix is forbidden in one mapping table")


def assert_mapping_copyback_payload(
    payload: Mapping[str, Any],
    catalog: Mapping[str, Any],
    mapping: Mapping[str, Any],
    gates_doc: Mapping[str, Any],
    schema: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Fail-closed founder copy-back. Never calls Asaas. Never writes. Never enables checkout."""
    gates_before = canonical_json(gates_doc)
    if schema is not None:
        schema_validate(payload, schema)
    if payload.get("schema_version") != "mapping-copyback.v1":
        raise ValidationError("mapping copy-back schema_version mismatch")
    records = payload.get("records") or []
    if not records:
        raise ValidationError("mapping copy-back requires at least one record")
    offers = {offer_id_of(offer): offer for offer in catalog.get("offers") or ()}
    new_mapping = deepcopy(dict(mapping))
    rows_by_id = {row["offer_id"]: deepcopy(row) for row in new_mapping.get("mappings") or ()}
    mapped_ids: list[str] = []
    for record in records:
        oid = str(record.get("offer_id") or "")
        if oid not in offers:
            raise ValidationError(f"unknown offer {oid}")
        offer = offers[oid]
        if offer.get("status") not in MAPPING_ALLOWED_OFFER_STATUSES:
            raise ValidationError(f"{oid}: status does not allow mapping")
        if oid not in rows_by_id:
            raise ValidationError(f"unknown offer {oid}")
        created_at = record.get("created_at")
        copied_at = record.get("copied_at")
        if not (isinstance(created_at, str) and ISO_Z_RE.match(created_at)):
            raise ValidationError(f"{oid}: created_at must be ISO-8601 Z")
        if not (isinstance(copied_at, str) and ISO_Z_RE.match(copied_at)):
            raise ValidationError(f"{oid}: copied_at must be ISO-8601 Z")
        env = record.get("environment")
        if env not in {"SANDBOX", "PRODUCTION"}:
            raise ValidationError(f"{oid}: mapping environment must be SANDBOX or PRODUCTION")
        updated = rows_by_id[oid]
        for field in MAPPING_ID_FIELDS:
            updated[field] = record.get(field)
        updated["environment"] = env
        updated["created_at"] = created_at
        updated["status"] = "MAPPED"
        updated["verified_at"] = None
        rows_by_id[oid] = updated
        mapped_ids.append(oid)
        assert_mapping_identifier_modality(updated, offer)
        assert_mapping_row_secrets_and_urls(updated)
    new_mapping["mappings"] = [rows_by_id[row["offer_id"]] for row in mapping.get("mappings") or ()]
    assert_mapping_table_isolation(new_mapping, catalog)
    if canonical_json(gates_doc) != gates_before:
        raise ValidationError("mapping copy-back mutated gates")
    # Mapping never activates checkout and never approves real_money, regardless of input flags.
    return {
        "mapping": new_mapping,
        "production_checkout_enabled": False,
        "real_money_mutation_approved": False,
        "mapped_offer_ids": mapped_ids,
        "gates_unchanged": True,
    }


def check_mapping_file(path: Path, root: Path | None = None) -> dict[str, Any]:
    root = repo_root(root)
    payload = load_json(path)
    catalog = load_json(root / "commercial" / "offers" / "catalog.v1.json")
    mapping = load_json(root / "commercial" / "providers" / "asaas-mapping.v1.json")
    gates = load_json(root / "commercial" / "gates" / "production-gates.v1.json")
    schema = load_json(root / "schemas" / "mapping-copyback.v1.schema.json")
    return assert_mapping_copyback_payload(payload, catalog, mapping, gates, schema)


def catalog_verdict(catalog: Mapping[str, Any], pending_doc: Mapping[str, Any]) -> str:
    missing: list[str] = []
    for offer in catalog.get("offers") or ():
        missing.extend(f"{offer_id_of(offer)}.{field}" for field in required_commercial_fields_missing(offer))
    if missing:
        return VERDICT_BLOCKED
    if pending_doc.get("blocks_catalog_verdict") is True:
        return VERDICT_BLOCKED
    return VERDICT_READY


def render_human_catalog(catalog: Mapping[str, Any]) -> str:
    lines = [
        "# CONFENGE offer catalog v1 (human-readable)",
        "",
        "Derived from `commercial/offers/catalog.v1.json`. Do not edit by hand.",
        "",
        f"- `catalog_id`: {catalog.get('catalog_id')}",
        f"- `catalog_authority`: {catalog.get('catalog_authority')}",
        f"- `terms_version`: {catalog.get('terms_version')}",
        f"- `currency`: {catalog.get('currency')}",
        "",
        "Consumers: `web-cfg#88`, `Warmbly#47`. Extra historical `1000000` cents/month is not listed.",
        "",
    ]
    for offer in catalog.get("offers") or ():
        lines.append(f"## {offer_id_of(offer)}")
        lines.append("")
        for field in NAMED_OFFER_FIELDS:
            value = offer.get(field)
            if field.endswith("_cents") and isinstance(value, int):
                display = f"{value} ({format_brl_cents(value)})"
            elif value is None:
                display = "null"
            elif isinstance(value, bool):
                display = "true" if value else "false"
            else:
                display = str(value)
            lines.append(f"- `{field}`: {display}")
        sold = offer.get("sold_out")
        lines.append(f"- `sold_out`: {'true' if sold else 'false'}")
        lines.append(f"- `funnel_role`: {offer.get('funnel_role')}")
        lines.append(f"- `upsell_policy`: {offer.get('upsell_policy')}")
        lines.append("")
    lines.append("Verdict token is recorded in `commercial/DECISIONS-CHANGELOG.md`.")
    lines.append("")
    return "\n".join(lines)


def _billing_label(offer: Mapping[str, Any]) -> str:
    if offer.get("billing_mode") == "ONE_TIME":
        return "cobrança única"
    return "recorrente"


def _cycle_label(offer: Mapping[str, Any]) -> str:
    if offer.get("cycle") == "MONTHLY":
        return "MONTHLY"
    return "n/a (não preencher ciclo)"


def _max_payments_label(offer: Mapping[str, Any]) -> str:
    if offer.get("max_payments") is None:
        return "sem máximo — não preencher maxPayments nem endDate"
    return str(offer.get("max_payments"))


def _total_label(offer: Mapping[str, Any]) -> str:
    total = offer.get("total_commitment_cents")
    if offer.get("billing_mode") == "ONE_TIME":
        return f"{offer['amount_cents']} ({format_brl_cents(offer['amount_cents'])}) pagamento único"
    if total is None:
        return "n/a — sem compromisso mínimo; não preencher total"
    return (
        f"{total} ({format_brl_cents(total)}) = "
        f"{offer.get('max_payments')} × {offer.get('amount_cents')}"
    )


def _cadastrar_instruction(offer: Mapping[str, Any]) -> str:
    if offer.get("billing_mode") == "ONE_TIME":
        return "produto avulso (pagamento único) e checkout/link; não criar assinatura"
    if offer.get("max_payments") is None:
        return "produto e assinatura MONTHLY; não preencher maxPayments nem endDate"
    return (
        f"produto e assinatura MONTHLY com maxPayments={offer['max_payments']}; "
        "sem renovação silenciosa"
    )


def _copyback_ids(offer: Mapping[str, Any]) -> str:
    if offer.get("billing_mode") == "ONE_TIME":
        return "`asaas_product_id` e `checkout_id` (`subscription_mapping` permanece null)"
    return "`asaas_product_id` e `subscription_mapping` (`checkout_id` permanece null)"


def _mapping_fields_to_fill(offer: Mapping[str, Any]) -> str:
    oid = offer_id_of(offer)
    if offer.get("billing_mode") == "ONE_TIME":
        fields = "asaas_product_id, checkout_id, environment, created_at"
    else:
        fields = "asaas_product_id, subscription_mapping, environment, created_at"
    return (
        f"`commercial/providers/asaas-mapping.v1.json` mappings[{oid}]: {fields}; "
        "`copied_at` no payload de copy-back"
    )


def render_founder_handoff(catalog: Mapping[str, Any], mapping: Mapping[str, Any]) -> str:
    validator_cmd = "python scripts/validate_commercial_authority.py --check-mapping <payload.json>"
    lines = [
        "# Founder Asaas registration handoff",
        "",
        "Open Asaas. Type the fields below. Do not interpret architecture.",
        "Do not create a customer, cobrança, checkout or webhook from this document.",
        "Do not paste API keys or checkout URLs back into git.",
        "Do not call the Asaas API from this repository.",
        "",
        "Policy de `externalReference`: `cfg:{offer_id}:{correlation_id}`",
        "",
        "After cadastro, copy IDs into a `mapping-copyback.v1` payload and run:",
        f"`{validator_cmd}`",
        "Then, only if that check passes, paste IDs into `commercial/providers/asaas-mapping.v1.json`.",
        "Set mapping `status` to `MAPPED`. `verified_at` stays null until a separate human check.",
        "Mapping does not enable checkout and does not approve real_money.",
        "",
        "## A. você pode cadastrar agora",
        "",
        "As quatro ofertas v1 abaixo têm nome, valor, billing e escopo. Cadastre no Asaas (manual).",
        "Depois copie os IDs de volta. Não publique, não ative checkout, não cobre.",
        "",
    ]
    by_id = {row["offer_id"]: row for row in mapping.get("mappings") or ()}
    for offer in catalog.get("offers") or ():
        oid = offer_id_of(offer)
        row = by_id[oid]
        product = row.get("asaas_product_id")
        checkout = row.get("checkout_id")
        subscription = row.get("subscription_mapping")
        lines.extend(
            [
                f"### {oid}",
                "",
                f"- nome exato: `{offer['public_name']}`",
                f"- descrição: `{offer['description_asaas']}`",
                f"- valor: `{format_brl_cents(offer['amount_cents'])}` (`{offer['amount_cents']}` centavos)",
                f"- billing mode: `{offer['billing_mode']}` ({_billing_label(offer)})",
                f"- cycle: `{_cycle_label(offer)}`",
                f"- maxPayments: `{_max_payments_label(offer)}`",
                f"- total: `{_total_label(offer)}`",
                f"- o que cadastrar: {_cadastrar_instruction(offer)}",
                f"- qual ID copiar de volta: {_copyback_ids(offer)}",
                f"- qual campo do mapping preencher: {_mapping_fields_to_fill(offer)}",
                f"- qual validator rodar: `{validator_cmd}`",
                "- o que continua OFF: `production_checkout_enabled`, `real_money_mutation_approved`, publicação pública, Extra, SmartLic, checkout recorrente, NFS-e automática, refund automático",
                f"- `externalReference` policy: `cfg:{oid}:{{correlation_id}}`",
                f"- Mapping atual: asaas_product_id=`{product if product is not None else 'null'}`, checkout_id=`{checkout if checkout is not None else 'null'}`, subscription_mapping=`{subscription if subscription is not None else 'null'}`, status=`{row.get('status')}`",
                "",
            ]
        )
    lines.extend(
        [
            "## B. não ativar/publicar ainda",
            "",
            "Do NOT activate yet (every offer):",
            "",
            "- recurring production checkout",
            "- `production_checkout_enabled` permanece false",
            "- `real_money_mutation_approved` permanece false",
            "- `public_activation_approved` permanece false",
            "- automated refund or cancellation",
            "- automated NFS-e",
            "- Extra historical R$ 10.000/mês",
            "- SmartLic billing",
            "- silent renewal",
            "- live charge before IDs are copied back and verified",
            "- mapping copy-back does not publish the public catalog",
            "- mapping copy-back does not approve LEGAL_APPROVED",
            "",
            "## C. aguarda campo/decisão",
            "",
            "- `LOW_FRICTION_ENTRY_OFFER` permanece `PENDING_FOUNDER_INPUT` (não inventar preço, nome, billing ou escopo)",
            "- IDs Asaas permanecem `PENDING_MANUAL_CADASTRO` até copy-back manual validado",
            "- `LEGAL_APPROVED` não marcar",
            "- capacity inventory staffed numbers beyond the 50-slot policy",
            "- accountant NFS-e classification",
            "- counsel review after first `PAYMENT_RECEIVED`",
            "",
        ]
    )
    return "\n".join(lines)


def assert_derived_documents(
    root: Path,
    catalog: Mapping[str, Any],
    mapping: Mapping[str, Any],
) -> None:
    human_path = root / "commercial" / "offers" / "catalog.human.v1.md"
    handoff_path = root / "commercial" / "FOUNDER-ASAAS-REGISTRATION.md"
    expected_human = render_human_catalog(catalog)
    expected_handoff = render_founder_handoff(catalog, mapping)
    if load_text(human_path) != expected_human:
        raise ValidationError("human catalog drifted from renderer")
    if load_text(handoff_path) != expected_handoff:
        raise ValidationError("founder handoff drifted from renderer")
    contract = load_text(root / "commercial" / "CONSUMER-CONTRACT.md")
    changelog = load_text(root / "commercial" / "DECISIONS-CHANGELOG.md")
    for required in (
        "web-cfg#88",
        "Warmbly#47",
        "PAUSED",
        "RETIRED",
        "offer_version",
        COMPATIBILITY_CONTRACT_PATH,
        "GOVERNANCE_WINS",
    ):
        if required not in contract:
            raise ValidationError(f"consumer contract missing {required}")
    for required in (
        "você pode cadastrar agora",
        "não ativar/publicar ainda",
        "aguarda campo/decisão",
        "python scripts/validate_commercial_authority.py --check-mapping",
        "PENDING_FOUNDER_INPUT",
    ):
        if required not in expected_handoff:
            raise ValidationError(f"founder handoff missing {required}")
    if VERDICT_READY not in changelog and VERDICT_BLOCKED not in changelog:
        raise ValidationError("changelog must record a catalog verdict token")
    if "PENDING_FOUNDER_INPUT" not in changelog:
        raise ValidationError("changelog must name PENDING_FOUNDER_INPUT")


def write_derived_artifacts(root: Path) -> None:
    catalog = load_json(root / "commercial" / "offers" / "catalog.v1.json")
    exceptions = load_json(root / "commercial" / "exceptions" / "extra-historical.v1.json")
    mapping = load_json(root / "commercial" / "providers" / "asaas-mapping.v1.json")
    contract = load_json(root / COMPATIBILITY_CONTRACT_PATH)
    public = build_public_catalog(catalog, exceptions)
    (root / "commercial" / "offers" / "catalog.public.v1.json").write_text(
        json.dumps(public, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (root / "commercial" / "offers" / "catalog.human.v1.md").write_text(
        render_human_catalog(catalog),
        encoding="utf-8",
    )
    (root / "commercial" / "FOUNDER-ASAAS-REGISTRATION.md").write_text(
        render_founder_handoff(catalog, mapping),
        encoding="utf-8",
    )
    fixture = render_compatibility_fixture(contract, catalog, mapping)
    (root / COMPATIBILITY_FIXTURE_PATH).write_text(
        json.dumps(fixture, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def is_received_revenue(event_type: str) -> bool:
    kind = event_type.lower()
    if kind in CREATED_PROVIDER_EVENTS:
        return False
    if "partner" in kind or "commission" in kind:
        return False
    return kind in RECEIVED_REVENUE_EVENTS


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
    mapping_schema = load_json(root / "schemas" / "provider-mapping.v1.schema.json")
    overlay_schema = load_json(root / "schemas" / "diagnostico-limited-production.v1.schema.json")
    compat_schema = load_json(root / "schemas" / "consumer-compatibility.v1.schema.json")
    authority_overlay_v2_schema = load_json(root / AUTHORITY_OVERLAY_V2_SCHEMA_PATH)
    authority_overlay_v3_schema = load_json(root / AUTHORITY_OVERLAY_V3_SCHEMA_PATH)

    catalog = load_json(root / "commercial" / "offers" / "catalog.v1.json")
    public = load_json(root / "commercial" / "offers" / "catalog.public.v1.json")
    exceptions = load_json(root / "commercial" / "exceptions" / "extra-historical.v1.json")
    gates = load_json(root / "commercial" / "gates" / "production-gates.v1.json")
    overlay = load_json(root / "commercial" / "gates" / "diagnostico-limited-production.v1.json")
    mapping = load_json(root / "commercial" / "providers" / "asaas-mapping.v1.json")
    pending = load_json(root / "commercial" / "offers" / "pending-founder-inputs.v1.json")
    fixture = load_json(root / "commercial" / "fixtures" / "consumer-catalog.example.v1.json")
    compat = load_json(root / COMPATIBILITY_CONTRACT_PATH)
    compat_fixture = load_json(root / COMPATIBILITY_FIXTURE_PATH)
    capacity = load_json(root / "commercial" / "capacity" / "capacity-policy.v1.json")
    terms_manifest = load_json(root / "commercial" / "terms" / "CFG-TERMS-B2B-2026-08-17-v1.manifest.json")
    terms_text = load_text(root / "commercial" / "terms" / "CFG-TERMS-B2B-2026-08-17-v1.md")
    manifest = load_json(root / "commercial" / "authority" / "authority-manifest.v1.json")
    authority_overlay_v2 = load_json(root / AUTHORITY_OVERLAY_V2_PATH)
    authority_overlay_v3 = load_json(root / AUTHORITY_OVERLAY_V3_PATH)

    schema_validate(catalog, catalog_schema)
    schema_validate(public, catalog_schema)
    schema_validate(gates, gates_schema)
    schema_validate(manifest, manifest_schema)
    schema_validate(mapping, mapping_schema)
    schema_validate(overlay, overlay_schema)
    schema_validate(compat, compat_schema)
    schema_validate(authority_overlay_v2, authority_overlay_v2_schema)
    schema_validate(authority_overlay_v3, authority_overlay_v3_schema)

    assert_catalog_invariants(catalog)
    assert_catalog_invariants(public)
    assert_exceptions(exceptions)
    assert_public_catalog_matches(catalog, public, exceptions)
    assert_gates_invariants(gates)
    assert_overlay_does_not_flip_portfolio_gates(overlay, gates)
    assert_no_active_while_gates_pending(catalog, gates)
    assert_no_active_while_gates_pending(public, gates)
    assert_capacity_invariants(capacity)
    assert_authority_overlay_v2(authority_overlay_v2, catalog, mapping, capacity)
    assert_authority_overlay_v3(authority_overlay_v3, catalog, gates)
    assert_mapping_invariants(mapping, catalog)
    assert_pending_founder_inputs(pending, catalog)
    assert_consumer_fixture(fixture, mapping)
    assert_compatibility_contract(compat, catalog)
    assert_compatibility_fixture(compat_fixture, compat, catalog, mapping)
    assert_no_partner_in_catalog_manifest(manifest)
    assert_derived_documents(root, catalog, mapping)
    assert_terms_manifest(terms_manifest)
    assert_authority_flags(manifest)
    assert_manifest_hashes(root, manifest)
    scan_tree_for_secrets(root)

    if TERMS_VERSION not in terms_text or "obligation of means" not in terms_text.lower():
        raise ValidationError("terms text must declare version and obligation of means")

    digest = authority_hash(manifest)
    legal_mod = load_legal_validator(root)
    legal = legal_mod.validate_all_legal_packages(root)
    legacy_verdict = catalog_verdict(catalog, pending)
    return {
        "root": str(root),
        "authority_hash": digest,
        "authority_overlay_v2_hash": content_hash_json(authority_overlay_v2),
        "authority_overlay_v3_hash": content_hash_json(authority_overlay_v3),
        "compatibility_hash": compatibility_hash(compat),
        "legal_package_hash": legal["prior_package_hash"],
        "founder_decided_hash": legal["founder_decided_hash"],
        "catalog_authority_v1_historical": manifest["catalog_authority"],
        "public_catalog_authority": "web-cfg",
        "offers": [offer["offer_code"] for offer in catalog["offers"]],
        "pending_gates": gates_pending_for_active(gates),
        "legacy_verdict": legacy_verdict,
        "verdict": OVERLAY_V2_VERDICT,
        "overlay_diagnostico_authorized": overlay.get("production_checkout_approved") is True,
        "recurring_checkout_approved": False,
        "production_checkout_enabled": False,
        "real_money_mutation_approved": False,
    }


def write_hashes(root: Path | None = None) -> dict[str, Any]:
    root = repo_root(root)
    write_derived_artifacts(root)
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
    parser.add_argument(
        "--check-mapping",
        type=Path,
        default=None,
        help="fail-closed check of founder mapping copy-back JSON (no Asaas call, no write)",
    )
    parser.add_argument("--root", type=Path, default=None)
    args = parser.parse_args(list(argv) if argv is not None else None)
    try:
        if args.check_mapping is not None:
            mapped = check_mapping_file(args.check_mapping, args.root)
            print("MAPPING_COPYBACK_OK")
            print("PRODUCTION_CHECKOUT_ENABLED false")
            print("REAL_MONEY_MUTATION_APPROVED false")
            print("MAPPED_OFFERS " + ",".join(mapped["mapped_offer_ids"]))
            return 0
        result = write_hashes(args.root) if args.write_hashes else validate_package(args.root)
    except ValidationError as exc:
        print(f"VALIDATION_ERROR {exc}", file=sys.stderr)
        return 1
    print(f"AUTHORITY_HASH {result['authority_hash']}")
    print(f"AUTHORITY_OVERLAY_V2_HASH {result['authority_overlay_v2_hash']}")
    print(f"AUTHORITY_OVERLAY_V3_HASH {result['authority_overlay_v3_hash']}")
    print(f"COMPATIBILITY_HASH {result['compatibility_hash']}")
    print(f"LEGAL_PACKAGE_HASH {result['legal_package_hash']}")
    print(f"FOUNDER_DECIDED_HASH {result['founder_decided_hash']}")
    print(f"CATALOG_AUTHORITY_V1_HISTORICAL {result['catalog_authority_v1_historical']}")
    print(f"PUBLIC_CATALOG_AUTHORITY {result['public_catalog_authority']}")
    print("OFFERS " + ",".join(result["offers"]))
    print("PENDING_GATES " + ",".join(result["pending_gates"]))
    print("PRODUCTION_CHECKOUT_ENABLED false")
    print("REAL_MONEY_MUTATION_APPROVED false")
    print("PUBLIC_ACTIVATION_APPROVED false")
    print("RECURRING_PRODUCTION_CHECKOUT_ENABLED false")
    print(f"VERDICT {result['verdict']}")
    print(f"V1_HISTORICAL_VERDICT {result['legacy_verdict']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
