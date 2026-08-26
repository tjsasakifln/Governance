"""CONFENGE Delivery OS vertical slice.

Governance owns readiness/capacity and orchestrates the canonical Control Center
Work Order authority. Public catalog identity remains in web-cfg and commercial
proposal truth remains in Warmbly.
"""

from .capacity import CapacityLedger, evaluate_admission, project_capacity_read_only
from .contracts import validate_delivery_order_requested
from .readiness import (
    generate_fail_closed_snapshot,
    promote_to_delivery_validated,
    validate_operational_profile,
)

__all__ = [
    "CapacityLedger",
    "evaluate_admission",
    "project_capacity_read_only",
    "generate_fail_closed_snapshot",
    "promote_to_delivery_validated",
    "validate_delivery_order_requested",
    "validate_operational_profile",
]
