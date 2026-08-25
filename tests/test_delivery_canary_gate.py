from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from delivery.canary_gate import CanaryGate
from delivery.capacity import CapacityLedger


ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "delivery" / "fixtures"


def load(name: str):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def test_stable_api_evaluate_hold_commit_release(tmp_path: Path):
    readiness = load("cfg-diag-exp-v1.production-ready.json")
    snapshot = load("capacity-synthetic-one.v1.json")
    request = load("canary-capacity-request.v1.json")
    with CapacityLedger(tmp_path / "capacity.sqlite3") as ledger:
        gate = CanaryGate(readiness=readiness, capacity_snapshot=snapshot, ledger=ledger)
        decision, held = gate.evaluate_and_hold(
            request=request,
            active_work_orders=[],
            evaluated_at="2026-08-25T12:00:00Z",
            hold_idempotency_key="diag-canary-api:hold",
            hold_expires_at="2026-08-28T12:00:00Z",
        )
        assert decision["decision"] == "CAN_ACCEPT"
        assert held["state"] == "HELD"
        committed = gate.commit(
            hold_id=held["hold_id"],
            work_order_id="wo_confenge_diag_canary_api",
            idempotency_key="diag-canary-api:commit",
            committed_at="2026-08-25T13:00:00Z",
        )
        assert committed["state"] == "COMMITTED"
        released = gate.release_closed(
            hold_id=held["hold_id"],
            idempotency_key="diag-canary-api:release",
            released_at="2026-08-25T18:00:00Z",
        )
        assert released["state"] == "RELEASED"


def test_cli_lifecycle_is_executable_and_final_state_converges(tmp_path: Path):
    command = [
        sys.executable,
        "-m",
        "delivery.canary_gate",
        "--readiness",
        str(FIXTURES / "cfg-diag-exp-v1.production-ready.json"),
        "--capacity",
        str(FIXTURES / "capacity-synthetic-one.v1.json"),
        "--request",
        str(FIXTURES / "canary-capacity-request.v1.json"),
        "--ledger",
        str(tmp_path / "cli.sqlite3"),
        "--evaluated-at",
        "2026-08-25T12:00:00Z",
        "--hold-expires-at",
        "2026-08-28T12:00:00Z",
        "--committed-at",
        "2026-08-25T13:00:00Z",
        "--released-at",
        "2026-08-25T18:00:00Z",
        "--work-order-id",
        "wo_confenge_diag_canary_cli",
    ]
    first = json.loads(subprocess.run(command, cwd=ROOT, check=True, text=True, capture_output=True).stdout)
    second = json.loads(subprocess.run(command, cwd=ROOT, check=True, text=True, capture_output=True).stdout)
    assert first["decision"]["decision"] == second["decision"]["decision"] == "CAN_ACCEPT"
    assert first["held"]["hold_id"] == second["held"]["hold_id"]
    assert first["released"]["state"] == second["released"]["state"] == "RELEASED"
    assert first["released_projection"] == second["released_projection"]
    assert first["released_projection"]["available_units"] == 1
    assert first["real_checkout"] is False
