"""Campaign tests for compatibility contract and fail-closed Asaas mapping copy-back.

Every assertion drives functions or artifacts from
``scripts/validate_commercial_authority.py``. No expected hash strings
are hard-coded; hashes are computed by the shipped hasher.
"""

from __future__ import annotations

import importlib.util
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


def mapping_doc():
    return v.load_json(ROOT / "commercial" / "providers" / "asaas-mapping.v1.json")


def gates_doc():
    return v.load_json(ROOT / "commercial" / "gates" / "production-gates.v1.json")


def contract():
    return v.load_json(ROOT / v.COMPATIBILITY_CONTRACT_PATH)


def copyback_schema():
    return v.load_json(ROOT / "schemas" / "mapping-copyback.v1.schema.json")


def offer_by_id(code: str, source=None):
    source = source if source is not None else catalog()
    for item in source["offers"]:
        if item["offer_id"] == code:
            return deepcopy(item)
    raise AssertionError(f"missing offer {code}")


def valid_copyback(*, offer_id: str = "CFG-DIAG-EXP-v1", environment: str = "PRODUCTION"):
    offer = offer_by_id(offer_id)
    record = {
        "offer_id": offer_id,
        "asaas_product_id": f"placeholder-product-{offer_id.lower()}",
        "checkout_id": None,
        "subscription_mapping": None,
        "environment": environment,
        "created_at": "2026-08-20T12:00:00Z",
        "copied_at": "2026-08-20T12:01:00Z",
    }
    if offer["billing_mode"] == "ONE_TIME":
        record["checkout_id"] = f"placeholder-checkout-{offer_id.lower()}"
    else:
        record["subscription_mapping"] = f"placeholder-subscription-{offer_id.lower()}"
    return {"schema_version": "mapping-copyback.v1", "records": [record]}


def test_canonical_one_off_nulls_and_billing_and_scope_are_accepted():
    compat = contract()
    v.assert_compatibility_contract(compat, catalog())
    for item in catalog()["offers"]:
        oid = item["offer_id"]
        assert (
            v.classify_consumer_value(
                "billing_mode",
                item["billing_mode"],
                offer_id=oid,
                canonical=item["billing_mode"],
                contract=compat,
            )
            == "canonical"
        )
        assert (
            v.classify_consumer_value(
                "scope_version",
                item["scope_version"],
                offer_id=oid,
                canonical=item["scope_version"],
                contract=compat,
            )
            == "canonical"
        )
        v.assert_no_silent_coercion(item, compat)
        if item["billing_mode"] == "ONE_TIME":
            for field in compat["canonical_representation"]["one_off_null_fields"]:
                assert item[field] is None
                assert (
                    v.classify_consumer_value(
                        field,
                        None,
                        offer_id=oid,
                        canonical=item[field],
                        contract=compat,
                    )
                    == "canonical"
                )


def test_listed_consumer_aliases_are_aliases_only():
    compat = contract()
    diag = offer_by_id("CFG-DIAG-EXP-v1")
    drifts = {item["drift_id"]: item for item in compat["accepted_consumer_aliases"]}
    one_off = drifts["one_off_null_vs_0_1"]
    alias_row = one_off["aliases"][0]
    for field, alias_value in alias_row.items():
        if field == "source":
            continue
        kind = v.classify_consumer_value(
            field,
            alias_value,
            offer_id="CFG-DIAG-EXP-v1",
            canonical=diag[field],
            contract=compat,
        )
        assert kind == "alias"
        assert alias_value != diag[field]
    billing = drifts["billing_enum_casing"]
    for key, canonical in billing["aliases"][0].items():
        if key == "source":
            continue
        kind = v.classify_consumer_value(
            "billing_mode",
            key,
            offer_id="CFG-DIAG-EXP-v1",
            canonical=canonical,
            contract=compat,
        )
        assert kind == "alias"
        assert key != canonical
    scope = drifts["scope_version_local_freeze"]
    alias_scope = scope["aliases"][0]["value"]
    for oid, canonical_scope in compat["canonical_representation"]["scope_version_by_offer"].items():
        kind = v.classify_consumer_value(
            "scope_version",
            alias_scope,
            offer_id=oid,
            canonical=canonical_scope,
            contract=compat,
        )
        assert kind == "alias"
        assert alias_scope != canonical_scope


