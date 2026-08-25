"""Durable SQLite event store for the first Work Order vertical slice."""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from copy import deepcopy
from pathlib import Path
from typing import Any, Callable, Iterator

from .contracts import canonical_json, deterministic_event_id
from .errors import DuplicateEventConflictError, OptimisticConcurrencyError

Transition = Callable[[dict[str, Any]], tuple[dict[str, Any], dict[str, Any]]]


class SQLiteWorkOrderStore:
    """Append-only events plus a replaceable projection.

    SQLite provides a durable minimum and `BEGIN IMMEDIATE` serializes writers.
    The projection is disposable: `rebuild_projection` recreates it from events.
    """

    def __init__(self, path: str | Path):
        self.path = str(path)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=15, isolation_level=None)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 15000")
        return connection

    @contextmanager
    def _transaction(self) -> Iterator[sqlite3.Connection]:
        connection = self._connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            yield connection
            connection.execute("COMMIT")
        except Exception:
            connection.execute("ROLLBACK")
            raise
        finally:
            connection.close()

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.executescript(
                """
                PRAGMA journal_mode = WAL;
                CREATE TABLE IF NOT EXISTS work_order_events (
                    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_id TEXT NOT NULL UNIQUE,
                    work_order_id TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    version INTEGER NOT NULL,
                    expected_version INTEGER NOT NULL,
                    idempotency_key TEXT NOT NULL UNIQUE,
                    command_hash TEXT NOT NULL,
                    event_json TEXT NOT NULL,
                    UNIQUE(work_order_id, version)
                );
                CREATE TABLE IF NOT EXISTS work_order_projection (
                    work_order_id TEXT PRIMARY KEY,
                    business_key TEXT NOT NULL UNIQUE,
                    version INTEGER NOT NULL,
                    last_event_id TEXT NOT NULL,
                    state_json TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS delivery_request_decisions (
                    idempotency_key TEXT PRIMARY KEY,
                    request_hash TEXT NOT NULL,
                    status TEXT NOT NULL,
                    work_order_id TEXT,
                    response_json TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_work_order_events_order
                ON work_order_events(work_order_id, version);
                """
            )

    @staticmethod
    def _hash_document(value: Any) -> str:
        from hashlib import sha256

        return sha256(canonical_json(value).encode("utf-8")).hexdigest()

    def get_decision(self, idempotency_key: str, request: Any) -> dict[str, Any] | None:
        request_hash = self._hash_document(request)
        with self._connect() as connection:
            row = connection.execute(
                "SELECT request_hash, work_order_id, response_json FROM delivery_request_decisions WHERE idempotency_key = ?",
                (idempotency_key,),
            ).fetchone()
        if row is None:
            return None
        if row["request_hash"] != request_hash:
            raise DuplicateEventConflictError(
                f"delivery request key {idempotency_key!r} was reused with different content"
            )
        response = json.loads(row["response_json"])
        if row["work_order_id"] is not None:
            response["state"] = self.get(row["work_order_id"])
        response["duplicate"] = True
        return response

    def record_held_decision(
        self,
        *,
        idempotency_key: str,
        request: Any,
        response: dict[str, Any],
    ) -> dict[str, Any]:
        request_hash = self._hash_document(request)
        with self._transaction() as connection:
            existing = connection.execute(
                "SELECT request_hash, response_json FROM delivery_request_decisions WHERE idempotency_key = ?",
                (idempotency_key,),
            ).fetchone()
            if existing is not None:
                if existing["request_hash"] != request_hash:
                    raise DuplicateEventConflictError("idempotency key payload changed")
                replay = json.loads(existing["response_json"])
                replay["duplicate"] = True
                return replay
            connection.execute(
                "INSERT INTO delivery_request_decisions(idempotency_key, request_hash, status, work_order_id, response_json) VALUES (?, ?, 'HELD', NULL, ?)",
                (idempotency_key, request_hash, canonical_json(response)),
            )
        return deepcopy(response)

    def create(
        self,
        *,
        request: dict[str, Any],
        decision_document: Any,
        state: dict[str, Any],
        occurred_at: str,
        actor: str,
    ) -> dict[str, Any]:
        """Create once per accepted proposal snapshot and record its request verdict."""

        request_key = request["idempotency_key"]
        request_hash = self._hash_document(decision_document)
        work_order_id = state["work_order_id"]
        event_id = deterministic_event_id(work_order_id, "WORK_ORDER_CREATED", request_key)
        payload = {"state": state}
        event = {
            "event_id": event_id,
            "schema_version": "confenge.work_order_event.v1",
            "work_order_id": work_order_id,
            "event_type": "WORK_ORDER_CREATED",
            "version": 1,
            "expected_version": 0,
            "idempotency_key": request_key,
            "causation_id": request["event_id"],
            "occurred_at": occurred_at,
            "actor": actor,
            "payload": payload,
        }
        projected = deepcopy(state)
        projected["version"] = 1
        projected["last_event_id"] = event_id
        response = {
            "status": "CREATED",
            "work_order_id": work_order_id,
            "state": projected,
            "duplicate": False,
            "blockers": [],
        }
        with self._transaction() as connection:
            decision = connection.execute(
                "SELECT request_hash, work_order_id, response_json FROM delivery_request_decisions WHERE idempotency_key = ?",
                (request_key,),
            ).fetchone()
            if decision is not None:
                if decision["request_hash"] != request_hash:
                    raise DuplicateEventConflictError("idempotency key payload changed")
                replay = json.loads(decision["response_json"])
                if decision["work_order_id"] is not None:
                    replay["state"] = self._load_state(connection, decision["work_order_id"])
                replay["duplicate"] = True
                return replay
            existing = connection.execute(
                "SELECT state_json FROM work_order_projection WHERE business_key = ?",
                (state["business_key"],),
            ).fetchone()
            if existing is not None:
                existing_state = json.loads(existing["state_json"])
                response = {
                    "status": "EXISTS",
                    "work_order_id": existing_state["work_order_id"],
                    "state": existing_state,
                    "duplicate": True,
                    "blockers": [],
                }
                connection.execute(
                    "INSERT INTO delivery_request_decisions(idempotency_key, request_hash, status, work_order_id, response_json) VALUES (?, ?, 'EXISTS', ?, ?)",
                    (request_key, request_hash, existing_state["work_order_id"], canonical_json(response)),
                )
                return response
            connection.execute(
                "INSERT INTO work_order_events(event_id, work_order_id, event_type, version, expected_version, idempotency_key, command_hash, event_json) VALUES (?, ?, ?, 1, 0, ?, ?, ?)",
                (
                    event_id,
                    work_order_id,
                    "WORK_ORDER_CREATED",
                    request_key,
                    self._hash_document(event),
                    canonical_json(event),
                ),
            )
            connection.execute(
                "INSERT INTO work_order_projection(work_order_id, business_key, version, last_event_id, state_json) VALUES (?, ?, 1, ?, ?)",
                (work_order_id, state["business_key"], event_id, canonical_json(projected)),
            )
            connection.execute(
                "INSERT INTO delivery_request_decisions(idempotency_key, request_hash, status, work_order_id, response_json) VALUES (?, ?, 'CREATED', ?, ?)",
                (request_key, request_hash, work_order_id, canonical_json(response)),
            )
        return response

    def mutate(
        self,
        *,
        work_order_id: str,
        event_type: str,
        idempotency_key: str,
        expected_version: int,
        causation_id: str,
        occurred_at: str,
        actor: str,
        command: Any,
        transition: Transition,
    ) -> dict[str, Any]:
        command_hash = self._hash_document(
            {"event_type": event_type, "work_order_id": work_order_id, "command": command}
        )
        with self._transaction() as connection:
            duplicate = connection.execute(
                "SELECT command_hash, event_json FROM work_order_events WHERE idempotency_key = ?",
                (idempotency_key,),
            ).fetchone()
            if duplicate is not None:
                if duplicate["command_hash"] != command_hash:
                    raise DuplicateEventConflictError(
                        f"idempotency key {idempotency_key!r} was reused with different content"
                    )
                state = self._load_state(connection, work_order_id)
                return {"state": state, "event": json.loads(duplicate["event_json"]), "duplicate": True}
            state = self._load_state(connection, work_order_id)
            if state["version"] != expected_version:
                raise OptimisticConcurrencyError(
                    f"expected version {expected_version}, found {state['version']}"
                )
            payload, next_state = transition(deepcopy(state))
            version = expected_version + 1
            event_id = deterministic_event_id(work_order_id, event_type, idempotency_key)
            event = {
                "event_id": event_id,
                "schema_version": "confenge.work_order_event.v1",
                "work_order_id": work_order_id,
                "event_type": event_type,
                "version": version,
                "expected_version": expected_version,
                "idempotency_key": idempotency_key,
                "causation_id": causation_id,
                "occurred_at": occurred_at,
                "actor": actor,
                "payload": payload,
            }
            next_state["version"] = version
            next_state["last_event_id"] = event_id
            connection.execute(
                "INSERT INTO work_order_events(event_id, work_order_id, event_type, version, expected_version, idempotency_key, command_hash, event_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    event_id,
                    work_order_id,
                    event_type,
                    version,
                    expected_version,
                    idempotency_key,
                    command_hash,
                    canonical_json(event),
                ),
            )
            updated = connection.execute(
                "UPDATE work_order_projection SET version = ?, last_event_id = ?, state_json = ? WHERE work_order_id = ? AND version = ?",
                (version, event_id, canonical_json(next_state), work_order_id, expected_version),
            )
            if updated.rowcount != 1:
                raise OptimisticConcurrencyError("projection changed while appending event")
        return {"state": deepcopy(next_state), "event": event, "duplicate": False}

    @staticmethod
    def _load_state(connection: sqlite3.Connection, work_order_id: str) -> dict[str, Any]:
        row = connection.execute(
            "SELECT state_json FROM work_order_projection WHERE work_order_id = ?",
            (work_order_id,),
        ).fetchone()
        if row is None:
            raise KeyError(f"work order {work_order_id!r} not found")
        return json.loads(row["state_json"])

    def get(self, work_order_id: str) -> dict[str, Any]:
        with self._connect() as connection:
            return deepcopy(self._load_state(connection, work_order_id))

    def list_work_orders(self) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT state_json FROM work_order_projection ORDER BY work_order_id"
            ).fetchall()
        return [json.loads(row["state_json"]) for row in rows]

    def events(self, work_order_id: str | None = None) -> list[dict[str, Any]]:
        query = "SELECT event_json FROM work_order_events"
        params: tuple[Any, ...] = ()
        if work_order_id is not None:
            query += " WHERE work_order_id = ?"
            params = (work_order_id,)
        query += " ORDER BY work_order_id, version"
        with self._connect() as connection:
            rows = connection.execute(query, params).fetchall()
        return [json.loads(row["event_json"]) for row in rows]

    def count_events(self, work_order_id: str | None = None) -> int:
        query = "SELECT COUNT(*) AS count FROM work_order_events"
        params: tuple[Any, ...] = ()
        if work_order_id is not None:
            query += " WHERE work_order_id = ?"
            params = (work_order_id,)
        with self._connect() as connection:
            return int(connection.execute(query, params).fetchone()["count"])

    def replace_projection(self, work_order_id: str, state: dict[str, Any]) -> None:
        """Replace only the disposable read model during a verified rebuild."""

        with self._transaction() as connection:
            connection.execute(
                "INSERT INTO work_order_projection(work_order_id, business_key, version, last_event_id, state_json) VALUES (?, ?, ?, ?, ?) ON CONFLICT(work_order_id) DO UPDATE SET business_key=excluded.business_key, version=excluded.version, last_event_id=excluded.last_event_id, state_json=excluded.state_json",
                (
                    work_order_id,
                    state["business_key"],
                    state["version"],
                    state["last_event_id"],
                    canonical_json(state),
                ),
            )

    def clear_projection(self) -> None:
        with self._transaction() as connection:
            connection.execute("DELETE FROM work_order_projection")
