"""Stable JSON/API boundary for the E2E canary readiness/capacity lifecycle."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Mapping, Sequence

from .capacity import CapacityLedger, evaluate_admission


class CanaryGate:
    """Evaluate readiness/capacity and apply idempotent allocation commands."""

    def __init__(
        self,
        *,
        readiness: Mapping[str, Any],
        capacity_snapshot: Mapping[str, Any],
        ledger: CapacityLedger,
    ):
        self.readiness = readiness
        self.capacity_snapshot = capacity_snapshot
        self.ledger = ledger

    def evaluate(
        self,
        *,
        request: Mapping[str, Any],
        active_work_orders: Sequence[Mapping[str, Any]],
        evaluated_at: str,
    ) -> dict[str, Any]:
        active_ids = [
            item["work_order_id"]
            for item in active_work_orders
            if item.get("stage") not in {"CLOSED", "CANCELLED"}
        ]
        reserved = self.ledger.reserved_effort_units(
            capacity_snapshot_id=self.capacity_snapshot["capacity_snapshot_id"],
            active_work_order_ids=active_ids,
        )
        return evaluate_admission(
            request=request,
            readiness=self.readiness,
            capacity_snapshot=self.capacity_snapshot,
            active_work_orders=active_work_orders,
            reserved_effort_units=reserved,
            evaluated_at=evaluated_at,
        )

    def evaluate_and_hold(
        self,
        *,
        request: Mapping[str, Any],
        active_work_orders: Sequence[Mapping[str, Any]],
        evaluated_at: str,
        hold_idempotency_key: str,
        hold_expires_at: str,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        decision = self.evaluate(
            request=request,
            active_work_orders=active_work_orders,
            evaluated_at=evaluated_at,
        )
        hold = self.ledger.acquire_hold(
            decision=decision,
            idempotency_key=hold_idempotency_key,
            correlation_id=request["correlation_id"],
            created_at=evaluated_at,
            expires_at=hold_expires_at,
        )
        return decision, hold

    def commit(
        self,
        *,
        hold_id: str,
        work_order_id: str,
        idempotency_key: str,
        committed_at: str,
    ) -> dict[str, Any]:
        return self.ledger.commit(
            hold_id=hold_id,
            work_order_id=work_order_id,
            idempotency_key=idempotency_key,
            committed_at=committed_at,
        )

    def release_closed(
        self,
        *,
        hold_id: str,
        idempotency_key: str,
        released_at: str,
    ) -> dict[str, Any]:
        return self.ledger.release(
            hold_id=hold_id,
            reason="WORK_ORDER_CLOSED",
            idempotency_key=idempotency_key,
            released_at=released_at,
        )


def _load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the synthetic capacity allocation lifecycle")
    parser.add_argument("--readiness", type=Path, required=True)
    parser.add_argument("--capacity", type=Path, required=True)
    parser.add_argument("--request", type=Path, required=True)
    parser.add_argument("--ledger", type=Path, required=True)
    parser.add_argument("--evaluated-at", required=True)
    parser.add_argument("--hold-expires-at", required=True)
    parser.add_argument("--committed-at", required=True)
    parser.add_argument("--released-at", required=True)
    parser.add_argument("--work-order-id", required=True)
    parser.add_argument("--idempotency-prefix", default="diag-canary-001")
    args = parser.parse_args()

    readiness = _load(args.readiness)
    snapshot = _load(args.capacity)
    request = _load(args.request)
    with CapacityLedger(args.ledger) as ledger:
        gate = CanaryGate(readiness=readiness, capacity_snapshot=snapshot, ledger=ledger)
        decision, held = gate.evaluate_and_hold(
            request=request,
            active_work_orders=[],
            evaluated_at=args.evaluated_at,
            hold_idempotency_key=f"{args.idempotency_prefix}:hold",
            hold_expires_at=args.hold_expires_at,
        )
        committed = gate.commit(
            hold_id=held["hold_id"],
            work_order_id=args.work_order_id,
            idempotency_key=f"{args.idempotency_prefix}:commit",
            committed_at=args.committed_at,
        )
        committed_projection = ledger.projection(
            capacity_snapshot_id=snapshot["capacity_snapshot_id"],
            staffed_capacity_units=snapshot["staffed_capacity_units"],
            active_work_orders=[
                {
                    "work_order_id": args.work_order_id,
                    "stage": "IN_PROGRESS",
                    "estimated_effort_units": readiness["estimated_effort"]["amount"],
                }
            ],
        )
        released = gate.release_closed(
            hold_id=held["hold_id"],
            idempotency_key=f"{args.idempotency_prefix}:release",
            released_at=args.released_at,
        )
        released_projection = ledger.projection(
            capacity_snapshot_id=snapshot["capacity_snapshot_id"],
            staffed_capacity_units=snapshot["staffed_capacity_units"],
            active_work_orders=[
                {
                    "work_order_id": args.work_order_id,
                    "stage": "CLOSED",
                    "estimated_effort_units": readiness["estimated_effort"]["amount"],
                }
            ],
        )
    print(
        json.dumps(
            {
                "schema_version": "confenge.canary_capacity_lifecycle.v1",
                "decision": decision,
                "held": held,
                "committed": committed,
                "committed_projection": committed_projection,
                "released": released,
                "released_projection": released_projection,
                "real_checkout": False,
                "synthetic": True,
            },
            indent=2,
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