def test_silent_coercion_of_aliases_as_governance_truth_is_rejected():
    compat = contract()
    diag = offer_by_id("CFG-DIAG-EXP-v1")
    alias_row = next(
        item["aliases"][0]
        for item in compat["accepted_consumer_aliases"]
        if item["drift_id"] == "one_off_null_vs_0_1"
    )
    coerced = deepcopy(diag)
    coerced["max_payments"] = alias_row["max_payments"]
    with pytest.raises(v.ValidationError, match="silent coercion"):
        v.assert_no_silent_coercion(coerced, compat)
    coerced = deepcopy(diag)
    coerced["commitment_months"] = alias_row["commitment_months"]
    with pytest.raises(v.ValidationError, match="silent coercion"):
        v.assert_no_silent_coercion(coerced, compat)
    billing_alias = next(
        item["aliases"][0]
        for item in compat["accepted_consumer_aliases"]
        if item["drift_id"] == "billing_enum_casing"
    )
    coerced = deepcopy(diag)
    coerced["billing_mode"] = next(key for key in billing_alias if key != "source")
    with pytest.raises(v.ValidationError, match="silent coercion"):
        v.assert_no_silent_coercion(coerced, compat)
    coerced = deepcopy(diag)
    coerced["scope_version"] = next(
        item["aliases"][0]["value"]
        for item in compat["accepted_consumer_aliases"]
        if item["drift_id"] == "scope_version_local_freeze"
    )
    with pytest.raises(v.ValidationError, match="silent coercion"):
        v.assert_no_silent_coercion(coerced, compat)


def test_compatibility_fixture_is_read_only_and_pins_hash():
    compat = contract()
    fixture = v.load_json(ROOT / v.COMPATIBILITY_FIXTURE_PATH)
    v.assert_compatibility_fixture(fixture, compat, catalog(), mapping_doc())
    assert fixture["consumers"] == ["web-cfg#88", "Warmbly#47"]
    assert fixture["pin_command"] == "python scripts/validate_commercial_authority.py"
    assert fixture["compatibility_hash"] == v.compatibility_hash(compat)
    assert fixture["compatibility_hash"].startswith("sha256:")
    assert fixture["read_only"] is True
    for offer in fixture["offers"]:
        assert offer["asaas_product_id"] is None
        assert offer["checkout_id"] is None
        assert offer["subscription_mapping"] is None


