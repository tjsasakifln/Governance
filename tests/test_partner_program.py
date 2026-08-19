"""Adversarial tests for the shipped partner referral/co-sell package.

Every assertion drives functions or artifacts from
``scripts/validate_partner_program.py``. No expected AUTHORITY_HASH strings
are hard-coded; hashes are computed by the shipped hasher twice.
"""

from __future__ import annotations

import importlib.util
import json
from datetime import date, timedelta
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
VALIDATOR_PATH = ROOT / "scripts" / "validate_partner_program.py"
LEGAL_VALIDATOR_PATH = ROOT / "scripts" / "validate_legal_founder_approved.py"
PROVISIONAL_VALIDATOR_PATH = ROOT / "scripts" / "validate_legal_provisional.py"
COMMERCIAL_VALIDATOR_PATH = ROOT / "scripts" / "validate_commercial_authority.py"
PKG = ROOT / "commercial" / "partners" / "referral-cosell-v1"


def load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


v = load_module(VALIDATOR_PATH, "validate_partner_program")
legal = load_module(LEGAL_VALIDATOR_PATH, "validate_legal_founder_approved")
prov = load_module(PROVISIONAL_VALIDATOR_PATH, "validate_legal_provisional")
auth = load_module(COMMERCIAL_VALIDATOR_PATH, "validate_commercial_authority")


def _happy_commission(**overrides):
    payload = dict(
        modality="REFERRAL_QUALIFIED",
        rate_bps=1000,
        eligible_net_fee_receipt_cents=800000,
        receipt_evidence=True,
        lead_status="ACCEPTED",
        preexisting=False,
        protection_expired_without_contract=False,
        contracted_during_protection=True,
        within_period_months=True,
        base_kind="eligible_net_fees",
        professional_flag=None,
        due_diligence_state="APPROVED",
    )
    payload.update(overrides)
    return v.commission_amount_cents(**payload)


def test_shipped_entry_points_and_required_artifacts():
    assert VALIDATOR_PATH.is_file()
    assert PKG.is_dir()
    for name in v.REQUIRED_FILES:
        assert (PKG / name).is_file(), name


def test_versioned_commercial_numbers_match_schedule():
    schedule = v.load_json(PKG / "COMMISSION_SCHEDULE.json")
    v.assert_schedule(schedule)
    assert v.REFERRAL_RATE_BPS == 1000
    assert v.REFERRAL_PERIOD_MONTHS == 6
    assert v.REFERRAL_CAP_CENTS == 1_000_000
    assert v.COSELL_MAX_RATE_BPS == 1500
    assert v.COSELL_PERIOD_MONTHS == 6
    assert v.COSELL_CAP_CENTS == 1_500_000
    assert v.LEAD_PROTECTION_DAYS == 90
    assert v.LEAD_DECISION_BUSINESS_DAYS == 2
    referral = schedule["modalities"]["REFERRAL_QUALIFIED"]
    assert referral["rate_bps"] == v.REFERRAL_RATE_BPS
    assert referral["period_months"] == v.REFERRAL_PERIOD_MONTHS
    assert referral["cap_cents_total_per_referred_client"] == v.REFERRAL_CAP_CENTS
    assert "NOT_MONTHLY" in referral["cap_kind"]
    cosell = schedule["modalities"]["COSELL_SPECIALIZED"]
    assert cosell["max_rate_bps"] == v.COSELL_MAX_RATE_BPS
    assert cosell["cap_cents_total_per_client"] == v.COSELL_CAP_CENTS


def test_commission_requires_real_eligible_receipt():
    assert _happy_commission() == 80000
    assert _happy_commission(receipt_evidence=False) == 0
    assert _happy_commission(eligible_net_fee_receipt_cents=0, receipt_evidence=True) == 0


def test_commission_never_uses_public_or_success_base():
    for base in v.INELIGIBLE_BASES:
        assert _happy_commission(base_kind=base) == 0
    assert _happy_commission(base_kind="edital") == 0
    assert _happy_commission(base_kind="obra") == 0
    assert _happy_commission(base_kind="success_fee") == 0


