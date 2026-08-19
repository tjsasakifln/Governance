"""Adversarial tests for the shipped provisional legal package.

Every assertion drives functions or artifacts from
``scripts/validate_legal_provisional.py``. No expected hash strings
are hard-coded; hashes are computed by the shipped hasher twice.
"""

from __future__ import annotations

import importlib.util
import json
from copy import deepcopy
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
LEGAL_VALIDATOR_PATH = ROOT / "scripts" / "validate_legal_provisional.py"
AUTHORITY_VALIDATOR_PATH = ROOT / "scripts" / "validate_commercial_authority.py"
PKG = ROOT / "commercial" / "legal" / "provisional-v1"


def load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


v = load_module(LEGAL_VALIDATOR_PATH, "validate_legal_provisional")
auth = load_module(AUTHORITY_VALIDATOR_PATH, "validate_commercial_authority")


def test_shipped_entry_points_exist():
    assert LEGAL_VALIDATOR_PATH.is_file()
    assert PKG.is_dir()
    assert (PKG / "TERMOS_B2B_DIAGNOSTICO.md").is_file()
    assert not (PKG / "DPA_LITE_B2B.md").is_file()


def test_required_files_and_metadata():
    result = v.validate_legal_package(ROOT)
    for name in v.REQUIRED_FILES:
        assert (PKG / name).is_file()
    for rel, text in v.iter_package_texts(PKG):
        v.assert_required_metadata(text, source=rel)
    assert result["offer_code"] == "CFG-DIAG-EXP-v1"
    assert result["offer_amount_cents"] == 800000
    assert result["dpa_lite_applicable"] is False
    assert result["campaign_status"] in v.ALLOWED_CAMPAIGN_STATUSES
    assert result["campaign_status"] not in v.FORBIDDEN_CAMPAIGN_STATUSES


def test_forbidden_claim_phrases_absent():
    for rel, text in v.iter_package_texts(PKG):
        v.assert_no_forbidden_claims(text, source=rel)
        v.assert_no_resultado_promise(text, source=rel)
        v.assert_no_checkout_authorization(text, source=rel)


def test_catalog_diagnosis_amount_unchanged_and_extra_absent():
    catalog = v.load_json(ROOT / "commercial" / "offers" / "catalog.v1.json")
    offer = next(item for item in catalog["offers"] if item["offer_code"] == "CFG-DIAG-EXP-v1")
    assert offer["amount_cents"] == 800000
    assert offer["billing_mode"] == "ONE_TIME"
    for rel, text in v.iter_package_texts(PKG):
        v.assert_no_extra_leak(text, source=rel)
        assert "HISTORICAL_LIGHTHOUSE" not in text
    extra = v.load_json(ROOT / "commercial" / "exceptions" / "extra-historical.v1.json")
    assert extra["exceptions"][0]["amount_cents"] == 1000000
    assert extra["exceptions"][0]["is_public_offer"] is False


def test_fail_closed_flags_stay_false():
    manifest = v.load_json(PKG / "manifest.json")
    v.assert_fail_closed_flags(manifest)
    gates = v.load_json(ROOT / "commercial" / "gates" / "production-gates.v1.json")
    assert gates["production_checkout_enabled"] is False
    assert gates["public_activation_approved"] is False
    assert gates["real_money_mutation_approved"] is False
    legal_gate = next(item for item in gates["gates"] if item["gate_id"] == "legal_terms_forum")
    assert legal_gate["state"] != "APPROVED"


def test_human_decisions_remain_unresolved():
    v.assert_human_decisions_package(PKG)
    manifest = v.load_json(PKG / "manifest.json")
    assert sorted(manifest["unresolved_human_decisions"]) == sorted(v.HUMAN_DECISION_IDS)
    terms = v.load_text(PKG / "TERMOS_B2B_DIAGNOSTICO.md")
    for decision_id in v.HUMAN_DECISION_IDS:
        assert v.human_decision_token(decision_id) in terms or decision_id in (
            # every id is required in HUMAN_DECISIONS; terms carry the operational tokens
            "dados_pessoais_tratados",
            "retencao",
        )
        assert v.human_decision_token(decision_id) in v.load_text(PKG / "HUMAN_DECISIONS_REQUIRED.md")