def test_mapping_copyback_rejects_fail_closed_cases():
    schema = copyback_schema()
    cat = catalog()
    mapping = mapping_doc()
    gates = gates_doc()

    unknown = valid_copyback()
    unknown["records"][0]["offer_id"] = "CFG-DOES-NOT-EXIST-v1"
    with pytest.raises(v.ValidationError, match="unknown offer"):
        v.assert_mapping_copyback_payload(unknown, cat, mapping, gates, schema)

    draft_cat = deepcopy(cat)
    draft_cat["offers"][0]["status"] = "DRAFT"
    with pytest.raises(v.ValidationError, match="status does not allow mapping"):
        v.assert_mapping_copyback_payload(valid_copyback(), draft_cat, mapping, gates, schema)

    mixed = valid_copyback()
    flex = valid_copyback(offer_id="CFG-DIRB2G-FLEX-v1", environment="SANDBOX")
    mixed["records"].append(flex["records"][0])
    with pytest.raises(v.ValidationError, match="sandbox/production mix"):
        v.assert_mapping_copyback_payload(mixed, cat, mapping, gates, schema)

    dup = valid_copyback()
    other = valid_copyback(offer_id="CFG-DIRB2G-FLEX-v1")
    shared = dup["records"][0]["asaas_product_id"]
    other["records"][0]["asaas_product_id"] = shared
    dup["records"].append(other["records"][0])
    with pytest.raises(v.ValidationError, match="duplicate provider ID"):
        v.assert_mapping_copyback_payload(dup, cat, mapping, gates, schema)

    one_off_as_sub = valid_copyback()
    one_off_as_sub["records"][0]["subscription_mapping"] = "placeholder-subscription-mismatch"
    with pytest.raises(v.ValidationError, match="one-off vs recurring identifier mismatch"):
        v.assert_mapping_copyback_payload(one_off_as_sub, cat, mapping, gates, schema)

    recurring_as_one_off = valid_copyback(offer_id="CFG-DIRB2G-FLEX-v1")
    recurring_as_one_off["records"][0]["subscription_mapping"] = None
    recurring_as_one_off["records"][0]["checkout_id"] = "placeholder-checkout-mismatch"
    with pytest.raises(v.ValidationError, match="one-off vs recurring identifier mismatch"):
        v.assert_mapping_copyback_payload(recurring_as_one_off, cat, mapping, gates, schema)

    secret_payload = valid_copyback()
    secret_payload["records"][0]["asaas_product_id"] = "$aact_" + "PLACEHOLDERTOKEN"
    with pytest.raises(v.ValidationError, match="secret"):
        v.assert_mapping_copyback_payload(secret_payload, cat, mapping, gates, schema)

    url_payload = valid_copyback()
    url_payload["records"][0]["checkout_id"] = "https://" + "example.invalid/pay"
    with pytest.raises(v.ValidationError, match="invented URL"):
        v.assert_mapping_copyback_payload(url_payload, cat, mapping, gates, schema)


def test_valid_in_memory_mapping_does_not_enable_checkout_or_real_money():
    schema = copyback_schema()
    cat = catalog()
    mapping = mapping_doc()
    gates = gates_doc()
    assert gates["production_checkout_enabled"] is False
    assert gates["real_money_mutation_approved"] is False
    result = v.assert_mapping_copyback_payload(valid_copyback(), cat, mapping, gates, schema)
    assert result["production_checkout_enabled"] is False
    assert result["real_money_mutation_approved"] is False
    assert gates["production_checkout_enabled"] is False
    assert gates["real_money_mutation_approved"] is False
    assert mapping_doc()["mappings"][0]["asaas_product_id"] is None
    for row in mapping["mappings"]:
        assert v.mapping_ids_pending(row) is True


def test_copyback_accepts_asaas_resource_id_shapes(tmp_path, capsys):
    """Real Asaas cus_/sub_/pay_ identifiers are mapping IDs, not secrets."""
    schema = copyback_schema()
    cat = catalog()
    mapping = mapping_doc()
    gates = gates_doc()
    token = "VXJBYgP2u0eO"
    cus_id = "cus_" + token
    sub_id = "sub_" + token
    pay_id = "pay_" + token
    assert v.scan_forbidden_secrets(cus_id) == []
    assert v.scan_forbidden_secrets(sub_id) == []
    assert v.scan_forbidden_secrets(pay_id) == []
    payload = valid_copyback(offer_id="CFG-DIRB2G-FLEX-v1")
    payload["records"][0]["asaas_product_id"] = cus_id
    payload["records"][0]["checkout_id"] = pay_id
    payload["records"][0]["subscription_mapping"] = sub_id
    result = v.assert_mapping_copyback_payload(payload, cat, mapping, gates, schema)
    assert result["production_checkout_enabled"] is False
    assert result["real_money_mutation_approved"] is False
    mapped = next(row for row in result["mapping"]["mappings"] if row["offer_id"] == "CFG-DIRB2G-FLEX-v1")
    assert mapped["subscription_mapping"] == sub_id
    assert mapped["asaas_product_id"] == cus_id
    assert mapped["checkout_id"] == pay_id
    for row in mapping_doc()["mappings"]:
        assert v.mapping_ids_pending(row) is True
    path = tmp_path / "asaas-ids.json"
    path.write_text(v.canonical_json(payload), encoding="utf-8")
    rc = v.main(["--check-mapping", str(path)])
    out = capsys.readouterr()
    assert rc == 0
    assert "MAPPING_COPYBACK_OK" in out.out
    assert "PRODUCTION_CHECKOUT_ENABLED false" in out.out
    assert "secret" not in out.err.lower()


