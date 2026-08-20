"""Convergence tests for mapping, handoff, consumer contract and overlay.

Every assertion drives shipped functions in
``scripts/validate_commercial_authority.py``.
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


def test_human_catalog_and_handoff_match_shipped_renderer():
    catalog = v.load_json(ROOT / "commercial" / "offers" / "catalog.v1.json")
    mapping = v.load_json(ROOT / "commercial" / "providers" / "asaas-mapping.v1.json")
    human = (ROOT / "commercial" / "offers" / "catalog.human.v1.md").read_text(encoding="utf-8")
    handoff = (ROOT / "commercial" / "FOUNDER-ASAAS-REGISTRATION.md").read_text(encoding="utf-8")
    assert human == v.render_human_catalog(catalog)
    assert handoff == v.render_founder_handoff(catalog, mapping)
    for offer_id in v.CANONICAL_OFFER_CODES:
        assert offer_id in human
        assert offer_id in handoff
    for offer in catalog["offers"]:
        assert offer["public_name"] in handoff
        assert offer["description_asaas"] in handoff
        assert v.format_brl_cents(offer["amount_cents"]) in handoff
        assert f"cfg:{offer['offer_id']}:{{correlation_id}}" in handoff
        for field in v.NAMED_OFFER_FIELDS:
            assert f"`{field}`:" in human
    assert "Do NOT activate yet" in handoff
    assert "recurring production checkout" in handoff
    assert "você pode cadastrar agora" in handoff
    assert "não ativar/publicar ainda" in handoff
    assert "aguarda campo/decisão" in handoff
    assert "python scripts/validate_commercial_authority.py --check-mapping" in handoff
    assert "PENDING_FOUNDER_INPUT" in handoff
    assert "maxPayments" in handoff
    assert "web-cfg#88" in human
    assert "Warmbly#47" in human
    for offer in catalog["offers"]:
        assert v._total_label(offer) in handoff
        assert v._cadastrar_instruction(offer) in handoff
        assert v._copyback_ids(offer) in handoff


def test_consumer_contract_names_consumers_and_public_internal_split():
    contract = (ROOT / "commercial" / "CONSUMER-CONTRACT.md").read_text(encoding="utf-8")
    assert "web-cfg#88" in contract
    assert "Warmbly#47" in contract
    assert "commercial/offers/catalog.v1.json" in contract
    assert "commercial/compatibility/consumer-compatibility.v1.json" in contract
    assert "GOVERNANCE_WINS" in contract
    assert "internal_code" in contract
    assert "description_asaas" in contract
    assert "PAUSED" in contract
    assert "sold_out" in contract
    assert "RETIRED" in contract
    fixture = v.load_json(ROOT / "commercial" / "fixtures" / "consumer-catalog.example.v1.json")
    mapping = v.load_json(ROOT / "commercial" / "providers" / "asaas-mapping.v1.json")
    v.assert_consumer_fixture(fixture, mapping)
    assert fixture["consumers"] == ["web-cfg#88", "Warmbly#47"]
    for offer in fixture["offers"]:
        assert offer.get("asaas_product_id") is None
        assert offer.get("checkout_id") is None


def test_changelog_records_incorporated_vs_pending_and_verdict():
    changelog = (ROOT / "commercial" / "DECISIONS-CHANGELOG.md").read_text(encoding="utf-8")
    assert "PENDING_FOUNDER_INPUT" in changelog
    assert v.VERDICT_READY in changelog
    pending = v.load_json(ROOT / "commercial" / "offers" / "pending-founder-inputs.v1.json")
    catalog = v.load_json(ROOT / "commercial" / "offers" / "catalog.v1.json")
    v.assert_pending_founder_inputs(pending, catalog)
    assert v.catalog_verdict(catalog, pending) == v.VERDICT_READY
    blocked = deepcopy(catalog)
    blocked["offers"][0]["amount_cents"] = "PENDING_FOUNDER_INPUT"
    assert v.catalog_verdict(blocked, pending) == v.VERDICT_BLOCKED


def test_visitor_surface_excludes_internal_fields():
    diag = v.load_json(ROOT / "commercial" / "offers" / "catalog.v1.json")["offers"][0]
    surface = v.visitor_surface_fields(diag)
    assert "public_name" in surface
    assert "amount_cents" in surface
    assert "description_asaas" not in surface
    assert "internal_code" not in surface
    assert "change_reason" not in surface
    assert set(surface).issubset(v.PUBLIC_SURFACE_FIELDS)


def test_price_change_without_new_version_still_rejected():
    catalog = v.load_json(ROOT / "commercial" / "offers" / "catalog.v1.json")
    existing = deepcopy(catalog["offers"][2])
    same = deepcopy(existing)
    same["amount_cents"] = existing["amount_cents"] + 100
    with pytest.raises(v.ValidationError, match="offer_version"):
        v.assert_price_change(existing, same)
    bumped = deepcopy(same)
    bumped["offer_version"] = "v2"
    bumped["offer_id"] = "CFG-DIRB2G-180-v2"
    bumped["offer_code"] = "CFG-DIRB2G-180-v2"
    v.assert_price_change(existing, bumped)
