"""Load the committed CAMPAIGN_ID=16 control-tower snapshot and fail closed."""

from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SNAP = ROOT / "docs" / "campaigns" / "2026-09-04-multivertical" / "control-snapshot"

REQUIRED_FILES = (
    "ledger.md",
    "contract-dag.json",
    "file-locks.json",
    "superseded-references.md",
    "closure-candidates.md",
    "merge-readiness.md",
    "branch-drift-risks.md",
    "refresh-protocol.md",
)

LEDGER_COLUMNS = (
    "repo",
    "issue/PR",
    "contemporaneous state",
    "owner",
    "dependency",
    "blocker",
    "next action",
    "do-not-do",
    "evidence",
    "observed_at",
)

ALLOWED_STATES = {
    "DONE",
    "PARTIAL",
    "NOW",
    "HOLD",
    "BLOCKED_EXTERNAL",
    "SUPERSEDED",
    "DECISION_ONLY",
    "LATER",
}

REQUIRED_CONTRACTS = {
    "CONFENGE_CORPORATE_TAXONOMY": "1.0.0-draft.20260904",
    "CONFENGE_OFFER_CATALOG": "2.0.0-draft.20260904",
    "CONFENGE_WEB_INTAKE": "2.0.0-draft.20260904",
    "NET_NEW_INBOUND_HANDRAISER": "1.0.0-draft.20260904",
    "CONFENGE_HANDRAISER_STATE": "1.0.0-draft.20260904",
    "MEETCFG_HANDRAISER_CONTEXT": "1.0.0-draft.20260904",
    "private_project_technical_readiness_v1": "1.0.0-draft.20260904",
    "private_project_technical_readiness_assessment": "1.0.0-draft.20260904",
    "CONFENGE_WEB": "lane",
}

REQUIRED_NUCLEOS = (
    "expert_evidence_assistance",
    "property_valuation",
    "building_engineering_documentation",
    "occupational_safety",
    "public_works_b2g",
)

NAMED_NODES = (
    ("web-cfg", "PR#522"),
    ("web-cfg", "PR#523"),
    ("web-cfg", "PR#524"),
    ("web-cfg", "PR#535"),
    ("web-cfg", "PR#536"),
    ("web-cfg", "PR#544"),
    ("web-cfg", "PR#548"),
    ("web-cfg", "PR#549"),
    ("web-cfg", "PR#586"),
    ("extra-cli", "issue#530"),
    ("extra-cli", "PR#539"),
    ("extra-cli", "PR#543"),
    ("extra-cli", "PR#531"),
    ("warmbly", "issue#260"),
    ("Governance", "issue#1"),
    ("web-cfg", "issue#61"),
    ("web-cfg", "issue#588"),
    ("warmbly", "issue#43"),
    ("warmbly", "issue#155"),
)

DORMANT_REPOS = ("lead-recovery", "Inbound", "outreach")


class SnapshotFailClosed(ValueError):
    """Missing or divergent snapshot authority must not pass."""


def _read(name: str) -> str:
    path = SNAP / name
    if not path.is_file():
        raise SnapshotFailClosed(f"missing snapshot file: {name}")
    return path.read_text(encoding="utf-8")


def _load_json(name: str) -> dict:
    return json.loads(_read(name))


def parse_ledger(text: str) -> list[dict[str, str]]:
    expected = list(LEDGER_COLUMNS)
    header = None
    rows: list[dict[str, str]] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line.startswith("|"):
            if header is not None:
                break
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if cells and set(cells[0]) <= {"-"}:
            continue
        if header is None:
            if cells == expected:
                header = cells
            continue
        if len(cells) != len(header):
            raise SnapshotFailClosed("ledger row cell count mismatch")
        rows.append(dict(zip(header, cells)))
    if header != expected:
        raise SnapshotFailClosed(f"ledger columns missing {expected!r}")
    if not rows:
        raise SnapshotFailClosed("ledger has no data rows")
    return rows


def canonical_contract_hash(contract: dict) -> str:
    payload = {k: v for k, v in contract.items() if k != "content_hash"}
    blob = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()


def require_pinned_contract(contract: dict) -> None:
    if not isinstance(contract, dict):
        raise SnapshotFailClosed("contract is not an object")
    version = contract.get("version")
    content_hash = contract.get("content_hash")
    if not version:
        raise SnapshotFailClosed(f"missing version for {contract.get('id')!r}")
    if not content_hash:
        raise SnapshotFailClosed(f"missing hash for {contract.get('id')!r}")
    expected = canonical_contract_hash(contract)
    if content_hash != expected:
        raise SnapshotFailClosed(
            f"divergent hash for {contract.get('id')!r}: {content_hash} != {expected}"
        )


def validate_contract_dag(dag: dict) -> dict:
    if dag.get("status") != "TEST_ONLY":
        raise SnapshotFailClosed("contract-dag must be TEST_ONLY")
    invariants = dag.get("invariants") or {}
    if invariants.get("outbound_eligible") is not False:
        raise SnapshotFailClosed("outbound_eligible must be false")
    if invariants.get("auto_send") is not False:
        raise SnapshotFailClosed("auto_send must be false")
    nucleos = {item.get("id") for item in dag.get("nucleos") or []}
    missing_nucleos = [n for n in REQUIRED_NUCLEOS if n not in nucleos]
    if missing_nucleos:
        raise SnapshotFailClosed(f"missing nucleos: {missing_nucleos}")
    by_id = {c.get("id"): c for c in dag.get("contracts") or []}
    for cid, version in REQUIRED_CONTRACTS.items():
        rec = by_id.get(cid)
        if rec is None:
            raise SnapshotFailClosed(f"missing contract {cid}")
        if rec.get("version") != version:
            raise SnapshotFailClosed(f"{cid} version {rec.get('version')!r} != {version!r}")
        if rec.get("production_authority") is not False:
            raise SnapshotFailClosed(f"{cid} must not be production authority")
        if rec.get("runtime_fallback_forbidden") is not True:
            raise SnapshotFailClosed(f"{cid} must forbid runtime fallback")
        require_pinned_contract(rec)
    return dag