def test_check_mapping_cli_entry_point(tmp_path, capsys):
    payload_path = tmp_path / "copyback.json"
    payload_path.write_text(v.canonical_json(valid_copyback()), encoding="utf-8")
    rc = v.main(["--check-mapping", str(payload_path)])
    out = capsys.readouterr()
    assert rc == 0
    assert "MAPPING_COPYBACK_OK" in out.out
    assert "PRODUCTION_CHECKOUT_ENABLED false" in out.out
    assert "REAL_MONEY_MUTATION_APPROVED false" in out.out
    bad = valid_copyback()
    bad["records"][0]["offer_id"] = "CFG-DOES-NOT-EXIST-v1"
    bad_path = tmp_path / "bad.json"
    bad_path.write_text(v.canonical_json(bad), encoding="utf-8")
    rc_bad = v.main(["--check-mapping", str(bad_path)])
    err = capsys.readouterr()
    assert rc_bad == 1
    assert "VALIDATION_ERROR" in err.err
    assert "unknown offer" in err.err


def test_extra_1000000_recurring_absent_from_public_catalog():
    for item in public_catalog()["offers"]:
        assert not (item["amount_cents"] == 1000000 and item["billing_mode"] == "RECURRING")


def test_v1_cents_names_and_terms_pin():
    offers = {item["offer_id"]: item for item in catalog()["offers"]}
    assert offers["CFG-DIAG-EXP-v1"]["amount_cents"] == 800000
    assert offers["CFG-DIAG-EXP-v1"]["billing_mode"] == "ONE_TIME"
    assert offers["CFG-DIAG-EXP-v1"]["public_name"] == "CONFENGE - Diagnóstico B2G de Expansão"
    flex = offers["CFG-DIRB2G-FLEX-v1"]
    assert flex["amount_cents"] == 2000000
    assert flex["max_payments"] is None
    assert flex["public_name"] == "CONFENGE - Diretoria B2G Fracionada - Flex"
    plan_180 = offers["CFG-DIRB2G-180-v1"]
    assert plan_180["total_commitment_cents"] == 6 * 1500000
    assert plan_180["public_name"] == "CONFENGE - Diretoria B2G Fracionada - 180"
    plan_365 = offers["CFG-DIRB2G-365-v1"]
    assert plan_365["total_commitment_cents"] == 12 * 1250000
    assert plan_365["public_name"] == "CONFENGE - Diretoria B2G Fracionada - 365"
    for item in offers.values():
        assert item["terms_version"] == v.TERMS_VERSION
        assert item["scope_version"] == v.CANONICAL_SCOPE_BY_OFFER[item["offer_id"]]


def test_low_friction_remains_pending_founder_input():
    pending = v.load_json(ROOT / "commercial" / "offers" / "pending-founder-inputs.v1.json")
    v.assert_pending_founder_inputs(pending, catalog())
    assert pending["items"][0]["status"] == "PENDING_FOUNDER_INPUT"
    assert pending["items"][0]["must_not_invent"] is True


def test_catalog_authority_manifest_excludes_partner_program():
    manifest = v.load_json(ROOT / "commercial" / "authority" / "authority-manifest.v1.json")
    v.assert_no_partner_in_catalog_manifest(manifest)
    paths = [item["path"] for item in manifest["artifacts"]]
    assert not any("partner" in path.lower() for path in paths)
    assert not any("commission" in path.lower() for path in paths)
    assert not any("referral-cosell" in path.lower() for path in paths)
    assert v.is_received_revenue("partner_commission_accrual_candidate") is False
    assert v.is_received_revenue("partner_event") is False
    assert v.COMPATIBILITY_CONTRACT_PATH in paths
    assert v.COMPATIBILITY_FIXTURE_PATH in paths
