#!/usr/bin/env python3
"""Validate the founder-approved limited-production legal package.

Shipped checker for commercial/legal/founder-approved-v1/.
Not a legal opinion. Does not claim LEGAL_APPROVED.

Usage:
    python scripts/validate_legal_founder_approved.py
    python scripts/validate_legal_founder_approved.py --write-hashes
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import re
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable, Mapping


PACKAGE_REL = Path("commercial") / "legal" / "founder-approved-v1"
SCHEMA_VERSION = "commercial-legal-founder-approved.v1"
PACKAGE_ID = "CFG-LEGAL-DIAG-EXP-FOUNDER-v1"
PACKAGE_VERSION = "founder-approved-v1"
OFFER_CODE = "CFG-DIAG-EXP-v1"
OFFER_AMOUNT_CENTS = 800000
DECISION_TOKEN = "FOUNDER_APPROVED_WITH_DEFERRED_COUNSEL_REVIEW_2026_08_18"
STATUS = "FOUNDER_APPROVED_LIMITED_PRODUCTION"
REVIEW = "DEFERRED_UNTIL_FIRST_REVENUE"
DECIDER = "Tiago Jun Sasaki"
DECIDED_AT = "2026-08-18"
TIMEZONE = "America/Sao_Paulo"
LEGAL_NAME = "CONFENGE SERVICOS DE DESENHOS TECNICOS LTDA"
CNPJ = "52.407.089/0001-09"
FORUM = "Foro da Comarca de Florianópolis, Estado de Santa Catarina"
REFUND_FORMULA = "refund_due = max(0, amount_received - earned_milestones - preapproved_nonrecoverable_third_party_costs)"
MILESTONE_PERCENTS = {"M0": 0, "M1": 15, "M2": 40, "M3": 75, "M4": 90, "M5": 100}

REQUIRED_METADATA = {
    "status": STATUS,
    "professional_legal_review": REVIEW,
    "founder_risk_acceptance": "APPROVED",
    "supersedable": "true",
    "jurisdiction": "Brazil",
    "business_context": "B2B_ENGINEERING_CONSULTING",
}

REQUIRED_FILES = (
    "README.md",
    "TERMOS_B2B_DIAGNOSTICO.md",
    "ORDEM_DE_SERVICO_DIAGNOSTICO.md",
    "POLITICA_CANCELAMENTO_REEMBOLSO.md",
    "AVISO_LIMITACOES_TECNICAS.md",
    "AVISO_PRIVACIDADE_LEADS.md",
    "RETENTION_SCHEDULE.json",
    "ELECTRONIC_ACCEPTANCE_SPEC.json",
    "INCIDENT_RESPONSE_MINIMUM.md",
    "ADVERSARIAL_REVIEW.md",
    "ADVERSARIAL_FINDINGS.json",
    "LEGAL_RISK_REGISTER.json",
    "CLAUSE_MATRIX.json",
    "FOUNDER_RISK_ACCEPTANCE.md",
    "FOUNDER_RISK_ACCEPTANCE.json",
    "CONSUMER_HANDOFF.md",
    "PUBLICATION_SUMMARY.md",
    "SOURCE_MANIFEST.json",
    "commercial-legal-founder-approved.schema.json",
    "manifest.json",
    "SHA256SUMS.txt",
)

HASHED_FILES = tuple(name for name in REQUIRED_FILES if name not in {"manifest.json", "SHA256SUMS.txt"})

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

REQUIRED_TERMS_PHRASES = (
    "pessoa jurídica ou empresário",
    "obrigação é de **meio**",
    "mapa de compradores",
    "15** concorrentes",
    "insumos obrigatórios",
    LEGAL_NAME,
    CNPJ,
    FORUM,
    "até 15 dias úteis",
    "confirmação financeira",
    "NFS-e",
    "aceite eletrônico",
    REFUND_FORMULA,
    "800000",
    "tiago.sasaki@confenge.com.br",
    "+55 48 98834-4559",
    DECISION_TOKEN,
    "DEFERRED_UNTIL_FIRST_REVENUE",
    "não substitui advogado",
    "não substitui contador",
    "não exerce representação jurídica",
    "ausência de garantia de resultado",
    "direitos cogentes",
    "OTP ou magic link",
    "CREDIT_CARD",
    "canal de privacidade",
)

FORBIDDEN_CLAIM_PHRASES = (
    "LEGAL_APPROVED",
    "COUNSEL_REVIEWED",
    "LAWYER_APPROVED",
    "parecer jurídico",
    "conformidade jurídica garantida",
    "ausência de risco",
    "inaplicabilidade absoluta do CDC",
    "aprovado pelo jurídico",
    "juridicamente validado",
)

FORBIDDEN_WORDS = (
    re.compile(r"(?<![A-Za-zÁ-ú])parecer(?![A-Za-zÁ-ú])", re.I),
    re.compile(r"(?<![A-Za-zÁ-ú])encarregado(?![A-Za-zÁ-ú])", re.I),
    re.compile(r"\bDPO\b"),
)

EXTRA_LEAK_MARKERS = (
    "HISTORICAL_LIGHTHOUSE",
    "CFG-EXC-EXTRA",
    "EXTRA-HISTORICAL",
    "extra-historical",
    "1000000 cents/month",
    "R$ 10.000/mês por seis",
    "R$ 10.000/month",
    "R$ 10 mil",
)

HUMAN_DECISION_RE = re.compile(r"HUMAN_DECISION_REQUIRED")

PRIMARY_SOURCE_URLS = (
    "https://www.planalto.gov.br/ccivil_03/leis/2002/l10406compilada.htm",
    "https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm",
    "https://www.planalto.gov.br/ccivil_03/mpv/antigas_2001/2200-2.htm",
    "https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2020/lei/l14063.htm",
    "https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2015/lei/l13105.htm",
    "https://www.gov.br/anpd/",
    "https://www.stj.jus.br/",
    "https://docs.asaas.com/",
)

_SHA256SUMS_HEADER = f"""# status={STATUS}
# professional_legal_review={REVIEW}
# founder_risk_acceptance=APPROVED
# supersedable=true
# jurisdiction=Brazil
# business_context=B2B_ENGINEERING_CONSULTING
# hashed_with=scripts/validate_legal_founder_approved.py
# decision_token={DECISION_TOKEN}
"""


class ValidationError(Exception):
    """Fail-closed founder-approved legal-package error."""


def _load_authority():
    path = Path(__file__).resolve().parent / "validate_commercial_authority.py"
    spec = importlib.util.spec_from_file_location("validate_commercial_authority", path)
    if spec is None or spec.loader is None:
        raise ValidationError("cannot load commercial authority validator")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _load_provisional():
    path = Path(__file__).resolve().parent / "validate_legal_provisional.py"
    spec = importlib.util.spec_from_file_location("validate_legal_provisional", path)
    if spec is None or spec.loader is None:
        raise ValidationError("cannot load provisional validator")
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


def package_dir(root: Path | None = None) -> Path:
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


def hash_legal_file(path: Path) -> str:
    if not path.is_file():
        raise ValidationError(f"missing artifact {path.name}")
    if path.suffix == ".json":
        return content_hash_json(load_json(path))
    return content_hash_text(load_text(path))


def hash_legal_file_hex(path: Path) -> str:
    return hash_legal_file(path).removeprefix("sha256:")


def legal_package_hash(manifest: Mapping[str, Any]) -> str:
    return content_hash_json(manifest)


def refund_due(
    amount_received: int,
    earned_percent: int,
    preapproved_nonrecoverable_third_party_costs: int = 0,
) -> int:
    """Shipped refund math. Tests must call this function."""
    if amount_received < 0 or earned_percent < 0 or earned_percent > 100:
        raise ValidationError("invalid refund inputs")
    if preapproved_nonrecoverable_third_party_costs < 0:
        raise ValidationError("third-party costs cannot be negative")
    earned_milestones = (amount_received * earned_percent) // 100
    return max(0, amount_received - earned_milestones - preapproved_nonrecoverable_third_party_costs)


def milestone_percent(milestone: str) -> int:
    if milestone not in MILESTONE_PERCENTS:
        raise ValidationError(f"unknown milestone {milestone}")
    return MILESTONE_PERCENTS[milestone]


def due_for_deletion(
    class_id: str,
    *,
    as_of: date,
    last_event: date,
    legal_hold: bool = False,
    schedule: Mapping[str, Any] | None = None,
) -> bool:
    """Shipped deletion/anonymization predicate. Legal hold blocks only the needed set."""
    if legal_hold:
        return False
    if schedule is None:
        schedule = load_json(package_dir() / "RETENTION_SCHEDULE.json")
    item = next((row for row in schedule.get("items") or [] if row.get("class_id") == class_id), None)
    if item is None:
        raise ValidationError(f"unknown retention class {class_id}")
    days = item.get("retention_days")
    if days is None:
        return False
    return as_of >= last_event + timedelta(days=int(days))


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


def build_sha256sums_text(pkg: Path) -> str:
    lines = [_SHA256SUMS_HEADER.rstrip(), ""]
    for name in HASHED_FILES:
        lines.append(f"{hash_legal_file_hex(pkg / name)}  {name}")
    return "\n".join(lines) + "\n"


def iter_package_texts(pkg: Path) -> Iterable[tuple[str, str]]:
    for path in sorted(pkg.rglob("*")):
        if path.is_file() and path.suffix in {".md", ".json", ".txt"}:
            yield str(path.relative_to(pkg)), load_text(path)


def assert_required_files(pkg: Path) -> None:
    missing = [name for name in REQUIRED_FILES if not (pkg / name).is_file()]
    if missing:
        raise ValidationError(f"missing required legal artifacts: {missing}")
    if (pkg / "DPA_LITE_B2B.md").is_file():
        raise ValidationError("DPA_LITE_B2B.md must not exist in this package")


def assert_required_metadata(text: str, *, source: str) -> None:
    blob = text[:5000]
    compact = blob.replace(" ", "").replace('"', "").replace("'", "")
    for key, value in REQUIRED_METADATA.items():
        patterns = (f"{key}: {value}", f"{key} = {value}", f"{key}={value}", f"{key}:{value}")
        ok = any(item.lower() in blob.lower() or item.replace(" ", "").lower() in compact.lower() for item in patterns)
        if key == "supersedable" and not ok:
            ok = re.search(r'"supersedable"\s*:\s*true', text, re.I) is not None
        if not ok:
            raise ValidationError(f"{source}: missing metadata {key}={value}")


def _is_denied_or_listed(text: str, start: int, phrase: str) -> bool:
    window = text[max(0, start - 400) : start + len(phrase) + 10].lower()
    denial_markers = (
        "não afirma",
        "nao afirma",
        "não é",
        "nao e",
        "não há",
        "nao ha",
        "não houve",
        "not_",
        "forbidden",
        "proib",
        "não autoriza",
        "nunca",
        "must not",
        "do not",
        "sem afirmação",
        "não declara",
        "inválidos",
        "invalidos",
        "ataque",
        "risk_covered",
        "claim ",
        "claim`",
        "não publicar",
        "nao publicar",
        "não deve",
        "nao deve",
        "não deve aparecer",
    )
    if start > 0 and text[start - 1] == "`" and start + len(phrase) < len(text) and text[start + len(phrase)] == "`":
        return True
    if start > 0 and text[start - 1] in "/,":
        return True
    return any(marker in window for marker in denial_markers)


def assert_no_forbidden_claims(text: str, *, source: str) -> None:
    if re.search(r"(?i)(?:status|professional_legal_review)\s*[:=]\s*LEGAL_APPROVED", text):
        raise ValidationError(f"{source}: forbidden claim 'LEGAL_APPROVED'")
    if re.search(r'(?i)"status"\s*:\s*"LEGAL_APPROVED"', text):
        raise ValidationError(f"{source}: forbidden claim 'LEGAL_APPROVED'")
    for phrase in FORBIDDEN_CLAIM_PHRASES:
        idx = 0
        while True:
            found = text.find(phrase, idx)
            if found < 0:
                break
            if not _is_denied_or_listed(text, found, phrase):
                raise ValidationError(f"{source}: forbidden claim {phrase!r}")
            idx = found + len(phrase)
    for pattern in FORBIDDEN_WORDS:
        if pattern.search(text):
            raise ValidationError(f"{source}: forbidden word {pattern.pattern!r}")
    if HUMAN_DECISION_RE.search(text):
        raise ValidationError(f"{source}: HUMAN_DECISION_REQUIRED must not remain")


def assert_no_extra_leak(text: str, *, source: str) -> None:
    for marker in EXTRA_LEAK_MARKERS:
        if marker in text:
            raise ValidationError(f"{source}: Extra leak {marker!r}")


def assert_no_placeholder(text: str, *, source: str) -> None:
    if "TODO" in text or "FIXME" in text or "TBD" in text or "[[PLACEHOLDER" in text:
        raise ValidationError(f"{source}: placeholder remains")


def assert_identity_and_forum(joined: str) -> None:
    for needle in (LEGAL_NAME, CNPJ, FORUM, "800000", OFFER_CODE, DECIDER, DECISION_TOKEN):
        if needle not in joined:
            raise ValidationError(f"package missing required identity/forum/token phrase: {needle}")


def assert_terms(terms: str) -> None:
    for clause_id in REQUIRED_CLAUSE_IDS:
        if f"**clause_id:** `{clause_id}`" not in terms:
            raise ValidationError(f"terms missing clause marker {clause_id}")
    lowered = terms.lower()
    for phrase in REQUIRED_TERMS_PHRASES:
        if phrase not in terms and phrase.lower() not in lowered:
            raise ValidationError(f"terms missing required phrase: {phrase!r}")
    lowered = terms.lower()
    if "renuncia a todo e qualquer" in lowered and "não** renuncia a todo e qualquer" not in lowered and "não renuncia a todo e qualquer" not in lowered:
        raise ValidationError("terms must not say the client waives every right")


def assert_refund_policy(text: str) -> None:
    if REFUND_FORMULA not in text:
        raise ValidationError("refund policy missing shipped formula")
    for milestone, percent in MILESTONE_PERCENTS.items():
        if milestone not in text:
            raise ValidationError(f"refund policy missing {milestone}")
        if f"{percent}%" not in text and f"{percent} %" not in text:
            raise ValidationError(f"refund policy missing {milestone} percent {percent}")
    # Drive the shipped function against the documented example.
    examples = {
        "M0": 800000,
        "M1": 680000,
        "M2": 480000,
        "M3": 200000,
        "M4": 80000,
        "M5": 0,
    }
    for milestone, expected in examples.items():
        got = refund_due(800000, milestone_percent(milestone))
        if got != expected:
            raise ValidationError(f"refund math drifted for {milestone}: {got} != {expected}")


def assert_retention(schedule: Mapping[str, Any]) -> None:
    required = {
        "lead_not_converted": 730,
        "eligibility_rejected_or_abandoned": 365,
        "acceptance_not_paid": 730,
        "contract_financial_evidence": 3650,
        "webhook_raw_payload": 1825,
        "security_logs_ip_ua": 365,
        "client_raw_inputs": 180,
        "final_deliverables_correction_trail": 1825,
    }
    items = {row["class_id"]: row for row in schedule.get("items") or []}
    for class_id, days in required.items():
        if class_id not in items:
            raise ValidationError(f"retention missing {class_id}")
        if items[class_id].get("retention_days") != days:
            raise ValidationError(f"retention {class_id} must be {days} days")
    if schedule.get("legal_hold_suspends_deletion_for_necessary_set_only") is not True:
        raise ValidationError("retention must honour legal hold")
    start = date(2026, 2, 18)
    if due_for_deletion("client_raw_inputs", as_of=start + timedelta(days=179), last_event=start, schedule=schedule):
        raise ValidationError("180-day class must not be due before day 180")
    if not due_for_deletion("client_raw_inputs", as_of=start + timedelta(days=180), last_event=start, schedule=schedule):
        raise ValidationError("180-day class must be due on day 180")
    if due_for_deletion(
        "client_raw_inputs",
        as_of=date(2027, 8, 18),
        last_event=date(2026, 2, 18),
        legal_hold=True,
        schedule=schedule,
    ):
        raise ValidationError("legal hold must suspend deletion")


def assert_acceptance(spec: Mapping[str, Any]) -> None:
    if spec.get("acceptance_before_checkout") is not True:
        raise ValidationError("acceptance must occur before checkout")
    if spec.get("checkout_callback_or_payment_never_replaces_acceptance") is not True:
        raise ValidationError("checkout must never replace acceptance")
    if spec.get("generic_lgpd_consent_checkbox_forbidden") is not True:
        raise ValidationError("generic LGPD consent checkbox must stay forbidden")
    if spec.get("amount_cents_must_equal") != OFFER_AMOUNT_CENTS:
        raise ValidationError("acceptance spec amount drifted")
    required = {"validate_cnpj", "confirm_email_otp_or_magic_link", "create_checkout_only_after"}
    flow = set(spec.get("flow") or [])
    if not required <= flow:
        raise ValidationError(f"acceptance flow missing {required - flow}")


def assert_sources(manifest: Mapping[str, Any]) -> None:
    urls = {item.get("url") for item in manifest.get("primary_sources") or []}
    for url in PRIMARY_SOURCE_URLS:
        if not any(item.startswith(url.rstrip("/")) or url.rstrip("/") in (item or "") for item in urls):
            # allow prefix match (docs.asaas.com/ vs docs.asaas.com/docs/...)
            if not any((item or "").startswith(url) for item in urls):
                raise ValidationError(f"source manifest missing primary url {url}")
    if manifest.get("asaas_checkout_boleto_documented") is not False:
        raise ValidationError("source manifest must record that Checkout boleto is undocumented")


def assert_p0(register: Mapping[str, Any], findings: Mapping[str, Any]) -> None:
    if register.get("p0_unmitigated") != 0 or findings.get("p0_unmitigated") != 0:
        raise ValidationError("P0 residual must be 0")
    for item in register.get("risks") or []:
        if item.get("priority") == "P0" and item.get("decision") not in {"REWRITE", "ACCEPT"}:
            raise ValidationError(f"{item.get('risk_id')}: P0 without mitigation or named ACCEPT")
        if item.get("priority") == "P0" and item.get("decision") == "HOLD":
            raise ValidationError("P0 cannot remain HOLD")


def assert_clause_matrix(matrix: Mapping[str, Any], terms: str) -> None:
    clauses = matrix.get("clauses") or []
    seen = [item.get("clause_id") for item in clauses]
    if sorted(seen) != sorted(REQUIRED_CLAUSE_IDS):
        raise ValidationError(f"clause matrix set mismatch: {sorted(set(seen) ^ set(REQUIRED_CLAUSE_IDS))}")
    for item in clauses:
        if item.get("state") != STATUS:
            raise ValidationError(f"clause {item.get('clause_id')} state must be {STATUS}")
        if f"**clause_id:** `{item['clause_id']}`" not in terms:
            raise ValidationError(f"clause {item['clause_id']} missing from terms")


def assert_manifest_flags(manifest: Mapping[str, Any]) -> None:
    expected = {
        "status": STATUS,
        "professional_legal_review": REVIEW,
        "founder_risk_acceptance": "APPROVED",
        "decision_token": DECISION_TOKEN,
        "approved_offer": OFFER_CODE,
        "offer_code": OFFER_CODE,
        "approved_amount_cents": OFFER_AMOUNT_CENTS,
        "approved_billing_mode": "ONE_TIME",
        "public_activation_approved": True,
        "production_checkout_approved": True,
        "recurring_checkout_approved": False,
        "automated_refund_approved": False,
        "automated_nfse_approved": False,
        "counsel_review_trigger": "FIRST_PAYMENT_RECEIVED",
        "counsel_review_target_business_days": 10,
        "decider_name": DECIDER,
        "decided_at": DECIDED_AT,
        "timezone": TIMEZONE,
        "dpa_lite_applicable": False,
        "campaign_status": STATUS,
    }
    for key, value in expected.items():
        if manifest.get(key) != value:
            raise ValidationError(f"manifest {key} must be {value!r}")
    if manifest.get("dpa_lite_path") is not None:
        raise ValidationError("dpa_lite_path must be null")


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
    key = {
        "manifest.json": "manifest",
        "CLAUSE_MATRIX.json": "clauseMatrix",
        "LEGAL_RISK_REGISTER.json": "riskRegister",
    }[name]
    ref = defs.get(key)
    if not isinstance(ref, Mapping):
        raise ValidationError(f"schema missing $defs.{key}")
    return ref


def assert_schema_artifacts(pkg: Path) -> None:
    auth = _load_authority()
    schema = load_json(pkg / "commercial-legal-founder-approved.schema.json")
    for name in ("manifest.json", "CLAUSE_MATRIX.json", "LEGAL_RISK_REGISTER.json"):
        instance = load_json(pkg / name)
        try:
            auth.schema_validate(instance, schema_for(name, schema), schema)
        except auth.ValidationError as exc:
            raise ValidationError(f"{name}: {exc}") from exc


def default_manifest(hashed: Mapping[str, str], prior_hash: str) -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "package_id": PACKAGE_ID,
        "package_version": PACKAGE_VERSION,
        "status": STATUS,
        "professional_legal_review": REVIEW,
        "founder_risk_acceptance": "APPROVED",
        "decision_token": DECISION_TOKEN,
        "supersedable": True,
        "jurisdiction": "Brazil",
        "business_context": "B2B_ENGINEERING_CONSULTING",
        "offer_code": OFFER_CODE,
        "approved_offer": OFFER_CODE,
        "approved_amount_cents": OFFER_AMOUNT_CENTS,
        "approved_billing_mode": "ONE_TIME",
        "public_activation_approved": True,
        "production_checkout_approved": True,
        "recurring_checkout_approved": False,
        "automated_refund_approved": False,
        "automated_nfse_approved": False,
        "counsel_review_trigger": "FIRST_PAYMENT_RECEIVED",
        "counsel_review_target_business_days": 10,
        "dpa_lite_applicable": False,
        "dpa_lite_path": None,
        "campaign_status": STATUS,
        "prior_package_id": "CFG-LEGAL-PROVISIONAL-DIAG-v1",
        "prior_package_hash": prior_hash,
        "decider_name": DECIDER,
        "decided_at": DECIDED_AT,
        "timezone": TIMEZONE,
        "artifacts": [{"path": name, "content_hash": hashed[name]} for name in HASHED_FILES],
    }


def mutate_package(pkg: Path, dest: Path) -> Path:
    import shutil

    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(pkg, dest)
    return dest


def reject_adversarial_text(text: str, *, kind: str, source: str = "fixture") -> None:
    if kind == "validated_claim":
        assert_no_forbidden_claims(text, source=source)
        return
    if kind == "extra":
        assert_no_extra_leak(text, source=source)
        return
    if kind == "human_decision":
        if HUMAN_DECISION_RE.search(text):
            raise ValidationError(f"{source}: HUMAN_DECISION_REQUIRED must not remain")
        return
    if kind == "placeholder":
        assert_no_placeholder(text, source=source)
        return
    if kind == "recurring":
        if '"recurring_checkout_approved": true' in text or "recurring_checkout_approved = true" in text:
            raise ValidationError(f"{source}: recurring checkout must stay false")
        return
    raise ValidationError(f"unknown adversarial kind {kind}")


def validate_legal_dir(pkg: Path, *, root: Path | None = None) -> dict[str, Any]:
    if not pkg.is_dir():
        raise ValidationError(f"missing founder-approved package directory {pkg}")
    root = root or repo_root(pkg)
    assert_required_files(pkg)
    for rel, text in iter_package_texts(pkg):
        assert_no_forbidden_claims(text, source=rel)
        assert_no_extra_leak(text, source=rel)
        assert_no_placeholder(text, source=rel)
        if rel.endswith(".md"):
            assert_required_metadata(text, source=rel)
    terms = load_text(pkg / "TERMOS_B2B_DIAGNOSTICO.md")
    assert_terms(terms)
    joined = "\n".join(text for _, text in iter_package_texts(pkg))
    assert_identity_and_forum(joined)
    assert_refund_policy(load_text(pkg / "POLITICA_CANCELAMENTO_REEMBOLSO.md"))
    assert_retention(load_json(pkg / "RETENTION_SCHEDULE.json"))
    assert_acceptance(load_json(pkg / "ELECTRONIC_ACCEPTANCE_SPEC.json"))
    assert_sources(load_json(pkg / "SOURCE_MANIFEST.json"))
    register = load_json(pkg / "LEGAL_RISK_REGISTER.json")
    findings = load_json(pkg / "ADVERSARIAL_FINDINGS.json")
    assert_p0(register, findings)
    assert_clause_matrix(load_json(pkg / "CLAUSE_MATRIX.json"), terms)
    manifest = load_json(pkg / "manifest.json")
    assert_manifest_flags(manifest)
    hashed = assert_sha256sums_match(pkg)
    assert_manifest_hashes(pkg, manifest, hashed)
    assert_schema_artifacts(pkg)
    prior = _load_provisional().validate_legal_package(root)
    if manifest.get("prior_package_hash") != prior["authority_hash"]:
        raise ValidationError("prior_package_hash does not match frozen provisional hash")
    digest = legal_package_hash(manifest)
    return {
        "root": str(root),
        "package": str(pkg),
        "authority_hash": digest,
        "prior_package_hash": prior["authority_hash"],
        "campaign_status": STATUS,
        "offer_code": OFFER_CODE,
        "offer_amount_cents": OFFER_AMOUNT_CENTS,
        "decision_token": DECISION_TOKEN,
        "public_activation_approved": True,
        "production_checkout_approved": True,
        "recurring_checkout_approved": False,
        "p0_unmitigated": 0,
    }


def validate_legal_package(root: Path | None = None) -> dict[str, Any]:
    root = repo_root(root)
    return validate_legal_dir(package_dir(root), root=root)


def write_hashes(root: Path | None = None) -> dict[str, Any]:
    root = repo_root(root)
    prior = _load_provisional().validate_legal_package(root)
    pkg = package_dir(root)
    pkg.mkdir(parents=True, exist_ok=True)
    (pkg / "SHA256SUMS.txt").write_text(build_sha256sums_text(pkg), encoding="utf-8")
    hashed = {name: hash_legal_file(pkg / name) for name in HASHED_FILES}
    manifest = default_manifest(hashed, prior["authority_hash"])
    (pkg / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return validate_legal_package(root)


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate founder-approved legal package")
    parser.add_argument("--write-hashes", action="store_true")
    parser.add_argument("--root", type=Path, default=None)
    args = parser.parse_args(list(argv) if argv is not None else None)
    try:
        result = write_hashes(args.root) if args.write_hashes else validate_legal_package(args.root)
    except ValidationError as exc:
        print(f"VALIDATION_ERROR {exc}", file=sys.stderr)
        return 1
    print(f"AUTHORITY_HASH {result['authority_hash']}")
    print(f"PRIOR_PACKAGE_HASH {result['prior_package_hash']}")
    print(f"CAMPAIGN_STATUS {result['campaign_status']}")
    print(f"OFFER {result['offer_code']} {result['offer_amount_cents']}")
    print(f"DECISION_TOKEN {result['decision_token']}")
    print("PUBLIC_ACTIVATION_APPROVED true")
    print("PRODUCTION_CHECKOUT_APPROVED true")
    print("RECURRING_CHECKOUT_APPROVED false")
    print("AUTOMATED_REFUND_APPROVED false")
    print("AUTOMATED_NFSE_APPROVED false")
    print("PROFESSIONAL_LEGAL_REVIEW DEFERRED_UNTIL_FIRST_REVENUE")
    print("FOUNDER_RISK_ACCEPTANCE APPROVED")
    print("P0_UNMITIGATED 0")
    print("NOT_LEGAL_APPROVED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
