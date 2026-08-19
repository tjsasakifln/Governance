"""Adversarial tests for the shipped founder-approved legal package.

Every assertion drives functions or artifacts from
``scripts/validate_legal_founder_approved.py``. No expected hash strings
are hard-coded; hashes are computed by the shipped hasher twice.
"""

from __future__ import annotations

import importlib.util
import json
from datetime import date, timedelta
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
LEGAL_VALIDATOR_PATH = ROOT / "scripts" / "validate_legal_founder_approved.py"
PROVISIONAL_VALIDATOR_PATH = ROOT / "scripts" / "validate_legal_provisional.py"
PKG = ROOT / "commercial" / "legal" / "founder-approved-v1"
PROVISIONAL = ROOT / "commercial" / "legal" / "provisional-v1"


def load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


v = load_module(LEGAL_VALIDATOR_PATH, "validate_legal_founder_approved")
prov = load_module(PROVISIONAL_VALIDATOR_PATH, "validate_legal_provisional")


def test_shipped_entry_points_and_required_artifacts():
    assert LEGAL_VALIDATOR_PATH.is_file()
    assert PKG.is_dir()
    for name in v.REQUIRED_FILES:
        assert (PKG / name).is_file(), name
    assert not (PKG / "DPA_LITE_B2B.md").is_file()
    assert PROVISIONAL.is_dir()


def test_provisional_tree_still_validates_unchanged():
    first = prov.validate_legal_package(ROOT)
    second = prov.validate_legal_package(ROOT)
    assert first["authority_hash"] == second["authority_hash"]
    assert first["authority_hash"].startswith("sha256:")


def test_required_metadata_and_decision_token():
    result = v.validate_legal_package(ROOT)
    assert result["offer_code"] == "CFG-DIAG-EXP-v1"
    assert result["offer_amount_cents"] == 800000
    assert result["decision_token"] == v.DECISION_TOKEN
    assert result["public_activation_approved"] is True
    assert result["production_checkout_approved"] is True
    assert result["recurring_checkout_approved"] is False
    assert result["p0_unmitigated"] == 0
    for rel, text in v.iter_package_texts(PKG):
        if rel.endswith(".md"):
            v.assert_required_metadata(text, source=rel)
        v.assert_no_forbidden_claims(text, source=rel)
        v.assert_no_extra_leak(text, source=rel)
        v.assert_no_placeholder(text, source=rel)
        assert "HUMAN_DECISION_REQUIRED" not in text


def test_identity_forum_price_scope():
    terms = v.load_text(PKG / "TERMOS_B2B_DIAGNOSTICO.md")
    assert v.LEGAL_NAME in terms
    assert v.CNPJ in terms
    assert v.FORUM in terms
    assert "800000" in terms
    assert "CFG-DIAG-EXP-v1" in terms
    assert "Foro da Comarca de Florianópolis, Estado de Santa Catarina" in terms


def test_refund_math_uses_shipped_function():
    assert v.refund_due(800000, v.milestone_percent("M0")) == 800000
    assert v.refund_due(800000, v.milestone_percent("M1")) == 680000
    assert v.refund_due(800000, v.milestone_percent("M2")) == 480000
    assert v.refund_due(800000, v.milestone_percent("M3")) == 200000
    assert v.refund_due(800000, v.milestone_percent("M4")) == 80000
    assert v.refund_due(800000, v.milestone_percent("M5")) == 0
    assert v.refund_due(800000, 15, 10000) == 670000
    assert v.refund_due(100, 100, 40) == 0
    policy = v.load_text(PKG / "POLITICA_CANCELAMENTO_REEMBOLSO.md")
    v.assert_refund_policy(policy)


def test_retention_routine_and_legal_hold():
    schedule = v.load_json(PKG / "RETENTION_SCHEDULE.json")
    v.assert_retention(schedule)
    start = date(2026, 1, 1)
    assert v.due_for_deletion("lead_not_converted", as_of=start + timedelta(days=730), last_event=start, schedule=schedule)
    assert not v.due_for_deletion(
        "lead_not_converted",
        as_of=start + timedelta(days=730),
        last_event=start,
        legal_hold=True,
        schedule=schedule,
    )


def test_acceptance_before_checkout():
    spec = v.load_json(PKG / "ELECTRONIC_ACCEPTANCE_SPEC.json")
    v.assert_acceptance(spec)
    terms = v.load_text(PKG / "TERMOS_B2B_DIAGNOSTICO.md")
    assert "somente depois criar o checkout" in terms
    assert "nunca substituem o aceite" in terms


def test_source_manifest_uses_primary_urls():
    sources = v.load_json(PKG / "SOURCE_MANIFEST.json")
    v.assert_sources(sources)
    for url in v.PRIMARY_SOURCE_URLS:
        assert any((item.get("url") or "").startswith(url) for item in sources["primary_sources"]), url


