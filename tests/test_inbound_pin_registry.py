"""commercial/inbound/pin-registry.v1.json is the machine-readable pin inventory.

It must cover every policy file under commercial/inbound, carry the hash the
repo's own ``policy_hash`` computes for each file, and name exactly one
PIN_TARGET per policy_id. The v1 policy is NOT_ADMITTED_FOR_PIN because the
consumer-pin evaluator closes it with POLICY_VERSION_NOT_ADMITTED.
"""

from __future__ import annotations

import json
import subprocess
import sys
from collections import Counter
from pathlib import Path

from commercial.inbound import (
    CANONICAL_POLICY_NAME,
    DRAFT_CANONICAL_NAME,
    evaluate_consumer_pin,
    load_draft_authority,
    policy_hash,
)

ROOT = Path(__file__).resolve().parents[1]
INBOUND = ROOT / "commercial" / "inbound"
REGISTRY_PATH = INBOUND / "pin-registry.v1.json"
ALLOWED_STATUSES = {"PIN_TARGET", "NOT_ADMITTED_FOR_PIN", "ACTIVE"}
EXPECTED_PIN_TARGET_HASH = "sha256:405ac86064a90641b843352d21cd21703744115de9592558e100671d92276df7"
EXPECTED_GOVERNANCE_SOURCE_SHA = "0074722ce66f16af06dd4799ee88064ea8a12fc1"


def _registry() -> dict:
    return json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))


def _entries() -> list[dict]:
    entries = _registry()["entries"]
    assert isinstance(entries, list) and entries
    return entries


def test_registry_lists_every_policy_file_and_not_itself():
    listed = {entry["path"] for entry in _entries()}
    on_disk = {
        f"commercial/inbound/{path.name}"
        for path in INBOUND.glob("*.json")
        if path.name != REGISTRY_PATH.name
    }
    assert listed == on_disk
    assert "commercial/inbound/pin-registry.v1.json" not in listed


def test_registry_hashes_equal_computed_policy_hash():
    for entry in _entries():
        payload = json.loads((ROOT / entry["path"]).read_text(encoding="utf-8"))
        assert entry["policy_hash"] == policy_hash(payload), entry["path"]
        assert entry["policy_hash"].startswith("sha256:")
        assert len(entry["policy_hash"]) == 71


def test_exactly_one_pin_target_per_policy_id():
    entries = _entries()
    for entry in entries:
        assert entry["status"] in ALLOWED_STATUSES, entry["path"]
        assert isinstance(entry["policy_id"], str) and entry["policy_id"]
        assert isinstance(entry["consumers"], list)
    pin_targets = Counter(entry["policy_id"] for entry in entries if entry["status"] == "PIN_TARGET")
    policy_ids = {entry["policy_id"] for entry in entries}
    assert set(pin_targets) == policy_ids
    assert all(count == 1 for count in pin_targets.values()), dict(pin_targets)


def test_pin_target_is_the_draft_authority_and_hash_is_reproduced():
    (target,) = [entry for entry in _entries() if entry["status"] == "PIN_TARGET"]
    assert target["canonical_name"] == DRAFT_CANONICAL_NAME
    assert target["path"] == "commercial/inbound/net-new-inbound-handraiser.1.0.0-draft.20260904.json"
    assert target["policy_hash"] == policy_hash(load_draft_authority())
    assert target["policy_hash"] == EXPECTED_PIN_TARGET_HASH
    assert _registry()["governance_source_sha"] == EXPECTED_GOVERNANCE_SOURCE_SHA
    assert "load_draft_authority" in _registry()["pin_command"]
    # The documented pin command must print the registry's pin-target hash.
    proc = subprocess.run(
        [
            sys.executable,
            "-c",
            "from commercial.inbound import load_draft_authority, policy_hash; print(policy_hash(load_draft_authority()))",
        ],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    assert proc.stdout.strip() == target["policy_hash"]


def test_v1_policy_is_not_admitted_for_pin_and_evaluator_agrees():
    (v1,) = [entry for entry in _entries() if entry["canonical_name"] == CANONICAL_POLICY_NAME and entry["role"] == "admission_policy"]
    assert v1["status"] == "NOT_ADMITTED_FOR_PIN"
    verdict = evaluate_consumer_pin(
        {"consumer_id": "Warmbly#47", "canonical_name": CANONICAL_POLICY_NAME, "policy_hash": v1["policy_hash"]}
    )
    assert verdict["decision"] == "REJECTED_WITH_REASON"
    assert "POLICY_VERSION_NOT_ADMITTED" in verdict["reason_codes"]

    (target,) = [entry for entry in _entries() if entry["status"] == "PIN_TARGET"]
    accepted = evaluate_consumer_pin(
        {"consumer_id": "Warmbly#47", "canonical_name": target["canonical_name"], "policy_hash": target["policy_hash"]}
    )
    assert accepted["decision"] == "ACCEPTED"


def test_consumer_docs_name_the_pin_target_and_reject_v1_pins():
    for name in ("CONSUMER-CONTRACT.md", "CONSUMER-HANDOFF.md"):
        text = (ROOT / "commercial" / name).read_text(encoding="utf-8")
        assert DRAFT_CANONICAL_NAME in text, name
        assert EXPECTED_PIN_TARGET_HASH in text, name
        assert EXPECTED_GOVERNANCE_SOURCE_SHA in text, name
        assert "policy_hash(load_draft_authority())" in text, name
        assert "POLICY_VERSION_NOT_ADMITTED" in text, name
        assert "pin-registry.v1.json" in text, name
