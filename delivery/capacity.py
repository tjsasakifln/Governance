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
ALLOCATION_STATES = frozenset({"HELD", "COMMITTED", "RELEASED", "EXPIRED"})
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


class CapacityLedger:
    """SQLite-backed idempotent hold/commit/release ledger.

    This is not a billing ledger.  It stores only operational capacity
    allocations and their command results.  SQLite ``BEGIN IMMEDIATE`` plus a
    process lock makes hold acquisition atomic for local/canary concurrency.
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
                    state TEXT NOT NULL CHECK (state IN ('HELD','COMMITTED','RELEASED','EXPIRED')),
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
        created = _parse_instant(created_at, "created_at")
        expires = _parse_instant(expires_at, "expires_at")
        if expires <= created:
            raise CapacityError("hold expiry must be after creation")
        if decision.get("correlation_id") != correlation_id:
            raise CapacityError("hold correlation diverges from admission")
        effort_units = decision.get("requested_effort_units")
        capacity_limit = decision.get("capacity_limit_after_wip_units")
        if not isinstance(effort_units, int) or effort_units <= 0 or not isinstance(capacity_limit, int):
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
                    WHERE capacity_snapshot_id = ? AND state IN ('HELD', 'COMMITTED')
                    """,
                    (decision["capacity_snapshot_id"],),
                ).fetchall()
                active_work_order_ids = set(decision.get("active_work_order_ids", []))
                active = sum(
                    row["effort_units"]
                    for row in active_rows
                    if row["state"] == "HELD" or row["work_order_id"] not in active_work_order_ids
                )
                if active + effort_units > capacity_limit:
                    raise CapacityError("capacity exhausted while acquiring hold")
                hold_id = _stable_id(
                    "hold",
                    {
                        "capacity_snapshot_id": decision["capacity_snapshot_id"],
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
                        decision["capacity_snapshot_id"],
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
                elif allocation["state"] not in {"HELD", "COMMITTED"}:
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
            WHERE capacity_snapshot_id = ? AND state IN ('HELD', 'COMMITTED')
            """,
            (capacity_snapshot_id,),
        ).fetchall()
        return sum(
            row["effort_units"]
            for row in rows
            if row["state"] == "HELD" or row["work_order_id"] not in active_ids
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
        held_units = sum(row["effort_units"] for row in rows if row["state"] == "HELD")
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