def test_commission_preexisting_rejected_expired():
    assert _happy_commission(preexisting=True) == 0
    assert _happy_commission(lead_status="REJECTED") == 0
    assert _happy_commission(protection_expired_without_contract=True) == 0
    assert _happy_commission(contracted_during_protection=False) == 0


def test_refund_reduces_commission():
    full = _happy_commission()
    reduced = _happy_commission(refund_or_chargeback_cents=200000)
    assert full == 80000
    assert reduced == 60000
    assert reduced < full
    capped = _happy_commission(previously_paid_or_accrued_cents=950000)
    assert capped == 50000


def test_oab_and_not_eligible_cannot_approve_standard_commission():
    assert _happy_commission(professional_flag="PROFESSIONAL_RULE_REVIEW_REQUIRED") == 0
    assert _happy_commission(modality="NOT_ELIGIBLE", rate_bps=1000) == 0
    assert _happy_commission(modality="DISTRIBUTION_INTEGRATION", rate_bps=1000) == 0
    assert v.standard_referral_commission_available(
        modality="REFERRAL_QUALIFIED",
        professional_flag="PROFESSIONAL_RULE_REVIEW_REQUIRED",
        due_diligence_state="APPROVED",
    ) is False
    assert v.standard_referral_commission_available(
        modality="REFERRAL_QUALIFIED",
        professional_flag=None,
        due_diligence_state="APPROVED",
    ) is True


def test_attribution_preexisting_rejected_expired_no_protection():
    start = date(2026, 1, 1)
    accepted = v.attribution_outcome(
        consent_evidence_ref="consent-1",
        source="consultoria-x",
        lead_decision="ACCEPT",
        protection_start=start,
        as_of=start,
    )
    assert accepted == "ACCEPTED_PROTECTED"
    assert v.protection_opens(accepted) is True
    assert v.protection_active(accepted, protection_start=start, as_of=start + timedelta(days=89)) is True
    expired = v.attribution_outcome(
        consent_evidence_ref="consent-1",
        source="consultoria-x",
        lead_decision="ACCEPT",
        protection_start=start,
        as_of=start + timedelta(days=90),
    )
    assert expired == "EXPIRED"
    assert v.protection_opens(expired) is False
    assert v.protection_active(expired, protection_start=start, as_of=start + timedelta(days=90)) is False
    rejected = v.attribution_outcome(
        consent_evidence_ref="consent-1",
        source="consultoria-x",
        lead_decision="REJECT",
    )
    assert rejected == "REJECTED"
    assert v.protection_opens(rejected) is False
    preexisting = v.attribution_outcome(
        consent_evidence_ref="consent-1",
        source="consultoria-x",
        preexisting_account=True,
        lead_decision="ACCEPT",
    )
    assert preexisting == "PREEXISTING"
    assert v.protection_opens(preexisting) is False


def test_lgpd_consent_and_source_required():
    assert v.lgpd_lead_admissible(consent_evidence_ref="c1", source="partner") is True
    assert v.lgpd_lead_admissible(consent_evidence_ref=None, source="partner") is False
    assert v.lgpd_lead_admissible(consent_evidence_ref="c1", source=None) is False
    assert v.lgpd_lead_admissible(consent_evidence_ref="c1", source="partner", list_dump=True) is False
    assert v.lgpd_lead_admissible(consent_evidence_ref="c1", source="partner", sensitive=True) is False
    assert v.lgpd_lead_admissible(consent_evidence_ref="c1", source="partner", pii_in_url=True) is False


