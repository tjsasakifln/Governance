"""Lossless adapter between extra-cli COMMERCIAL_AUTHORITY/1.0 names and aliases.

Canonical producer names always win. An alias may fill a missing canonical
field. If both are present and disagree, the adapter fails closed. Aliases
never drop semantic hash, producer identity, or authority/basis hash.
"""

from __future__ import annotations

from typing import Any, Mapping

CANONICAL_CONTRACT = "COMMERCIAL_AUTHORITY/1.0"

CANONICAL_TO_ALIASES: dict[str, tuple[str, ...]] = {
    "basis_source_run_id": ("source_run_id",),
    "basis_snapshot_hash": ("snapshot_id", "basis_snapshot_id"),
    "basis_membership_hash": ("membership_hash",),
}

MUST_NOT_DROP = (
    "basis_publication_semantic_hash",
    "producer_identity",
    "commercial_authority_hash",
    "authority_hash",
)

REQUIRED_BINDING = (
    "basis_source_run_id",
    "basis_snapshot_hash",
    "basis_membership_hash",
    "basis_publication_semantic_hash",
    "producer_identity",
)


def _text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def adapt_commercial_authority(raw: Mapping[str, Any] | None) -> dict[str, Any]:
    """Return canonical fields plus lossless aliases. Never drops MUST_NOT_DROP."""
    payload = dict(raw or {})
    out: dict[str, Any] = {}
    conflicts: list[str] = []

    for canonical, aliases in CANONICAL_TO_ALIASES.items():
        canonical_val = _text(payload.get(canonical))
        alias_hits = [(alias, _text(payload.get(alias))) for alias in aliases]
        present = [(alias, value) for alias, value in alias_hits if value is not None]
        if canonical_val is not None:
            for alias, value in present:
                if value != canonical_val:
                    conflicts.append(canonical)
            chosen = canonical_val
        elif present:
            chosen = present[0][1]
        else:
            chosen = None
        out[canonical] = chosen
        out[aliases[0]] = chosen

    for field in MUST_NOT_DROP:
        out[field] = _text(payload.get(field))

    for field in (
        "validated_at",
        "valid_until",
        "state",
        "schema",
        "contract_version",
        "policy_version",
    ):
        if field in payload and field not in out:
            out[field] = payload.get(field)

    out["new_admission_allowed"] = payload.get("new_admission_allowed")
    out["existing_bound_touch_transport_allowed"] = payload.get("existing_bound_touch_transport_allowed")
    out["reason_codes"] = list(payload.get("reason_codes") or [])
    out["conflicts"] = conflicts
    out["complete"] = all(_text(out.get(field)) for field in REQUIRED_BINDING) and not conflicts
    return out


def one_byte_drift(value: str) -> str:
    if not value:
        return "x"
    return value[:-1] + ("0" if value[-1] != "0" else "1")