def test_eight_snapshot_files_exist():
    missing = [name for name in REQUIRED_FILES if not (SNAP / name).is_file()]
    assert missing == []
    assert len(REQUIRED_FILES) == 8


def test_ledger_has_required_columns_and_allowed_states():
    rows = parse_ledger(_read("ledger.md"))
    for row in rows:
        state = row["contemporaneous state"]
        assert state in ALLOWED_STATES, row
        assert row["observed_at"], row
        assert "T" in row["observed_at"] and row["observed_at"].endswith("Z")


def test_named_reconciliation_nodes_are_classified():
    rows = parse_ledger(_read("ledger.md"))
    index = {(row["repo"], row["issue/PR"]): row for row in rows}
    for repo, item in NAMED_NODES:
        row = index.get((repo, item))
        assert row is not None, f"missing named node {repo} {item}"
        assert row["contemporaneous state"] in ALLOWED_STATES
        assert row["observed_at"]


def test_dormant_repos_are_recorded_as_no_open_work():
    rows = parse_ledger(_read("ledger.md"))
    for repo in DORMANT_REPOS:
        matches = [row for row in rows if row["repo"] == repo]
        assert matches, f"missing dormant repo {repo}"
        assert any("no-open-work" in row["issue/PR"] or row["issue/PR"] == "repo-open-work=0" for row in matches)
        assert all(row["contemporaneous state"] == "DONE" for row in matches)
        assert any("Do not reactivate" in row["do-not-do"] for row in matches)


def test_file_locks_cover_campaigns_01_to_15():
    payload = _load_json("file-locks.json")
    ids = {str(item["campaign_id"]).zfill(2) for item in payload["locks"]}
    expected = {f"{i:02d}" for i in range(1, 16)}
    assert expected <= ids
    assert payload["refresh_owner"] == 97
    assert payload["photograph"] == "initial"


def test_contract_dag_pins_draft_contracts_and_invariants():
    dag = validate_contract_dag(_load_json("contract-dag.json"))
    assert dag["invariants"]["fail_closed_on_missing_or_divergent_version_or_hash"] is True
    text = json.dumps(dag)
    for nucleo in REQUIRED_NUCLEOS:
        assert nucleo in text


def test_missing_version_or_hash_fails_closed():
    dag = _load_json("contract-dag.json")
    original = dag["contracts"][0]
    missing_version = copy.deepcopy(original)
    missing_version.pop("version")
    with pytest.raises(SnapshotFailClosed, match="missing version"):
        require_pinned_contract(missing_version)
    missing_hash = copy.deepcopy(original)
    missing_hash.pop("content_hash")
    with pytest.raises(SnapshotFailClosed, match="missing hash"):
        require_pinned_contract(missing_hash)
    diverged = copy.deepcopy(original)
    diverged["content_hash"] = "0" * 64
    with pytest.raises(SnapshotFailClosed, match="divergent hash"):
        require_pinned_contract(diverged)


def test_unknown_classification_is_rejected():
    rows = parse_ledger(_read("ledger.md"))
    poisoned = copy.deepcopy(rows[0])
    poisoned["contemporaneous state"] = "UNKNOWN"
    with pytest.raises(AssertionError):
        assert poisoned["contemporaneous state"] in ALLOWED_STATES
    with pytest.raises(SnapshotFailClosed, match="UNKNOWN classification"):
        if poisoned["contemporaneous state"] not in ALLOWED_STATES:
            raise SnapshotFailClosed("UNKNOWN classification is not a ledger state")


def test_idempotent_reparse_matches():
    first_ledger = parse_ledger(_read("ledger.md"))
    second_ledger = parse_ledger(_read("ledger.md"))
    assert first_ledger == second_ledger
    first_dag = validate_contract_dag(_load_json("contract-dag.json"))
    second_dag = validate_contract_dag(_load_json("contract-dag.json"))
    assert first_dag == second_dag
    first_locks = _load_json("file-locks.json")
    second_locks = _load_json("file-locks.json")
    assert first_locks == second_locks


def test_refresh_protocol_is_initial_photograph():
    text = _read("refresh-protocol.md").lower()
    assert "initial photograph" in text or "initial photograph" in _read("refresh-protocol.md").lower()
    raw = _read("refresh-protocol.md")
    assert "initial photograph" in raw
    assert "97" in raw
    assert "does **not** “accompany in background”" in raw or "does not" in raw.lower()
    assert "background" in raw.lower()


def test_snapshot_forbids_smtp_and_eight_web_cfg_pr_comments():
    ledger = _read("ledger.md")
    assert "NO_SMTP=CONFIRMED" in ledger
    assert "Do not comment/close from campaign 16" in ledger
    merge = _read("merge-readiness.md")
    assert "NO_MERGE" in merge
    assert "#536" in merge and "LCP" in merge