def test_placeholders_cannot_become_approved():
    placeholder_record = {
        "legal_name": "[[FAIL_CLOSED:PARTNER_LEGAL_NAME]]",
        "cnpj": "[[FAIL_CLOSED:PARTNER_CNPJ]]",
        "professional_registry": "[[FAIL_CLOSED:PARTNER_PROFESSIONAL_REGISTRY]]",
        "modality": "REFERRAL_QUALIFIED",
        "professional_flag": None,
        "integrity_conflict": "NONE",
    }
    assert v.partner_record_may_be_approved(placeholder_record) is False
    with pytest.raises(v.ValidationError, match="placeholder"):
        v.assert_due_diligence_state_allowed(placeholder_record, "APPROVED")
    filled = {
        "legal_name": "Consultoria Exemplo LTDA",
        "cnpj": "preenchido-apos-diligencia",
        "professional_registry": "NAO_APLICAVEL",
        "modality": "REFERRAL_QUALIFIED",
        "professional_flag": "PROFESSIONAL_RULE_REVIEW_REQUIRED",
        "integrity_conflict": "NONE",
    }
    with pytest.raises(v.ValidationError, match="OAB"):
        v.assert_due_diligence_state_allowed(filled, "APPROVED")
    ineligible = dict(filled, professional_flag=None, modality="NOT_ELIGIBLE")
    with pytest.raises(v.ValidationError, match="NOT_ELIGIBLE"):
        v.assert_due_diligence_state_allowed(ineligible, "APPROVED")
    conflict = dict(filled, professional_flag=None, integrity_conflict="APPARENT")
    with pytest.raises(v.ValidationError, match="integrity"):
        v.assert_due_diligence_state_allowed(conflict, "APPROVED")


def test_unknown_and_missing_integrity_conflict_cannot_be_approved():
    base = {
        "legal_name": "Consultoria Exemplo LTDA",
        "cnpj": "preenchido-apos-diligencia",
        "professional_registry": "NAO_APLICAVEL",
        "modality": "REFERRAL_QUALIFIED",
        "professional_flag": None,
    }
    blocked_values = ("UNKNOWN", "REAL", "APPARENT", "UNRESOLVED", "", "UNASSESSED")
    for conflict in blocked_values:
        record = dict(base, integrity_conflict=conflict)
        assert v.integrity_conflict_blocks_approval(conflict) is True
        assert v.partner_record_may_be_approved(record) is False
        with pytest.raises(v.ValidationError, match="integrity"):
            v.assert_due_diligence_state_allowed(record, "APPROVED")
        with pytest.raises(v.ValidationError, match="integrity"):
            v.assert_due_diligence_state_allowed(record, "APPROVED_WITH_LIMITATIONS")
    missing = dict(base)
    assert "integrity_conflict" not in missing
    assert v.integrity_conflict_blocks_approval(missing.get("integrity_conflict")) is True
    assert v.partner_record_may_be_approved(missing) is False
    with pytest.raises(v.ValidationError, match="integrity"):
        v.assert_due_diligence_state_allowed(missing, "APPROVED")
    cleared = dict(base, integrity_conflict="NONE")
    assert v.integrity_conflict_blocks_approval("NONE") is False
    assert v.partner_record_may_be_approved(cleared) is True
    v.assert_due_diligence_policy(v.load_text(PKG / "PARTNER_DUE_DILIGENCE.md"))


def test_partner_event_is_never_received_revenue_without_evidence():
    accrual = {"type": "partner_commission_accrual_candidate", "eligible_receipt_cents": 800000}
    assert v.partner_event_is_received_revenue(accrual) is False
    assert v.partner_event_is_received_revenue("partner_commission_paid") is False
    assert v.partner_commission_may_be_marked_paid(accrual) is False
    unpaid = {
        "type": "partner_commission_paid",
        "outcome": "UNKNOWN",
        "receipt_evidence": False,
        "human_approval_actor": None,
        "eligible_receipt_cents": 800000,
    }
    assert v.partner_commission_may_be_marked_paid(unpaid) is False
    paid = {
        "type": "partner_commission_paid",
        "outcome": "PAID",
        "receipt_evidence": True,
        "human_approval_actor": "founder",
        "eligible_receipt_cents": 800000,
    }
    assert v.partner_commission_may_be_marked_paid(paid) is True
    assert v.partner_event_is_received_revenue(paid) is False


