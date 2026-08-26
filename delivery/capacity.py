"""Deterministic capacity admission and durable idempotent allocations."""

from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

from .readiness import canonical_json, readiness_for_admission


class CapacityError(ValueError):
    """Raised when an allocation command would violate capacity policy."""


TERMINAL_WORK_ORDER_STAGES = frozenset({"CLOSED", "CANCELLED"})
ALLOCATION_STATES = frozenset(
    {"HELD", "COMMITTED", "RELEASED", "EXPIRED", "RECONCILIATION_REQUIRED"}
)
WORK_ORDER_STAGES = frozenset(
    {
        "AWAITING_INPUTS",
        "READY",
        "IN_PROGRESS",
        "BLOCKED",
        "QA",
        "READY_TO_DELIVER",
        "DELIVERED",
        "ACCEPTED",
        "REWORK_REQUIRED",
        *TERMINAL_WORK_ORDER_STAGES,
    }
)

V2_ALLOCATION_STATES = frozenset(
    {"HELD", "COMMITTED", "RELEASED", "EXPIRED", "RECONCILIATION_REQUIRED"}
)

_REASON_DETAILS: dict[str, tuple[str, str]] = {
    "POLICY_CEILING_UNKNOWN": (
        "commercial/capacity/capacity-policy.v1.json",
        "Publicar uma policy ceiling versionada; não substituí-la por capacidade staffed.",
    ),
    "CAPACITY_REQUEST_INVALID": (
        "schemas/capacity-admission.v2.schema.json",
        "Corrigir request_id/correlation/deliverable/version/scope/deadline antes de avaliar.",
    ),
    "STAFFED_CAPACITY_UNKNOWN": (
        "tjsasakifln/Governance#123",
        "Delivery owner deve publicar snapshot staffed real, datado e com evidência; não estimar capacidade humana.",
    ),
    "CAPACITY_SNAPSHOT_INVALID": (
        "schemas/staffed-capacity-snapshot.v2.schema.json",
        "Corrigir ou republicar o snapshot staffed sem copiar o teto comercial.",
    ),
    "CAPACITY_SNAPSHOT_FROM_FUTURE": (
        "schemas/staffed-capacity-snapshot.v2.schema.json",
        "Reconciliar o relógio e republicar o snapshot antes de prometer prazo.",
    ),
    "CAPACITY_SNAPSHOT_STALE": (
        "tjsasakifln/Governance#123",
        "Delivery owner deve renovar o snapshot staffed expirado.",
    ),
    "WORKING_CALENDAR_UNKNOWN": (
        "schemas/working-calendar.v1.schema.json",
        "Publicar o calendário operacional versionado aplicável ao prazo solicitado.",
    ),
    "WORKING_CALENDAR_INVALID": (
        "schemas/working-calendar.v1.schema.json",
        "Corrigir o calendário versionado e sua janela de validade.",
    ),
    "CALENDAR_VERSION_DIVERGED": (
        "schemas/working-calendar.v1.schema.json",
        "Reconciliar a versão do calendário entre request e snapshot staffed.",
    ),
    "WORKING_CALENDAR_OUT_OF_RANGE": (
        "schemas/working-calendar.v1.schema.json",
        "Publicar calendário que cubra a avaliação e o prazo solicitado.",
    ),
    "READINESS_UNKNOWN": (
        "tjsasakifln/Governance#122",
        "Materializar ou atualizar readiness do deliverable/version exato; UNKNOWN permanece fail-closed.",
    ),
    "READINESS_NOT_READY": (
        "tjsasakifln/Governance#122",
        "Resolver os blockers de readiness antes de aceitar o trabalho.",
    ),
    "READINESS_EVIDENCE_INVALID": (
        "schemas/delivery-readiness.v1.schema.json",
        "Corrigir evidência, effort versionado e dependências da readiness.",
    ),
    "READINESS_FROM_FUTURE": (
        "schemas/delivery-readiness.v1.schema.json",
        "Reconciliar o relógio da avaliação de readiness.",
    ),
    "READINESS_STALE": (
        "tjsasakifln/Governance#122",
        "Reavaliar a readiness expirada do deliverable/version.",
    ),
    "DELIVERABLE_BINDING_DIVERGED": (
        "tjsasakifln/web-cfg#329",
        "Reconciliar deliverable/version/scope com os pins do catálogo antes de avaliar capacidade.",
    ),
    "ESTIMATED_EFFORT_UNKNOWN": (
        "tjsasakifln/Governance#122",
        "Publicar estimated effort e sua versão na readiness; não inferir esforço humano.",
    ),
    "WORK_ORDER_SNAPSHOT_UNKNOWN": (
        "tjsasakifln/Governance#121",
        "Publicar snapshot completo e read-only das Work Orders canônicas.",
    ),
    "WORK_ORDER_SNAPSHOT_INVALID": (
        "schemas/work-order-capacity-snapshot.v1.schema.json",
        "Reconstruir o snapshot de WIP a partir das Work Orders canônicas.",
    ),
    "WORK_ORDER_SNAPSHOT_STALE": (
        "tjsasakifln/Governance#121",
        "Atualizar a projeção de todas as Work Orders antes da admissão.",
    ),
    "WORK_ORDER_INVENTORY_INCOMPLETE": (
        "tjsasakifln/Governance#121",
        "Reexecutar a leitura completa; 100% das Work Orders não terminais devem entrar no WIP.",
    ),
    "ACTIVE_WIP_INVALID": (
        "schemas/work-order.v1.schema.json",
        "Corrigir identidade/stage da Work Order na fonte canônica.",
    ),
    "ACTIVE_WIP_EFFORT_UNKNOWN": (
        "schemas/work-order.v1.schema.json",
        "Registrar estimated_capacity_units na Work Order; não inferir esforço.",
    ),
    "ALLOCATION_SNAPSHOT_UNKNOWN": (
        "schemas/capacity-allocation-snapshot.v1.schema.json",
        "Publicar o snapshot completo do modelo de holds ou declarar explicitamente que está vazio.",
    ),
    "ALLOCATION_SNAPSHOT_INVALID": (
        "schemas/capacity-allocation-snapshot.v1.schema.json",
        "Reconciliar o snapshot de holds model-only antes de nova admissão.",
    ),
    "ALLOCATION_SNAPSHOT_STALE": (
        "schemas/capacity-allocation-snapshot.v1.schema.json",
        "Atualizar o snapshot de holds antes de nova admissão.",
    ),
    "ALLOCATION_INVENTORY_INCOMPLETE": (
        "tjsasakifln/Governance#123",
        "Reconstruir todos os holds/commits modelados antes de calcular available.",
    ),
    "RECONCILIATION_REQUIRED": (
        "tjsasakifln/Governance#123",
        "Resolver cancellation/refund/timeout ambíguo por evidência humana antes de liberar ou consumir capacidade.",
    ),
    "REQUESTED_DEADLINE_UNKNOWN": (
        "schemas/capacity-admission.v2.schema.json",
        "Obter prazo solicitado explícito e versionado; não prometer por default.",
    ),
    "REQUESTED_DEADLINE_INFEASIBLE": (
        "tjsasakifln/Governance#123",
        "Negociar prazo posterior à primeira data viável ou recusar a admissão.",
    ),
    "INSUFFICIENT_STAFFED_CAPACITY": (
        "tjsasakifln/Governance#123",
        "Aguardar capacidade staffed comprovada ou recusar; não usar o teto 50 como inventário.",
    ),
    "POLICY_CEILING_REACHED": (
        "commercial/capacity/capacity-policy.v1.json",
        "Não admitir além do teto comercial; alteração exige nova decisão de autoridade.",
    ),
    "ADMISSION_GATES_SATISFIED": (
        "delivery/capacity.py:evaluate_admission_v2",
        "Consumir esta decisão somente no escopo e até o expiry publicados.",
    ),
}


