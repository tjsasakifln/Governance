"""Read existing Warmbly/web-cfg/Delivery observations without copying CRM."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Mapping

ISO_Z_RE = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")
CANONICAL_STAGES = (
    "reached",
    "asset_visit",
    "useful_action",
    "monitor",
    "handraiser",
    "QCO",
    "proposal",
    "won",
)
COMMERCIAL_SNAPSHOT_KEYS = (
    "new_leads",
    "qualified",
    "opportunities",
    "proposals",
    "clients",
    "novos_leads",
    "qualificados",
    "oportunidades",
    "propostas",
    "clientes",
)


def repo_root(start: Path | None = None) -> Path:
    here = (start or Path(__file__)).resolve()
    if here.is_file():
        here = here.parent
    for candidate in (here, *here.parents):
        if (candidate / "commercial" / "offers" / "catalog.v1.json").is_file():
            return candidate
    raise ValueError("cannot locate Governance root")


def _as_map(value: Any) -> dict[str, Any] | None:
    return dict(value) if isinstance(value, Mapping) else None


def _nonempty_str(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def source_identity(block: Mapping[str, Any] | None) -> dict[str, Any]:
    if not isinstance(block, Mapping):
        return {"present": False, "payload_ref": None, "snapshot_ref": None, "note": None}
    return {
        "present": block.get("present") is True,
        "payload_ref": _nonempty_str(block.get("payload_ref")),
        "snapshot_ref": _nonempty_str(block.get("snapshot_ref")),
        "note": _nonempty_str(block.get("note")),
    }


def origin_material(observations: Mapping[str, Any]) -> dict[str, Any]:
    sources = observations.get("sources") if isinstance(observations.get("sources"), Mapping) else {}
    rows = observations.get("stage_observations") if isinstance(observations.get("stage_observations"), list) else []
    return {
        "lane": observations.get("lane"),
        "window": observations.get("window"),
        "sources": {
            "web_cfg": source_identity(_as_map(sources.get("web_cfg"))),
            "warmbly": source_identity(_as_map(sources.get("warmbly"))),
            "delivery": source_identity(_as_map(sources.get("delivery"))),
        },
        "stage_observations": [
            {
                "lane": row.get("lane"),
                "stage": row.get("stage"),
                "state": row.get("state"),
                "count": row.get("count"),
                "source": row.get("source"),
                "source_ref": row.get("source_ref"),
                "window": row.get("window"),
                "freshness": row.get("freshness"),
                "as_of": row.get("as_of"),
            }
            for row in rows
            if isinstance(row, Mapping)
        ],
    }


def _flatten_keys(payload: Any) -> set[str]:
    keys: set[str] = set()

    def walk(node: Any) -> None:
        if isinstance(node, Mapping):
            for key, item in node.items():
                keys.add(str(key).lower())
                walk(item)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(payload)
    return keys


def _token_set(value: str) -> set[str]:
    lower = value.lower()
    parts = {part for part in re.split(r"[^a-z0-9]+", lower) if part}
    parts.add(lower)
    parts.add(lower.replace(".", "_"))
    return parts


def _has_vocab(text: str, vocab: str) -> bool:
    if not text or not vocab:
        return False
    return re.search(rf"(^|[^a-z0-9]){re.escape(vocab)}([^a-z0-9]|$)", text.lower()) is not None


def is_forbidden_proxy(row: Mapping[str, Any], policy: Mapping[str, Any]) -> bool:
    proxies = {str(item).lower() for item in policy.get("forbidden_funnel_proxies") or ()}
    unbound = {str(item).lower() for item in policy.get("unbound_vocabularies") or ()}
    forbidden = proxies | unbound | set(COMMERCIAL_SNAPSHOT_KEYS)
    keys = _flatten_keys(row)
    if keys & forbidden:
        return True
    source = _nonempty_str(row.get("source")) or ""
    tokens = _token_set(source)
    if tokens & forbidden:
        return True
    return any(_has_vocab(source, item) for item in forbidden)


def resolve_ref(ref: str | None, *, root: Path | None = None) -> Path | None:
    text = _nonempty_str(ref)
    if text is None:
        return None
    path = Path(text)
    if path.is_absolute():
        return path if path.is_file() else None
    base = root or repo_root()
    candidate = (base / path).resolve()
    return candidate if candidate.is_file() else None


def load_json_ref(ref: str | None, *, root: Path | None = None) -> Any | None:
    path = resolve_ref(ref, root=root)
    if path is None:
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def inspect_warmbly_presence(block: Mapping[str, Any] | None, *, root: Path | None = None) -> dict[str, Any]:
    identity = source_identity(block)
    payload = load_json_ref(identity.get("payload_ref"), root=root)
    present = identity["present"] or payload is not None
    note = identity.get("note")
    if payload is not None and any(key in payload for key in ("deals", "deals_summary", "confenge_inbound")):
        note = note or "warmbly_collect_payload_present_unbound"
    return {
        "present": present,
        "payload_loaded": payload is not None,
        "note": note,
        "payload_ref": identity.get("payload_ref"),
    }


def inspect_delivery_capacity(block: Mapping[str, Any] | None, *, root: Path | None = None) -> dict[str, Any]:
    identity = source_identity(block)
    snapshot = load_json_ref(identity.get("snapshot_ref") or identity.get("payload_ref"), root=root)
    if not isinstance(snapshot, Mapping):
        return {
            "state": "UNKNOWN",
            "available_units": None,
            "evidence_class": "UNKNOWN",
            "source": "missing:tjsasakifln/Governance#123.staffed_capacity_snapshot.v2",
            "owner": "tjsasakifln/Governance",
            "missing_event": "real non-synthetic staffed-capacity snapshot v2 published by the delivery owner for Governance#123",
        }
    synthetic = snapshot.get("synthetic") is True
    schema_ok = snapshot.get("schema_version") == "confenge.staffed_capacity_snapshot.v2"
    units = snapshot.get("staffed_capacity_units")
    if synthetic or not schema_ok or not _is_int(units) or units < 0:
        return {
            "state": "UNKNOWN",
            "available_units": None,
            "evidence_class": "SYNTHETIC" if synthetic else "UNKNOWN",
            "source": identity.get("snapshot_ref") or identity.get("payload_ref") or "delivery.snapshot",
            "owner": "tjsasakifln/Governance",
            "missing_event": "real non-synthetic staffed-capacity snapshot v2 published by the delivery owner for Governance#123",
        }
    return {
        "state": "OBSERVED",
        "available_units": units,
        "evidence_class": "REAL",
        "source": identity.get("snapshot_ref") or identity.get("payload_ref") or "delivery.snapshot",
        "owner": "tjsasakifln/Governance",
        "missing_event": None,
    }


def explicit_stage_row(
    row: Mapping[str, Any],
    *,
    policy: Mapping[str, Any],
    default_window: Mapping[str, Any],
    default_lane: str,
) -> dict[str, Any] | None:
    stage = _nonempty_str(row.get("stage"))
    if stage not in CANONICAL_STAGES:
        return None
    lane = _nonempty_str(row.get("lane")) or default_lane
    if lane != "NET_NEW_INBOUND":
        return None
    if is_forbidden_proxy(row, policy):
        return {
            "stage": stage,
            "rejected": "FUNNEL_PROXY_OR_UNBOUND_VOCABULARY",
        }
    state = row.get("state")
    count = row.get("count")
    window = row.get("window") if isinstance(row.get("window"), Mapping) else default_window
    source = _nonempty_str(row.get("source")) or "explicit.canonical_stage"
    freshness = row.get("freshness") if row.get("freshness") in {"FRESH", "STALE", "UNKNOWN", "ERROR"} else "UNKNOWN"
    confidence = (
        row.get("confidence")
        if row.get("confidence") in {"HIGH", "MEDIUM", "LOW", "INSUFFICIENT_EVIDENCE"}
        else None
    )
    if state == "OBSERVED" and _is_int(count) and count >= 0:
        return {
            "stage": stage,
            "lane": lane,
            "window": dict(window),
            "count": count,
            "state": "OBSERVED",
            "source": source,
            "freshness": freshness,
            "confidence": confidence or ("HIGH" if count == 0 else "MEDIUM"),
            "rejected": None,
        }
    return {
        "stage": stage,
        "lane": lane,
        "window": dict(window),
        "count": None,
        "state": "UNKNOWN",
        "source": source,
        "freshness": freshness,
        "confidence": confidence or "INSUFFICIENT_EVIDENCE",
        "rejected": None if state == "UNKNOWN" else "OBSERVED_WITHOUT_INTEGER_COUNT",
    }