def test_public_influence_and_cargo_copy_fail():
    with pytest.raises(v.ValidationError, match="influence|cargo"):
        v.reject_adversarial_text("prometemos influência junto ao órgão", kind="influence")
    with pytest.raises(v.ValidationError, match="influence|cargo"):
        v.reject_adversarial_text("oferecemos acesso pelo cargo público", kind="influence")
    integrity = v.load_text(PKG / "PUBLIC_SECTOR_INTEGRITY.md")
    v.assert_no_public_influence_claim(integrity, source="PUBLIC_SECTOR_INTEGRITY.md")


def test_sha256_and_package_hash_identical_on_two_shipped_runs():
    first = v.build_sha256sums_text(PKG)
    second = v.build_sha256sums_text(PKG)
    assert first == second
    hashed_1 = {name: v.hash_partner_file(PKG / name) for name in v.HASHED_FILES}
    hashed_2 = {name: v.hash_partner_file(PKG / name) for name in v.HASHED_FILES}
    assert hashed_1 == hashed_2
    r1 = v.validate_partner_package(ROOT)
    r2 = v.validate_partner_package(ROOT)
    assert r1["authority_hash"] == r2["authority_hash"]
    assert r1["authority_hash"].startswith("sha256:")
    manifest = v.load_json(PKG / "manifest.json")
    assert v.partner_package_hash(manifest) == r1["authority_hash"]
    listed = v.parse_sha256sums(v.load_text(PKG / "SHA256SUMS.txt"))
    rebuilt = v.parse_sha256sums(first)
    assert listed == rebuilt


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
    assert "PUBLICATION_ENABLED false" in out1
    assert "REAL_PARTNER_CREATED false" in out1
    assert "REAL_MONEY_MUTATION_APPROVED false" in out1


def test_catalog_extra_and_real_money_untouched():
    catalog = v.load_json(ROOT / "commercial" / "offers" / "catalog.v1.json")
    offer = next(item for item in catalog["offers"] if item["offer_code"] == "CFG-DIAG-EXP-v1")
    assert offer["amount_cents"] == 800000
    assert offer["billing_mode"] == "ONE_TIME"
    gates = v.load_json(ROOT / "commercial" / "gates" / "production-gates.v1.json")
    assert gates["real_money_mutation_approved"] is False
    extra = v.load_json(ROOT / "commercial" / "exceptions" / "extra-historical.v1.json")
    public = json.dumps(v.load_json(ROOT / "commercial" / "offers" / "catalog.public.v1.json"))
    assert "HISTORICAL_LIGHTHOUSE" not in public
    assert extra["exceptions"][0]["is_public_offer"] is False
    authority = v.load_json(ROOT / "commercial" / "authority" / "authority-manifest.v1.json")
    assert all("partners" not in (item.get("path") or "") for item in authority["artifacts"])
    for _, text in v.iter_package_texts(PKG):
        assert "HISTORICAL_LIGHTHOUSE" not in text
        assert "CFG-EXC-EXTRA" not in text
        assert "1000000 cents/month" not in text


def test_prior_legal_and_commercial_hashes_unchanged():
    legal_result = legal.validate_legal_package(ROOT)
    assert legal_result["authority_hash"].startswith("sha256:")
    prov_result = prov.validate_legal_package(ROOT)
    assert prov_result["authority_hash"] == "sha256:53cb908af9eeaaa1d7097c322394440cff329ff9bd7fb9522ab922801f0cd150"
    commercial = auth.validate_package(ROOT)
    assert commercial["authority_hash"].startswith("sha256:")


def test_secret_pii_scan_and_generated_artifacts_policy():
    joined = "\n".join(text for _, text in v.iter_package_texts(PKG))
    hits = v.scan_forbidden_secrets(joined)
    assert hits == []
    assert v.PII_URL_RE.search(joined) is None
    hasher_text = v.build_sha256sums_text(PKG)
    on_disk = v.load_text(PKG / "SHA256SUMS.txt")
    assert hasher_text == on_disk
    hashed = {name: v.hash_partner_file(PKG / name) for name in v.HASHED_FILES}
    generated = v.default_manifest(hashed)
    on_disk_manifest = v.load_json(PKG / "manifest.json")
    assert generated == on_disk_manifest


