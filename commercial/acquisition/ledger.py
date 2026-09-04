"""Append-only model-only acquisition-pressure ledger."""

from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from typing import Any, Mapping


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


class AcquisitionLedger:
    """In-memory or file-backed exactly-once store. Not a production data plane."""

    mutation_mode = "MODEL_ONLY"

    def __init__(self, path: Path | None = None) -> None:
        self.path = path
        self._by_key: dict[str, dict[str, Any]] = {}
        if path is not None and path.is_file():
            payload = json.loads(path.read_text(encoding="utf-8"))
            records = payload if isinstance(payload, list) else payload.get("records") or []
            for record in records:
                if isinstance(record, Mapping) and record.get("dedup_key"):
                    self._by_key[str(record["dedup_key"])] = deepcopy(dict(record))

    def get(self, dedup_key: str) -> dict[str, Any] | None:
        record = self._by_key.get(dedup_key)
        return deepcopy(record) if record is not None else None

    def append(self, record: Mapping[str, Any]) -> dict[str, Any]:
        key = str(record["dedup_key"])
        existing = self._by_key.get(key)
        if existing is not None:
            replayed = deepcopy(existing)
            replayed["replayed"] = True
            return replayed
        stored = deepcopy(dict(record))
        stored["replayed"] = False
        self._by_key[key] = stored
        self._persist()
        return deepcopy(stored)

    def mark_replay_proof(self, dedup_key: str) -> None:
        record = self._by_key.get(dedup_key)
        if record is None:
            return
        saida = dict(record.get("saida") or {})
        saida["REPLAY_100"] = "PASS"
        record["saida"] = saida
        self._persist()

    def records(self) -> list[dict[str, Any]]:
        return [deepcopy(item) for item in self._by_key.values()]

    def __len__(self) -> int:
        return len(self._by_key)

    def _persist(self) -> None:
        if self.path is None:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "schema_version": "acquisition-pressure-ledger.v1",
            "mutation_mode": "MODEL_ONLY",
            "records": self.records(),
        }
        tmp = self.path.with_suffix(self.path.suffix + ".tmp")
        tmp.write_text(canonical_json(payload) + "\n", encoding="utf-8")
        tmp.replace(self.path)
