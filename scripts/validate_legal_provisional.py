#!/usr/bin/env python3
"""Validate the provisional and founder-decided B2B legal packages for CFG-DIAG-EXP-v1.

Shipped checker for commercial/legal/provisional-v1/ (frozen) and
commercial/legal/diagnostico-v1.1/ (founder-decided successor).
Not a legal opinion. Does not authorize checkout, publication, or real-money mutation.

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

SUCCESSOR_REL = Path("commercial") / "legal" / "diagnostico-v1.1"
SUCCESSOR_SCHEMA_VERSION = "commercial-legal-diagnostico.v1.1"
SUCCESSOR_PACKAGE_ID = "CFG-LEGAL-DIAG-EXP-v1.1"
SUCCESSOR_PACKAGE_VERSION = "diagnostico-v1.1"
SUCCESSOR_EFFECTIVE_AT = "2026-08-18T00:00:00Z"
FOUNDER_DECISION_DATE = "2026-08-18"
FOUNDER_DECIDED_BY = "founder"
SUCCESSOR_STATUS = "FOUNDER_DECIDED_DRAFT"
SUCCESSOR_OPERATIONAL_USE = "PRIVATE_NEGOTIATION_ONLY"

ALLOWED_CLASSIFICATION_STATUSES = frozenset(
    {
        "RESOLVED_BY_FOUNDER_BASELINE",
        "RESOLVED_BY_AUTHORITATIVE_ENTITY_DATA",
        "PENDING_NAMED_COUNSEL",
        "PENDING_NAMED_ACCOUNTANT",
        "PENDING_ENTITY_DOCUMENT",
        "PENDING_OPERATIONAL_INVENTORY",
    }
)
FOUNDER_COMMERCIAL_IDS = (
    "limite_responsabilidade",
    "politica_reembolso",
    "prazo_entrega",
    "dados_pessoais_tratados",
    "aceite_eletronico",
    "canal_suporte",
)
ENTITY_BOUND_IDS = ("razao_social_cnpj_contratante", "foro")
ACCOUNTANT_BOUND_IDS = ("responsavel_fiscal",)
COUNSEL_BOUND_IDS = ("retencao",)
EXPECTED_FOUNDER_STATUSES = {
    "razao_social_cnpj_contratante": "PENDING_ENTITY_DOCUMENT",
    "foro": "PENDING_ENTITY_DOCUMENT",
    "limite_responsabilidade": "RESOLVED_BY_FOUNDER_BASELINE",
    "politica_reembolso": "RESOLVED_BY_FOUNDER_BASELINE",
    "prazo_entrega": "RESOLVED_BY_FOUNDER_BASELINE",
    "dados_pessoais_tratados": "RESOLVED_BY_FOUNDER_BASELINE",
    "retencao": "PENDING_NAMED_COUNSEL",
    "responsavel_fiscal": "PENDING_NAMED_ACCOUNTANT",
    "aceite_eletronico": "RESOLVED_BY_FOUNDER_BASELINE",
    "canal_suporte": "RESOLVED_BY_FOUNDER_BASELINE",
}

SUCCESSOR_REQUIRED_METADATA = {
    "status": SUCCESSOR_STATUS,
    "professional_legal_review": "NOT_YET_PERFORMED",
    "operational_use": SUCCESSOR_OPERATIONAL_USE,
    "supersedable": "true",
    "jurisdiction": "Brazil",
    "business_context": "B2B_ENGINEERING_CONSULTING",
}
SUCCESSOR_ALLOWED_CAMPAIGN_STATUSES = frozenset(
    {
        "READY_FOR_PRIVATE_NEGOTIATION",
        "BLOCKED_MISSING_COMMERCIAL_AUTHORITY",
        "BLOCKED_CI",
        "BLOCKED_PROFESSIONAL_GATES",
    }
)
SUCCESSOR_REQUIRED_FILES = (
    "TERMOS_B2B_DIAGNOSTICO.md",
    "ORDEM_DE_SERVICO_DIAGNOSTICO.md",
    "POLITICA_CANCELAMENTO_REEMBOLSO.md",
    "AVISO_LIMITACOES_TECNICAS.md",
    "AVISO_PRIVACIDADE_LEADS.md",
    "LEGAL_RISK_REGISTER.json",
    "HUMAN_DECISIONS_REQUIRED.md",
    "FOUNDER_DECISIONS.md",
    "PROFESSIONAL_GATES.md",
    "LEGAL_COUNSEL_HANDOFF.md",
    "ACCOUNTANT_HANDOFF.md",
    "DECISION_CLASSIFICATION.json",
    "STATUS_FINAL.md",
    "CLAUSE_MATRIX.json",
    "commercial-legal-diagnostico.schema.json",
    "manifest.json",
    "SHA256SUMS.txt",
    "README.md",
)
SUCCESSOR_HASHED_FILES = (
    "TERMOS_B2B_DIAGNOSTICO.md",
    "ORDEM_DE_SERVICO_DIAGNOSTICO.md",
    "POLITICA_CANCELAMENTO_REEMBOLSO.md",
    "AVISO_LIMITACOES_TECNICAS.md",
    "AVISO_PRIVACIDADE_LEADS.md",
    "LEGAL_RISK_REGISTER.json",
    "HUMAN_DECISIONS_REQUIRED.md",
    "FOUNDER_DECISIONS.md",
    "PROFESSIONAL_GATES.md",
    "LEGAL_COUNSEL_HANDOFF.md",
    "ACCOUNTANT_HANDOFF.md",
    "DECISION_CLASSIFICATION.json",
    "STATUS_FINAL.md",
    "CLAUSE_MATRIX.json",
    "commercial-legal-diagnostico.schema.json",
    "README.md",
    "CONSUMER_HANDOFF.md",
)
SUCCESSOR_REQUIRED_TERMS_PHRASES = (
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
    "FOUNDER_BASELINE: limite_responsabilidade",
    "valor efetivamente pago na OS afetada",
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
    "FOUNDER_BASELINE: canal_suporte",
    "tiago.sasaki@confenge.com.br",
    "não institui arbitragem",
    "HUMAN_DECISION_REQUIRED: foro",
    "supersedable = true",
    "Ordem de Serviço ou proposta aceita",
    "FOUNDER_BASELINE: aceite_eletronico",
    "checkout/callback sozinho não prova aceite",
    "FOUNDER_BASELINE: politica_reembolso",
    "FOUNDER_BASELINE: prazo_entrega",
    "FOUNDER_BASELINE: dados_pessoais_tratados",
    "HUMAN_DECISION_REQUIRED: razao_social_cnpj_contratante",
    "HUMAN_DECISION_REQUIRED: retencao",
    "HUMAN_DECISION_REQUIRED: responsavel_fiscal",
)
FOUNDER_BASELINE_PHRASES = {
    "limite_responsabilidade": (
        "valor efetivamente pago na OS afetada",
        "dolo",
        "fraude",
        "LGPD",
    ),
    "politica_reembolso": (
        "cobrança indevida",
        "devolução integral",
        "trabalho demonstravelmente executado",
        "saldo positivo",
        "reembolso automático integral",
    ),
    "prazo_entrega": ("10", "15", "dias úteis"),
    "dados_pessoais_tratados": (
        "contato corporativo",
        "não solicitar dado sensível por padrão",
    ),
    "aceite_eletronico": (
        "terms_version",
        "scope_version",
        "cópia durável",
        "não prova aceite",
    ),
    "canal_suporte": ("tiago.sasaki@confenge.com.br",),
}
COUNSEL_REQUIRED_TOPICS = (
    "identidade",
    "foro",
    "teto",
    "reembolso",
    "aceite eletrônico",
    "LGPD",
    "reten",
)
COUNSEL_FORBIDDEN_TOPICS = ("fator R", "RBT12", "Anexo")
ACCOUNTANT_REQUIRED_TOPICS = (
    "CNPJ",
    "CNAE",
    "Anexo",
    "fator R",
    "RBT12",
    "ISS",
    "NFS-e",
    "margem",
)
FORBIDDEN_ACCEPTANCE_PHRASES = (
    "checkout prova aceite",
    "callback prova aceite",
    "callback constitui aceite",
    "checkout constitui aceite",
    "o clique no checkout é aceite",
    "checkout/callback sozinho prova aceite",
)
STATUS_FINAL_REQUIRED = (
    "READY_FOR_PRIVATE_NEGOTIATION",
    "NOT_LEGAL_APPROVED",
    "NOT_TAX_APPROVED",
    "NOT_CHECKOUT_AUTHORIZED",
)
FORBIDDEN_ONLINE_SALE_PHRASES = (
    "pronto para vender online",
    "ready to sell online",
)

_SUCCESSOR_SHA256SUMS_HEADER = """# status=FOUNDER_DECIDED_DRAFT
# professional_legal_review=NOT_YET_PERFORMED
# operational_use=PRIVATE_NEGOTIATION_ONLY
# supersedable=true
# jurisdiction=Brazil
# business_context=B2B_ENGINEERING_CONSULTING
# hashed_with=scripts/validate_legal_provisional.py
# prior_package=provisional-v1
"""

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


def founder_baseline_token(decision_id: str) -> str:
    return f"[[FOUNDER_BASELINE: {decision_id}]]"


def successor_package_dir(root: Path | None = None) -> Path:
    return repo_root(root) / SUCCESSOR_REL


def pending_decision_ids(classification: Mapping[str, Any]) -> list[str]:
    return [
        item["id"]
        for item in classification.get("decisions") or ()
        if str(item.get("status", "")).startswith("PENDING_")
    ]


def founder_resolved_ids(classification: Mapping[str, Any]) -> list[str]:
    return [
        item["id"]
        for item in classification.get("decisions") or ()
        if str(item.get("status", "")).startswith("RESOLVED_BY_")
    ]


def checkout_or_publication_permitted(
    manifest: Mapping[str, Any], classification: Mapping[str, Any]
) -> bool:
    """Fail-closed: pending professional gates, or any live flag, block activation."""
    if pending_decision_ids(classification):
        return False
    if manifest.get("professional_legal_review") != "APPROVED_BY_NAMED_COUNSEL":
        return False
    live_flags = (
        "checkout_authorized",
        "publication_authorized",
        "production_checkout_enabled",
        "cobranca_authorized",
        "public_activation_approved",
        "real_money_mutation_approved",
    )
    if any(manifest.get(flag) is True for flag in live_flags):
        return False
    if manifest.get("campaign_status") in FORBIDDEN_CAMPAIGN_STATUSES:
        return False
    return False


def assert_pending_gates_block_activation(
    manifest: Mapping[str, Any], classification: Mapping[str, Any]
) -> None:
    pending = pending_decision_ids(classification)
    live_flags = (
        "checkout_authorized",
        "publication_authorized",
        "production_checkout_enabled",
        "cobranca_authorized",
        "public_activation_approved",
        "real_money_mutation_approved",
    )
    if pending:
        for flag in live_flags:
            if manifest.get(flag) is True:
                raise ValidationError(
                    f"{flag} cannot be true while professional gate pending: {pending}"
                )
    if checkout_or_publication_permitted(manifest, classification):
        raise ValidationError("checkout/publication cannot be permitted in this campaign")
    for flag in live_flags:
        if manifest.get(flag) is True:
            raise ValidationError(f"{flag} must stay false")


def assert_checkout_is_not_acceptance(text: str, *, source: str) -> None:
    lowered = text.lower()
    for phrase in FORBIDDEN_ACCEPTANCE_PHRASES:
        if phrase in lowered:
            raise ValidationError(f"{source}: checkout/callback counted as aceite ({phrase!r})")
    needles = (
        "não prova aceite",
        "nao prova aceite",
        "não são aceite",
        "não é aceite",
        "não contam como aceite",
        "sozinho não prova aceite",
        "sozinhos não provam",
    )
    if not any(item in lowered for item in needles):
        raise ValidationError(f"{source}: missing explicit statement that checkout/callback is not aceite")


def assert_no_invented_entity_fills(text: str, *, source: str) -> None:
    for pattern in FILLED_DECISION_PATTERNS:
        if pattern.search(text):
            raise ValidationError(f"{source}: invented entity/numeric fill {pattern.pattern!r}")


def assert_successor_metadata(text: str, *, source: str) -> None:
    blob = _metadata_blob(text)
    compact = blob.replace(" ", "").replace('"', "").replace("'", "")
    for key, value in SUCCESSOR_REQUIRED_METADATA.items():
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


def assert_successor_document_safe(text: str, *, source: str) -> None:
    assert_successor_metadata(text, source=source)
    assert_no_forbidden_claims(text, source=source)
    assert_no_resultado_promise(text, source=source)
    assert_no_checkout_authorization(text, source=source)
    assert_no_extra_leak(text, source=source)
    assert_no_invented_legal_basis(text, source=source)
    assert_no_invented_entity_fills(text, source=source)
    if any(phrase in text.lower() for phrase in FORBIDDEN_ONLINE_SALE_PHRASES):
        raise ValidationError(f"{source}: must not claim ready to sell online")


def assert_classification(classification: Mapping[str, Any]) -> None:
    if classification.get("artifact") != "decision_classification":
        raise ValidationError("classification artifact id mismatch")
    if classification.get("legal_approved") is not False:
        raise ValidationError("classification must not set legal_approved")
    if classification.get("tax_approved") is not False:
        raise ValidationError("classification must not set tax_approved")
    if classification.get("checkout_authorized") is not False:
        raise ValidationError("classification must not set checkout_authorized")
    decisions = classification.get("decisions") or []
    seen = [item.get("id") for item in decisions]
    if sorted(seen) != sorted(HUMAN_DECISION_IDS):
        raise ValidationError(f"classification must cover the ten ids exactly: {seen}")
    if len(seen) != len(set(seen)):
        raise ValidationError("duplicate decision id in classification")
    for item in decisions:
        status = item.get("status")
        if status not in ALLOWED_CLASSIFICATION_STATUSES:
            raise ValidationError(f"{item.get('id')}: illegal classification status {status!r}")
        if status == "LEGAL_APPROVED" or item.get("legal_approved") is True:
            raise ValidationError(f"{item.get('id')}: founder fill must not be labeled LEGAL_APPROVED")
        if not item.get("owner") or not item.get("required_evidence") or not item.get("professional_owner"):
            raise ValidationError(f"{item.get('id')}: missing owner/evidence")
        expected = EXPECTED_FOUNDER_STATUSES[item["id"]]
        if status != expected:
            raise ValidationError(f"{item['id']}: expected {expected}, got {status}")
        if item["id"] in ENTITY_BOUND_IDS and status == "RESOLVED_BY_AUTHORITATIVE_ENTITY_DATA":
            raise ValidationError(
                f"{item['id']}: entity data cannot be inlined in this repository; keep PENDING_ENTITY_DOCUMENT"
            )
        if item["id"] in FOUNDER_COMMERCIAL_IDS and status != "RESOLVED_BY_FOUNDER_BASELINE":
            raise ValidationError(f"{item['id']}: founder commercial decision must be RESOLVED_BY_FOUNDER_BASELINE")
        if item["id"] in ACCOUNTANT_BOUND_IDS and status != "PENDING_NAMED_ACCOUNTANT":
            raise ValidationError(f"{item['id']}: accountant-bound id must stay PENDING_NAMED_ACCOUNTANT")
        if item["id"] in COUNSEL_BOUND_IDS and status != "PENDING_NAMED_COUNSEL":
            raise ValidationError(f"{item['id']}: retention must stay PENDING_NAMED_COUNSEL")


def assert_successor_tokens(pkg: Path, classification: Mapping[str, Any]) -> None:
    corpus = []
    for path in pkg.iterdir():
        if path.is_file() and path.suffix in {".md", ".json", ".txt"}:
            corpus.append(path.read_text(encoding="utf-8"))
    joined = "\n".join(corpus)
    terms = load_text(pkg / "TERMOS_B2B_DIAGNOSTICO.md")
    human = load_text(pkg / "HUMAN_DECISIONS_REQUIRED.md")
    founder = load_text(pkg / "FOUNDER_DECISIONS.md")
    for item in classification["decisions"]:
        decision_id = item["id"]
        status = item["status"]
        if status.startswith("PENDING_"):
            token = human_decision_token(decision_id)
            if token not in joined:
                raise ValidationError(f"pending decision missing token {token}")
            if token not in terms or token not in human:
                raise ValidationError(f"{decision_id}: pending token must remain in terms and HUMAN_DECISIONS")
        elif status.startswith("RESOLVED_BY_"):
            token = founder_baseline_token(decision_id)
            if token not in joined:
                raise ValidationError(f"founder-resolved decision missing token {token}")
            if human_decision_token(decision_id) in terms:
                raise ValidationError(f"{decision_id}: HUMAN_DECISION token must not remain in terms after founder baseline")
            if token not in terms or token not in founder or token not in human:
                raise ValidationError(f"{decision_id}: FOUNDER_BASELINE token missing from terms/founder/human docs")
            for phrase in FOUNDER_BASELINE_PHRASES.get(decision_id, ()):
                if phrase.lower() not in founder.lower() and phrase not in founder:
                    raise ValidationError(f"FOUNDER_DECISIONS.md missing baseline phrase for {decision_id}: {phrase!r}")
                if phrase.lower() not in terms.lower() and phrase not in terms:
                    raise ValidationError(f"terms missing baseline phrase for {decision_id}: {phrase!r}")


def assert_successor_terms_clauses(terms: str) -> None:
    for clause_id in REQUIRED_CLAUSE_IDS:
        marker = f"**clause_id:** `{clause_id}`"
        if marker not in terms:
            raise ValidationError(f"successor terms missing clause marker {clause_id}")
    for phrase in SUCCESSOR_REQUIRED_TERMS_PHRASES:
        if phrase.lower() not in terms.lower() and phrase not in terms:
            raise ValidationError(f"successor terms missing required phrase: {phrase!r}")


def assert_successor_clause_matrix(matrix: Mapping[str, Any], terms: str) -> None:
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
        if item.get("state") != SUCCESSOR_STATUS:
            raise ValidationError(f"clause {item.get('clause_id')} state must stay {SUCCESSOR_STATUS}")
        if not isinstance(item.get("consumer"), list) or not item["consumer"]:
            raise ValidationError(f"clause {item.get('clause_id')} consumer must be a non-empty list")
        marker = f"**clause_id:** `{item['clause_id']}`"
        if marker not in terms:
            raise ValidationError(f"clause matrix id {item['clause_id']} not present in terms")


def assert_handoff_topics(pkg: Path) -> None:
    counsel = load_text(pkg / "LEGAL_COUNSEL_HANDOFF.md")
    accountant = load_text(pkg / "ACCOUNTANT_HANDOFF.md")
    for topic in COUNSEL_REQUIRED_TOPICS:
        if topic.lower() not in counsel.lower():
            raise ValidationError(f"counsel handoff missing topic {topic!r}")
    for topic in COUNSEL_FORBIDDEN_TOPICS:
        if topic.lower() in counsel.lower():
            raise ValidationError(f"counsel handoff must not carry accountant topic {topic!r}")
    for topic in ACCOUNTANT_REQUIRED_TOPICS:
        if topic.lower() not in accountant.lower():
            raise ValidationError(f"accountant handoff missing topic {topic!r}")
    if "teto de responsabilidade" in accountant.lower() and "não pede opinião sobre teto" not in accountant.lower():
        raise ValidationError("accountant handoff must not litigate liability ceiling")


def assert_status_final(text: str) -> None:
    for phrase in STATUS_FINAL_REQUIRED:
        if phrase not in text:
            raise ValidationError(f"STATUS_FINAL missing {phrase}")
    for phrase in FORBIDDEN_ONLINE_SALE_PHRASES:
        if phrase in text.lower():
            raise ValidationError("STATUS_FINAL must not say ready to sell online")
    if "LEGAL_APPROVED" in text and "NOT_LEGAL_APPROVED" not in text:
        raise ValidationError("STATUS_FINAL must not claim LEGAL_APPROVED")


def assert_successor_fail_closed(
    manifest: Mapping[str, Any], classification: Mapping[str, Any]
) -> None:
    expected = {
        "production_checkout_enabled": False,
        "public_activation_approved": False,
        "real_money_mutation_approved": False,
        "checkout_authorized": False,
        "publication_authorized": False,
        "cobranca_authorized": False,
        "dpa_lite_applicable": False,
        "does_not_reapprove_catalog_terms": True,
    }
    for key, value in expected.items():
        if manifest.get(key) != value:
            raise ValidationError(f"successor manifest flag {key} must be {value!r}")
    if manifest.get("legal_terms_forum_gate") != "UNKNOWN":
        raise ValidationError("successor legal_terms_forum_gate must remain UNKNOWN")
    status = manifest.get("campaign_status")
    if status not in SUCCESSOR_ALLOWED_CAMPAIGN_STATUSES:
        raise ValidationError(f"illegal successor campaign status {status!r}")
    if status in FORBIDDEN_CAMPAIGN_STATUSES:
        raise ValidationError(f"forbidden campaign status {status!r}")
    if set(manifest.get("forbidden_statuses") or []) != FORBIDDEN_CAMPAIGN_STATUSES:
        raise ValidationError("successor manifest must list the three forbidden statuses")
    pending = pending_decision_ids(classification)
    unresolved = list(manifest.get("unresolved_human_decisions") or [])
    remaining = list(manifest.get("remaining_pending_decisions") or [])
    if sorted(unresolved) != sorted(pending) or sorted(remaining) != sorted(pending):
        raise ValidationError("successor pending-decision lists must match classification PENDING_* ids")
    if manifest.get("dpa_lite_path") is not None:
        raise ValidationError("dpa_lite_path must be null when not applicable")
    if not manifest.get("dpa_lite_reason"):
        raise ValidationError("dpa_lite_reason must record non-applicability")
    if manifest.get("offer_code") != OFFER_CODE or manifest.get("offer_amount_cents") != OFFER_AMOUNT_CENTS:
        raise ValidationError("successor manifest must pin CFG-DIAG-EXP-v1 at 800000 centavos")
    if manifest.get("billing_mode") != "ONE_TIME":
        raise ValidationError("successor billing_mode must be ONE_TIME")
    if manifest.get("package_version") != SUCCESSOR_PACKAGE_VERSION:
        raise ValidationError("successor package_version mismatch")
    if manifest.get("prior_package_version") != "provisional-v1":
        raise ValidationError("successor must point at provisional-v1")
    if not manifest.get("invalidation_rule"):
        raise ValidationError("successor must declare invalidation_rule")
    if manifest.get("founder_decided_by") != FOUNDER_DECIDED_BY:
        raise ValidationError("founder_decided_by must be founder")
    assert_pending_gates_block_activation(manifest, classification)


def assert_successor_required_files(pkg: Path) -> None:
    missing = [name for name in SUCCESSOR_REQUIRED_FILES if not (pkg / name).is_file()]
    if missing:
        raise ValidationError(f"missing required successor artifacts: {missing}")
    if (pkg / DPA_FILENAME).is_file():
        raise ValidationError(
            f"{DPA_FILENAME} must not exist unless processing-on-behalf is in scope; "
            "this diagnosis package records non-applicability and invents no subprocessors"
        )


def build_successor_sha256sums_text(pkg: Path) -> str:
    lines = [_SUCCESSOR_SHA256SUMS_HEADER.rstrip(), ""]
    for name in SUCCESSOR_HASHED_FILES:
        digest = hash_legal_file_hex(pkg / name)
        lines.append(f"{digest}  {name}")
    return "\n".join(lines) + "\n"


def assert_successor_sha256sums_match(pkg: Path) -> dict[str, str]:
    listed = parse_sha256sums(load_text(pkg / "SHA256SUMS.txt"))
    expected = {name: hash_legal_file_hex(pkg / name) for name in SUCCESSOR_HASHED_FILES}
    if set(listed) != set(expected):
        raise ValidationError(f"successor SHA256SUMS file set mismatch: {sorted(set(listed) ^ set(expected))}")
    for name, digest in expected.items():
        if listed[name] != digest:
            raise ValidationError(f"successor SHA256SUMS mismatch for {name}")
    return {name: f"sha256:{digest}" for name, digest in expected.items()}


def successor_schema_for(name: str, schema: Mapping[str, Any]) -> Mapping[str, Any]:
    defs = schema.get("$defs") or {}
    key = {
        "manifest.json": "manifest",
        "CLAUSE_MATRIX.json": "clauseMatrix",
        "LEGAL_RISK_REGISTER.json": "riskRegister",
        "DECISION_CLASSIFICATION.json": "decisionClassification",
    }[name]
    ref = defs.get(key)
    if not isinstance(ref, Mapping):
        raise ValidationError(f"successor schema missing $defs.{key}")
    return ref


def assert_successor_schema_artifacts(pkg: Path) -> None:
    auth = _load_authority()
    schema = load_json(pkg / "commercial-legal-diagnostico.schema.json")
    for name in (
        "manifest.json",
        "CLAUSE_MATRIX.json",
        "LEGAL_RISK_REGISTER.json",
        "DECISION_CLASSIFICATION.json",
    ):
        instance = load_json(pkg / name)
        try:
            auth.schema_validate(instance, successor_schema_for(name, schema), schema)
        except auth.ValidationError as exc:
            raise ValidationError(f"{name}: {exc}") from exc


def default_successor_manifest(hashed: Mapping[str, str], prior_hash: str) -> dict[str, Any]:
    pending = [
        decision_id
        for decision_id, status in EXPECTED_FOUNDER_STATUSES.items()
        if status.startswith("PENDING_")
    ]
    return {
        "schema_version": SUCCESSOR_SCHEMA_VERSION,
        "package_id": SUCCESSOR_PACKAGE_ID,
        "package_version": SUCCESSOR_PACKAGE_VERSION,
        "status": SUCCESSOR_STATUS,
        "professional_legal_review": "NOT_YET_PERFORMED",
        "operational_use": SUCCESSOR_OPERATIONAL_USE,
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
        "campaign_status": "READY_FOR_PRIVATE_NEGOTIATION",
        "production_checkout_enabled": False,
        "public_activation_approved": False,
        "real_money_mutation_approved": False,
        "legal_terms_forum_gate": "UNKNOWN",
        "checkout_authorized": False,
        "publication_authorized": False,
        "cobranca_authorized": False,
        "effective_at": SUCCESSOR_EFFECTIVE_AT,
        "prior_package_id": PACKAGE_ID,
        "prior_package_version": "provisional-v1",
        "prior_package_hash": prior_hash,
        "founder_decided_by": FOUNDER_DECIDED_BY,
        "founder_decided_at": FOUNDER_DECISION_DATE,
        "invalidation_rule": (
            "Any material edit of diagnostico-v1.1 requires a new package_version and a new hash. "
            "An already-accepted prior contract pinned to provisional-v1 is not rewritten. "
            "LEGAL_APPROVED, TAX_APPROVED, PRODUCTION_AUTHORIZED and CHECKOUT_AUTHORIZED are never "
            "implied by a founder baseline."
        ),
        "consumers": [
            {"id": "web-cfg#88", "role": "delivery_parent", "pin": "founder_decided_hash"},
            {"id": "Warmbly#47", "role": "reconciliation_consumer", "pin": "founder_decided_hash"},
        ],
        "unresolved_human_decisions": pending,
        "remaining_pending_decisions": pending,
        "forbidden_statuses": sorted(FORBIDDEN_CAMPAIGN_STATUSES),
        "artifacts": [{"path": name, "content_hash": hashed[name]} for name in SUCCESSOR_HASHED_FILES],
    }


def assert_prior_package_immutable(root: Path, prior_hash: str) -> None:
    pkg = legal_package_dir(root)
    hashed = {name: hash_legal_file(pkg / name) for name in HASHED_FILES}
    listed = assert_sha256sums_match(pkg)
    if hashed != listed:
        raise ValidationError("provisional-v1 hashes drifted while validating successor")
    manifest = load_json(pkg / "manifest.json")
    current = legal_package_hash(manifest)
    if current != prior_hash:
        raise ValidationError("successor path mutated the prior package hash")


def validate_founder_decided_dir(pkg: Path, *, root: Path | None = None) -> dict[str, Any]:
    if not pkg.is_dir():
        raise ValidationError(f"missing successor legal package directory {pkg}")
    root = root or repo_root(pkg)
    assert_successor_required_files(pkg)
    for rel, text in iter_package_texts(pkg):
        assert_successor_document_safe(text, source=rel)
    terms = load_text(pkg / "TERMOS_B2B_DIAGNOSTICO.md")
    assert_successor_terms_clauses(terms)
    assert_checkout_is_not_acceptance(terms, source="TERMOS_B2B_DIAGNOSTICO.md")
    assert_checkout_is_not_acceptance(load_text(pkg / "ORDEM_DE_SERVICO_DIAGNOSTICO.md"), source="ORDEM_DE_SERVICO_DIAGNOSTICO.md")
    assert_checkout_is_not_acceptance(load_text(pkg / "FOUNDER_DECISIONS.md"), source="FOUNDER_DECISIONS.md")
    classification = load_json(pkg / "DECISION_CLASSIFICATION.json")
    assert_classification(classification)
    assert_successor_tokens(pkg, classification)
    assert_handoff_topics(pkg)
    assert_status_final(load_text(pkg / "STATUS_FINAL.md"))
    matrix = load_json(pkg / "CLAUSE_MATRIX.json")
    register = load_json(pkg / "LEGAL_RISK_REGISTER.json")
    manifest = load_json(pkg / "manifest.json")
    assert_successor_clause_matrix(matrix, terms)
    assert_risk_register(register)
    assert_successor_fail_closed(manifest, classification)
    assert_catalog_alignment(root, manifest)
    hashed = assert_successor_sha256sums_match(pkg)
    assert_manifest_hashes(pkg, manifest, hashed)
    assert_successor_schema_artifacts(pkg)
    prior = validate_legal_package(root)
    if manifest.get("prior_package_hash") != prior["authority_hash"]:
        raise ValidationError("successor prior_package_hash does not match frozen provisional hash")
    assert_prior_package_immutable(root, prior["authority_hash"])
    digest = legal_package_hash(manifest)
    return {
        "root": str(root),
        "package": str(pkg),
        "authority_hash": digest,
        "prior_package_hash": prior["authority_hash"],
        "campaign_status": manifest["campaign_status"],
        "offer_code": manifest["offer_code"],
        "offer_amount_cents": manifest["offer_amount_cents"],
        "unresolved_human_decisions": list(manifest["unresolved_human_decisions"]),
        "remaining_pending_decisions": list(manifest["remaining_pending_decisions"]),
        "production_checkout_enabled": False,
        "public_activation_approved": False,
        "real_money_mutation_approved": False,
        "dpa_lite_applicable": False,
        "checkout_or_publication_permitted": checkout_or_publication_permitted(manifest, classification),
    }


def validate_founder_decided_package(root: Path | None = None) -> dict[str, Any]:
    root = repo_root(root)
    return validate_founder_decided_dir(successor_package_dir(root), root=root)


def validate_all_legal_packages(root: Path | None = None) -> dict[str, Any]:
    root = repo_root(root)
    prior = validate_legal_package(root)
    successor = validate_founder_decided_package(root)
    if successor["prior_package_hash"] != prior["authority_hash"]:
        raise ValidationError("successor prior_package_hash does not match frozen provisional hash")
    prior_again = validate_legal_package(root)
    if prior_again["authority_hash"] != prior["authority_hash"]:
        raise ValidationError("successor validation mutated prior package")
    return {
        "root": str(root),
        "authority_hash": prior["authority_hash"],
        "prior_package_hash": prior["authority_hash"],
        "founder_decided_hash": successor["authority_hash"],
        "campaign_status": successor["campaign_status"],
        "offer_code": successor["offer_code"],
        "offer_amount_cents": successor["offer_amount_cents"],
        "unresolved_human_decisions": successor["unresolved_human_decisions"],
        "production_checkout_enabled": False,
        "public_activation_approved": False,
        "real_money_mutation_approved": False,
        "dpa_lite_applicable": False,
    }


def write_hashes(root: Path | None = None) -> dict[str, Any]:
    """Rewrite successor SHA256SUMS/manifest only. Never mutates provisional-v1."""
    root = repo_root(root)
    prior = validate_legal_package(root)
    pkg = successor_package_dir(root)
    pkg.mkdir(parents=True, exist_ok=True)
    sums = build_successor_sha256sums_text(pkg)
    (pkg / "SHA256SUMS.txt").write_text(sums, encoding="utf-8")
    hashed = {name: hash_legal_file(pkg / name) for name in SUCCESSOR_HASHED_FILES}
    manifest = default_successor_manifest(hashed, prior["authority_hash"])
    (pkg / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    assert_prior_package_immutable(root, prior["authority_hash"])
    return validate_all_legal_packages(root)


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
    if kind == "invented_entity":
        assert_no_invented_entity_fills(text, source=source)
        return
    if kind == "checkout_as_aceite":
        assert_checkout_is_not_acceptance(text, source=source)
        return
    raise ValidationError(f"unknown adversarial kind {kind}")


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate CONFENGE provisional legal package")
    parser.add_argument("--write-hashes", action="store_true", help="rewrite SHA256SUMS and manifest hashes")
    parser.add_argument("--root", type=Path, default=None)
    args = parser.parse_args(list(argv) if argv is not None else None)
    try:
        result = write_hashes(args.root) if args.write_hashes else validate_all_legal_packages(args.root)
    except ValidationError as exc:
        print(f"VALIDATION_ERROR {exc}", file=sys.stderr)
        return 1
    print(f"AUTHORITY_HASH {result['authority_hash']}")
    print(f"FOUNDER_DECIDED_HASH {result['founder_decided_hash']}")
    print(f"CAMPAIGN_STATUS {result['campaign_status']}")
    print(f"OFFER {result['offer_code']} {result['offer_amount_cents']}")
    print("PRODUCTION_CHECKOUT_ENABLED false")
    print("REAL_MONEY_MUTATION_APPROVED false")
    print("PUBLIC_ACTIVATION_APPROVED false")
    print("DPA_LITE_APPLICABLE false")
    print("LEGAL_TERMS_FORUM UNKNOWN")
    print("UNRESOLVED_DECISIONS " + ",".join(result["unresolved_human_decisions"]))
    print("NOT_LEGAL_APPROVED")
    print("NOT_TAX_APPROVED")
    print("NOT_CHECKOUT_AUTHORIZED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
