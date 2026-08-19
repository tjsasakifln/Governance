#!/usr/bin/env python3
"""Validate the founder-approved partner referral/co-sell package.

Shipped checker for commercial/partners/referral-cosell-v1/.
Not a legal opinion. Does not claim LEGAL_APPROVED.

Usage:
    python scripts/validate_partner_program.py
    python scripts/validate_partner_program.py --write-hashes
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import re
import sys
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Iterable, Mapping


PACKAGE_REL = Path("commercial") / "partners" / "referral-cosell-v1"
SCHEMA_VERSION = "partner-program.v1"
PACKAGE_ID = "CFG-PARTNER-REFERRAL-COSELL-v1"
PACKAGE_VERSION = "referral-cosell-v1"
STATUS = "FOUNDER_APPROVED_WITH_DEFERRED_COUNSEL_REVIEW"
REVIEW = "DEFERRED_UNTIL_FIRST_REVENUE"
DECISION_TOKEN = "FOUNDER_APPROVED_PARTNER_PROGRAM_DEFERRED_COUNSEL_2026_08_19"
DECIDER = "Tiago Jun Sasaki"
DECIDED_AT = "2026-08-19"
TIMEZONE = "America/Sao_Paulo"
CANONICAL_ISSUE = "https://github.com/tjsasakifln/Governance/issues/7"
LEGAL_NAME = "CONFENGE SERVICOS DE DESENHOS TECNICOS LTDA"
CNPJ = "52.407.089/0001-09"
FORUM = "Foro da Comarca de Florianópolis, Estado de Santa Catarina"

REFERRAL_RATE_BPS = 1000
REFERRAL_PERIOD_MONTHS = 6
REFERRAL_CAP_CENTS = 1_000_000
COSELL_MAX_RATE_BPS = 1500
COSELL_PERIOD_MONTHS = 6
COSELL_CAP_CENTS = 1_500_000
LEAD_DECISION_BUSINESS_DAYS = 2
LEAD_PROTECTION_DAYS = 90

MODALITIES = (
    "REFERRAL_QUALIFIED",
    "COSELL_SPECIALIZED",
    "DISTRIBUTION_INTEGRATION",
    "NOT_ELIGIBLE",
)
DD_STATES = (
    "APPROVED",
    "APPROVED_WITH_LIMITATIONS",
    "NEEDS_INFO",
    "LEGAL_REVIEW_REQUIRED",
    "REJECTED",
    "SUSPENDED",
)
APPROVED_DD_STATES = frozenset({"APPROVED", "APPROVED_WITH_LIMITATIONS"})
INELIGIBLE_BASES = frozenset(
    {
        "edital",
        "obra",
        "contrato_publico",
        "economia",
        "pleito",
        "vitoria",
        "valor_publico",
        "success_fee",
        "public_contract_value",
        "attorney_fees",
    }
)
REQUIRED_EVENT_TYPES = (
    "partner_candidate_created",
    "partner_due_diligence_decided",
    "partner_agreement_accepted",
    "partner_lead_submitted",
    "partner_lead_more_info_requested",
    "partner_lead_accepted",
    "partner_lead_rejected",
    "partner_protection_started",
    "partner_protection_expired",
    "partner_opportunity_progressed",
    "partner_commission_accrual_candidate",
    "partner_commission_approved",
    "partner_commission_paid",
    "partner_commission_adjusted",
    "partner_suspended",
    "partner_terminated",
)
REQUIRED_CLAUSE_IDS = (
    "partes_autoridade_assinatura",
    "definicoes",
    "modalidade",
    "natureza_independente",
    "ausencia_sociedade_emprego_mandato",
    "servicos_fronteiras",
    "lead_registration",
    "consentimento_apresentacao",
    "aceitacao_rejeicao",
    "protecao_90_dias",
    "preexisting_accounts",
    "duplicidades",
    "colaboracao_cosell",
    "propriedade_conta_comunicacao",
    "comissao_base_periodo_teto",
    "evento_pagamento",
    "documento_fiscal",
    "estorno_reembolso_inadimplencia",
    "nao_exclusividade",
    "uso_marca",
    "confidencialidade",
    "lgpd_minimizacao",
    "seguranca",
    "propriedade_intelectual",
    "conflitos",
    "integridade_anticorrupcao",
    "sancoes_due_diligence",
    "proibicao_influencia_exito_publico",
    "registros_auditoria",
    "suspensao_preventiva",
    "terminacao",
    "efeito_terminacao_leads",
    "responsabilidade_indenizacao",
    "notificacoes",
    "foro_lei",
    "ordem_precedencia",
    "assinatura_eletronica_versionamento",
)
FAIL_CLOSED_PLACEHOLDERS = (
    "[[FAIL_CLOSED:PARTNER_LEGAL_NAME]]",
    "[[FAIL_CLOSED:PARTNER_CNPJ]]",
    "[[FAIL_CLOSED:PARTNER_REGISTERED_ADDRESS]]",
    "[[FAIL_CLOSED:PARTNER_SIGNATORY_NAME]]",
    "[[FAIL_CLOSED:PARTNER_SIGNATORY_CAPACITY]]",
    "[[FAIL_CLOSED:PARTNER_PROFESSIONAL_REGISTRY]]",
)
IDENTITY_RECORD_KEYS = (
    "legal_name",
    "cnpj",
    "professional_registry",
)

REQUIRED_METADATA = {
    "status": STATUS,
    "professional_legal_review": REVIEW,
    "founder_risk_acceptance": "APPROVED",
    "operational_use": "PRIVATE_NEGOTIATION_ONLY",
    "supersedable": "true",
    "jurisdiction": "Brazil",
    "business_context": "B2B_ENGINEERING_CONSULTING",
}

REQUIRED_FILES = (
    "README.md",
    "PARTNER_PROGRAM_POLICY.md",
    "PARTNER_AGREEMENT_B2B.md",
    "COSELLING_ADDENDUM.md",
    "LEAD_REGISTRATION_AND_ATTRIBUTION.md",
    "COMMISSION_POLICY.md",
    "COMMISSION_SCHEDULE.json",
    "PARTNER_DUE_DILIGENCE.md",
    "PARTNER_CODE_OF_CONDUCT.md",
    "PUBLIC_SECTOR_INTEGRITY.md",
    "CONFLICT_OF_INTEREST_POLICY.md",
    "LGPD_PARTNER_LEAD_NOTICE.md",
    "PROFESSIONAL_RESTRICTIONS.md",
    "OAB_REVIEW_GATE.md",
    "ANTI_CIRCUMVENTION_AND_ACCOUNT_PROTECTION.md",
    "TERMINATION_AND_SUSPENSION.md",
    "PARTNER_EVENT_CONTRACT.json",
    "CONSUMER_HANDOFF.md",
    "FOUNDER_RISK_ACCEPTANCE.md",
    "FOUNDER_RISK_ACCEPTANCE.json",
    "COUNSEL_HANDOFF.md",
    "LEGAL_RISK_REGISTER.json",
    "CLAUSE_MATRIX.json",
    "partner-program.schema.json",
    "manifest.json",
    "SHA256SUMS.txt",
)
HASHED_FILES = tuple(name for name in REQUIRED_FILES if name not in {"manifest.json", "SHA256SUMS.txt"})

FORBIDDEN_CLAIM_PHRASES = (
    "LEGAL_APPROVED",
    "COUNSEL_REVIEWED",
    "LAWYER_APPROVED",
    "parecer jurídico",
    "conformidade jurídica garantida",
    "ausência de risco",
    "aprovado pelo jurídico",
    "juridicamente validado",
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
INFLUENCE_CLAIM_RES = (
    re.compile(
        r"(prometemos|oferecemos|garantimos|disponibilizamos)\s+.{0,80}"
        r"(influência|facilitação|acesso privilegiado|vitória em licitação)",
        re.I | re.S,
    ),
    re.compile(r"facilitação junto ao órgão", re.I),
    re.compile(r"procurador perante (o )?órgão", re.I),
    re.compile(r"(pelo|via|através do|por meio do|usando o)\s+cargo público", re.I),
    re.compile(r"uso do cargo público", re.I),
    re.compile(r"acesso privilegiado ao órgão", re.I),
)
SECRET_PATTERNS = (
    re.compile(r"\$aact_[A-Za-z0-9_]+"),
    re.compile(r"\bsk_(?:live|test)_[A-Za-z0-9]+"),
    re.compile(r"asaas[_-]?api[_-]?key", re.I),
    re.compile(r"checkout\.asaas\.com", re.I),
    re.compile(r"asaas\.com/c/", re.I),
    re.compile(r"\b(?:cus|sub|pay)_[A-Za-z0-9]{8,}\b"),
    re.compile(r"\b\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}\b"),
    re.compile(r"\b\d{3}\.\d{3}\.\d{3}-\d{2}\b"),
)
ALLOWED_PUBLIC_IDENTITY_TOKENS = frozenset({CNPJ})
PII_URL_RE = re.compile(r"(?:https?://[^\s]+[?&](?:cpf|email|nome|phone|telefone)=)", re.I)
HUMAN_DECISION_RE = re.compile(r"HUMAN_DECISION_REQUIRED")

_SHA256SUMS_HEADER = f"""# status={STATUS}
# professional_legal_review={REVIEW}
# founder_risk_acceptance=APPROVED
# operational_use=PRIVATE_NEGOTIATION_ONLY
# supersedable=true
# jurisdiction=Brazil
# business_context=B2B_ENGINEERING_CONSULTING
# hashed_with=scripts/validate_partner_program.py
# decision_token={DECISION_TOKEN}
"""


class ValidationError(Exception):
    """Fail-closed partner-program error."""


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


def hash_partner_file(path: Path) -> str:
    if not path.is_file():
        raise ValidationError(f"missing artifact {path.name}")
    if path.suffix == ".json":
        return content_hash_json(load_json(path))
    return content_hash_text(load_text(path))


def hash_partner_file_hex(path: Path) -> str:
    return hash_partner_file(path).removeprefix("sha256:")


def partner_package_hash(manifest: Mapping[str, Any]) -> str:
    return content_hash_json(manifest)


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
        lines.append(f"{hash_partner_file_hex(pkg / name)}  {name}")
    return "\n".join(lines) + "\n"


def iter_package_texts(pkg: Path) -> Iterable[tuple[str, str]]:
    for path in sorted(pkg.rglob("*")):
        if path.is_file() and path.suffix in {".md", ".json", ".txt"}:
            yield str(path.relative_to(pkg)), load_text(path)


def scan_forbidden_secrets(text: str) -> list[str]:
    hits: list[str] = []
    for pattern in SECRET_PATTERNS:
        hits.extend(str(item) for item in pattern.findall(text))
    return [hit for hit in hits if hit not in ALLOWED_PUBLIC_IDENTITY_TOKENS]


def cap_for_modality(modality: str) -> int:
    if modality == "REFERRAL_QUALIFIED":
        return REFERRAL_CAP_CENTS
    if modality == "COSELL_SPECIALIZED":
        return COSELL_CAP_CENTS
    return 0


def max_rate_for_modality(modality: str) -> int:
    if modality == "REFERRAL_QUALIFIED":
        return REFERRAL_RATE_BPS
    if modality == "COSELL_SPECIALIZED":
        return COSELL_MAX_RATE_BPS
    return 0


def standard_referral_commission_available(
    *,
    modality: str,
    professional_flag: str | None,
    due_diligence_state: str,
) -> bool:
    if modality != "REFERRAL_QUALIFIED":
        return False
    if professional_flag == "PROFESSIONAL_RULE_REVIEW_REQUIRED":
        return False
    if due_diligence_state not in APPROVED_DD_STATES:
        return False
    return True


def identity_is_placeholder(value: Any) -> bool:
    if value is None:
        return True
    text = str(value).strip()
    if not text:
        return True
    if "[[FAIL_CLOSED:" in text:
        return True
    if text.upper() in {"UNKNOWN", "TBD", "TODO", "N/A", "NA"}:
        return True
    return False


def partner_record_may_be_approved(record: Mapping[str, Any]) -> bool:
    try:
        assert_due_diligence_state_allowed(record, "APPROVED")
    except ValidationError:
        return False
    return True


def assert_due_diligence_state_allowed(record: Mapping[str, Any], proposed_state: str) -> None:
    if proposed_state not in DD_STATES:
        raise ValidationError(f"unknown due-diligence state {proposed_state}")
    if proposed_state not in APPROVED_DD_STATES:
        return
    for key in IDENTITY_RECORD_KEYS:
        if identity_is_placeholder(record.get(key)):
            raise ValidationError(f"placeholder identity cannot become APPROVED ({key})")
    if record.get("professional_flag") == "PROFESSIONAL_RULE_REVIEW_REQUIRED":
        raise ValidationError("OAB/professional gate cannot auto-approve")
    if record.get("modality") == "NOT_ELIGIBLE":
        raise ValidationError("NOT_ELIGIBLE cannot be approved")
    if record.get("modality") == "DISTRIBUTION_INTEGRATION" and not record.get("separate_addendum"):
        raise ValidationError("DISTRIBUTION_INTEGRATION cannot auto-approve without separate addendum")
    conflict = record.get("integrity_conflict")
    if conflict in {"REAL", "APPARENT", "UNRESOLVED", True}:
        raise ValidationError("integrity conflict cannot auto-approve")
    if record.get("real_partner_created") is True:
        raise ValidationError("canonical package cannot mark a real partner created")


def attribution_outcome(
    *,
    consent_evidence_ref: str | None,
    source: str | None,
    preexisting_account: bool = False,
    preexisting_opportunity: bool = False,
    lead_decision: str = "PENDING",
    protection_start: date | None = None,
    as_of: date | None = None,
    material_partner_action: bool = True,
    list_dump: bool = False,
    protection_days: int = LEAD_PROTECTION_DAYS,
) -> str:
    if list_dump:
        return "LIST_DUMP"
    if not consent_evidence_ref:
        return "NO_CONSENT"
    if not source:
        return "NO_SOURCE"
    if preexisting_account or preexisting_opportunity:
        return "PREEXISTING"
    decision = (lead_decision or "PENDING").upper()
    if decision in {"REJECT", "REJECTED"}:
        return "REJECTED"
    if decision in {"MORE_INFO", "NEEDS_INFO"}:
        return "MORE_INFO"
    if decision not in {"ACCEPT", "ACCEPTED"}:
        return "PENDING"
    if not material_partner_action:
        return "NO_MATERIAL_ACTION"
    if protection_start is not None and as_of is not None:
        if as_of >= protection_start + timedelta(days=int(protection_days)):
            return "EXPIRED"
    return "ACCEPTED_PROTECTED"


def protection_opens(outcome: str) -> bool:
    return outcome == "ACCEPTED_PROTECTED"


def protection_active(
    outcome: str,
    *,
    protection_start: date | None,
    as_of: date,
    protection_days: int = LEAD_PROTECTION_DAYS,
) -> bool:
    if not protection_opens(outcome):
        return False
    if protection_start is None:
        return False
    return as_of < protection_start + timedelta(days=int(protection_days))


def lgpd_lead_admissible(
    *,
    consent_evidence_ref: str | None,
    source: str | None,
    sensitive: bool = False,
    list_dump: bool = False,
    pii_in_url: bool = False,
) -> bool:
    if not consent_evidence_ref or not source:
        return False
    if sensitive or list_dump or pii_in_url:
        return False
    return True


def partner_event_is_received_revenue(event: Mapping[str, Any] | str) -> bool:
    """Partner events are never CONFENGE received revenue."""
    return False


def partner_commission_may_be_marked_paid(event: Mapping[str, Any]) -> bool:
    if event.get("type") != "partner_commission_paid":
        return False
    if event.get("outcome") in {None, "UNKNOWN"}:
        return False
    if not event.get("receipt_evidence"):
        return False
    if not (event.get("human_approval_actor") or event.get("approval_actor")):
        return False
    if int(event.get("eligible_receipt_cents") or 0) <= 0:
        return False
    return True


def commission_amount_cents(
    *,
    modality: str,
    rate_bps: int,
    eligible_net_fee_receipt_cents: int,
    previously_paid_or_accrued_cents: int = 0,
    refund_or_chargeback_cents: int = 0,
    receipt_evidence: bool = False,
    lead_status: str = "ACCEPTED",
    preexisting: bool = False,
    protection_expired_without_contract: bool = False,
    contracted_during_protection: bool = True,
    within_period_months: bool = True,
    base_kind: str = "eligible_net_fees",
    professional_flag: str | None = None,
    due_diligence_state: str = "APPROVED",
    cap_cents: int | None = None,
) -> int:
    """Shipped commission math. Tests must call this function."""
    if not receipt_evidence:
        return 0
    if base_kind != "eligible_net_fees" or base_kind in INELIGIBLE_BASES:
        return 0
    if base_kind in INELIGIBLE_BASES:
        return 0
    if preexisting:
        return 0
    if (lead_status or "").upper() not in {"ACCEPT", "ACCEPTED"}:
        return 0
    if protection_expired_without_contract:
        return 0
    if not contracted_during_protection:
        return 0
    if not within_period_months:
        return 0
    if professional_flag == "PROFESSIONAL_RULE_REVIEW_REQUIRED":
        return 0
    if modality in {"NOT_ELIGIBLE", "DISTRIBUTION_INTEGRATION"}:
        return 0
    if due_diligence_state not in APPROVED_DD_STATES:
        return 0
    if modality not in {"REFERRAL_QUALIFIED", "COSELL_SPECIALIZED"}:
        return 0
    max_rate = max_rate_for_modality(modality)
    if rate_bps <= 0 or rate_bps > max_rate:
        return 0
    if eligible_net_fee_receipt_cents < 0 or refund_or_chargeback_cents < 0:
        raise ValidationError("commission inputs cannot be negative")
    if previously_paid_or_accrued_cents < 0:
        raise ValidationError("previously paid cannot be negative")
    net = max(0, int(eligible_net_fee_receipt_cents) - int(refund_or_chargeback_cents))
    raw = net * int(rate_bps) // 10_000
    cap = int(cap_cents if cap_cents is not None else cap_for_modality(modality))
    remaining = max(0, cap - int(previously_paid_or_accrued_cents))
    return max(0, min(raw, remaining))


def _is_denied_or_listed(text: str, start: int, phrase: str) -> bool:
    if start > 0 and text[start - 1] == "`" and start + len(phrase) < len(text) and text[start + len(phrase)] == "`":
        return True
    if start > 0 and text[start - 1] in "/,":
        return True
    raw_window = text[max(0, start - 400) : start + len(phrase) + 40]
    window = re.sub(r"[*`#]", "", raw_window).lower()
    window = window.replace("**", "")
    denial_markers = (
        "não afirma",
        "nao afirma",
        "não é",
        "nao e",
        "não oferece",
        "nao oferece",
        "nenhuma mensagem",
        "não há",
        "nao ha",
        "não houve",
        "não autoriz",
        "nao autoriz",
        "not_",
        "forbidden",
        "proib",
        "vedado",
        "bloqueia",
        "não habilita",
        "nao habilita",
        "does not enable",
        "does_not_authorize",
        "not legal_approved",
        "nunca use",
        "nunca usar",
        "must not",
        "do not",
        "não deve",
        "nao deve",
        "risk_covered",
        "claim ",
        "claims de",
        "apresentado como",
    )
    return any(marker in window for marker in denial_markers)


def assert_no_forbidden_claims(text: str, *, source: str) -> None:
    if re.search(r"(?i)(?:status|professional_legal_review)\s*[:=]\s*LEGAL_APPROVED", text):
        raise ValidationError(f"{source}: forbidden claim 'LEGAL_APPROVED'")
    if re.search(r'(?i)"status"\s*:\s*"LEGAL_APPROVED"', text):
        raise ValidationError(f"{source}: forbidden claim 'LEGAL_APPROVED'")
    if re.search(r'(?i)"legal_approved"\s*:\s*true', text):
        raise ValidationError(f"{source}: forbidden claim legal_approved=true")
    for phrase in FORBIDDEN_CLAIM_PHRASES:
        idx = 0
        while True:
            found = text.find(phrase, idx)
            if found < 0:
                break
            if not _is_denied_or_listed(text, found, phrase):
                raise ValidationError(f"{source}: forbidden claim {phrase!r}")
            idx = found + len(phrase)


def assert_no_extra_leak(text: str, *, source: str) -> None:
    for marker in EXTRA_LEAK_MARKERS:
        if marker in text:
            raise ValidationError(f"{source}: Extra leak {marker!r}")


def assert_no_placeholder_debt(text: str, *, source: str) -> None:
    if "TODO" in text or "FIXME" in text or "TBD" in text or "[[PLACEHOLDER" in text:
        raise ValidationError(f"{source}: placeholder remains")


def assert_no_public_influence_claim(text: str, *, source: str) -> None:
    for pattern in INFLUENCE_CLAIM_RES:
        match = pattern.search(text)
        if match:
            raise ValidationError(f"{source}: public-influence/cargo copy {match.group(0)!r}")


def assert_required_metadata(text: str, *, source: str) -> None:
    blob = text[:5000]
    compact = blob.replace(" ", "").replace('"', "").replace("'", "")
    for key, value in REQUIRED_METADATA.items():
        patterns = (f"{key}: {value}", f"{key} = {value}", f"{key}={value}", f"{key}:{value}")
        ok = any(
            item.lower() in blob.lower() or item.replace(" ", "").lower() in compact.lower()
            for item in patterns
        )
        if key == "supersedable" and not ok:
            ok = re.search(r'"supersedable"\s*:\s*true', text, re.I) is not None
        if not ok:
            raise ValidationError(f"{source}: missing metadata {key}={value}")


def assert_required_files(pkg: Path) -> None:
    missing = [name for name in REQUIRED_FILES if not (pkg / name).is_file()]
    if missing:
        raise ValidationError(f"missing required partner artifacts: {missing}")


def assert_schedule(schedule: Mapping[str, Any]) -> None:
    referral = (schedule.get("modalities") or {}).get("REFERRAL_QUALIFIED") or {}
    cosell = (schedule.get("modalities") or {}).get("COSELL_SPECIALIZED") or {}
    attr = schedule.get("attribution") or {}
    if referral.get("rate_bps") != REFERRAL_RATE_BPS:
        raise ValidationError("referral rate_bps must be 1000")
    if referral.get("period_months") != REFERRAL_PERIOD_MONTHS:
        raise ValidationError("referral period_months must be 6")
    if referral.get("cap_cents_total_per_referred_client") != REFERRAL_CAP_CENTS:
        raise ValidationError("referral cap must be 1000000 total centavos")
    if "NOT_MONTHLY" not in str(referral.get("cap_kind") or ""):
        raise ValidationError("referral cap must not be monthly")
    if cosell.get("max_rate_bps") != COSELL_MAX_RATE_BPS:
        raise ValidationError("co-sell max_rate_bps must be 1500")
    if cosell.get("period_months") != COSELL_PERIOD_MONTHS:
        raise ValidationError("co-sell period_months must be 6")
    if cosell.get("cap_cents_total_per_client") != COSELL_CAP_CENTS:
        raise ValidationError("co-sell cap must be 1500000 total centavos")
    if attr.get("decision_business_days") != LEAD_DECISION_BUSINESS_DAYS:
        raise ValidationError("lead decision must be 2 business days")
    if attr.get("protection_days_from_acceptance") != LEAD_PROTECTION_DAYS:
        raise ValidationError("protection must be 90 days")
    if attr.get("protection_is_permanent_account_ownership") is not False:
        raise ValidationError("protection must not be permanent account ownership")
    if schedule.get("advance_allowed") is not False:
        raise ValidationError("advance_allowed must be false")
    if schedule.get("guaranteed_minimum_cents") != 0:
        raise ValidationError("guaranteed minimum must be 0")
    if schedule.get("automatic_financial_provider_mutation") is not False:
        raise ValidationError("automatic financial mutation must stay false")
    if schedule.get("real_money_mutation_approved") is not False:
        raise ValidationError("real_money_mutation_approved must stay false")
    missing_bases = INELIGIBLE_BASES.difference(schedule.get("ineligible_bases") or [])
    if missing_bases:
        raise ValidationError(f"schedule missing ineligible bases: {sorted(missing_bases)}")
    professional = schedule.get("professional_rule") or {}
    if professional.get("standard_referral_commission_automatically_available") is not False:
        raise ValidationError("standard referral must not auto-available under professional rule")


def assert_events(contract: Mapping[str, Any]) -> None:
    if contract.get("operational_ledger") is not False or contract.get("creates_second_ledger") is not False:
        raise ValidationError("event contract must not create a second ledger")
    if contract.get("consumer") != "Warmbly#47":
        raise ValidationError("event consumer must remain Warmbly#47")
    types = [item.get("type") for item in contract.get("events") or []]
    missing = [name for name in REQUIRED_EVENT_TYPES if name not in types]
    if missing:
        raise ValidationError(f"event contract missing types: {missing}")
    for item in contract.get("events") or []:
        if item.get("is_received_revenue") is not False:
            raise ValidationError(f"{item.get('type')} must not be received revenue")
        if item.get("type") == "partner_commission_accrual_candidate" and item.get("is_paid_commission") is not False:
            raise ValidationError("accrual candidate must not be paid commission")
        if item.get("type") == "partner_lead_rejected" and item.get("opens_protection") is True:
            raise ValidationError("rejected lead must not open protection")


def assert_clause_matrix(matrix: Mapping[str, Any], joined: str) -> None:
    clauses = matrix.get("clauses") or []
    ids = [item.get("clause_id") for item in clauses]
    missing = [cid for cid in REQUIRED_CLAUSE_IDS if cid not in ids]
    if missing:
        raise ValidationError(f"clause matrix missing {missing}")
    for cid in REQUIRED_CLAUSE_IDS:
        if f"**clause_id:** `{cid}`" not in joined:
            raise ValidationError(f"package missing clause marker {cid}")


def assert_agreement(agreement: str, pkg: Path) -> None:
    joined_support = "\n".join(
        load_text(pkg / name)
        for name in (
            "PARTNER_AGREEMENT_B2B.md",
            "COSELLING_ADDENDUM.md",
            "LEAD_REGISTRATION_AND_ATTRIBUTION.md",
            "COMMISSION_POLICY.md",
            "LGPD_PARTNER_LEAD_NOTICE.md",
            "PUBLIC_SECTOR_INTEGRITY.md",
            "CONFLICT_OF_INTEREST_POLICY.md",
            "ANTI_CIRCUMVENTION_AND_ACCOUNT_PROTECTION.md",
            "TERMINATION_AND_SUSPENSION.md",
            "PARTNER_DUE_DILIGENCE.md",
        )
    )
    for cid in REQUIRED_CLAUSE_IDS:
        if f"**clause_id:** `{cid}`" not in joined_support:
            raise ValidationError(f"missing clause marker {cid}")
    for token in FAIL_CLOSED_PLACEHOLDERS:
        if token not in agreement:
            raise ValidationError(f"agreement missing fail-closed placeholder {token}")
    for needle in (LEGAL_NAME, CNPJ, FORUM, DECISION_TOKEN, "lei brasileira", "dois dias úteis", "90 dias"):
        if needle not in agreement and needle.lower() not in agreement.lower():
            raise ValidationError(f"agreement missing required phrase {needle}")
    for modality in MODALITIES:
        if modality not in joined_support:
            raise ValidationError(f"package missing modality {modality}")


def assert_p0(register: Mapping[str, Any]) -> None:
    if int(register.get("p0_count") or 0) != 0 or int(register.get("p0_unmitigated") or 0) != 0:
        raise ValidationError("unmitigated P0 risks are not allowed")
    for risk in register.get("risks") or []:
        if risk.get("priority") == "P0" and risk.get("decision") not in {"ACCEPT", "MITIGATE"}:
            raise ValidationError(f"P0 {risk.get('risk_id')} lacks decision")


def assert_manifest_flags(manifest: Mapping[str, Any]) -> None:
    expected = {
        "schema_version": SCHEMA_VERSION,
        "package_id": PACKAGE_ID,
        "package_version": PACKAGE_VERSION,
        "status": STATUS,
        "professional_legal_review": REVIEW,
        "founder_risk_acceptance": "APPROVED",
        "decision_token": DECISION_TOKEN,
        "operational_use": "PRIVATE_NEGOTIATION_ONLY",
        "legal_approved": False,
        "private_negotiation_enabled": True,
        "publication_enabled": False,
        "real_partner_created": False,
        "real_money_mutation_approved": False,
        "automatic_financial_provider_mutation": False,
        "counsel_review_trigger": "FIRST_PARTNER_ATTRIBUTED_REVENUE",
        "counsel_review_trigger_reuse": "FIRST_PAYMENT_RECEIVED",
        "counsel_review_target_business_days": 10,
        "integrity_oab_conflict_auto_accept": False,
        "canonical_issue": CANONICAL_ISSUE,
        "decider_name": DECIDER,
        "decided_at": DECIDED_AT,
        "timezone": TIMEZONE,
        "confenge_legal_name": LEGAL_NAME,
        "confenge_cnpj": CNPJ,
        "forum": FORUM,
    }
    for key, value in expected.items():
        if manifest.get(key) != value:
            raise ValidationError(f"manifest {key} must be {value!r}")


def assert_sha256sums_match(pkg: Path) -> dict[str, str]:
    listed = parse_sha256sums(load_text(pkg / "SHA256SUMS.txt"))
    expected = {name: hash_partner_file_hex(pkg / name) for name in HASHED_FILES}
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
        "COMMISSION_SCHEDULE.json": "commissionSchedule",
        "PARTNER_EVENT_CONTRACT.json": "eventContract",
    }[name]
    ref = defs.get(key)
    if not isinstance(ref, Mapping):
        raise ValidationError(f"schema missing $defs.{key}")
    return ref


def assert_schema_artifacts(pkg: Path) -> None:
    auth = _load_authority()
    schema = load_json(pkg / "partner-program.schema.json")
    for name in (
        "manifest.json",
        "CLAUSE_MATRIX.json",
        "LEGAL_RISK_REGISTER.json",
        "COMMISSION_SCHEDULE.json",
        "PARTNER_EVENT_CONTRACT.json",
    ):
        instance = load_json(pkg / name)
        try:
            auth.schema_validate(instance, schema_for(name, schema), schema)
        except auth.ValidationError as exc:
            raise ValidationError(f"{name}: {exc}") from exc


def assert_existing_authority_untouched(root: Path) -> None:
    catalog = load_json(root / "commercial" / "offers" / "catalog.v1.json")
    offer = next(item for item in catalog["offers"] if item["offer_code"] == "CFG-DIAG-EXP-v1")
    if offer.get("amount_cents") != 800000 or offer.get("billing_mode") != "ONE_TIME":
        raise ValidationError("catalog CFG-DIAG-EXP-v1 must remain 800000 / ONE_TIME")
    gates = load_json(root / "commercial" / "gates" / "production-gates.v1.json")
    if gates.get("real_money_mutation_approved") is not False:
        raise ValidationError("real_money_mutation_approved must remain false")
    authority = load_json(root / "commercial" / "authority" / "authority-manifest.v1.json")
    for artifact in authority.get("artifacts") or []:
        path = str(artifact.get("path") or "")
        if "partners" in path:
            raise ValidationError("partner files must not be added to offer authority-manifest")
    extra = load_json(root / "commercial" / "exceptions" / "extra-historical.v1.json")
    if extra["exceptions"][0].get("is_public_offer") is not False:
        raise ValidationError("Extra must remain a private exception")


def default_manifest(hashed: Mapping[str, str]) -> dict[str, Any]:
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
        "operational_use": "PRIVATE_NEGOTIATION_ONLY",
        "legal_approved": False,
        "private_negotiation_enabled": True,
        "publication_enabled": False,
        "real_partner_created": False,
        "real_money_mutation_approved": False,
        "automatic_financial_provider_mutation": False,
        "counsel_review_trigger": "FIRST_PARTNER_ATTRIBUTED_REVENUE",
        "counsel_review_trigger_reuse": "FIRST_PAYMENT_RECEIVED",
        "counsel_review_target_business_days": 10,
        "integrity_oab_conflict_auto_accept": False,
        "canonical_issue": CANONICAL_ISSUE,
        "decider_name": DECIDER,
        "decided_at": DECIDED_AT,
        "timezone": TIMEZONE,
        "confenge_legal_name": LEGAL_NAME,
        "confenge_cnpj": CNPJ,
        "forum": FORUM,
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
    if kind == "influence":
        assert_no_public_influence_claim(text, source=source)
        return
    if kind == "placeholder":
        assert_no_placeholder_debt(text, source=source)
        return
    if kind == "human_decision":
        if HUMAN_DECISION_RE.search(text):
            raise ValidationError(f"{source}: HUMAN_DECISION_REQUIRED must not remain")
        return
    raise ValidationError(f"unknown adversarial kind {kind}")


def validate_partner_dir(pkg: Path, *, root: Path | None = None) -> dict[str, Any]:
    if not pkg.is_dir():
        raise ValidationError(f"missing partner package directory {pkg}")
    root = root or repo_root(pkg)
    assert_required_files(pkg)
    for rel, text in iter_package_texts(pkg):
        assert_no_forbidden_claims(text, source=rel)
        assert_no_extra_leak(text, source=rel)
        assert_no_placeholder_debt(text, source=rel)
        assert_no_public_influence_claim(text, source=rel)
        if PII_URL_RE.search(text):
            raise ValidationError(f"{rel}: PII in URL")
        secrets = scan_forbidden_secrets(text)
        if secrets:
            raise ValidationError(f"{rel}: secret/PII scan hits {secrets}")
        if HUMAN_DECISION_RE.search(text):
            raise ValidationError(f"{rel}: HUMAN_DECISION_REQUIRED must not remain")
        if rel.endswith(".md"):
            assert_required_metadata(text, source=rel)
    agreement = load_text(pkg / "PARTNER_AGREEMENT_B2B.md")
    joined = "\n".join(text for _, text in iter_package_texts(pkg))
    assert_agreement(agreement, pkg)
    assert_schedule(load_json(pkg / "COMMISSION_SCHEDULE.json"))
    assert_events(load_json(pkg / "PARTNER_EVENT_CONTRACT.json"))
    assert_clause_matrix(load_json(pkg / "CLAUSE_MATRIX.json"), joined)
    assert_p0(load_json(pkg / "LEGAL_RISK_REGISTER.json"))
    manifest = load_json(pkg / "manifest.json")
    assert_manifest_flags(manifest)
    hashed = assert_sha256sums_match(pkg)
    assert_manifest_hashes(pkg, manifest, hashed)
    assert_schema_artifacts(pkg)
    assert_existing_authority_untouched(root)
    digest = partner_package_hash(manifest)
    return {
        "root": str(root),
        "package": str(pkg),
        "authority_hash": digest,
        "campaign_status": STATUS,
        "referral_rate_bps": REFERRAL_RATE_BPS,
        "referral_period_months": REFERRAL_PERIOD_MONTHS,
        "referral_cap_cents": REFERRAL_CAP_CENTS,
        "cosell_max_rate_bps": COSELL_MAX_RATE_BPS,
        "cosell_period_months": COSELL_PERIOD_MONTHS,
        "cosell_cap_cents": COSELL_CAP_CENTS,
        "lead_protection_days": LEAD_PROTECTION_DAYS,
        "lead_decision_business_days": LEAD_DECISION_BUSINESS_DAYS,
        "private_negotiation_enabled": True,
        "publication_enabled": False,
        "real_partner_created": False,
        "legal_approved": False,
        "real_money_mutation_approved": False,
        "p0_unmitigated": 0,
    }


def validate_partner_package(root: Path | None = None) -> dict[str, Any]:
    root = repo_root(root)
    return validate_partner_dir(package_dir(root), root=root)


def write_hashes(root: Path | None = None) -> dict[str, Any]:
    root = repo_root(root)
    pkg = package_dir(root)
    pkg.mkdir(parents=True, exist_ok=True)
    (pkg / "SHA256SUMS.txt").write_text(build_sha256sums_text(pkg), encoding="utf-8")
    hashed = {name: hash_partner_file(pkg / name) for name in HASHED_FILES}
    manifest = default_manifest(hashed)
    (pkg / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return validate_partner_package(root)


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate partner referral/co-sell package")
    parser.add_argument("--write-hashes", action="store_true")
    parser.add_argument("--root", type=Path, default=None)
    args = parser.parse_args(list(argv) if argv is not None else None)
    try:
        result = write_hashes(args.root) if args.write_hashes else validate_partner_package(args.root)
    except ValidationError as exc:
        print(f"VALIDATION_ERROR {exc}", file=sys.stderr)
        return 1
    print(f"AUTHORITY_HASH {result['authority_hash']}")
    print(f"CAMPAIGN_STATUS {result['campaign_status']}")
    print(f"REFERRAL_RATE_BPS {result['referral_rate_bps']}")
    print(f"REFERRAL_PERIOD_MONTHS {result['referral_period_months']}")
    print(f"REFERRAL_CAP_CENTS {result['referral_cap_cents']}")
    print(f"COSELL_MAX_RATE_BPS {result['cosell_max_rate_bps']}")
    print(f"COSELL_PERIOD_MONTHS {result['cosell_period_months']}")
    print(f"COSELL_CAP_CENTS {result['cosell_cap_cents']}")
    print(f"LEAD_PROTECTION_DAYS {result['lead_protection_days']}")
    print(f"LEAD_DECISION_BUSINESS_DAYS {result['lead_decision_business_days']}")
    print("PRIVATE_NEGOTIATION_ENABLED true")
    print("PUBLICATION_ENABLED false")
    print("REAL_PARTNER_CREATED false")
    print("REAL_MONEY_MUTATION_APPROVED false")
    print("PROFESSIONAL_LEGAL_REVIEW DEFERRED_UNTIL_FIRST_REVENUE")
    print("FOUNDER_RISK_ACCEPTANCE APPROVED")
    print("P0_UNMITIGATED 0")
    print("NOT_LEGAL_APPROVED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