def test_clause_matrix_and_risk_register_cover_required_topics():
    terms = v.load_text(PKG / "TERMOS_B2B_DIAGNOSTICO.md")
    matrix = v.load_json(PKG / "CLAUSE_MATRIX.json")
    register = v.load_json(PKG / "LEGAL_RISK_REGISTER.json")
    v.assert_terms_clauses(terms)
    v.assert_clause_matrix(matrix, terms)
    v.assert_risk_register(register)
    schema = v.load_json(PKG / "commercial-legal-provisional.schema.json")
    auth.schema_validate(matrix, v.schema_for("CLAUSE_MATRIX.json", schema), schema)
    auth.schema_validate(register, v.schema_for("LEGAL_RISK_REGISTER.json", schema), schema)
    auth.schema_validate(v.load_json(PKG / "manifest.json"), v.schema_for("manifest.json", schema), schema)


def test_sha256sums_match_two_independent_shipped_hasher_runs():
    first = v.build_sha256sums_text(PKG)
    second = v.build_sha256sums_text(PKG)
    assert first == second
    hashed_1 = {name: v.hash_legal_file(PKG / name) for name in v.HASHED_FILES}
    hashed_2 = {name: v.hash_legal_file(PKG / name) for name in v.HASHED_FILES}
    assert hashed_1 == hashed_2
    for digest in hashed_1.values():
        assert digest.startswith("sha256:")
        assert len(digest) == 71
    listed = v.assert_sha256sums_match(PKG)
    assert listed == hashed_1


def test_legal_package_hash_stable_across_two_shipped_runs():
    first = v.validate_legal_package(ROOT)
    second = v.validate_legal_package(ROOT)
    assert first["authority_hash"] == second["authority_hash"]
    assert first["authority_hash"].startswith("sha256:")
    manifest = v.load_json(PKG / "manifest.json")
    assert v.legal_package_hash(manifest) == first["authority_hash"]
    rebuilt = json.loads(v.canonical_json(manifest))
    assert v.legal_package_hash(rebuilt) == first["authority_hash"]


def test_cli_and_authority_entry_twice(capsys):
    rc1 = v.main([])
    out1 = capsys.readouterr().out
    rc2 = v.main([])
    out2 = capsys.readouterr().out
    assert rc1 == 0 and rc2 == 0
    line1 = [line for line in out1.splitlines() if line.startswith("AUTHORITY_HASH ")][0]
    line2 = [line for line in out2.splitlines() if line.startswith("AUTHORITY_HASH ")][0]
    assert line1 == line2
    assert line1.split()[1].startswith("sha256:")

    arc1 = auth.main([])
    aout1 = capsys.readouterr().out
    arc2 = auth.main([])
    aout2 = capsys.readouterr().out
    assert arc1 == 0 and arc2 == 0
    ahash1 = [line for line in aout1.splitlines() if line.startswith("AUTHORITY_HASH ")][0]
    ahash2 = [line for line in aout2.splitlines() if line.startswith("AUTHORITY_HASH ")][0]
    assert ahash1 == ahash2
    assert ahash1.split()[1].startswith("sha256:")
    legal1 = [line for line in aout1.splitlines() if line.startswith("LEGAL_PACKAGE_HASH ")][0]
    legal2 = [line for line in aout2.splitlines() if line.startswith("LEGAL_PACKAGE_HASH ")][0]
    assert legal1 == legal2 == line1.replace("AUTHORITY_HASH", "LEGAL_PACKAGE_HASH")


def _mutated_terms(suffix: str) -> str:
    return v.load_text(PKG / "TERMOS_B2B_DIAGNOSTICO.md") + "\n" + suffix + "\n"


def test_adversarial_presents_as_validated():
    text = _mutated_terms("Este texto foi aprovado pelo jurídico e juridicamente validado.")
    with pytest.raises(v.ValidationError, match="forbidden claim"):
        v.reject_adversarial_text(text, kind="validated_claim")
    dest = Path("/tmp/grok-goal-9cc0054bcbf6/implementer") / "adv-validated"
    copy = v.mutate_package(PKG, dest)
    (copy / "TERMOS_B2B_DIAGNOSTICO.md").write_text(text, encoding="utf-8")
    with pytest.raises(v.ValidationError, match="forbidden claim"):
        v.validate_legal_dir(copy, root=ROOT)


def test_adversarial_hides_missing_review():
    text = v.load_text(PKG / "TERMOS_B2B_DIAGNOSTICO.md").replace(
        "professional_legal_review: NOT_YET_PERFORMED",
        "professional_legal_review: COMPLETE",
    )
    with pytest.raises(v.ValidationError, match="missing metadata"):
        v.assert_required_metadata(text, source="hidden")
    with pytest.raises(v.ValidationError, match="hides missing professional review"):
        v.reject_adversarial_text(text.replace("NOT_YET_PERFORMED", ""), kind="hidden_review")