def _parse_instant(value: str, field: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (AttributeError, ValueError) as exc:
        raise CapacityError(f"{field} must be an ISO-8601 instant") from exc
    if parsed.tzinfo is None:
        raise CapacityError(f"{field} must include a timezone")
    return parsed.astimezone(timezone.utc)


def _parse_day(value: str, field: str) -> date:
    try:
        return date.fromisoformat(value)
    except (AttributeError, ValueError) as exc:
        raise CapacityError(f"{field} must be an ISO-8601 date") from exc


def _stable_id(prefix: str, value: Any) -> str:
    digest = hashlib.sha256(canonical_json(value)).hexdigest()
    return f"{prefix}_{digest[:32]}"


def _is_working_day(day: date, calendar: Mapping[str, Any]) -> bool:
    weekdays = calendar.get("working_weekdays")
    holidays = calendar.get("holidays")
    if (
        not isinstance(weekdays, list)
        or not weekdays
        or not all(isinstance(item, int) and not isinstance(item, bool) and 0 <= item <= 6 for item in weekdays)
        or len(set(weekdays)) != len(weekdays)
    ):
        raise CapacityError("working calendar lacks working_weekdays")
    if not isinstance(holidays, list) or not all(isinstance(item, str) for item in holidays):
        raise CapacityError("working calendar lacks holidays")
    for holiday in holidays:
        _parse_day(holiday, "calendar.holidays")
    return day.weekday() in weekdays and day.isoformat() not in set(holidays)


def add_business_days(start: date, amount: int, calendar: Mapping[str, Any]) -> date:
    """Add business days after ``start`` under a pinned calendar."""

    if amount <= 0:
        raise CapacityError("business-day amount must be positive")
    current = start
    remaining = amount
    while remaining:
        current += timedelta(days=1)
        if _is_working_day(current, calendar):
            remaining -= 1
    return current


def _unknown_decision(
    *,
    request: Mapping[str, Any],
    evaluated_at: str,
    reasons: list[str],
    readiness: Mapping[str, Any] | None,
    capacity_snapshot: Mapping[str, Any] | None,
) -> dict[str, Any]:
    basis = {
        "request_id": request.get("request_id"),
        "evaluated_at": evaluated_at,
        "reasons": reasons,
        "readiness_ref": readiness.get("readiness_ref") if readiness else None,
        "capacity_snapshot_id": capacity_snapshot.get("capacity_snapshot_id") if capacity_snapshot else None,
    }
    return {
        "schema_version": "confenge.capacity_admission.v1",
        "decision_id": _stable_id("cadm", basis),
        "decision": "UNKNOWN",
        "reason_codes": reasons,
        "request_id": request.get("request_id"),
        "evaluated_at": evaluated_at,
        "synthetic": bool(capacity_snapshot and capacity_snapshot.get("synthetic")),
        "capacity_snapshot_id": capacity_snapshot.get("capacity_snapshot_id") if capacity_snapshot else None,
        "readiness_ref": readiness.get("readiness_ref") if readiness else None,
    }


def evaluate_admission(
    *,
    request: Mapping[str, Any],
    readiness: Mapping[str, Any] | None,
    capacity_snapshot: Mapping[str, Any] | None,
    active_work_orders: Sequence[Mapping[str, Any]] | None,
    reserved_effort_units: int | None,
    evaluated_at: str,
) -> dict[str, Any]:
    """Pure fail-closed admission decision.

    The policy ceiling from the legacy commercial file is intentionally not an
    input.  Only a fresh staffed snapshot, active Work Order WIP, readiness
    evidence, estimated effort, requested deadline and a pinned calendar can
    yield ``CAN_ACCEPT``.
    """

    now = _parse_instant(evaluated_at, "evaluated_at")
    readiness_verdict = readiness_for_admission(readiness, evaluated_at=evaluated_at)
    if readiness_verdict["verdict"] == "UNKNOWN":
        return _unknown_decision(
            request=request,
            evaluated_at=evaluated_at,
            reasons=readiness_verdict["reason_codes"],
            readiness=readiness,
            capacity_snapshot=capacity_snapshot,
        )
    if readiness_verdict["verdict"] == "CANNOT_ACCEPT":
        result = _unknown_decision(
            request=request,
            evaluated_at=evaluated_at,
            reasons=readiness_verdict["reason_codes"],
            readiness=readiness,
            capacity_snapshot=capacity_snapshot,
        )
        result["decision"] = "CANNOT_ACCEPT"
        return result

    if not capacity_snapshot:
        return _unknown_decision(
            request=request,
            evaluated_at=evaluated_at,
            reasons=["STAFFED_CAPACITY_UNKNOWN"],
            readiness=readiness,
            capacity_snapshot=None,
        )
    if capacity_snapshot.get("schema_version") != "confenge.staffed_capacity_snapshot.v1":
        return _unknown_decision(
            request=request,
            evaluated_at=evaluated_at,
            reasons=["CAPACITY_SNAPSHOT_INVALID"],
            readiness=readiness,
            capacity_snapshot=capacity_snapshot,
        )
    staffed_units = capacity_snapshot.get("staffed_capacity_units")
    if not isinstance(staffed_units, int) or staffed_units < 0:
        return _unknown_decision(
            request=request,
            evaluated_at=evaluated_at,
            reasons=["STAFFED_CAPACITY_UNKNOWN"],
            readiness=readiness,
            capacity_snapshot=capacity_snapshot,
        )
    try:
        snapshot_as_of = _parse_instant(capacity_snapshot.get("as_of"), "capacity.as_of")
        snapshot_expiry = _parse_instant(capacity_snapshot.get("expires_at"), "capacity.expires_at")
    except CapacityError:
        return _unknown_decision(
            request=request,
            evaluated_at=evaluated_at,
            reasons=["CAPACITY_FRESHNESS_UNKNOWN"],
            readiness=readiness,
            capacity_snapshot=capacity_snapshot,
        )
    if snapshot_as_of >= snapshot_expiry or now < snapshot_as_of:
        return _unknown_decision(
            request=request,
            evaluated_at=evaluated_at,
            reasons=["CAPACITY_SNAPSHOT_FROM_FUTURE"],
            readiness=readiness,
            capacity_snapshot=capacity_snapshot,
        )
    if now >= snapshot_expiry:
        return _unknown_decision(
            request=request,
            evaluated_at=evaluated_at,
            reasons=["CAPACITY_SNAPSHOT_STALE"],
            readiness=readiness,
            capacity_snapshot=capacity_snapshot,
        )
    if active_work_orders is None:
        return _unknown_decision(
            request=request,
            evaluated_at=evaluated_at,
            reasons=["ACTIVE_WIP_UNKNOWN"],
            readiness=readiness,
            capacity_snapshot=capacity_snapshot,
        )
    if not isinstance(reserved_effort_units, int) or reserved_effort_units < 0:
        return _unknown_decision(
            request=request,
            evaluated_at=evaluated_at,
            reasons=["CAPACITY_ALLOCATIONS_UNKNOWN"],
            readiness=readiness,
            capacity_snapshot=capacity_snapshot,
        )
    if (
        capacity_snapshot.get("unit") != "delivery_slot"
        or capacity_snapshot.get("policy_ceiling_used_as_staffed_capacity") is not False
        or capacity_snapshot.get("real_checkout_enabled") is not False
        or not capacity_snapshot.get("evidence_refs")
    ):
        return _unknown_decision(
            request=request,
            evaluated_at=evaluated_at,
            reasons=["CAPACITY_SNAPSHOT_INVALID"],
            readiness=readiness,
            capacity_snapshot=capacity_snapshot,
        )

    if (
        request.get("deliverable_id") != readiness.get("deliverable_id")
        or request.get("deliverable_version") != readiness.get("deliverable_version")
    ):
        return _unknown_decision(
            request=request,
            evaluated_at=evaluated_at,
            reasons=["DELIVERABLE_BINDING_DIVERGED"],
            readiness=readiness,
            capacity_snapshot=capacity_snapshot,
        )
    if request.get("calendar_version") != capacity_snapshot.get("working_calendar", {}).get("version"):
        return _unknown_decision(
            request=request,
            evaluated_at=evaluated_at,
            reasons=["CALENDAR_VERSION_DIVERGED"],
            readiness=readiness,
            capacity_snapshot=capacity_snapshot,
        )

    active_effort = 0
    seen_work_order_ids: set[str] = set()
    for work_order in active_work_orders:
        if not isinstance(work_order, Mapping):
            return _unknown_decision(
                request=request,
                evaluated_at=evaluated_at,
                reasons=["ACTIVE_WIP_INVALID"],
                readiness=readiness,
                capacity_snapshot=capacity_snapshot,
            )
        work_order_id = work_order.get("work_order_id")
        stage = work_order.get("current_stage")
        if (
            not isinstance(work_order_id, str)
            or not work_order_id
            or work_order_id in seen_work_order_ids
            or stage not in WORK_ORDER_STAGES
        ):
            return _unknown_decision(
                request=request,
                evaluated_at=evaluated_at,
                reasons=["ACTIVE_WIP_INVALID"],
                readiness=readiness,
                capacity_snapshot=capacity_snapshot,
            )
        seen_work_order_ids.add(work_order_id)
        if stage in TERMINAL_WORK_ORDER_STAGES:
            continue
        effort = work_order.get("estimated_capacity_units")
        if not isinstance(effort, int) or effort <= 0:
            return _unknown_decision(
                request=request,
                evaluated_at=evaluated_at,
                reasons=["ACTIVE_WIP_EFFORT_UNKNOWN"],
                readiness=readiness,
                capacity_snapshot=capacity_snapshot,
            )
        active_effort += effort

    estimated_effort = readiness["estimated_effort"]
    effort_units = estimated_effort.get("amount")
    if not isinstance(effort_units, int) or effort_units <= 0:
        return _unknown_decision(
            request=request,
            evaluated_at=evaluated_at,
            reasons=["ESTIMATED_EFFORT_UNKNOWN"],
            readiness=readiness,
            capacity_snapshot=capacity_snapshot,
        )

    calendar = capacity_snapshot.get("working_calendar")
    requested_deadline = request.get("requested_deadline")
    if not isinstance(calendar, Mapping) or not requested_deadline:
        return _unknown_decision(
            request=request,
            evaluated_at=evaluated_at,
            reasons=["DEADLINE_OR_CALENDAR_UNKNOWN"],
            readiness=readiness,
            capacity_snapshot=capacity_snapshot,
        )
    try:
        deadline_day = _parse_day(requested_deadline, "requested_deadline")
        calendar_valid_from = _parse_day(calendar.get("valid_from"), "calendar.valid_from")
        calendar_valid_until = _parse_day(calendar.get("valid_until"), "calendar.valid_until")
        earliest_due = add_business_days(
            now.date(),
            estimated_effort["lead_time_business_days"],
            calendar,
        )
    except CapacityError:
        return _unknown_decision(
            request=request,
            evaluated_at=evaluated_at,
            reasons=["WORKING_CALENDAR_INVALID"],
            readiness=readiness,
            capacity_snapshot=capacity_snapshot,
        )
    if not calendar_valid_from <= now.date() <= calendar_valid_until or deadline_day > calendar_valid_until:
        return _unknown_decision(
            request=request,
            evaluated_at=evaluated_at,
            reasons=["WORKING_CALENDAR_OUT_OF_RANGE"],
            readiness=readiness,
            capacity_snapshot=capacity_snapshot,
        )

    available = staffed_units - active_effort - reserved_effort_units
    decision = "CAN_ACCEPT"
    reasons: list[str] = []
    if staffed_units == 0 or available < effort_units:
        decision = "CANNOT_ACCEPT"
        reasons.append("INSUFFICIENT_STAFFED_CAPACITY")
    if earliest_due > deadline_day:
        decision = "CANNOT_ACCEPT"
        reasons.append("REQUESTED_DEADLINE_INFEASIBLE")

    basis = {
        "request": request,
        "readiness_hash": readiness_verdict["readiness_hash"],
        "capacity_snapshot_id": capacity_snapshot["capacity_snapshot_id"],
        "active_work_orders": list(active_work_orders),
        "reserved_effort_units": reserved_effort_units,
        "evaluated_at": evaluated_at,
    }
    return {
        "schema_version": "confenge.capacity_admission.v1",
        "decision_id": _stable_id("cadm", basis),
        "decision": decision,
        "reason_codes": reasons,
        "request_id": request.get("request_id"),
        "correlation_id": request.get("correlation_id"),
        "evaluated_at": evaluated_at,
        "synthetic": bool(capacity_snapshot.get("synthetic")),
        "capacity_snapshot_id": capacity_snapshot["capacity_snapshot_id"],
        "readiness_ref": readiness_verdict["readiness_ref"],
        "readiness_hash": readiness_verdict["readiness_hash"],
        "staffed_capacity_units": staffed_units,
        "active_wip_units": active_effort,
        "active_work_order_ids": [
            item["work_order_id"]
            for item in active_work_orders
            if item.get("current_stage") not in TERMINAL_WORK_ORDER_STAGES
        ],
        "reserved_effort_units": reserved_effort_units,
        "requested_effort_units": effort_units,
        "available_effort_units": max(0, available),
        "capacity_limit_after_wip_units": max(0, staffed_units - active_effort),
        "earliest_due": earliest_due.isoformat(),
        "requested_deadline": deadline_day.isoformat(),
        "calendar_version": calendar["version"],
    }


def _valid_non_negative_integer(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def _freshness(
    value: Mapping[str, Any], *, now: datetime, label: str
) -> tuple[str, datetime | None, datetime | None]:
    try:
        observed = _parse_instant(value.get("as_of"), f"{label}.as_of")
        expiry = _parse_instant(value.get("expires_at"), f"{label}.expires_at")
    except CapacityError:
        return "INVALID", None, None
    if observed >= expiry:
        return "INVALID", observed, expiry
    if observed > now:
        return "FUTURE", observed, expiry
    if now >= expiry:
        return "STALE", observed, expiry
    return "FRESH", observed, expiry


def _v2_blockers(reason_codes: Sequence[str]) -> list[dict[str, str]]:
    blockers: list[dict[str, str]] = []
    for code in reason_codes:
        if code == "ADMISSION_GATES_SATISFIED":
            continue
        source_ref, next_action = _REASON_DETAILS.get(
            code,
            (
                "tjsasakifln/Governance#123",
                "Reconciliar a evidência na autoridade canônica antes de admitir.",
            ),
        )
        blockers.append(
            {"code": code, "source_ref": source_ref, "next_action": next_action}
        )
    return blockers


def evaluate_admission_v2(
    *,
    request: Mapping[str, Any],
    readiness: Mapping[str, Any] | None,
    policy_ceiling: Mapping[str, Any] | None,
    capacity_snapshot: Mapping[str, Any] | None,
    working_calendar: Mapping[str, Any] | None,
    work_order_snapshot: Mapping[str, Any] | None,
    allocation_snapshot: Mapping[str, Any] | None,
    evaluated_at: str,
) -> dict[str, Any]:
    """Evaluate admission from versioned authorities without mutating them.

    This is the canonical v2 evaluator.  The v1 evaluator above remains intact
    for existing canary consumers.  Policy ceiling constrains admission but is
    never used as staffed inventory.  Work Orders are read as a complete,
    freshness-bounded snapshot; every non-terminal row consumes its canonical
    ``estimated_capacity_units`` exactly once.
    """

    now = _parse_instant(evaluated_at, "evaluated_at")
    unknown_reasons: list[str] = []
    cannot_reasons: list[str] = []

    def unknown(code: str) -> None:
        if code not in unknown_reasons:
            unknown_reasons.append(code)

    def cannot(code: str) -> None:
        if code not in cannot_reasons:
            cannot_reasons.append(code)

    request_view = {
        "request_id": request.get("request_id"),
        "correlation_id": request.get("correlation_id"),
        "deliverable_id": request.get("deliverable_id"),
        "deliverable_version": request.get("deliverable_version"),
        "scope_version": request.get("scope_version"),
        "requested_deadline": request.get("requested_deadline"),
    }
    if (
        request.get("schema_version") != "confenge.capacity_request.v1"
        or not all(
            isinstance(request.get(field), str) and bool(request.get(field))
            for field in (
                "request_id",
                "correlation_id",
                "deliverable_id",
                "deliverable_version",
                "scope_version",
            )
        )
    ):
        unknown("CAPACITY_REQUEST_INVALID")

    policy_version: str | None = None
    policy_units: int | None = None
    policy_unit: str | None = None
    policy_evidence: str | None = None
    if not isinstance(policy_ceiling, Mapping):
        unknown("POLICY_CEILING_UNKNOWN")
    else:
        policy_version = policy_ceiling.get("version")
        policy_units = policy_ceiling.get("ceiling_units")
        policy_unit = policy_ceiling.get("unit")
        policy_evidence = policy_ceiling.get("evidence_ref")
        if (
            not isinstance(policy_version, str)
            or not policy_version
            or not _valid_non_negative_integer(policy_units)
            or policy_unit != "delivery_slot"
            or not isinstance(policy_evidence, str)
            or not policy_evidence
        ):
            policy_version = policy_version if isinstance(policy_version, str) else None
            policy_units = None
            policy_unit = None
            policy_evidence = None
            unknown("POLICY_CEILING_UNKNOWN")

    staffed_units: int | None = None
    capacity_id: str | None = None
    capacity_version: int | None = None
    capacity_as_of: str | None = None
    capacity_expires_at: str | None = None
    capacity_freshness = "UNKNOWN"
    capacity_calendar_version: str | None = None
    capacity_synthetic = False
    expiry_candidates: list[datetime] = []
    if not isinstance(capacity_snapshot, Mapping):
        unknown("STAFFED_CAPACITY_UNKNOWN")
    elif capacity_snapshot.get("schema_version") != "confenge.staffed_capacity_snapshot.v2":
        unknown("CAPACITY_SNAPSHOT_INVALID")
    else:
        capacity_id = capacity_snapshot.get("capacity_snapshot_id")
        capacity_version = capacity_snapshot.get("version")
        capacity_as_of = capacity_snapshot.get("as_of")
        capacity_expires_at = capacity_snapshot.get("expires_at")
        capacity_calendar_version = capacity_snapshot.get("working_calendar_version")
        capacity_synthetic = capacity_snapshot.get("synthetic") is True
        staffed_units = capacity_snapshot.get("staffed_capacity_units")
        freshness_policy = capacity_snapshot.get("freshness")
        if (
            not isinstance(capacity_id, str)
            or not capacity_id
            or not isinstance(capacity_version, int)
            or isinstance(capacity_version, bool)
            or capacity_version < 1
            or not _valid_non_negative_integer(staffed_units)
            or capacity_snapshot.get("unit") != "delivery_slot"
            or capacity_snapshot.get("policy_ceiling_used_as_staffed_capacity") is not False
            or capacity_snapshot.get("mutation_mode") != "MODEL_ONLY"
            or not capacity_snapshot.get("evidence_refs")
            or not isinstance(capacity_calendar_version, str)
            or not capacity_calendar_version
            or not isinstance(freshness_policy, Mapping)
            or freshness_policy.get("basis") != "EXPLICIT_EXPIRY"
            or not isinstance(freshness_policy.get("max_age_seconds"), int)
            or isinstance(freshness_policy.get("max_age_seconds"), bool)
            or freshness_policy.get("max_age_seconds") <= 0
        ):
            staffed_units = None
            unknown("CAPACITY_SNAPSHOT_INVALID")
        freshness, _, expiry = _freshness(
            capacity_snapshot, now=now, label="capacity_snapshot"
        )
        capacity_freshness = freshness if freshness in {"FRESH", "STALE"} else "UNKNOWN"
        if freshness == "INVALID":
            unknown("CAPACITY_SNAPSHOT_INVALID")
        elif freshness == "FUTURE":
            unknown("CAPACITY_SNAPSHOT_FROM_FUTURE")
        elif freshness == "STALE":
            unknown("CAPACITY_SNAPSHOT_STALE")
        elif expiry is not None:
            expiry_candidates.append(expiry)
        if (
            expiry is not None
            and capacity_as_of is not None
            and isinstance(freshness_policy, Mapping)
            and isinstance(freshness_policy.get("max_age_seconds"), int)
        ):
            try:
                observed = _parse_instant(capacity_as_of, "capacity_snapshot.as_of")
            except CapacityError:
                pass
            else:
                if int((expiry - observed).total_seconds()) != freshness_policy["max_age_seconds"]:
                    unknown("CAPACITY_SNAPSHOT_INVALID")

    readiness_verdict = readiness_for_admission(readiness, evaluated_at=evaluated_at)
    if readiness_verdict["verdict"] == "UNKNOWN":
        for reason in readiness_verdict["reason_codes"]:
            unknown(reason)
    elif readiness_verdict["verdict"] == "CANNOT_ACCEPT":
        for reason in readiness_verdict["reason_codes"]:
            cannot(reason)

    readiness_ref = readiness_verdict.get("readiness_ref")
    readiness_hash = readiness_verdict.get("readiness_hash")
    readiness_state = readiness_verdict.get("readiness_state")
    requested_effort_units: int | None = None
    effort_version: str | None = None
    lead_time: int | None = None
    if readiness_verdict.get("verdict") == "READY" and isinstance(readiness, Mapping):
        if (
            request.get("deliverable_id") != readiness.get("deliverable_id")
            or request.get("deliverable_version") != readiness.get("deliverable_version")
            or request.get("scope_version") != readiness.get("scope", {}).get("version")
        ):
            unknown("DELIVERABLE_BINDING_DIVERGED")
        effort = readiness.get("estimated_effort")
        if isinstance(effort, Mapping):
            requested_effort_units = effort.get("amount")
            effort_version = effort.get("version")
            lead_time = effort.get("lead_time_business_days")
        if (
            not isinstance(effort, Mapping)
            or not isinstance(requested_effort_units, int)
            or isinstance(requested_effort_units, bool)
            or requested_effort_units <= 0
            or effort.get("unit") != "delivery_slot"
            or not isinstance(effort_version, str)
            or not effort_version
            or not isinstance(lead_time, int)
            or isinstance(lead_time, bool)
            or lead_time <= 0
        ):
            requested_effort_units = None
            effort_version = None
            lead_time = None
            unknown("ESTIMATED_EFFORT_UNKNOWN")
        try:
            readiness_expiry = _parse_instant(
                readiness.get("freshness", {}).get("expires_at"),
                "readiness.freshness.expires_at",
            )
        except CapacityError:
            pass
        else:
            expiry_candidates.append(readiness_expiry)

    calendar_version: str | None = None
    calendar_freshness = "UNKNOWN"
    calendar: Mapping[str, Any] | None = None
    if not isinstance(working_calendar, Mapping):
        unknown("WORKING_CALENDAR_UNKNOWN")
    elif working_calendar.get("schema_version") != "confenge.working_calendar.v1":
        unknown("WORKING_CALENDAR_INVALID")
    else:
        calendar = working_calendar
        calendar_version = working_calendar.get("version")
        if (
            not isinstance(calendar_version, str)
            or not calendar_version
            or not isinstance(working_calendar.get("calendar_id"), str)
            or not working_calendar.get("calendar_id")
            or working_calendar.get("unit") != "business_day"
            or working_calendar.get("timezone") != "America/Sao_Paulo"
            or (
                capacity_id is not None
                and working_calendar.get("synthetic") != capacity_synthetic
            )
            or not working_calendar.get("evidence_refs")
        ):
            calendar = None
            unknown("WORKING_CALENDAR_INVALID")
        if calendar is not None and (
            request.get("calendar_version") != calendar_version
            or (
                capacity_calendar_version is not None
                and capacity_calendar_version != calendar_version
            )
        ):
            unknown("CALENDAR_VERSION_DIVERGED")
        calendar_freshness = "FRESH" if calendar is not None else "UNKNOWN"

    wip_snapshot_id: str | None = None
    wip_as_of: str | None = None
    wip_freshness = "UNKNOWN"
    wip_complete = False
    non_terminal_ids: list[str] = []
    active_wip_units: int | None = None
    blocked_effort_units: int | None = None
    if not isinstance(work_order_snapshot, Mapping):
        unknown("WORK_ORDER_SNAPSHOT_UNKNOWN")
    elif work_order_snapshot.get("schema_version") != "confenge.work_order_capacity_snapshot.v1":
        unknown("WORK_ORDER_SNAPSHOT_INVALID")
    else:
        wip_snapshot_id = work_order_snapshot.get("snapshot_id")
        wip_as_of = work_order_snapshot.get("as_of")
        wip_complete = work_order_snapshot.get("complete") is True
        freshness, _, expiry = _freshness(
            work_order_snapshot, now=now, label="work_order_snapshot"
        )
        wip_freshness = freshness if freshness in {"FRESH", "STALE"} else "UNKNOWN"
        if freshness == "INVALID" or freshness == "FUTURE":
            unknown("WORK_ORDER_SNAPSHOT_INVALID")
        elif freshness == "STALE":
            unknown("WORK_ORDER_SNAPSHOT_STALE")
        elif expiry is not None:
            expiry_candidates.append(expiry)
        if not wip_complete:
            unknown("WORK_ORDER_INVENTORY_INCOMPLETE")
        rows = work_order_snapshot.get("work_orders")
        if (
            not isinstance(wip_snapshot_id, str)
            or not wip_snapshot_id
            or not isinstance(work_order_snapshot.get("source_ref"), str)
            or not work_order_snapshot.get("source_ref")
            or not isinstance(rows, list)
        ):
            unknown("WORK_ORDER_SNAPSHOT_INVALID")
        else:
            active_wip_units = 0
            blocked_effort_units = 0
            seen: set[str] = set()
            for row in rows:
                work_order_id = row.get("work_order_id") if isinstance(row, Mapping) else None
                stage = row.get("current_stage") if isinstance(row, Mapping) else None
                effort_units = row.get("estimated_capacity_units") if isinstance(row, Mapping) else None
                if (
                    not isinstance(work_order_id, str)
                    or not work_order_id
                    or work_order_id in seen
                    or stage not in WORK_ORDER_STAGES
                ):
                    unknown("ACTIVE_WIP_INVALID")
                    continue
                seen.add(work_order_id)
                if stage in TERMINAL_WORK_ORDER_STAGES:
                    continue
                non_terminal_ids.append(work_order_id)
                if (
                    not isinstance(effort_units, int)
                    or isinstance(effort_units, bool)
                    or effort_units <= 0
                ):
                    unknown("ACTIVE_WIP_EFFORT_UNKNOWN")
                    active_wip_units = None
                    blocked_effort_units = None
                    continue
                if active_wip_units is not None:
                    active_wip_units += effort_units
                if blocked_effort_units is not None and (
                    stage == "BLOCKED" or bool(row.get("blockers"))
                ):
                    blocked_effort_units += effort_units

    allocation_snapshot_id: str | None = None
    allocation_freshness = "UNKNOWN"
    held_units: int | None = None
    reconciliation_units: int | None = None
    if not isinstance(allocation_snapshot, Mapping):
        unknown("ALLOCATION_SNAPSHOT_UNKNOWN")
    elif allocation_snapshot.get("schema_version") != "confenge.capacity_allocation_snapshot.v1":
        unknown("ALLOCATION_SNAPSHOT_INVALID")
    else:
        allocation_snapshot_id = allocation_snapshot.get("snapshot_id")
        freshness, _, expiry = _freshness(
            allocation_snapshot, now=now, label="allocation_snapshot"
        )
        allocation_freshness = freshness if freshness in {"FRESH", "STALE"} else "UNKNOWN"
        if freshness == "INVALID" or freshness == "FUTURE":
            unknown("ALLOCATION_SNAPSHOT_INVALID")
        elif freshness == "STALE":
            unknown("ALLOCATION_SNAPSHOT_STALE")
        elif expiry is not None:
            expiry_candidates.append(expiry)
        if allocation_snapshot.get("complete") is not True:
            unknown("ALLOCATION_INVENTORY_INCOMPLETE")
        allocations = allocation_snapshot.get("allocations")
        if (
            not isinstance(allocation_snapshot_id, str)
            or not allocation_snapshot_id
            or allocation_snapshot.get("mutation_mode") != "MODEL_ONLY"
            or not isinstance(allocations, list)
        ):
            unknown("ALLOCATION_SNAPSHOT_INVALID")
        else:
            held_units = 0
            reconciliation_units = 0
            seen_allocations: set[str] = set()
            active_ids = set(non_terminal_ids)
            for row in allocations:
                allocation_id = row.get("allocation_id") if isinstance(row, Mapping) else None
                state = row.get("state") if isinstance(row, Mapping) else None
                effort_units = row.get("effort_units") if isinstance(row, Mapping) else None
                if (
                    not isinstance(allocation_id, str)
                    or not allocation_id
                    or allocation_id in seen_allocations
                    or state not in V2_ALLOCATION_STATES
                    or not isinstance(effort_units, int)
                    or isinstance(effort_units, bool)
                    or effort_units <= 0
                ):
                    unknown("ALLOCATION_SNAPSHOT_INVALID")
                    continue
                seen_allocations.add(allocation_id)
                if state == "HELD":
                    held_units += effort_units
                elif state == "RECONCILIATION_REQUIRED":
                    if row.get("ambiguity_reason") not in {
                        "CANCELLATION_AMBIGUOUS",
                        "REFUND_AMBIGUOUS",
                        "CHECKOUT_TIMEOUT_AMBIGUOUS",
                    }:
                        unknown("ALLOCATION_SNAPSHOT_INVALID")
                    reconciliation_units += effort_units
                    unknown("RECONCILIATION_REQUIRED")
                elif state == "COMMITTED" and row.get("work_order_id") not in active_ids:
                    reconciliation_units += effort_units
                    unknown("RECONCILIATION_REQUIRED")

    earliest_due: str | None = None
    deadline_day: date | None = None
    deadline_risk = "UNKNOWN"
    requested_deadline = request.get("requested_deadline")
    if not isinstance(requested_deadline, str) or not requested_deadline:
        unknown("REQUESTED_DEADLINE_UNKNOWN")
    else:
        try:
            deadline_day = _parse_day(requested_deadline, "requested_deadline")
        except CapacityError:
            unknown("REQUESTED_DEADLINE_UNKNOWN")
    if calendar is not None and deadline_day is not None and lead_time is not None:
        try:
            valid_from = _parse_day(calendar.get("valid_from"), "calendar.valid_from")
            valid_until = _parse_day(calendar.get("valid_until"), "calendar.valid_until")
            earliest = add_business_days(now.date(), lead_time, calendar)
        except CapacityError:
            unknown("WORKING_CALENDAR_INVALID")
        else:
            if not valid_from <= now.date() <= valid_until or deadline_day > valid_until:
                unknown("WORKING_CALENDAR_OUT_OF_RANGE")
                calendar_freshness = "UNKNOWN"
            else:
                earliest_due = earliest.isoformat()
                if earliest > deadline_day:
                    deadline_risk = "INFEASIBLE"
                    cannot("REQUESTED_DEADLINE_INFEASIBLE")
                else:
                    deadline_risk = "FEASIBLE"

    available_units: int | None = None
    if all(
        value is not None
        for value in (
            policy_units,
            staffed_units,
            active_wip_units,
            held_units,
            reconciliation_units,
        )
    ):
        effective_limit = min(policy_units, staffed_units)
        consumed = active_wip_units + held_units + reconciliation_units
        available_units = max(0, effective_limit - consumed)
        if requested_effort_units is not None and available_units < requested_effort_units:
            if policy_units <= staffed_units and policy_units - consumed < requested_effort_units:
                cannot("POLICY_CEILING_REACHED")
            if staffed_units <= policy_units and staffed_units - consumed < requested_effort_units:
                cannot("INSUFFICIENT_STAFFED_CAPACITY")

    if unknown_reasons:
        decision = "UNKNOWN"
        reason_codes = unknown_reasons + [code for code in cannot_reasons if code not in unknown_reasons]
    elif cannot_reasons:
        decision = "CANNOT_ACCEPT"
        reason_codes = cannot_reasons
    else:
        decision = "CAN_ACCEPT"
        reason_codes = ["ADMISSION_GATES_SATISFIED"]

    evidence_class = (
        "ABSENT"
        if capacity_snapshot is None
        else "SYNTHETIC"
        if capacity_synthetic
        or bool(isinstance(readiness, Mapping) and readiness.get("constraints", {}).get("synthetic_only"))
        else "REAL"
    )
    expires_at = min(expiry_candidates).isoformat().replace("+00:00", "Z") if expiry_candidates else None
    blockers = _v2_blockers(reason_codes)
    if blockers:
        next_action = blockers[0]["next_action"]
    else:
        next_action = _REASON_DETAILS["ADMISSION_GATES_SATISFIED"][1]
    basis = {
        "request": request_view,
        "policy": policy_ceiling,
        "capacity_snapshot": capacity_snapshot,
        "working_calendar": working_calendar,
        "work_order_snapshot": work_order_snapshot,
        "allocation_snapshot": allocation_snapshot,
        "readiness_hash": readiness_hash,
        "evaluated_at": evaluated_at,
    }
    return {
        "schema_version": "confenge.capacity_admission.v2",
        "decision_id": _stable_id("cadm", basis),
        "decision": decision,
        "reason_codes": reason_codes,
        "blockers": blockers,
        "request": request_view,
        "evaluated_at": evaluated_at,
        "expires_at": expires_at,
        "evidence_class": evidence_class,
        "policy": {
            "version": policy_version,
            "ceiling_units": policy_units,
            "unit": policy_unit,
            "evidence_ref": policy_evidence,
        },
        "staffed": {
            "snapshot_id": capacity_id,
            "version": capacity_version,
            "capacity_units": staffed_units,
            "state": "KNOWN" if staffed_units is not None else "UNKNOWN",
            "as_of": capacity_as_of,
            "expires_at": capacity_expires_at,
            "freshness": capacity_freshness,
            "calendar_version": capacity_calendar_version,
        },
        "wip": {
            "snapshot_id": wip_snapshot_id,
            "as_of": wip_as_of,
            "freshness": wip_freshness,
            "complete": wip_complete,
            "non_terminal_work_orders": len(non_terminal_ids) if active_wip_units is not None else None,
            "work_order_refs": sorted(non_terminal_ids),
            "committed_effort_units": active_wip_units,
            "blocked_effort_units": blocked_effort_units,
        },
        "allocations": {
            "snapshot_id": allocation_snapshot_id,
            "freshness": allocation_freshness,
            "held_effort_units": held_units,
            "reconciliation_required_effort_units": reconciliation_units,
        },
        "available_effort_units": available_units,
        "requested_effort": {
            "amount": requested_effort_units,
            "unit": "delivery_slot" if requested_effort_units is not None else None,
            "version": effort_version,
            "readiness_state": readiness_state,
            "readiness_ref": readiness_ref,
            "readiness_hash": readiness_hash,
        },
        "deadline": {
            "requested": deadline_day.isoformat() if deadline_day is not None else None,
            "earliest_feasible": earliest_due,
            "calendar_version": calendar_version,
            "calendar_freshness": calendar_freshness,
            "risk": deadline_risk,
        },
        "actionability": {
            "read_only": True,
            "hold_mode": "MODEL_ONLY",
            "real_reservation_created": False,
            "checkout_enabled": False,
            "promise_allowed": decision == "CAN_ACCEPT" and evidence_class == "REAL",
        },
        "next_action": next_action,
    }


def project_capacity_read_only_v2(admission: Mapping[str, Any] | None, *, projected_at: str) -> dict[str, Any]:
    """Create the single Control Center projection from a v2 decision.

    No capacity arithmetic is recalculated here.  The projection is a redacted
    aggregate view of the pure evaluator output and is never a ledger.
    """

    _parse_instant(projected_at, "projected_at")
    valid = isinstance(admission, Mapping) and admission.get("schema_version") == "confenge.capacity_admission.v2"
    policy = admission.get("policy", {}) if valid else {}
    staffed = admission.get("staffed", {}) if valid else {}
    wip = admission.get("wip", {}) if valid else {}
    allocations = admission.get("allocations", {}) if valid else {}
    deadline = admission.get("deadline", {}) if valid else {}
    actionability = admission.get("actionability", {}) if valid else {}
    decision = admission.get("decision") if valid else "UNKNOWN"
    if decision not in {"CAN_ACCEPT", "CANNOT_ACCEPT", "UNKNOWN"}:
        decision = "UNKNOWN"
    reason_codes = list(admission.get("reason_codes", [])) if valid else ["STAFFED_CAPACITY_UNKNOWN"]
    if not reason_codes:
        reason_codes = ["STAFFED_CAPACITY_UNKNOWN"]
        decision = "UNKNOWN"
    staffed_state = staffed.get("state") if staffed.get("state") == "KNOWN" else "UNKNOWN"
    if staffed_state == "UNKNOWN":
        decision = "UNKNOWN"
    return {
        "schema_version": "confenge.capacity_projection.v2",
        "projected_at": projected_at,
        "decision_id": admission.get("decision_id") if valid else None,
        "deliverable_id": admission.get("request", {}).get("deliverable_id") if valid else None,
        "deliverable_version": admission.get("request", {}).get("deliverable_version") if valid else None,
        "requested_deadline": admission.get("request", {}).get("requested_deadline") if valid else None,
        "policy_ceiling": policy.get("ceiling_units"),
        "staffed_capacity": staffed.get("capacity_units") if staffed_state == "KNOWN" else None,
        "staffed_capacity_state": staffed_state,
        "committed": wip.get("committed_effort_units") if staffed_state == "KNOWN" else None,
        "held": allocations.get("held_effort_units") if staffed_state == "KNOWN" else None,
        "available": admission.get("available_effort_units") if staffed_state == "KNOWN" else None,
        "freshness": staffed.get("freshness") if staffed.get("freshness") in {"FRESH", "STALE"} else "UNKNOWN",
        "admission": decision,
        "deadline_risk": deadline.get("risk") if deadline.get("risk") in {"FEASIBLE", "INFEASIBLE", "UNKNOWN"} else "UNKNOWN",
        "blockers": list(admission.get("blockers", [])) if valid else _v2_blockers(reason_codes),
        "next_action": admission.get("next_action") if valid else _REASON_DETAILS["STAFFED_CAPACITY_UNKNOWN"][1],
        "evidence_class": admission.get("evidence_class") if valid else "ABSENT",
        "can_accept": decision == "CAN_ACCEPT" and actionability.get("promise_allowed") is True,
        "checkout_enabled": False,
        "source": {
            "capacity_snapshot_id": staffed.get("snapshot_id") if valid else None,
            "work_order_snapshot_id": wip.get("snapshot_id") if valid else None,
            "as_of": staffed.get("as_of") if valid else None,
            "expires_at": admission.get("expires_at") if valid else None,
        },
        "reason_codes": reason_codes,
    }


def evaluate_catalog_availability(
    *, catalog_sold_out: bool | None, admission: Mapping[str, Any] | None
) -> dict[str, Any]:
    """Apply static catalog blocks without treating ``sold_out=false`` as capacity."""

    if catalog_sold_out is True:
        return {"decision": "CANNOT_ACCEPT", "reason_codes": ["CATALOG_STATIC_BLOCK"]}
    if not isinstance(admission, Mapping) or admission.get("schema_version") != "confenge.capacity_admission.v2":
        return {"decision": "UNKNOWN", "reason_codes": ["ADMISSION_DECISION_MISSING"]}
    decision = admission.get("decision")
    if decision == "CAN_ACCEPT" and admission.get("actionability", {}).get("promise_allowed") is not True:
        return {"decision": "UNKNOWN", "reason_codes": ["ADMISSION_NOT_ACTIONABLE"]}
    if decision not in {"CAN_ACCEPT", "CANNOT_ACCEPT", "UNKNOWN"}:
        return {"decision": "UNKNOWN", "reason_codes": ["ADMISSION_DECISION_INVALID"]}
    return {"decision": decision, "reason_codes": list(admission.get("reason_codes", []))}


def project_capacity_read_only(
    *,
    policy_ceiling: int | None,
    capacity_snapshot: Mapping[str, Any] | None,
    active_work_orders: Sequence[Mapping[str, Any]] | None,
    committed_allocations: int | None,
    projected_at: str,
    admission_decision: str | None = None,
) -> dict[str, Any]:
    """Project current capacity without reserving, committing, or enabling checkout.

    This projection has deliberately different semantics from the synthetic
    admission canary.  Synthetic evidence may exercise arithmetic, but it can
    never become real-world readiness in the Control Center.
    """

    now = _parse_instant(projected_at, "projected_at")
    if not isinstance(policy_ceiling, int) or isinstance(policy_ceiling, bool) or policy_ceiling < 0:
        policy_ceiling = None

    base: dict[str, Any] = {
        "schema_version": "confenge.capacity_projection.v1",
        "projected_at": projected_at,
        "policy_ceiling": policy_ceiling,
        "staffed_capacity": None,
        "staffed_capacity_state": "UNKNOWN",
        "committed": None,
        "available": None,
        "freshness": "UNKNOWN",
        "evidence_class": "ABSENT",
        "admission": "UNKNOWN",
        "can_accept": False,
        "checkout_enabled": False,
        "source": {"capacity_snapshot_id": None, "as_of": None, "expires_at": None},
        "reason_codes": [],
    }
    if not capacity_snapshot:
        base["reason_codes"] = ["STAFFED_CAPACITY_UNKNOWN"]
        return base

    snapshot_id = capacity_snapshot.get("capacity_snapshot_id")
    as_of = capacity_snapshot.get("as_of")
    expires_at = capacity_snapshot.get("expires_at")
    base["source"] = {
        "capacity_snapshot_id": snapshot_id if isinstance(snapshot_id, str) and snapshot_id else None,
        "as_of": as_of if isinstance(as_of, str) else None,
        "expires_at": expires_at if isinstance(expires_at, str) else None,
    }
    if capacity_snapshot.get("schema_version") != "confenge.staffed_capacity_snapshot.v1":
        base["freshness"] = "ERROR"
        base["reason_codes"] = ["CAPACITY_SNAPSHOT_INVALID"]
        return base
    staffed = capacity_snapshot.get("staffed_capacity_units")
    if not isinstance(staffed, int) or isinstance(staffed, bool) or staffed < 0:
        base["reason_codes"] = ["STAFFED_CAPACITY_UNKNOWN"]
        return base
    if capacity_snapshot.get("policy_ceiling_used_as_staffed_capacity") is not False:
        base["freshness"] = "ERROR"
        base["reason_codes"] = ["POLICY_CEILING_USED_AS_STAFFED_CAPACITY"]
        return base
    try:
        observed = _parse_instant(as_of, "capacity_snapshot.as_of")
        expiry = _parse_instant(expires_at, "capacity_snapshot.expires_at")
    except CapacityError:
        base["freshness"] = "ERROR"
        base["reason_codes"] = ["CAPACITY_SNAPSHOT_INVALID"]
        return base
    if observed > now:
        base["reason_codes"] = ["CAPACITY_SNAPSHOT_FROM_FUTURE"]
        return base
    if now >= expiry:
        base["freshness"] = "STALE"
        base["reason_codes"] = ["CAPACITY_SNAPSHOT_STALE"]
        return base

    synthetic = capacity_snapshot.get("synthetic") is True
    base["staffed_capacity"] = staffed
    base["staffed_capacity_state"] = "KNOWN"
    base["freshness"] = "FRESH"
    base["evidence_class"] = "SYNTHETIC" if synthetic else "REAL"
    if active_work_orders is None or not isinstance(committed_allocations, int) or committed_allocations < 0:
        base["reason_codes"] = ["COMMITTED_CAPACITY_UNKNOWN"]
        return base

    active_effort = 0
    seen: set[str] = set()
    for work_order in active_work_orders:
        work_order_id = work_order.get("work_order_id") if isinstance(work_order, Mapping) else None
        stage = work_order.get("current_stage") if isinstance(work_order, Mapping) else None
        effort = work_order.get("estimated_capacity_units") if isinstance(work_order, Mapping) else None
        if (
            not isinstance(work_order_id, str)
            or not work_order_id
            or work_order_id in seen
            or stage not in WORK_ORDER_STAGES
            or not isinstance(effort, int)
            or isinstance(effort, bool)
            or effort <= 0
        ):
            base["committed"] = None
            base["available"] = None
            base["reason_codes"] = ["ACTIVE_WIP_INVALID"]
            return base
        seen.add(work_order_id)
        if stage not in TERMINAL_WORK_ORDER_STAGES:
            active_effort += effort

    committed = active_effort + committed_allocations
    base["committed"] = committed
    base["available"] = max(0, staffed - committed)
    requested_admission = admission_decision if admission_decision in {"CAN_ACCEPT", "CANNOT_ACCEPT", "UNKNOWN"} else "UNKNOWN"
    if staffed == 0:
        requested_admission = "CANNOT_ACCEPT"
        base["reason_codes"] = ["INSUFFICIENT_STAFFED_CAPACITY"]
    elif synthetic:
        requested_admission = "UNKNOWN"
        base["reason_codes"] = ["SYNTHETIC_CAPACITY_NOT_REAL_READINESS"]
    elif requested_admission == "CAN_ACCEPT":
        base["reason_codes"] = ["READ_ONLY_PROJECTION_DOES_NOT_ENABLE_CHECKOUT"]
    else:
        base["reason_codes"] = ["ADMISSION_NOT_PROVEN"]
    base["admission"] = requested_admission
    # A read model reports an admission fact but never enables checkout itself.
    base["can_accept"] = requested_admission == "CAN_ACCEPT" and not synthetic
    return base


class CapacityLedger:
    """SQLite-backed idempotent model for hold/commit/release/expire.

    This is not a production reservation service or a billing ledger.  It only
    exercises synthetic/model-only lifecycle invariants.  SQLite ``BEGIN
    IMMEDIATE`` plus a process lock makes acquisition atomic for local/canary
    concurrency; real decisions are rejected.
    """

    def __init__(self, path: str | Path):
        self.path = str(path)
        self._lock = threading.RLock()
        self._connection = sqlite3.connect(self.path, timeout=30, check_same_thread=False)
        self._connection.row_factory = sqlite3.Row
        self._connection.execute("PRAGMA busy_timeout = 30000")
        self._connection.execute("PRAGMA journal_mode = WAL")
        self._initialize()

    def close(self) -> None:
        with self._lock:
            self._connection.close()

    def __enter__(self) -> "CapacityLedger":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def _initialize(self) -> None:
        with self._connection:
            self._connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS capacity_allocations (
                    hold_id TEXT PRIMARY KEY,
                    idempotency_key TEXT NOT NULL UNIQUE,
                    correlation_id TEXT NOT NULL,
                    capacity_snapshot_id TEXT NOT NULL,
                    effort_units INTEGER NOT NULL CHECK (effort_units > 0),
                    state TEXT NOT NULL CHECK (state IN ('HELD','COMMITTED','RELEASED','EXPIRED','RECONCILIATION_REQUIRED')),
                    created_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    committed_at TEXT,
                    released_at TEXT,
                    work_order_id TEXT UNIQUE,
                    release_reason TEXT
                );
                CREATE TABLE IF NOT EXISTS capacity_commands (
                    idempotency_key TEXT PRIMARY KEY,
                    command_type TEXT NOT NULL,
                    hold_id TEXT NOT NULL,
                    command_hash TEXT NOT NULL,
                    result_json TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS capacity_allocations_snapshot_state
                    ON capacity_allocations(capacity_snapshot_id, state);
                """
            )

    @staticmethod
    def _row(row: sqlite3.Row) -> dict[str, Any]:
        return dict(row)

    @staticmethod
    def _command_hash(value: Mapping[str, Any]) -> str:
        return hashlib.sha256(canonical_json(value)).hexdigest()

    def _command_result(
        self, idempotency_key: str, command_type: str, command: Mapping[str, Any]
    ) -> dict[str, Any] | None:
        row = self._connection.execute(
            "SELECT command_type, command_hash, result_json FROM capacity_commands WHERE idempotency_key = ?",
            (idempotency_key,),
        ).fetchone()
        if row and (
            row["command_type"] != command_type
            or row["command_hash"] != self._command_hash(command)
        ):
            raise CapacityError("idempotency key was already used by a different command")
        return json.loads(row["result_json"]) if row else None

    def _record_command(
        self,
        idempotency_key: str,
        command_type: str,
        command: Mapping[str, Any],
        result: Mapping[str, Any],
    ) -> None:
        self._connection.execute(
            "INSERT INTO capacity_commands(idempotency_key, command_type, hold_id, command_hash, result_json) VALUES (?, ?, ?, ?, ?)",
            (
                idempotency_key,
                command_type,
                result["hold_id"],
                self._command_hash(command),
                json.dumps(result, sort_keys=True),
            ),
        )

    def acquire_hold(
        self,
        *,
        decision: Mapping[str, Any],
        idempotency_key: str,
        correlation_id: str,
        created_at: str,
        expires_at: str,
    ) -> dict[str, Any]:
        if decision.get("decision") != "CAN_ACCEPT":
            raise CapacityError("capacity hold requires CAN_ACCEPT")
        if decision.get("synthetic") is not True and decision.get("evidence_class") != "SYNTHETIC":
            raise CapacityError("capacity ledger is MODEL_ONLY and rejects real reservations")
        v2 = decision.get("schema_version") == "confenge.capacity_admission.v2"
        created = _parse_instant(created_at, "created_at")
        expires = _parse_instant(expires_at, "expires_at")
        if expires <= created:
            raise CapacityError("hold expiry must be after creation")
        decision_correlation = (
            decision.get("request", {}).get("correlation_id")
            if v2
            else decision.get("correlation_id")
        )
        if decision_correlation != correlation_id:
            raise CapacityError("hold correlation diverges from admission")
        if v2:
            effort_units = decision.get("requested_effort", {}).get("amount")
            staffed_units = decision.get("staffed", {}).get("capacity_units")
            policy_units = decision.get("policy", {}).get("ceiling_units")
            active_wip_units = decision.get("wip", {}).get("committed_effort_units")
            held = decision.get("allocations", {}).get("held_effort_units")
            reconciliation = decision.get("allocations", {}).get(
                "reconciliation_required_effort_units"
            )
            reserved_units = (
                held + reconciliation
                if _valid_non_negative_integer(held)
                and _valid_non_negative_integer(reconciliation)
                else None
            )
            capacity_limit = (
                max(0, min(policy_units, staffed_units) - active_wip_units)
                if all(
                    _valid_non_negative_integer(item)
                    for item in (policy_units, staffed_units, active_wip_units)
                )
                else None
            )
            available_units = decision.get("available_effort_units")
            capacity_snapshot_id = decision.get("staffed", {}).get("snapshot_id")
            active_work_order_ids = set(decision.get("wip", {}).get("work_order_refs", []))
        else:
            effort_units = decision.get("requested_effort_units")
            capacity_limit = decision.get("capacity_limit_after_wip_units")
            staffed_units = decision.get("staffed_capacity_units")
            active_wip_units = decision.get("active_wip_units")
            reserved_units = decision.get("reserved_effort_units")
            available_units = decision.get("available_effort_units")
            capacity_snapshot_id = decision.get("capacity_snapshot_id")
            active_work_order_ids = set(decision.get("active_work_order_ids", []))
        if (
            not isinstance(effort_units, int)
            or effort_units <= 0
            or not all(
                isinstance(item, int) and not isinstance(item, bool) and item >= 0
                for item in (capacity_limit, staffed_units, active_wip_units, reserved_units, available_units)
            )
            or not isinstance(capacity_snapshot_id, str)
            or not capacity_snapshot_id
            or capacity_limit
            != (
                max(0, min(policy_units, staffed_units) - active_wip_units)
                if v2
                else max(0, staffed_units - active_wip_units)
            )
            or available_units != max(0, capacity_limit - reserved_units)
            or effort_units > available_units
        ):
            raise CapacityError("admission lacks effort/capacity basis")
        command = {
            "decision": dict(decision),
            "correlation_id": correlation_id,
            "created_at": created_at,
            "expires_at": expires_at,
        }

        with self._lock:
            self._connection.execute("BEGIN IMMEDIATE")
            try:
                replay = self._command_result(idempotency_key, "HOLD", command)
                if replay is not None:
                    self._connection.commit()
                    return replay
                active_rows = self._connection.execute(
                    """
                    SELECT effort_units, state, work_order_id
                    FROM capacity_allocations
                    WHERE capacity_snapshot_id = ? AND state IN ('HELD', 'COMMITTED', 'RECONCILIATION_REQUIRED')
                    """,
                    (capacity_snapshot_id,),
                ).fetchall()
                active = sum(
                    row["effort_units"]
                    for row in active_rows
                    if row["state"] in {"HELD", "RECONCILIATION_REQUIRED"}
                    or row["work_order_id"] not in active_work_order_ids
                )
                if active + effort_units > capacity_limit:
                    raise CapacityError("capacity exhausted while acquiring hold")
                hold_id = _stable_id(
                    "hold",
                    {
                        "capacity_snapshot_id": capacity_snapshot_id,
                        "idempotency_key": idempotency_key,
                        "correlation_id": correlation_id,
                    },
                )
                self._connection.execute(
                    """
                    INSERT INTO capacity_allocations(
                        hold_id, idempotency_key, correlation_id, capacity_snapshot_id,
                        effort_units, state, created_at, expires_at
                    ) VALUES (?, ?, ?, ?, ?, 'HELD', ?, ?)
                    """,
                    (
                        hold_id,
                        idempotency_key,
                        correlation_id,
                        capacity_snapshot_id,
                        effort_units,
                        created_at,
                        expires_at,
                    ),
                )
                result = self.get(hold_id)
                self._record_command(idempotency_key, "HOLD", command, result)
                self._connection.commit()
                return result
            except Exception:
                self._connection.rollback()
                raise

    def commit(
        self,
        *,
        hold_id: str,
        work_order_id: str,
        idempotency_key: str,
        committed_at: str,
    ) -> dict[str, Any]:
        committed = _parse_instant(committed_at, "committed_at")
        command = {
            "hold_id": hold_id,
            "work_order_id": work_order_id,
            "committed_at": committed_at,
        }
        with self._lock:
            self._connection.execute("BEGIN IMMEDIATE")
            try:
                replay = self._command_result(idempotency_key, "COMMIT", command)
                if replay is not None:
                    self._connection.commit()
                    return replay
                allocation = self.get(hold_id)
                if committed < _parse_instant(allocation["created_at"], "created_at"):
                    raise CapacityError("commit timestamp precedes the hold")
                if committed >= _parse_instant(allocation["expires_at"], "expires_at"):
                    raise CapacityError("cannot commit an expired hold")
                if allocation["state"] == "COMMITTED" and allocation["work_order_id"] == work_order_id:
                    result = allocation
                elif allocation["state"] != "HELD":
                    raise CapacityError(f"cannot commit allocation in {allocation['state']}")
                else:
                    self._connection.execute(
                        """
                        UPDATE capacity_allocations
                        SET state = 'COMMITTED', committed_at = ?, work_order_id = ?
                        WHERE hold_id = ?
                        """,
                        (committed_at, work_order_id, hold_id),
                    )
                    result = self.get(hold_id)
                self._record_command(idempotency_key, "COMMIT", command, result)
                self._connection.commit()
                return result
            except Exception:
                self._connection.rollback()
                raise

    def release(
        self,
        *,
        hold_id: str,
        reason: str,
        idempotency_key: str,
        released_at: str,
    ) -> dict[str, Any]:
        released = _parse_instant(released_at, "released_at")
        if not reason:
            raise CapacityError("release reason is required")
        command = {"hold_id": hold_id, "reason": reason, "released_at": released_at}
        with self._lock:
            self._connection.execute("BEGIN IMMEDIATE")
            try:
                replay = self._command_result(idempotency_key, "RELEASE", command)
                if replay is not None:
                    self._connection.commit()
                    return replay
                allocation = self.get(hold_id)
                lower_bound = allocation["committed_at"] or allocation["created_at"]
                if released < _parse_instant(lower_bound, "allocation timestamp"):
                    raise CapacityError("release timestamp precedes the allocation")
                if allocation["state"] == "RELEASED":
                    result = allocation
                elif allocation["state"] not in {"HELD", "COMMITTED", "RECONCILIATION_REQUIRED"}:
                    raise CapacityError(f"cannot release allocation in {allocation['state']}")
                else:
                    self._connection.execute(
                        """
                        UPDATE capacity_allocations
                        SET state = 'RELEASED', released_at = ?, release_reason = ?
                        WHERE hold_id = ?
                        """,
                        (released_at, reason, hold_id),
                    )
                    result = self.get(hold_id)
                self._record_command(idempotency_key, "RELEASE", command, result)
                self._connection.commit()
                return result
            except Exception:
                self._connection.rollback()
                raise

    def mark_reconciliation_required(
        self,
        *,
        hold_id: str,
        ambiguity: str,
        idempotency_key: str,
        observed_at: str,
    ) -> dict[str, Any]:
        """Hold capacity fail-closed when cancellation/refund/timeout is ambiguous."""

        allowed = {
            "CANCELLATION_AMBIGUOUS",
            "REFUND_AMBIGUOUS",
            "CHECKOUT_TIMEOUT_AMBIGUOUS",
        }
        if ambiguity not in allowed:
            raise CapacityError("unsupported reconciliation ambiguity")
        observed = _parse_instant(observed_at, "observed_at")
        command = {
            "hold_id": hold_id,
            "ambiguity": ambiguity,
            "observed_at": observed_at,
        }
        with self._lock:
            self._connection.execute("BEGIN IMMEDIATE")
            try:
                replay = self._command_result(idempotency_key, "RECONCILE", command)
                if replay is not None:
                    self._connection.commit()
                    return replay
                allocation = self.get(hold_id)
                lower_bound = allocation["committed_at"] or allocation["created_at"]
                if observed < _parse_instant(lower_bound, "allocation timestamp"):
                    raise CapacityError("reconciliation timestamp precedes the allocation")
                if allocation["state"] == "RECONCILIATION_REQUIRED":
                    if allocation["release_reason"] != ambiguity:
                        raise CapacityError("allocation already has a different ambiguity")
                    result = allocation
                elif allocation["state"] not in {"HELD", "COMMITTED"}:
                    raise CapacityError(
                        f"cannot require reconciliation in {allocation['state']}"
                    )
                else:
                    self._connection.execute(
                        """
                        UPDATE capacity_allocations
                        SET state = 'RECONCILIATION_REQUIRED', release_reason = ?
                        WHERE hold_id = ?
                        """,
                        (ambiguity, hold_id),
                    )
                    result = self.get(hold_id)
                self._record_command(idempotency_key, "RECONCILE", command, result)
                self._connection.commit()
                return result
            except Exception:
                self._connection.rollback()
                raise

    def get(self, hold_id: str) -> dict[str, Any]:
        row = self._connection.execute(
            "SELECT * FROM capacity_allocations WHERE hold_id = ?",
            (hold_id,),
        ).fetchone()
        if row is None:
            raise CapacityError(f"unknown capacity hold {hold_id}")
        return self._row(row)

    def reconcile_expired(self, *, as_of: str) -> list[str]:
        """Durably transition elapsed, uncommitted holds to EXPIRED."""

        instant = _parse_instant(as_of, "as_of")
        with self._lock:
            self._connection.execute("BEGIN IMMEDIATE")
            try:
                rows = self._connection.execute(
                    "SELECT hold_id, expires_at FROM capacity_allocations WHERE state = 'HELD'"
                ).fetchall()
                expired = sorted(
                    row["hold_id"]
                    for row in rows
                    if _parse_instant(row["expires_at"], "expires_at") <= instant
                )
                if expired:
                    self._connection.executemany(
                        "UPDATE capacity_allocations SET state = 'EXPIRED', released_at = ?, release_reason = 'HOLD_EXPIRED' WHERE hold_id = ? AND state = 'HELD'",
                        [(as_of, hold_id) for hold_id in expired],
                    )
                self._connection.commit()
                return expired
            except Exception:
                self._connection.rollback()
                raise

    def reserved_effort_units(
        self,
        *,
        capacity_snapshot_id: str,
        active_work_order_ids: Iterable[str] = (),
    ) -> int:
        """Return holds plus commits not yet visible in the Work Order WIP read model."""

        active_ids = set(active_work_order_ids)
        rows = self._connection.execute(
            """
            SELECT effort_units, state, work_order_id
            FROM capacity_allocations
            WHERE capacity_snapshot_id = ? AND state IN ('HELD', 'COMMITTED', 'RECONCILIATION_REQUIRED')
            """,
            (capacity_snapshot_id,),
        ).fetchall()
        return sum(
            row["effort_units"]
            for row in rows
            if row["state"] in {"HELD", "RECONCILIATION_REQUIRED"}
            or row["work_order_id"] not in active_ids
        )

    def projection(
        self,
        *,
        capacity_snapshot_id: str,
        staffed_capacity_units: int,
        active_work_orders: Sequence[Mapping[str, Any]],
    ) -> dict[str, Any]:
        seen_ids: set[str] = set()
        for item in active_work_orders:
            work_order_id = item.get("work_order_id")
            stage = item.get("current_stage")
            effort = item.get("estimated_capacity_units")
            if (
                not isinstance(work_order_id, str)
                or not work_order_id
                or work_order_id in seen_ids
                or stage not in WORK_ORDER_STAGES
                or not isinstance(effort, int)
                or isinstance(effort, bool)
                or effort <= 0
            ):
                raise CapacityError("capacity projection requires unique canonical Work Orders")
            seen_ids.add(work_order_id)
        active_ids = {
            item["work_order_id"]
            for item in active_work_orders
            if item.get("current_stage") not in TERMINAL_WORK_ORDER_STAGES
        }
        active_wip_units = sum(
            item["estimated_capacity_units"]
            for item in active_work_orders
            if item.get("current_stage") not in TERMINAL_WORK_ORDER_STAGES
        )
        rows = self._connection.execute(
            "SELECT effort_units, state, work_order_id FROM capacity_allocations WHERE capacity_snapshot_id = ?",
            (capacity_snapshot_id,),
        ).fetchall()
        # v1 has no reconciliation field; count ambiguous allocations as held
        # so the compatibility projection remains fail-closed.
        held_units = sum(
            row["effort_units"]
            for row in rows
            if row["state"] in {"HELD", "RECONCILIATION_REQUIRED"}
        )
        committed_units = sum(row["effort_units"] for row in rows if row["state"] == "COMMITTED")
        unprojected_commit_units = sum(
            row["effort_units"]
            for row in rows
            if row["state"] == "COMMITTED" and row["work_order_id"] not in active_ids
        )
        released_units = sum(row["effort_units"] for row in rows if row["state"] == "RELEASED")
        consumed = active_wip_units + held_units + unprojected_commit_units
        return {
            "schema_version": "confenge.capacity_projection.v1",
            "capacity_snapshot_id": capacity_snapshot_id,
            "staffed_capacity_units": staffed_capacity_units,
            "active_wip_units": active_wip_units,
            "held_units": held_units,
            "committed_units": committed_units,
            "released_units": released_units,
            "available_units": max(0, staffed_capacity_units - consumed),
        }
