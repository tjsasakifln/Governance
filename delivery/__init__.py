"""CONFENGE Delivery OS vertical slice.

Governance owns Work Orders, readiness, capacity and their Control Center read
model. Public catalog identity remains in web-cfg and commercial proposal truth
remains in Warmbly.
"""

from .capacity import CapacityLedger, evaluate_admission
from .contracts import validate_delivery_order_requested
from .readiness import (
    generate_fail_closed_snapshot,
    promote_to_delivery_validated,
    validate_operational_profile,
)
from .store import SQLiteWorkOrderStore
from .work_order import WorkOrderService, rebuild_store_projection, rebuild_work_order

__all__ = [
    "CapacityLedger",
    "SQLiteWorkOrderStore",
    "WorkOrderService",
    "evaluate_admission",
    "generate_fail_closed_snapshot",
    "promote_to_delivery_validated",
    "rebuild_store_projection",
    "rebuild_work_order",
    "validate_delivery_order_requested",
    "validate_operational_profile",
]