def test_adversarial_promises_resultado():
    text = _mutated_terms("Este diagnóstico garante vitória em licitação.")
    with pytest.raises(v.ValidationError, match="result promise"):
        v.reject_adversarial_text(text, kind="resultado")
    dest = Path("/tmp/grok-goal-9cc0054bcbf6/implementer") / "adv-resultado"
    copy = v.mutate_package(PKG, dest)
    (copy / "TERMOS_B2B_DIAGNOSTICO.md").write_text(text, encoding="utf-8")
    with pytest.raises(v.ValidationError, match="result promise"):
        v.validate_legal_dir(copy, root=ROOT)


def test_adversarial_authorizes_cobranca():
    text = _mutated_terms("Checkout autorizado. Cobrança autorizada.")
    with pytest.raises(v.ValidationError, match="forbidden authorization"):
        v.reject_adversarial_text(text, kind="cobranca")
    dest = Path("/tmp/grok-goal-9cc0054bcbf6/implementer") / "adv-cobranca"
    copy = v.mutate_package(PKG, dest)
    (copy / "TERMOS_B2B_DIAGNOSTICO.md").write_text(text, encoding="utf-8")
    with pytest.raises(v.ValidationError, match="forbidden authorization"):
        v.validate_legal_dir(copy, root=ROOT)


def test_adversarial_leaks_extra():
    text = _mutated_terms("Condição HISTORICAL_LIGHTHOUSE / CFG-EXC-EXTRA.")
    with pytest.raises(v.ValidationError, match="leak"):
        v.reject_adversarial_text(text, kind="extra")
    dest = Path("/tmp/grok-goal-9cc0054bcbf6/implementer") / "adv-extra"
    copy = v.mutate_package(PKG, dest)
    (copy / "TERMOS_B2B_DIAGNOSTICO.md").write_text(text, encoding="utf-8")
    with pytest.raises(v.ValidationError, match="leak"):
        v.validate_legal_dir(copy, root=ROOT)


def test_adversarial_invents_legal_basis():
    text = _mutated_terms("O art. 63 do CPC obriga o foro de São Paulo neste contrato.")
    with pytest.raises(v.ValidationError, match="invented legal basis"):
        v.reject_adversarial_text(text, kind="invented_basis")
    dest = Path("/tmp/grok-goal-9cc0054bcbf6/implementer") / "adv-basis"
    copy = v.mutate_package(PKG, dest)
    (copy / "TERMOS_B2B_DIAGNOSTICO.md").write_text(text, encoding="utf-8")
    with pytest.raises(v.ValidationError, match="invented legal basis"):
        v.validate_legal_dir(copy, root=ROOT)


def test_adversarial_fills_human_decision():
    original = v.load_text(PKG / "TERMOS_B2B_DIAGNOSTICO.md")
    filled = original.replace(
        v.human_decision_token("foro"),
        "Foro da Comarca de Recife",
    )
    with pytest.raises(v.ValidationError, match="filled human decision"):
        v.reject_adversarial_text(filled, kind="filled_decision")
    dest = Path("/tmp/grok-goal-9cc0054bcbf6/implementer") / "adv-foro"
    copy = v.mutate_package(PKG, dest)
    (copy / "TERMOS_B2B_DIAGNOSTICO.md").write_text(filled, encoding="utf-8")
    with pytest.raises(v.ValidationError):
        v.validate_legal_dir(copy, root=ROOT)


def test_adversarial_dpa_with_invented_subprocessor_rejected(tmp_path):
    dest = v.mutate_package(PKG, tmp_path / "adv-dpa")
    (dest / "DPA_LITE_B2B.md").write_text(
        "status: PROVISIONAL_AI_DRAFT\nsubprocessor: invented-vendor.example\n",
        encoding="utf-8",
    )
    with pytest.raises(v.ValidationError, match="DPA_LITE_B2B"):
        v.validate_legal_dir(dest, root=ROOT)


def test_schema_rejects_illegal_campaign_status():
    manifest = v.load_json(PKG / "manifest.json")
    bad = deepcopy(manifest)
    bad["campaign_status"] = "LEGAL_APPROVED"
    schema = v.load_json(PKG / "commercial-legal-provisional.schema.json")
    with pytest.raises(auth.ValidationError):
        auth.schema_validate(bad, v.schema_for("manifest.json", schema), schema)
    with pytest.raises(v.ValidationError, match="campaign status"):
        v.assert_fail_closed_flags(bad)
    bad_checkout = deepcopy(manifest)
    bad_checkout["production_checkout_enabled"] = True
    with pytest.raises(v.ValidationError):
        v.assert_fail_closed_flags(bad_checkout)
    bad_forum = deepcopy(manifest)
    bad_forum["legal_terms_forum_gate"] = "APPROVED"
    with pytest.raises(v.ValidationError, match="APPROVED"):
        v.assert_fail_closed_flags(bad_forum)


