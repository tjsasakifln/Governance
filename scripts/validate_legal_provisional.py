#!/usr/bin/env python3
"""Validate the provisional B2B legal bootstrap for CFG-DIAG-EXP-v1.

Shipped checker for commercial/legal/provisional-v1/. Not a legal opinion.
Does not authorize checkout, publication, or real-money mutation.

Usage:
    python scripts/validate_legal_provisional.py
    python scripts/validate_legal_provisional.py --write-hashes
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import re
import sys
from pathlib import Path
from typing import Any, Iterable, Mapping


PACKAGE_REL = Path("commercial") / "legal" / "provisional-v1"
SCHEMA_VERSION = "commercial-legal-provisional.v1"
PACKAGE_ID = "CFG-LEGAL-PROVISIONAL-DIAG-v1"
OFFER_CODE = "CFG-DIAG-EXP-v1"
OFFER_AMOUNT_CENTS = 800000
EFFECTIVE_AT = "2026-08-18T00:00:00Z"
ALLOWED_CAMPAIGN_STATUSES = frozenset(
    {
        "PROVISIONAL_PACKAGE_READY_FOR_FOUNDER_DECISIONS",
        "BLOCKED_MISSING_COMMERCIAL_AUTHORITY",
        "BLOCKED_CI",
    }
)
FORBIDDEN_CAMPAIGN_STATUSES = frozenset(
    {"LEGAL_APPROVED", "PRODUCTION_AUTHORIZED", "CHECKOUT_AUTHORIZED"}
)

REQUIRED_METADATA = {
    "status": "PROVISIONAL_AI_DRAFT",
    "professional_legal_review": "NOT_YET_PERFORMED",
    "operational_use": "HUMAN_DECISION_REQUIRED",
    "supersedable": "true",
    "jurisdiction": "Brazil",
    "business_context": "B2B_ENGINEERING_CONSULTING",
}

REQUIRED_FILES = (
    "TERMOS_B2B_DIAGNOSTICO.md",
    "ORDEM_DE_SERVICO_DIAGNOSTICO.md",
    "POLITICA_CANCELAMENTO_REEMBOLSO.md",
    "AVISO_LIMITACOES_TECNICAS.md",
    "AVISO_PRIVACIDADE_LEADS.md",
    "LEGAL_RISK_REGISTER.json",
    "HUMAN_DECISIONS_REQUIRED.md",
    "FISCAL_HANDOFF_TO_ACCOUNTANT.md",
    "CLAUSE_MATRIX.json",
    "commercial-legal-provisional.schema.json",
    "manifest.json",
    "SHA256SUMS.txt",
    "README.md",
)

HASHED_FILES = (
    "TERMOS_B2B_DIAGNOSTICO.md",
    "ORDEM_DE_SERVICO_DIAGNOSTICO.md",
    "POLITICA_CANCELAMENTO_REEMBOLSO.md",
    "AVISO_LIMITACOES_TECNICAS.md",
    "AVISO_PRIVACIDADE_LEADS.md",
    "LEGAL_RISK_REGISTER.json",
    "HUMAN_DECISIONS_REQUIRED.md",
    "FISCAL_HANDOFF_TO_ACCOUNTANT.md",
    "CLAUSE_MATRIX.json",
    "commercial-legal-provisional.schema.json",
    "README.md",
    "CONSUMER_HANDOFF.md",
)

REQUIRED_CLAUSE_IDS = (
    "partes_elegibilidade_b2b",
    "objeto",
    "entregaveis",
    "dados_documentos_cliente",
    "premissas",
    "prazo_marcos",
    "preco_condicao_inicio",
    "tributos_nfse",
    "aceite",
    "ajustes_escopo",
    "confidencialidade",
    "propriedade_intelectual",
    "licenca_uso_entregaveis",
    "fontes_publicas_dados_terceiros",
    "limitacoes_responsabilidade",
    "ausencia_garantia_resultado",
    "ausencia_representacao_juridica",
    "ausencia_substituicao_advogado_contador",
    "dever_validacao_cliente",
    "suspensao_falta_informacao",
    "cancelamento",
    "inadimplencia",
    "forca_maior",
    "protecao_dados_minimizacao",
    "comunicacao",
    "resolucao_conflitos",
    "foro_provisorio",
    "versionamento",
    "prevalencia_proposta_os",
)

HUMAN_DECISION_IDS = (
    "razao_social_cnpj_contratante",
    "foro",
    "limite_responsabilidade",
    "politica_reembolso",
    "prazo_entrega",
    "dados_pessoais_tratados",
    "retencao",
    "responsavel_fiscal",
    "aceite_eletronico",
    "canal_suporte",
)

REQUIRED_TERMS_PHRASES = (
    "pessoa jurídica ou empresário",
    "obrigação é de **meio**",
    "mapa de compradores",
    "15** concorrentes",
    "insumos obrigatórios",
    "premissas",
    "dias úteis",
    "confirmação financeira",
    "NFS-e",
    "aceite eletrônico",
    "Mudança material",
    "não publica",
    "Métodos, modelos, software",
    "licença perpétua",
    "fontes públicas",
    "HUMAN_DECISION_REQUIRED: limite_responsabilidade",
    "ausência de garantia de resultado",
    "não exerce representação jurídica",
    "não substitui advogado",
    "não substitui contador",
    "cliente deve validar",
    "autoriza suspensão do relógio",
    "POLITICA_CANCELAMENTO_REEMBOLSO.md",
    "Valores incontroversos vencidos",
    "Evento extraordinário",
    "minimização",
    "HUMAN_DECISION_REQUIRED: canal_suporte",
    "não institui arbitragem",
    "HUMAN_DECISION_REQUIRED: foro",
    "supersedable = true",
    "Ordem de Serviço ou proposta aceita",
)

FORBIDDEN_CLAIM_PHRASES = (
    "aprovado pelo jurídico",
    "juridicamente validado",
    "garantia de conformidade",
    "modelo definitivo",
)
FORBIDDEN_CLAIM_WORD_PATTERNS = (
    re.compile(r"(?<![A-Za-zÁ-ú])parecer(?![A-Za-zÁ-ú])", re.I),
    re.compile(r"(?<![A-Za-zÁ-ú])pareceres(?![A-Za-zÁ-ú])", re.I),
)

FORBIDDEN_PROMISE_PHRASES = (
    "este diagnóstico garante vitória",
    "garantimos vitória",
    "asseguramos recuperação de crédito",
    "garante adjudicação",
    "promessa de resultado cumprida",
    "conclusão jurídica vinculante fornecida",
    "oferece garantia de resultado",
)
FORBIDDEN_PROMISE_PATTERNS = (
    re.compile(r"(?<![Nn]ão\s)(?<![Ss]em\s)(?<!ausência de\s)há garantia de resultado", re.I),
)

FORBIDDEN_AUTHORIZATION_PHRASES = (
    "checkout autorizado",
    "cobrança autorizada",
    "publicação autorizada",
    "production_checkout_enabled = true",
    '"production_checkout_enabled": true',
    '"checkout_authorized": true',
    '"cobranca_authorized": true',
    '"publication_authorized": true',
    '"public_activation_approved": true',
    '"real_money_mutation_approved": true',
)

EXTRA_LEAK_MARKERS = (
    "HISTORICAL_LIGHTHOUSE",
    "CFG-EXC-EXTRA",
    "EXTRA-HISTORICAL",
    "extra-historical",
    "1000000 cents/month",
    "R$ 10.000/mês por seis",
    "R$ 10.000/month",
)

INVENTED_BASIS_PATTERNS = (
    re.compile(r"obriga o foro", re.I),
    re.compile(r"foro é válido por força do art", re.I),
    re.compile(r"art\.\s*\d+\s+do cpc obriga", re.I),
    re.compile(r"teto de responsabilidade é válido por lei", re.I),
)

FILLED_DECISION_PATTERNS = (
    re.compile(r"Foro da Comarca de [A-ZÁ-Ú]", re.I),
    re.compile(r"\b\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}\b"),
    re.compile(r"responsabilidade limitada a R\$\s*[\d.]"),
    re.compile(r"reembolso de 100%\s+em\s+\d+"),
    re.compile(r"prazo garantido de\s+\d+\s+dias", re.I),
)

DPA_FILENAME = "DPA_LITE_B2B.md"

_SHA256SUMS_HEADER = """# status=PROVISIONAL_AI_DRAFT
# professional_legal_review=NOT_YET_PERFORMED
# operational_use=HUMAN_DECISION_REQUIRED
# supersedable=true
# jurisdiction=Brazil
# business_context=B2B_ENGINEERING_CONSULTING
# hashed_with=scripts/validate_legal_provisional.py
"""


class ValidationError(Exception):
    """Fail-closed provisional legal-package error."""


def _load_authority():
    path = Path(__file__).resolve().parent / "validate_commercial_authority.py"
    spec = importlib.util.spec_from_file_location("validate_commercial_authority", path)
    if spec is None or spec.loader is None:
        raise ValidationError("cannot load commercial authority validator")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def repo_root(start: Path | None = None) -> Path:
    here = (start or Path(__file__)).resolve()
    if here.is_file():
        here = here.parent
    for candidate in (here, *here.parents):
        if (candidate / "commercial" / "offers" / "catalog.v1.json").is_file():
            return candidate
    raise ValidationError("cannot locate Governance commercial authority root")


def legal_package_dir(root: Path | None = None) -> Path:
    return repo_root(root) / PACKAGE_REL


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


def human_decision_token(decision_id: str) -> str:
    return f"[[HUMAN_DECISION_REQUIRED: {decision_id}]]"


def hash_legal_file(path: Path) -> str:
    if not path.is_file():
        raise ValidationError(f"missing artifact {path.name}")
    if path.suffix == ".json":
        return content_hash_json(load_json(path))
    return content_hash_text(load_text(path))


def hash_legal_file_hex(path: Path) -> str:
    return hash_legal_file(path).removeprefix("sha256:")


def build_sha256sums_text(pkg: Path) -> str:
    lines = [_SHA256SUMS_HEADER.rstrip(), ""]
    for name in HASHED_FILES:
        digest = hash_legal_file_hex(pkg / name)
        lines.append(f"{digest}  {name}")
    return "\n".join(lines) + "\n"


def parse_sha256sums(text: str) -> dict[str, str]:
    listed: dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if len(parts) != 2:
            raise ValidationError(f"invalid SHA256SUMS line: {raw!r}")
        digest, name = parts
        if not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise ValidationError(f"invalid digest for {name}")
        listed[name] = digest
    return listed


def assert_required_files(pkg: Path) -> None:
    missing = [name for name in REQUIRED_FILES if not (pkg / name).is_file()]
    if missing:
        raise ValidationError(f"missing required legal artifacts: {missing}")
    if (pkg / DPA_FILENAME).is_file():
        raise ValidationError(
            f"{DPA_FILENAME} must not exist unless processing-on-behalf is in scope; "
            "this diagnosis package records non-applicability and invents no subprocessors"
        )
    extra_md = sorted(
        path.name
        for path in pkg.glob("*.md")
        if path.name not in set(REQUIRED_FILES) | {"CONSUMER_HANDOFF.md"}
    )
    if extra_md:
        raise ValidationError(f"unexpected markdown in legal package: {extra_md}")


def _metadata_blob(text: str) -> str:
    return text[:4000]


def assert_required_metadata(text: str, *, source: str) -> None:
    blob = _metadata_blob(text)
    compact = blob.replace(" ", "").replace('"', "").replace("'", "")
    for key, value in REQUIRED_METADATA.items():
        patterns = (
            f"{key}: {value}",
            f"{key} = {value}",
            f"{key}={value}",
            f"{key}:{value}",
        )
        ok = any(item.lower() in blob.lower() or item.replace(" ", "").lower() in compact.lower() for item in patterns)
        if key == "supersedable" and not ok:
            ok = re.search(r'"supersedable"\s*:\s*true', text, re.I) is not None
        if not ok:
            raise ValidationError(f"{source}: missing metadata {key}={value}")


def assert_no_forbidden_claims(text: str, *, source: str) -> None:
    lowered = text.lower()
    for phrase in FORBIDDEN_CLAIM_PHRASES:
        if phrase.lower() in lowered:
            raise ValidationError(f"{source}: forbidden claim {phrase!r}")
    for pattern in FORBIDDEN_CLAIM_WORD_PATTERNS:
        if pattern.search(text):
            raise ValidationError(f"{source}: forbidden claim word {pattern.pattern!r}")


def assert_no_resultado_promise(text: str, *, source: str) -> None:
    lowered = text.lower()
    for phrase in FORBIDDEN_PROMISE_PHRASES:
        if phrase in lowered:
            raise ValidationError(f"{source}: forbidden result promise {phrase!r}")
    for pattern in FORBIDDEN_PROMISE_PATTERNS:
        if pattern.search(text):
            raise ValidationError(f"{source}: forbidden result promise {pattern.pattern!r}")


def assert_no_checkout_authorization(text: str, *, source: str) -> None:
    lowered = text.lower()
    for phrase in FORBIDDEN_AUTHORIZATION_PHRASES:
        if phrase.lower() in lowered:
            raise ValidationError(f"{source}: forbidden authorization {phrase!r}")


def assert_no_extra_leak(text: str, *, source: str) -> None:
    for marker in EXTRA_LEAK_MARKERS:
        if marker.lower() in text.lower():
            raise ValidationError(f"{source}: Extra/private-exception leak {marker!r}")


def assert_no_invented_legal_basis(text: str, *, source: str) -> None:
    for pattern in INVENTED_BASIS_PATTERNS:
        if pattern.search(text):
            raise ValidationError(f"{source}: invented legal basis {pattern.pattern!r}")


def assert_human_tokens_unresolved(text: str, *, source: str, required_ids: Iterable[str] | None = None) -> None:
    for pattern in FILLED_DECISION_PATTERNS:
        if pattern.search(text):
            raise ValidationError(f"{source}: filled human decision {pattern.pattern!r}")
    for decision_id in required_ids or ():
        token = human_decision_token(decision_id)
        if token not in text:
            raise ValidationError(f"{source}: missing unresolved token {token}")


def assert_document_safe(text: str, *, source: str) -> None:
    assert_required_metadata(text, source=source)
    assert_no_forbidden_claims(text, source=source)
    assert_no_resultado_promise(text, source=source)
    assert_no_checkout_authorization(text, source=source)
    assert_no_extra_leak(text, source=source)
    assert_no_invented_legal_basis(text, source=source)
    assert_human_tokens_unresolved(text, source=source)


def assert_terms_clauses(terms: str) -> None:
    for clause_id in REQUIRED_CLAUSE_IDS:
        marker = f"**clause_id:** `{clause_id}`"
        if marker not in terms:
            raise ValidationError(f"terms missing clause marker {clause_id}")
    for phrase in REQUIRED_TERMS_PHRASES:
        if phrase.lower() not in terms.lower() and phrase not in terms:
            raise ValidationError(f"terms missing required operational phrase: {phrase!r}")


def assert_human_decisions_package(pkg: Path) -> None:
    corpus = []
    for path in pkg.iterdir():
        if path.is_file() and path.suffix in {".md", ".json", ".txt"}:
            corpus.append(path.read_text(encoding="utf-8"))
    joined = "\n".join(corpus)
    for decision_id in HUMAN_DECISION_IDS:
        token = human_decision_token(decision_id)
        if token not in joined:
            raise ValidationError(f"unresolved human decision missing from package: {token}")
    terms = load_text(pkg / "TERMOS_B2B_DIAGNOSTICO.md")
    human = load_text(pkg / "HUMAN_DECISIONS_REQUIRED.md")
    os_doc = load_text(pkg / "ORDEM_DE_SERVICO_DIAGNOSTICO.md")
    for source, text, ids in (
        ("TERMOS_B2B_DIAGNOSTICO.md", terms, HUMAN_DECISION_IDS),
        ("HUMAN_DECISIONS_REQUIRED.md", human, HUMAN_DECISION_IDS),
        (
            "ORDEM_DE_SERVICO_DIAGNOSTICO.md",
            os_doc,
            (
                "razao_social_cnpj_contratante",
                "foro",
                "limite_responsabilidade",
                "politica_reembolso",
                "prazo_entrega",
                "aceite_eletronico",
                "canal_suporte",
                "responsavel_fiscal",
            ),
        ),
    ):
        assert_human_tokens_unresolved(text, source=source, required_ids=ids)


def assert_clause_matrix(matrix: Mapping[str, Any], terms: str) -> None:
    if matrix.get("artifact") != "clause_matrix":
        raise ValidationError("clause matrix artifact id mismatch")
    clauses = matrix.get("clauses") or []
    seen = [item.get("clause_id") for item in clauses]
    if sorted(seen) != sorted(REQUIRED_CLAUSE_IDS):
        raise ValidationError(f"clause matrix set mismatch: {sorted(set(seen) ^ set(REQUIRED_CLAUSE_IDS))}")
    if len(seen) != len(set(seen)):
        raise ValidationError("duplicate clause_id in matrix")
    for item in clauses:
        for key in ("risk_covered", "source_or_premissa", "state", "consumer"):
            if not item.get(key):
                raise ValidationError(f"clause {item.get('clause_id')} missing {key}")
        if item.get("state") != "PROVISIONAL_AI_DRAFT":
            raise ValidationError(f"clause {item.get('clause_id')} state must stay PROVISIONAL_AI_DRAFT")
        if not isinstance(item.get("consumer"), list) or not item["consumer"]:
            raise ValidationError(f"clause {item.get('clause_id')} consumer must be a non-empty list")
        marker = f"**clause_id:** `{item['clause_id']}`"
        if marker not in terms:
            raise ValidationError(f"clause matrix id {item['clause_id']} not present in terms")


def assert_risk_register(register: Mapping[str, Any]) -> None:
    if register.get("artifact") != "legal_risk_register":
        raise ValidationError("risk register artifact id mismatch")
    risks = register.get("risks") or []
    if len(risks) < 16:
        raise ValidationError("risk register must cover the adversarial scenarios")
    required_keys = (
        "risk_id",
        "risk",
        "impacto",
        "probabilidade",
        "mitigacao",
        "owner",
        "gate",
        "professional_review_trigger",
    )
    seen: set[str] = set()
    for item in risks:
        for key in required_keys:
            if not item.get(key):
                raise ValidationError(f"risk {item.get('risk_id')} missing {key}")
        rid = item["risk_id"]
        if rid in seen:
            raise ValidationError(f"duplicate risk_id {rid}")
        seen.add(rid)
        if item.get("impacto") not in {"LOW", "MEDIUM", "HIGH"}:
            raise ValidationError(f"{rid}: invalid impacto")
        if item.get("probabilidade") not in {"LOW", "MEDIUM", "HIGH"}:
            raise ValidationError(f"{rid}: invalid probabilidade")
        if item.get("gate") == "legal_terms_forum" and "APPROVED" in str(item.get("mitigacao")):
            if "legal_terms_forum = APPROVED" in str(item.get("mitigacao")):
                raise ValidationError("risk register must not flip legal_terms_forum to APPROVED")


def assert_fail_closed_flags(manifest: Mapping[str, Any]) -> None:
    expected_false = {
        "production_checkout_enabled": False,
        "public_activation_approved": False,
        "real_money_mutation_approved": False,
        "checkout_authorized": False,
        "publication_authorized": False,
        "cobranca_authorized": False,
        "dpa_lite_applicable": False,
        "does_not_reapprove_catalog_terms": True,
    }
    for key, value in expected_false.items():
        if manifest.get(key) != value:
            raise ValidationError(f"manifest flag {key} must be {value!r}")
    if manifest.get("legal_terms_forum_gate") == "APPROVED":
        raise ValidationError("legal_terms_forum must not be flipped to APPROVED")
    if manifest.get("legal_terms_forum_gate") != "UNKNOWN":
        raise ValidationError("legal_terms_forum_gate must remain UNKNOWN")
    status = manifest.get("campaign_status")
    if status not in ALLOWED_CAMPAIGN_STATUSES:
        raise ValidationError(f"illegal campaign status {status!r}")
    if status in FORBIDDEN_CAMPAIGN_STATUSES:
        raise ValidationError(f"forbidden campaign status {status!r}")
    if set(manifest.get("forbidden_statuses") or []) != FORBIDDEN_CAMPAIGN_STATUSES:
        raise ValidationError("manifest must list the three forbidden statuses")
    unresolved = list(manifest.get("unresolved_human_decisions") or [])
    if sorted(unresolved) != sorted(HUMAN_DECISION_IDS):
        raise ValidationError("manifest unresolved_human_decisions mismatch")
    if manifest.get("dpa_lite_path") is not None:
        raise ValidationError("dpa_lite_path must be null when not applicable")
    if not manifest.get("dpa_lite_reason"):
        raise ValidationError("dpa_lite_reason must record non-applicability")
    if manifest.get("offer_code") != OFFER_CODE or manifest.get("offer_amount_cents") != OFFER_AMOUNT_CENTS:
        raise ValidationError("manifest must pin CFG-DIAG-EXP-v1 at 800000 centavos")
    if manifest.get("billing_mode") != "ONE_TIME":
        raise ValidationError("manifest billing_mode must be ONE_TIME")


def assert_catalog_alignment(root: Path, manifest: Mapping[str, Any]) -> None:
    catalog = load_json(root / "commercial" / "offers" / "catalog.v1.json")
    gates = load_json(root / "commercial" / "gates" / "production-gates.v1.json")
    offer = None
    for item in catalog.get("offers") or ():
        if item.get("offer_code") == OFFER_CODE:
            offer = item
            break
    if offer is None:
        raise ValidationError("catalog missing CFG-DIAG-EXP-v1")
    if offer.get("amount_cents") != OFFER_AMOUNT_CENTS:
        raise ValidationError("catalog CFG-DIAG-EXP-v1 amount_cents must remain 800000")
    if offer.get("billing_mode") != "ONE_TIME":
        raise ValidationError("catalog diagnosis must remain ONE_TIME")
    if offer.get("delivery_business_days_min") != 10 or offer.get("delivery_business_days_max") != 15:
        raise ValidationError("catalog diagnosis window must remain 10-15")
    deliverables = offer.get("deliverables") or {}
    for key in (
        "buyer_map",
        "price_panel",
        "expiring_contracts",
        "screened_notices",
        "executive_recommendations_pdf",
        "spreadsheets",
        "kickoff",
        "final_presentation",
    ):
        if deliverables.get(key) is not True:
            raise ValidationError(f"catalog deliverable {key} missing")
    if deliverables.get("competitors") != 15:
        raise ValidationError("catalog competitors must remain 15")
    if gates.get("production_checkout_enabled") is not False:
        raise ValidationError("production_checkout_enabled must stay false")
    if gates.get("public_activation_approved") is not False:
        raise ValidationError("public_activation_approved must stay false")
    if gates.get("real_money_mutation_approved") is not False:
        raise ValidationError("real_money_mutation_approved must stay false")
    by_id = {gate["gate_id"]: gate for gate in gates.get("gates") or ()}
    legal_gate = by_id.get("legal_terms_forum") or {}
    if legal_gate.get("state") == "APPROVED":
        raise ValidationError("legal_terms_forum must not be APPROVED")
    if manifest.get("offer_amount_cents") != offer.get("amount_cents"):
        raise ValidationError("legal manifest amount drifted from catalog")


def assert_sha256sums_match(pkg: Path) -> dict[str, str]:
    listed = parse_sha256sums(load_text(pkg / "SHA256SUMS.txt"))
    expected = {name: hash_legal_file_hex(pkg / name) for name in HASHED_FILES}
    if set(listed) != set(expected):
        raise ValidationError(f"SHA256SUMS file set mismatch: {sorted(set(listed) ^ set(expected))}")
    for name, digest in expected.items():
        if listed[name] != digest:
            raise ValidationError(f"SHA256SUMS mismatch for {name}")
    return {name: f"sha256:{digest}" for name, digest in expected.items()}


def assert_manifest_hashes(pkg: Path, manifest: Mapping[str, Any], hashed: Mapping[str, str]) -> None:
    listed = {item["path"]: item["content_hash"] for item in manifest.get("artifacts") or []}
    if set(listed) != set(hashed):
        raise ValidationError(f"manifest artifact set mismatch: {sorted(set(listed) ^ set(hashed))}")
    for name, digest in hashed.items():
        if listed[name] != digest:
            raise ValidationError(f"manifest content_hash mismatch for {name}")


def schema_for(name: str, schema: Mapping[str, Any]) -> Mapping[str, Any]:
    defs = schema.get("$defs") or {}
    key = {"manifest.json": "manifest", "CLAUSE_MATRIX.json": "clauseMatrix", "LEGAL_RISK_REGISTER.json": "riskRegister"}[name]
    ref = defs.get(key)
    if not isinstance(ref, Mapping):
        raise ValidationError(f"schema missing $defs.{key}")
    return ref


def assert_schema_artifacts(pkg: Path) -> None:
    auth = _load_authority()
    schema = load_json(pkg / "commercial-legal-provisional.schema.json")
    for name in ("manifest.json", "CLAUSE_MATRIX.json", "LEGAL_RISK_REGISTER.json"):
        instance = load_json(pkg / name)
        try:
            auth.schema_validate(instance, schema_for(name, schema), schema)
        except auth.ValidationError as exc:
            raise ValidationError(f"{name}: {exc}") from exc
        if name != "manifest.json":
            assert_required_metadata(json.dumps(instance, ensure_ascii=False), source=name)


def legal_package_hash(manifest: Mapping[str, Any]) -> str:
    return content_hash_json(manifest)


def default_manifest(hashed: Mapping[str, str]) -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "package_id": PACKAGE_ID,
        "package_version": "provisional-v1",
        "status": "PROVISIONAL_AI_DRAFT",
        "professional_legal_review": "NOT_YET_PERFORMED",
        "operational_use": "HUMAN_DECISION_REQUIRED",
        "supersedable": True,
        "jurisdiction": "Brazil",
        "business_context": "B2B_ENGINEERING_CONSULTING",
        "offer_code": OFFER_CODE,
        "offer_amount_cents": OFFER_AMOUNT_CENTS,
        "billing_mode": "ONE_TIME",
        "catalog_terms_version_referenced": "CFG-TERMS-B2B-2026-08-17-v1",
        "does_not_reapprove_catalog_terms": True,
        "dpa_lite_applicable": False,
        "dpa_lite_path": None,
        "dpa_lite_reason": (
            "Diagnosis one-off treats B2B contact and client-supplied inputs as an independent "
            "controller activity. No processing-on-behalf relationship is established and no "
            "subprocessors are contracted or listed."
        ),
        "campaign_status": "PROVISIONAL_PACKAGE_READY_FOR_FOUNDER_DECISIONS",
        "production_checkout_enabled": False,
        "public_activation_approved": False,
        "real_money_mutation_approved": False,
        "legal_terms_forum_gate": "UNKNOWN",
        "checkout_authorized": False,
        "publication_authorized": False,
        "cobranca_authorized": False,
        "effective_at": EFFECTIVE_AT,
        "consumers": [
            {"id": "web-cfg#88", "role": "delivery_parent", "pin": "legal_package_hash"},
            {"id": "Warmbly#47", "role": "reconciliation_consumer", "pin": "legal_package_hash"},
        ],
        "unresolved_human_decisions": list(HUMAN_DECISION_IDS),
        "forbidden_statuses": sorted(FORBIDDEN_CAMPAIGN_STATUSES),
        "artifacts": [{"path": name, "content_hash": hashed[name]} for name in HASHED_FILES],
    }


def write_hashes(root: Path | None = None) -> dict[str, Any]:
    root = repo_root(root)
    pkg = legal_package_dir(root)
    pkg.mkdir(parents=True, exist_ok=True)
    sums = build_sha256sums_text(pkg)
    (pkg / "SHA256SUMS.txt").write_text(sums, encoding="utf-8")
    hashed = {name: hash_legal_file(pkg / name) for name in HASHED_FILES}
    manifest = default_manifest(hashed)
    (pkg / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return validate_legal_package(root)


def iter_package_texts(pkg: Path) -> Iterable[tuple[str, str]]:
    for path in sorted(pkg.rglob("*")):
        if path.is_file() and path.suffix in {".md", ".json", ".txt"}:
            yield str(path.relative_to(pkg)), load_text(path)


def validate_legal_dir(pkg: Path, *, root: Path | None = None) -> dict[str, Any]:
    if not pkg.is_dir():
        raise ValidationError(f"missing legal package directory {pkg}")
    root = root or repo_root(pkg)
    assert_required_files(pkg)
    for rel, text in iter_package_texts(pkg):
        assert_document_safe(text, source=rel)
        if rel == "SHA256SUMS.txt":
            assert_required_metadata(text, source=rel)
    terms = load_text(pkg / "TERMOS_B2B_DIAGNOSTICO.md")
    assert_terms_clauses(terms)
    assert_human_decisions_package(pkg)
    matrix = load_json(pkg / "CLAUSE_MATRIX.json")
    register = load_json(pkg / "LEGAL_RISK_REGISTER.json")
    manifest = load_json(pkg / "manifest.json")
    assert_clause_matrix(matrix, terms)
    assert_risk_register(register)
    assert_fail_closed_flags(manifest)
    assert_catalog_alignment(root, manifest)
    hashed = assert_sha256sums_match(pkg)
    assert_manifest_hashes(pkg, manifest, hashed)
    assert_schema_artifacts(pkg)
    digest = legal_package_hash(manifest)
    return {
        "root": str(root),
        "package": str(pkg),
        "authority_hash": digest,
        "campaign_status": manifest["campaign_status"],
        "offer_code": manifest["offer_code"],
        "offer_amount_cents": manifest["offer_amount_cents"],
        "unresolved_human_decisions": list(manifest["unresolved_human_decisions"]),
        "production_checkout_enabled": False,
        "public_activation_approved": False,
        "real_money_mutation_approved": False,
        "dpa_lite_applicable": False,
    }


def validate_legal_package(root: Path | None = None) -> dict[str, Any]:
    root = repo_root(root)
    return validate_legal_dir(legal_package_dir(root), root=root)


def mutate_package(pkg: Path, dest: Path) -> Path:
    """Copy the package tree for adversarial fixtures. Tests drive this helper."""
    import shutil

    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(pkg, dest)
    return dest


def reject_adversarial_text(text: str, *, kind: str, source: str = "fixture") -> None:
    """Reject a mutated document. Used by tests as the shipped adversarial entry."""
    if kind == "validated_claim":
        assert_no_forbidden_claims(text, source=source)
        return
    if kind == "hidden_review":
        if "NOT_YET_PERFORMED" not in text:
            raise ValidationError(f"{source}: hides missing professional review")
        return
    if kind == "resultado":
        assert_no_resultado_promise(text, source=source)
        return
    if kind == "cobranca":
        assert_no_checkout_authorization(text, source=source)
        return
    if kind == "extra":
        assert_no_extra_leak(text, source=source)
        return
    if kind == "invented_basis":
        assert_no_invented_legal_basis(text, source=source)
        return
    if kind == "filled_decision":
        assert_human_tokens_unresolved(text, source=source)
        return
    raise ValidationError(f"unknown adversarial kind {kind}")


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate CONFENGE provisional legal package")
    parser.add_argument("--write-hashes", action="store_true", help="rewrite SHA256SUMS and manifest hashes")
    parser.add_argument("--root", type=Path, default=None)
    args = parser.parse_args(list(argv) if argv is not None else None)
    try:
        result = write_hashes(args.root) if args.write_hashes else validate_legal_package(args.root)
    except ValidationError as exc:
        print(f"VALIDATION_ERROR {exc}", file=sys.stderr)
        return 1
    print(f"AUTHORITY_HASH {result['authority_hash']}")
    print(f"CAMPAIGN_STATUS {result['campaign_status']}")
    print(f"OFFER {result['offer_code']} {result['offer_amount_cents']}")
    print("PRODUCTION_CHECKOUT_ENABLED false")
    print("REAL_MONEY_MUTATION_APPROVED false")
    print("PUBLIC_ACTIVATION_APPROVED false")
    print("DPA_LITE_APPLICABLE false")
    print("LEGAL_TERMS_FORUM UNKNOWN")
    print("UNRESOLVED_DECISIONS " + ",".join(result["unresolved_human_decisions"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
