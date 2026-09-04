"""Read-only conformance of owner readbacks against NET_NEW_INBOUND_HANDRAISER-v1.

Governance validates published evidence. It does not call Warmbly or MeetCFG.
"""

from __future__ import annotations

from typing import Any, Mapping

from .admit import CANONICAL_POLICY_NAME, load_authority, policy_hash

CLOSED_STATES = frozenset({"ACCEPTED", "REJECTED_WITH_REASON", "UNKNOWN"})


def evaluate_owner_readbacks(
    evidence: Mapping[str, Any],
    *,
    authority: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    authority = authority or load_authority()
    warmbly = evidence.get("warmbly") if isinstance(evidence.get("warmbly"), Mapping) else {}
    meetcfg = evidence.get("meetcfg") if isinstance(evidence.get("meetcfg"), Mapping) else {}
    residual = None
    if warmbly.get("collection_export") == "SCHEMA_MISMATCH_COLLECTION":
        residual = "SCHEMA_MISMATCH_COLLECTION"
    elif meetcfg.get("warmbly_export") == "SCHEMA_MISMATCH_COLLECTION":
        residual = "SCHEMA_MISMATCH_COLLECTION"

    policy_on_main = bool((evidence.get("governance") or {}).get("policy_on_origin_main"))
    warmbly_ack = warmbly.get("implementation_ack") == "PASS"
    meetcfg_ack = meetcfg.get("consumer_ack") == "PASS"
    accepted = warmbly.get("accepted_e2e") in {"PASS", "ISOLATED_PASS"} and meetcfg.get("accepted_e2e") in {
        "PASS",
        "LOCAL_FIXTURE_PASS",
    }
    rejected = warmbly.get("rejected_unknown_e2e") in {"PASS", "ISOLATED_PASS"} and meetcfg.get(
        "rejected_unknown_e2e"
    ) in {"PASS", "ISOLATED_PASS"}
    replay = warmbly.get("replay_100") in {"PASS", "ISOLATED_PASS"} and meetcfg.get("replay_100") == "PASS"
    inbound_only = (
        warmbly.get("inbound_only_never_outbound") == "PASS"
        and meetcfg.get("inbound_only_preserved") == "PASS"
    )
    live_export_ok = residual is None
    closeable = all(
        [
            policy_on_main,
            warmbly_ack,
            meetcfg_ack,
            accepted,
            rejected,
            replay,
            inbound_only,
            live_export_ok,
        ]
    )
    issue_65 = "CLOSED" if closeable else f"OPEN_WITH_EXACT_REASON:{residual or 'POLICY_NOT_ON_MAIN'}"
    return {
        "canonical_name": authority.get("canonical_name") or CANONICAL_POLICY_NAME,
        "policy_hash": policy_hash(authority),
        "WARM_BLY_POLICY_ACK": "PASS" if warmbly_ack else "PENDING",
        "MEETCFG_CONSUMER_ACK": "PASS" if meetcfg_ack else "PENDING",
        "ACCEPTED_NET_NEW_E2E": "PASS" if accepted and live_export_ok else "PENDING",
        "REJECTED_UNKNOWN_E2E": "PASS" if rejected and live_export_ok else "PENDING",
        "REPLAY_100_EXACTLY_ONCE_LOGICAL": "PASS" if replay else "FAIL",
        "INBOUND_ONLY_NEVER_OUTBOUND": "PASS" if inbound_only else "FAIL",
        "ISSUE_65": issue_65,
        "residual": residual,
        "residual_owner": "Warmbly" if residual == "SCHEMA_MISMATCH_COLLECTION" else None,
        "closeable": closeable,
        "smtp_authorized": False,
        "new_control_plane": False,
    }