SUCCESSOR = ROOT / "commercial" / "legal" / "diagnostico-v1.1"


def test_successor_package_exists_and_points_at_frozen_prior():
    assert SUCCESSOR.is_dir()
    assert (SUCCESSOR / "FOUNDER_DECISIONS.md").is_file()
    assert (SUCCESSOR / "PROFESSIONAL_GATES.md").is_file()
    assert (SUCCESSOR / "LEGAL_COUNSEL_HANDOFF.md").is_file()
    assert (SUCCESSOR / "ACCOUNTANT_HANDOFF.md").is_file()
    assert (SUCCESSOR / "STATUS_FINAL.md").is_file()
    assert (SUCCESSOR / "DECISION_CLASSIFICATION.json").is_file()
    assert not (SUCCESSOR / "DPA_LITE_B2B.md").is_file()
    result = v.validate_all_legal_packages(ROOT)
    prior = v.validate_legal_package(ROOT)
    assert result["prior_package_hash"] == prior["authority_hash"]
    assert result["founder_decided_hash"] != result["prior_package_hash"]
    assert result["offer_code"] == "CFG-DIAG-EXP-v1"
    assert result["offer_amount_cents"] == 800000
    manifest = v.load_json(SUCCESSOR / "manifest.json")
    assert manifest["prior_package_hash"] == prior["authority_hash"]
    assert manifest["prior_package_version"] == "provisional-v1"
    assert manifest["campaign_status"] == "READY_FOR_PRIVATE_NEGOTIATION"


def test_ten_ids_classified_founder_baseline_not_legal_approved():
    classification = v.load_json(SUCCESSOR / "DECISION_CLASSIFICATION.json")
    v.assert_classification(classification)
    statuses = {item["id"]: item["status"] for item in classification["decisions"]}
    assert statuses == dict(v.EXPECTED_FOUNDER_STATUSES)
    for item in classification["decisions"]:
        assert item["status"] in v.ALLOWED_CLASSIFICATION_STATUSES
        assert item["status"] != "LEGAL_APPROVED"
        assert item.get("legal_approved") is not True
    assert classification["legal_approved"] is False
    assert classification["tax_approved"] is False
    assert classification["checkout_authorized"] is False
    for decision_id in v.FOUNDER_COMMERCIAL_IDS:
        assert statuses[decision_id] == "RESOLVED_BY_FOUNDER_BASELINE"
    pending = v.pending_decision_ids(classification)
    assert sorted(pending) == sorted(
        ["razao_social_cnpj_contratante", "foro", "retencao", "responsavel_fiscal"]
    )


def test_status_final_ready_for_private_negotiation_not_approved():
    text = v.load_text(SUCCESSOR / "STATUS_FINAL.md")
    v.assert_status_final(text)
    assert "READY_FOR_PRIVATE_NEGOTIATION" in text
    assert "NOT_LEGAL_APPROVED" in text
    assert "NOT_TAX_APPROVED" in text
    assert "NOT_CHECKOUT_AUTHORIZED" in text


def test_write_hashes_does_not_mutate_prior_package():
    prior_manifest = v.load_json(PKG / "manifest.json")
    prior_hash = v.legal_package_hash(prior_manifest)
    prior_files = {name: v.hash_legal_file(PKG / name) for name in v.HASHED_FILES}
    prior_sums = v.load_text(PKG / "SHA256SUMS.txt")
    result = v.write_hashes(ROOT)
    after_files = {name: v.hash_legal_file(PKG / name) for name in v.HASHED_FILES}
    after_manifest = v.load_json(PKG / "manifest.json")
    assert prior_files == after_files
    assert v.legal_package_hash(after_manifest) == prior_hash
    assert v.load_text(PKG / "SHA256SUMS.txt") == prior_sums
    assert result["prior_package_hash"] == prior_hash
    assert result["founder_decided_hash"].startswith("sha256:")


def test_pending_professional_gate_blocks_checkout_and_publication():
    classification = v.load_json(SUCCESSOR / "DECISION_CLASSIFICATION.json")
    manifest = v.load_json(SUCCESSOR / "manifest.json")
    v.assert_pending_gates_block_activation(manifest, classification)
    assert v.checkout_or_publication_permitted(manifest, classification) is False
    bad = deepcopy(manifest)
    bad["checkout_authorized"] = True
    with pytest.raises(v.ValidationError, match="checkout_authorized"):
        v.assert_pending_gates_block_activation(bad, classification)
    bad_pub = deepcopy(manifest)
    bad_pub["publication_authorized"] = True
    with pytest.raises(v.ValidationError, match="publication_authorized"):
        v.assert_pending_gates_block_activation(bad_pub, classification)