def test_pr_reviewability_text_only_package():
    for path in PKG.rglob("*"):
        if path.is_file():
            assert path.suffix in {".md", ".json", ".txt"}
            path.read_text(encoding="utf-8")


def test_adversarial_legal_approved_token(tmp_path):
    text = v.load_text(PKG / "PARTNER_AGREEMENT_B2B.md") + "\nstatus: LEGAL_APPROVED\n"
    with pytest.raises(v.ValidationError, match="forbidden claim"):
        v.reject_adversarial_text(text, kind="validated_claim")
    dest = v.mutate_package(PKG, tmp_path / "adv-legal")
    (dest / "PARTNER_AGREEMENT_B2B.md").write_text(text, encoding="utf-8")
    with pytest.raises(v.ValidationError, match="forbidden claim"):
        v.validate_partner_dir(dest, root=ROOT)


def test_adversarial_extra_leak(tmp_path):
    text = v.load_text(PKG / "README.md") + "\nHISTORICAL_LIGHTHOUSE R$ 10 mil\n"
    with pytest.raises(v.ValidationError, match="leak"):
        v.reject_adversarial_text(text, kind="extra")
    dest = v.mutate_package(PKG, tmp_path / "adv-extra")
    (dest / "README.md").write_text(text, encoding="utf-8")
    with pytest.raises(v.ValidationError, match="leak"):
        v.validate_partner_dir(dest, root=ROOT)


def test_adversarial_influence_copy(tmp_path):
    dest = v.mutate_package(PKG, tmp_path / "adv-influence")
    text = v.load_text(dest / "PARTNER_CODE_OF_CONDUCT.md") + "\nprometemos influência junto ao órgão\n"
    (dest / "PARTNER_CODE_OF_CONDUCT.md").write_text(text, encoding="utf-8")
    with pytest.raises(v.ValidationError, match="influence|cargo"):
        v.validate_partner_dir(dest, root=ROOT)


def test_adversarial_filled_placeholders(tmp_path):
    dest = v.mutate_package(PKG, tmp_path / "adv-placeholder")
    text = v.load_text(dest / "PARTNER_AGREEMENT_B2B.md").replace(
        "[[FAIL_CLOSED:PARTNER_CNPJ]]", "PREENCHIDO_SEM_REVISAO"
    )
    (dest / "PARTNER_AGREEMENT_B2B.md").write_text(text, encoding="utf-8")
    with pytest.raises(v.ValidationError, match="fail-closed placeholder"):
        v.validate_partner_dir(dest, root=ROOT)


def test_adversarial_immutable_agreement_hash(tmp_path):
    dest = v.mutate_package(PKG, tmp_path / "adv-hash")
    text = v.load_text(dest / "PARTNER_AGREEMENT_B2B.md") + "\n\nmutacao silenciosa\n"
    (dest / "PARTNER_AGREEMENT_B2B.md").write_text(text, encoding="utf-8")
    with pytest.raises(v.ValidationError, match="SHA256SUMS mismatch"):
        v.validate_partner_dir(dest, root=ROOT)


def test_modalities_and_fail_closed_flags_in_package():
    result = v.validate_partner_package(ROOT)
    assert result["legal_approved"] is False
    assert result["publication_enabled"] is False
    assert result["real_partner_created"] is False
    assert result["private_negotiation_enabled"] is True
    joined = "\n".join(text for _, text in v.iter_package_texts(PKG))
    for modality in v.MODALITIES:
        assert modality in joined
    assert "PROFESSIONAL_RULE_REVIEW_REQUIRED" in joined
    assert "Warmbly #47" in joined or "Warmbly#47" in joined