def test_sha256_and_package_hash_identical_on_two_shipped_runs():
    first = v.build_sha256sums_text(PKG)
    second = v.build_sha256sums_text(PKG)
    assert first == second
    hashed_1 = {name: v.hash_legal_file(PKG / name) for name in v.HASHED_FILES}
    hashed_2 = {name: v.hash_legal_file(PKG / name) for name in v.HASHED_FILES}
    assert hashed_1 == hashed_2
    for digest in hashed_1.values():
        assert digest.startswith("sha256:")
        assert len(digest) == 71
    r1 = v.validate_legal_package(ROOT)
    r2 = v.validate_legal_package(ROOT)
    assert r1["authority_hash"] == r2["authority_hash"]
    assert r1["authority_hash"].startswith("sha256:")
    manifest = v.load_json(PKG / "manifest.json")
    assert v.legal_package_hash(manifest) == r1["authority_hash"]


def test_cli_twice(capsys):
    rc1 = v.main([])
    out1 = capsys.readouterr().out
    rc2 = v.main([])
    out2 = capsys.readouterr().out
    assert rc1 == 0 and rc2 == 0
    line1 = [line for line in out1.splitlines() if line.startswith("AUTHORITY_HASH ")][0]
    line2 = [line for line in out2.splitlines() if line.startswith("AUTHORITY_HASH ")][0]
    assert line1 == line2
    assert line1.split()[1].startswith("sha256:")
    assert "NOT_LEGAL_APPROVED" in out1
    assert "RECURRING_CHECKOUT_APPROVED false" in out1
    assert "P0_UNMITIGATED 0" in out1


def test_p0_is_zero_and_recurring_false():
    register = v.load_json(PKG / "LEGAL_RISK_REGISTER.json")
    findings = v.load_json(PKG / "ADVERSARIAL_FINDINGS.json")
    v.assert_p0(register, findings)
    manifest = v.load_json(PKG / "manifest.json")
    assert manifest["recurring_checkout_approved"] is False
    assert manifest["automated_refund_approved"] is False
    assert manifest["automated_nfse_approved"] is False


def test_adversarial_legal_approved_token(tmp_path):
    text = v.load_text(PKG / "TERMOS_B2B_DIAGNOSTICO.md") + "\nstatus: LEGAL_APPROVED\n"
    with pytest.raises(v.ValidationError, match="forbidden claim"):
        v.reject_adversarial_text(text, kind="validated_claim")
    dest = v.mutate_package(PKG, tmp_path / "adv-legal")
    (dest / "TERMOS_B2B_DIAGNOSTICO.md").write_text(text, encoding="utf-8")
    with pytest.raises(v.ValidationError, match="forbidden claim"):
        v.validate_legal_dir(dest, root=ROOT)


def test_adversarial_extra_leak(tmp_path):
    text = v.load_text(PKG / "TERMOS_B2B_DIAGNOSTICO.md") + "\nHISTORICAL_LIGHTHOUSE R$ 10 mil\n"
    with pytest.raises(v.ValidationError, match="leak"):
        v.reject_adversarial_text(text, kind="extra")
    dest = v.mutate_package(PKG, tmp_path / "adv-extra")
    (dest / "PUBLICATION_SUMMARY.md").write_text(text, encoding="utf-8")
    with pytest.raises(v.ValidationError, match="leak"):
        v.validate_legal_dir(dest, root=ROOT)


def test_adversarial_human_decision_returns(tmp_path):
    text = v.load_text(PKG / "TERMOS_B2B_DIAGNOSTICO.md") + "\n[[HUMAN_DECISION_REQUIRED: foro]]\n"
    with pytest.raises(v.ValidationError, match="HUMAN_DECISION_REQUIRED"):
        v.reject_adversarial_text(text, kind="human_decision")
    dest = v.mutate_package(PKG, tmp_path / "adv-human")
    (dest / "TERMOS_B2B_DIAGNOSTICO.md").write_text(text, encoding="utf-8")
    with pytest.raises(v.ValidationError):
        v.validate_legal_dir(dest, root=ROOT)


def test_adversarial_recurring_flag():
    with pytest.raises(v.ValidationError, match="recurring"):
        v.reject_adversarial_text('"recurring_checkout_approved": true', kind="recurring")


def test_global_catalog_gates_stay_fail_closed_for_recurring():
    gates = v.load_json(ROOT / "commercial" / "gates" / "production-gates.v1.json")
    assert gates["production_checkout_enabled"] is False
    legal = next(item for item in gates["gates"] if item["gate_id"] == "legal_terms_forum")
    assert legal["state"] != "APPROVED"
    catalog = v.load_json(ROOT / "commercial" / "offers" / "catalog.v1.json")
    offer = next(item for item in catalog["offers"] if item["offer_code"] == "CFG-DIAG-EXP-v1")
    assert offer["amount_cents"] == 800000
    extra = v.load_json(ROOT / "commercial" / "exceptions" / "extra-historical.v1.json")
    public = json.dumps(v.load_json(ROOT / "commercial" / "offers" / "catalog.public.v1.json"))
    assert "HISTORICAL_LIGHTHOUSE" not in public
    assert extra["exceptions"][0]["is_public_offer"] is False