def test_pending_gate_in_successor_dir_rejects_checkout_flag(tmp_path):
    dest = v.mutate_package(SUCCESSOR, tmp_path / "adv-checkout-pending")
    manifest = v.load_json(dest / "manifest.json")
    manifest["checkout_authorized"] = True
    (dest / "manifest.json").write_text(
        __import__("json").dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    with pytest.raises(v.ValidationError, match="checkout_authorized"):
        v.validate_founder_decided_dir(dest, root=ROOT)


def test_invented_cnpj_razao_and_foro_fail(tmp_path):
    dest = v.mutate_package(SUCCESSOR, tmp_path / "adv-cnpj")
    terms = v.load_text(dest / "TERMOS_B2B_DIAGNOSTICO.md")
    invented_cnpj = f"{12:02d}.{345:03d}.{678:03d}/{1:04d}-{90:02d}"
    filled = terms.replace(
        v.human_decision_token("razao_social_cnpj_contratante"),
        f"CONFENGE SERVICOS LTDA CNPJ {invented_cnpj}",
    )
    (dest / "TERMOS_B2B_DIAGNOSTICO.md").write_text(filled, encoding="utf-8")
    with pytest.raises(v.ValidationError, match="invented"):
        v.reject_adversarial_text(filled, kind="invented_entity")
    with pytest.raises(v.ValidationError):
        v.validate_founder_decided_dir(dest, root=ROOT)

    dest_foro = v.mutate_package(SUCCESSOR, tmp_path / "adv-foro-v11")
    foro_text = v.load_text(dest_foro / "TERMOS_B2B_DIAGNOSTICO.md").replace(
        v.human_decision_token("foro"),
        "Foro da Comarca de Recife",
    )
    (dest_foro / "TERMOS_B2B_DIAGNOSTICO.md").write_text(foro_text, encoding="utf-8")
    with pytest.raises(v.ValidationError, match="invented"):
        v.reject_adversarial_text(foro_text, kind="invented_entity")
    with pytest.raises(v.ValidationError):
        v.validate_founder_decided_dir(dest_foro, root=ROOT)


def test_checkout_callback_is_not_aceite(tmp_path):
    terms = v.load_text(SUCCESSOR / "TERMOS_B2B_DIAGNOSTICO.md")
    v.assert_checkout_is_not_acceptance(terms, source="terms")
    bad = terms + "\nO checkout constitui aceite.\n"
    with pytest.raises(v.ValidationError, match="aceite"):
        v.reject_adversarial_text(bad, kind="checkout_as_aceite")
    dest = v.mutate_package(SUCCESSOR, tmp_path / "adv-aceite")
    (dest / "TERMOS_B2B_DIAGNOSTICO.md").write_text(bad, encoding="utf-8")
    with pytest.raises(v.ValidationError, match="aceite"):
        v.validate_founder_decided_dir(dest, root=ROOT)


def test_successor_terms_do_not_promise_result(tmp_path):
    terms = v.load_text(SUCCESSOR / "TERMOS_B2B_DIAGNOSTICO.md")
    v.assert_no_resultado_promise(terms, source="successor-terms")
    bad = terms + "\nEste diagnóstico garante vitória em licitação.\n"
    with pytest.raises(v.ValidationError, match="result promise"):
        v.reject_adversarial_text(bad, kind="resultado")
    dest = v.mutate_package(SUCCESSOR, tmp_path / "adv-result-v11")
    (dest / "TERMOS_B2B_DIAGNOSTICO.md").write_text(bad, encoding="utf-8")
    with pytest.raises(v.ValidationError, match="result promise"):
        v.validate_founder_decided_dir(dest, root=ROOT)


def test_mislabeling_founder_baseline_as_legal_approved_fails():
    classification = v.load_json(SUCCESSOR / "DECISION_CLASSIFICATION.json")
    bad = deepcopy(classification)
    for item in bad["decisions"]:
        if item["id"] == "limite_responsabilidade":
            item["status"] = "LEGAL_APPROVED"
    with pytest.raises(v.ValidationError, match="illegal classification status"):
        v.assert_classification(bad)
    invented_entity = deepcopy(classification)
    for item in invented_entity["decisions"]:
        if item["id"] == "razao_social_cnpj_contratante":
            item["status"] = "RESOLVED_BY_AUTHORITATIVE_ENTITY_DATA"
    with pytest.raises(v.ValidationError, match="PENDING_ENTITY_DOCUMENT"):
        v.assert_classification(invented_entity)
