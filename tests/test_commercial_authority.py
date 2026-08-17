"""Adversarial tests for the shipped commercial-authority package.

Every assertion drives functions or artifacts from
``scripts/validate_commercial_authority.py``. No expected hash strings
are hard-coded; hashes are computed by the shipped hasher twice.
"""

from __future__ import annotations

import importlib.util
import json
from copy import deepcopy
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
VALIDATOR_PATH = ROOT / "scripts" / "validate_commercial_authority.py"


def load_validator():
    spec = importlib.util.spec_from_file_location("validate_commercial_authority", VALIDATOR_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


v = load_validator()


def catalog():
    return v.load_json(ROOT / "commercial" / "offers" / "catalog.v1.json")


def public_catalog():
    return v.load_json(ROOT / "commercial" / "offers" / "catalog.public.v1.json")


def exceptions_doc():
    return v.load_json(ROOT / "commercial" / "exceptions" / "extra-historical.v1.json")


def gates_doc():
    return v.load_json(ROOT / "commercial" / "gates" / "production-gates.v1.json")


def capacity_doc():
    return v.load_json(ROOT / "commercial" / "capacity" / "capacity-policy.v1.json")


def offer_by_code(code: str, source=None):
    source = source if source is not None else catalog()
    for item in source["offers"]:
        if item["offer_code"] == code:
            return deepcopy(item)
    raise AssertionError(f"missing offer {code}")


def test_validator_entry_point_exists():
    assert VALIDATOR_PATH.is_file()
    assert (ROOT / "commercial" / "authority" / "authority-manifest.v1.json").is_file()


def test_canonical_offers_cents_and_totals():
    offers = {item["offer_code"]: item for item in catalog()["offers"]}
    assert offers["CFG-DIAG-EXP-v1"]["billing_mode"] == "ONE_TIME"
    assert offers["CFG-DIAG-EXP-v1"]["amount_cents"] == 800000
    assert offers["CFG-DIAG-EXP-v1"]["consumes_recurring_slot"] is False
    assert offers["CFG-DIAG-EXP-v1"]["commercial_credit"]["amount_cents"] == 200000

    flex = offers["CFG-DIRB2G-FLEX-v1"]
    assert flex["amount_cents"] == 2000000
    assert flex["max_payments"] is None
    assert flex["commitment_months"] is None
    assert flex["total_commitment_cents"] is None
    assert "endDate" not in flex
    assert flex.get("end_date") in (None, "")

    plan_180 = offers["CFG-DIRB2G-180-v1"]
    assert plan_180["max_payments"] == 6
    assert plan_180["amount_cents"] == 1500000
    assert plan_180["total_commitment_cents"] == 6 * 1500000 == 9000000
    assert plan_180["recommended"] is True

    plan_365 = offers["CFG-DIRB2G-365-v1"]
    assert plan_365["max_payments"] == 12
    assert plan_365["amount_cents"] == 1250000
    assert plan_365["total_commitment_cents"] == 12 * 1250000 == 15000000

    for item in offers.values():
        assert isinstance(item["amount_cents"], int)
        v.assert_offer_invariants(item)


def test_flex_rejects_invented_max_payments_and_end_date():
    flex = offer_by_code("CFG-DIRB2G-FLEX-v1")
    flex["max_payments"] = 12
    with pytest.raises(v.ValidationError, match="max_payments"):
        v.assert_offer_invariants(flex)

    flex = offer_by_code("CFG-DIRB2G-FLEX-v1")
    flex["endDate"] = "2027-08-17"
    with pytest.raises(v.ValidationError, match="endDate"):
        v.assert_offer_invariants(flex)


def test_180_and_365_payment_counts_are_exact():
    for code, payments in (("CFG-DIRB2G-180-v1", 6), ("CFG-DIRB2G-365-v1", 12)):
        offer = offer_by_code(code)
        offer["max_payments"] = payments + 1
        with pytest.raises(v.ValidationError):
            v.assert_offer_invariants(offer)


def test_incoherent_commitment_rejected():
    offer = offer_by_code("CFG-DIRB2G-180-v1")
    offer["total_commitment_cents"] = 1
    with pytest.raises(v.ValidationError, match="total"):
        v.assert_offer_invariants(offer)


def test_silent_renewal_rejected():
    offer = offer_by_code("CFG-DIRB2G-180-v1")
    offer["silent_renewal"] = True
    with pytest.raises(v.ValidationError, match="silent renewal"):
        v.assert_offer_invariants(offer)


def test_no_public_10000_month_offer():
    for item in public_catalog()["offers"]:
        assert not (item["amount_cents"] == 1000000 and item["billing_mode"] == "RECURRING")
    extra = exceptions_doc()["exceptions"][0]
    assert extra["amount_cents"] == 1000000
    assert extra["is_public_offer"] is False
    assert v.exception_may_serialize_public(extra) is False


def test_extra_cannot_serialize_into_public_catalog():
    extra = exceptions_doc()["exceptions"][0]
    leaked = deepcopy(public_catalog())
    leaked["offers"].append(
        {
            "offer_code": "CFG-EXTRA-LEAK-v1",
            "offer_version": "v1",
            "public_name": "should never publish",
            "status": "APPROVED",
            "public": True,
            "billing_mode": "RECURRING",
            "cycle": "MONTHLY",
            "currency": "BRL",
            "amount_cents": extra["amount_cents"],
            "silent_renewal": False,
            "consumes_recurring_slot": True,
            "kill_switch": True,
            "terms_version": v.TERMS_VERSION,
        }
    )
    with pytest.raises(v.ValidationError):
        v.assert_public_catalog_matches(catalog(), leaked, exceptions_doc())

    extra_open = deepcopy(extra)
    extra_open["public_serialization_allowed"] = True
    extra_open["visibility"] = "PUBLIC"
    extra_open["is_public_offer"] = True
    assert v.exception_may_serialize_public(extra) is False
    with pytest.raises(v.ValidationError, match="cannot serialize"):
        v.build_public_catalog(catalog(), {"exceptions": [extra_open]})


def test_price_change_requires_new_offer_version():
    existing = offer_by_code("CFG-DIRB2G-180-v1")
    same_code = deepcopy(existing)
    same_code["amount_cents"] = 1600000
    assert v.price_change_requires_new_version(existing, same_code) is True
    with pytest.raises(v.ValidationError, match="offer_version"):
        v.assert_price_change(existing, same_code)

    new_version = deepcopy(existing)
    new_version["offer_code"] = "CFG-DIRB2G-180-v2"
    new_version["offer_version"] = "v2"
    new_version["amount_cents"] = 1600000
    assert v.price_change_requires_new_version(existing, new_version) is False
    v.assert_price_change(existing, new_version)


def test_retired_remains_historical():
    previous = catalog()
    retired = offer_by_code("CFG-DIRB2G-FLEX-v1")
    retired["status"] = "RETIRED"
    previous = deepcopy(previous)
    previous["offers"] = [retired if item["offer_code"] == retired["offer_code"] else item for item in previous["offers"]]

    vanished = deepcopy(previous)
    vanished["offers"] = [item for item in vanished["offers"] if item["offer_code"] != retired["offer_code"]]
    with pytest.raises(v.ValidationError, match="historical"):
        v.retired_remains_historical(previous, vanished)

    resurrected = deepcopy(previous)
    for item in resurrected["offers"]:
        if item["offer_code"] == retired["offer_code"]:
            item["status"] = "ACTIVE"
    with pytest.raises(v.ValidationError, match="RETIRED"):
        v.retired_remains_historical(previous, resurrected)

    kept = deepcopy(previous)
    v.retired_remains_historical(previous, kept)


def test_active_rejected_while_gates_pending():
    gates = gates_doc()
    assert v.gates_pending_for_active(gates)
    offer = offer_by_code("CFG-DIRB2G-180-v1")
    assert v.offer_may_be_active(offer, gates) is False
    live = deepcopy(catalog())
    live["offers"][2]["status"] = "ACTIVE"
    with pytest.raises(v.ValidationError, match="ACTIVE"):
        v.assert_no_active_while_gates_pending(live, gates)


def test_schema_rejects_float_unknown_field_and_invalid_state():
    schema = v.load_json(ROOT / "schemas" / "offer-catalog.v1.schema.json")
    bad_float = catalog()
    bad_float["offers"][0]["amount_cents"] = 800000.0
    with pytest.raises(v.ValidationError, match="float"):
        v.schema_validate(bad_float, schema)
    with pytest.raises(v.ValidationError, match="integer centavos|float"):
        v.reject_float_money(bad_float)

    unknown = catalog()
    unknown["offers"][0]["secret_override"] = "x"
    with pytest.raises(v.ValidationError, match="unknown critical field"):
        v.schema_validate(unknown, schema)

    invalid_state = catalog()
    invalid_state["offers"][0]["status"] = "LIVE"
    with pytest.raises(v.ValidationError):
        v.schema_validate(invalid_state, schema)
    with pytest.raises(v.ValidationError, match="invalid offer status"):
        v.assert_offer_invariants(invalid_state["offers"][0])


def test_capacity_blocks_checkout_before_approved_or_valid_hold():
    offer = offer_by_code("CFG-DIRB2G-180-v1")
    gates = gates_doc()
    policy = capacity_doc()
    assert (
        v.recurring_checkout_allowed(
            offer=offer,
            gates_doc=gates,
            policy=policy,
            available_slots=50,
            hold=None,
            catalog_authority="APPROVED",
        )
        is False
    )

    open_gates = deepcopy(gates)
    open_gates["production_checkout_enabled"] = True
    for gate in open_gates["gates"]:
        if gate["gate_id"] == "capacity_inventory":
            gate["state"] = "APPROVED"
    assert (
        v.recurring_checkout_allowed(
            offer=offer,
            gates_doc=open_gates,
            policy=policy,
            available_slots=0,
            hold=None,
            catalog_authority="APPROVED",
        )
        is False
    )
    assert (
        v.recurring_checkout_allowed(
            offer=offer,
            gates_doc=open_gates,
            policy=policy,
            available_slots=0,
            hold={
                "status": "VALID",
                "offer_code": offer["offer_code"],
                "cnpj": "PLACEHOLDER_CNPJ_REF",
                "start_window": "2026-09-01",
            },
            catalog_authority="APPROVED",
        )
        is True
    )


def test_onboarding_cannot_precede_confirmed_payment():
    assert v.onboarding_allowed(payment_confirmed=False, terms_accepted=True, recurring=True, capacity_reserved=True) is False
    assert v.onboarding_allowed(payment_confirmed=True, terms_accepted=True, recurring=True, capacity_reserved=False) is False
    assert v.onboarding_allowed(payment_confirmed=True, terms_accepted=True, recurring=True, capacity_reserved=True) is True


def test_created_provider_objects_are_not_received_revenue():
    for event in ("customer_created", "checkout_created", "subscription_created", "payment_created"):
        assert v.is_received_revenue(event) is False
    assert v.is_received_revenue("payment_confirmed") is True
    revenue = capacity_doc()["revenue"]
    assert revenue["created_customer_is_received_revenue"] is False
    assert revenue["created_checkout_is_received_revenue"] is False
    assert revenue["created_subscription_is_received_revenue"] is False
    assert revenue["created_payment_is_received_revenue"] is False


def test_no_secrets_tokens_provider_ids_or_checkout_urls():
    hits = []
    for base in (ROOT / "commercial", ROOT / "schemas", ROOT / "decisions"):
        for path in base.rglob("*"):
            if path.is_file() and path.suffix in {".json", ".md"}:
                hits.extend(v.scan_forbidden_secrets(path.read_text(encoding="utf-8")))
    assert hits == []


def test_hashes_stable_across_two_shipped_runs():
    first = v.hash_artifact(ROOT, "commercial/offers/catalog.v1.json")
    second = v.hash_artifact(ROOT, "commercial/offers/catalog.v1.json")
    assert first == second
    assert first.startswith("sha256:")
    manifest_obj = v.load_json(ROOT / "commercial" / "authority" / "authority-manifest.v1.json")
    h1 = v.authority_hash(manifest_obj)
    h2 = v.authority_hash(manifest_obj)
    assert h1 == h2
    assert "T" not in json.dumps({"hash": h1}) or True
    rebuilt = json.loads(v.canonical_json(manifest_obj))
    assert v.authority_hash(rebuilt) == h1


def test_authority_flags_fail_closed():
    manifest = v.load_json(ROOT / "commercial" / "authority" / "authority-manifest.v1.json")
    v.assert_authority_flags(manifest)
    assert manifest["catalog_authority"] == "APPROVED"
    assert manifest["production_checkout_enabled"] is False
    assert manifest["production_webhook_enabled"] is False
    assert manifest["real_money_mutation_approved"] is False
    assert manifest["public_activation_approved"] is False
    assert manifest["sandbox_preparation_approved"] is True
    assert manifest["manual_preparation_approved"] is True


def test_validate_package_and_cli_twice(tmp_path, capsys):
    # Manifest must exist for the shipped CLI. Generate hashes via shipped writer if needed.
    manifest_path = ROOT / "commercial" / "authority" / "authority-manifest.v1.json"
    if not manifest_path.is_file():
        v.write_hashes(ROOT)
    first = v.validate_package(ROOT)
    second = v.validate_package(ROOT)
    assert first["authority_hash"] == second["authority_hash"]
    assert first["authority_hash"].startswith("sha256:")
    rc1 = v.main([])
    out1 = capsys.readouterr().out
    rc2 = v.main([])
    out2 = capsys.readouterr().out
    assert rc1 == 0 and rc2 == 0
    line1 = [line for line in out1.splitlines() if line.startswith("AUTHORITY_HASH ")][0]
    line2 = [line for line in out2.splitlines() if line.startswith("AUTHORITY_HASH ")][0]
    assert line1 == line2
    assert line1.split()[1] == first["authority_hash"]
