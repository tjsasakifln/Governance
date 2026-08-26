"""Pure, read-only commercial-to-delivery truth projection."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any, Mapping


WEB_CFG_DELIVERABLES_BLOB = "99e77f51336e7fe63af0446d7577b3b20fe9a9b0"
PAYMENT_STATES = frozenset({"PAYMENT_CREATED", "PAYMENT_CONFIRMED", "PAYMENT_RECEIVED"})


def _record(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _string(value: Any) -> str | None:
    return value if isinstance(value, str) and value.strip() else None


def _refs(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return sorted({item for item in value if isinstance(item, str) and item.strip()})


def _stable_id(prefix: str, value: Any) -> str:
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return f"{prefix}_{hashlib.sha256(payload.encode('utf-8')).hexdigest()[:32]}"


def _age_seconds(instant: Any, projected_at: str) -> int | None:
    if not isinstance(instant, str):
        return None
    try:
        start = datetime.fromisoformat(instant.replace("Z", "+00:00"))
        end = datetime.fromisoformat(projected_at.replace("Z", "+00:00"))
    except ValueError:
        return None
    if start.tzinfo is None or end.tzinfo is None:
        return None
    return max(0, int((end.astimezone(timezone.utc) - start.astimezone(timezone.utc)).total_seconds()))


def _hop(state: str, refs: list[str], reason: str | None = None) -> dict[str, Any]:
    result: dict[str, Any] = {"state": state, "evidence_refs": refs}
    if reason:
        result["reason"] = reason
    return result


def _exception(
    *,
    bucket: str,
    owner: str,
    reason: str,
    evidence: list[str],
    age_seconds: int | None,
    next_action: str,
    severity: str,
    source: Mapping[str, str],
    freshness: str,
) -> dict[str, Any]:
    basis = {"bucket": bucket, "owner": owner, "reason": reason, "evidence": evidence, "source": source}
    return {
        "schema_version": "confenge.operational_exception.v1",
        "exception_id": _stable_id("exc", basis),
        "bucket": bucket,
        "owner": owner,
        "reason": reason,
        "evidence": evidence or ["evidence:missing"],
        "age_seconds": age_seconds,
        "next_action": next_action,
        "severity": severity,
        "source": dict(source),
        "freshness": freshness,
    }


def project_commercial_chain(facts: Mapping[str, Any], *, projected_at: str) -> dict[str, Any]:
    """Project explicit facts; never promote a missing downstream hop."""

    # Validate the projection clock early without using wall-clock time.
    parsed_clock = datetime.fromisoformat(projected_at.replace("Z", "+00:00"))
    if parsed_clock.tzinfo is None:
        raise ValueError("projected_at must include a timezone")

    offer = _record(facts.get("offer"))
    proposal = _record(facts.get("proposal"))
    acceptance = _record(facts.get("acceptance"))
    financial = _record(facts.get("financial_gate"))
    provider = _record(facts.get("provider"))
    commercial_state = _record(facts.get("commercial_state"))
    work_order = _record(facts.get("work_order"))
    delivery = _record(facts.get("delivery"))
    capacity = _record(facts.get("capacity"))
    synthetic = facts.get("synthetic") is True or financial.get("synthetic") is True or provider.get("synthetic") is True

    correlation_id = _string(facts.get("correlation_id"))
    identity = {
        "correlation_id": correlation_id,
        "deliverable_id": _string(offer.get("deliverable_id")),
        "proposal_id": _string(proposal.get("proposal_id")),
        "acceptance_id": _string(acceptance.get("acceptance_id")),
        "provider_payment_id": _string(provider.get("payment_id")),
        "commercial_state_id": _string(commercial_state.get("state_id")),
        "work_order_id": _string(work_order.get("work_order_id")),
        "delivery_id": _string(delivery.get("delivery_id")),
    }

    offer_refs = _refs(offer.get("evidence_refs"))
    offer_proven = bool(identity["deliverable_id"] and offer.get("registry_blob") == WEB_CFG_DELIVERABLES_BLOB and offer_refs)
    proposal_refs = _refs(proposal.get("evidence_refs"))
    proposal_proven = bool(identity["proposal_id"] and isinstance(proposal.get("version"), int) and proposal_refs)
    acceptance_refs = _refs(acceptance.get("evidence_refs"))
    accepted = acceptance.get("state") == "ACCEPTED" and bool(identity["acceptance_id"] and acceptance_refs)
    financial_refs = _refs(financial.get("evidence_refs"))
    financial_authorized = financial.get("state") == "AUTHORIZED" and not synthetic and bool(financial_refs)
    financial_synthetic = financial.get("state") == "SYNTHETIC_VALID" and synthetic and bool(financial_refs)

    provider_refs = _refs(provider.get("evidence_refs"))
    event_type = _string(provider.get("event_type"))
    if event_type:
        event_type = event_type.upper()
    provider_proven = bool(
        event_type in PAYMENT_STATES
        and identity["provider_payment_id"]
        and _string(provider.get("provider_event_id"))
        and provider_refs
        and not synthetic
    )
    payment_state = event_type if event_type in PAYMENT_STATES and provider_proven else "UNKNOWN"

    commercial_refs = _refs(commercial_state.get("evidence_refs"))
    commercial_proven = bool(identity["commercial_state_id"] and _string(commercial_state.get("state")) and commercial_refs)
    work_order_refs = _refs(work_order.get("evidence_refs"))
    work_order_proven = bool(identity["work_order_id"] and _string(work_order.get("state")) and work_order_refs)
    delivery_refs = _refs(delivery.get("evidence_refs"))
    delivery_proven = bool(identity["delivery_id"] and _string(delivery.get("state")) and delivery_refs)

    hops = {
        "offer": _hop("PROVEN" if offer_proven else "UNKNOWN", offer_refs, None if offer_proven else "web-cfg registry pin/evidence missing"),
        "proposal": _hop("PROVEN" if proposal_proven else "UNKNOWN", proposal_refs, None if proposal_proven else "proposal/version evidence missing"),
        "acceptance": _hop("PROVEN" if accepted else "UNKNOWN", acceptance_refs, None if accepted else "accepted proposal evidence missing"),
        "financial_gate": _hop(
            "PROVEN" if financial_authorized else "SYNTHETIC" if financial_synthetic else "UNKNOWN",
            financial_refs,
            None if financial_authorized else "financial gate is absent, unknown, or synthetic",
        ),
        "provider": _hop("PROVEN" if provider_proven else "UNKNOWN", provider_refs, None if provider_proven else "provider object/event proof missing"),
        "commercial_state": _hop("PROVEN" if commercial_proven else "UNKNOWN", commercial_refs, None if commercial_proven else "commercial state evidence missing"),
        "work_order": _hop("PROVEN" if work_order_proven else "UNKNOWN", work_order_refs, None if work_order_proven else "Work Order evidence missing"),
        "delivery": _hop("PROVEN" if delivery_proven else "UNKNOWN", delivery_refs, None if delivery_proven else "delivery evidence missing"),
    }

    exceptions: list[dict[str, Any]] = []
    source = {"system": "asaas", "kind": "provider-read", "locator": "payment/event"}
    provider_age = _age_seconds(provider.get("occurred_at"), projected_at)
    if not provider_proven:
        exceptions.append(
            _exception(
                bucket="payment_provider_ambiguity",
                owner="finance",
                reason="Objeto ou evento Asaas não foi comprovado por fonte primária; o estado financeiro permanece UNKNOWN.",
                evidence=provider_refs or financial_refs or ["provider:evidence-missing"],
                age_seconds=provider_age,
                next_action="Reconciliar o objeto/evento no provider em sessão humana autorizada; não simular nem habilitar checkout.",
                severity="critical",
                source=source,
                freshness="UNKNOWN",
            )
        )
    if capacity.get("staffed_capacity_state") != "KNOWN":
        exceptions.append(
            _exception(
                bucket="capacity_unknown",
                owner="delivery_owner",
                reason="Capacidade staffed real e disponibilidade não estão publicadas.",
                evidence=_refs(capacity.get("evidence_refs")) or ["capacity:snapshot-missing"],
                age_seconds=_age_seconds(capacity.get("as_of"), projected_at),
                next_action="Publicar snapshot staffed real, calendário e WIP; manter admission e checkout fail-closed.",
                severity="critical",
                source={"system": "governance", "kind": "capacity-read", "locator": "delivery/capacity"},
                freshness="UNKNOWN",
            )
        )
    if work_order.get("state") == "BLOCKED":
        exceptions.append(
            _exception(
                bucket="delivery_blocker",
                owner=_string(work_order.get("owner")) or "delivery_owner",
                reason=_string(work_order.get("blocker_reason")) or "Work Order bloqueada sem motivo observado.",
                evidence=work_order_refs or ["work-order:blocker-evidence-missing"],
                age_seconds=_age_seconds(work_order.get("updated_at"), projected_at),
                next_action=_string(work_order.get("next_action")) or "Resolver o blocker no Work Order canônico.",
                severity="high",
                source={"system": "governance", "kind": "work-order-read", "locator": identity["work_order_id"] or "unknown"},
                freshness="UNKNOWN" if not work_order_refs else "FRESH",
            )
        )
    binding_values = {
        value
        for value in (
            correlation_id,
            _string(proposal.get("correlation_id")),
            _string(acceptance.get("correlation_id")),
            _string(provider.get("correlation_id")),
            _string(commercial_state.get("correlation_id")),
            _string(work_order.get("correlation_id")),
        )
        if value
    }
    if len(binding_values) > 1:
        exceptions.append(
            _exception(
                bucket="runtime_mismatch",
                owner="commercial_ops",
                reason="A chain identity diverge entre os hops observados.",
                evidence=[f"correlation:{value}" for value in sorted(binding_values)],
                age_seconds=None,
                next_action="Reconciliar a correlation canônica antes de promover estado financeiro ou criar Work Order.",
                severity="critical",
                source={"system": "control-center", "kind": "cross-repo-projection", "locator": "commercial-chain"},
                freshness="ERROR",
            )
        )

    paid = payment_state in {"PAYMENT_CONFIRMED", "PAYMENT_RECEIVED"}
    received_revenue = payment_state == "PAYMENT_RECEIVED" and provider_proven and not synthetic
    all_real_hops = all(item["state"] == "PROVEN" for item in hops.values())
    readiness = "PROVEN" if all_real_hops and received_revenue and not exceptions else "BLOCKED" if exceptions else "NOT_PROVEN"
    basis = {"identity": identity, "projected_at": projected_at, "synthetic": synthetic}
    return {
        "schema_version": "confenge.commercial_chain_projection.v1",
        "chain_id": _stable_id("chain", basis),
        "projected_at": projected_at,
        "synthetic": synthetic,
        "chain_identity": identity,
        "hops": hops,
        "payment": {
            "state": payment_state,
            "provider_proven": provider_proven,
            "paid": paid,
            "received_revenue": received_revenue,
        },
        "readiness": readiness,
        "exceptions": exceptions,
        "mutations_performed": 0,
    }
