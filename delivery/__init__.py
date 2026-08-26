"""CONFENGE Delivery OS vertical slice.

Governance owns readiness/capacity and orchestrates the canonical Control Center
Work Order authority. Public catalog identity remains in web-cfg and commercial
proposal truth remains in Warmbly.
"""

from .capacity import (
    CapacityLedger,
    evaluate_admission,
    evaluate_admission_v2,
    evaluate_catalog_availability,
    project_capacity_read_only,
    project_capacity_read_only_v2,
)
from .contracts import validate_delivery_order_requested
from .readiness import (
    generate_fail_closed_snapshot,
    promote_to_delivery_validated,
    validate_operational_profile,
)

__all__ = [
    "CapacityLedger",
    "evaluate_admission",
    "evaluate_admission_v2",
    "evaluate_catalog_availability",
    "project_capacity_read_only",
    "project_capacity_read_only_v2",
    "generate_fail_closed_snapshot",
    "promote_to_delivery_validated",
    "validate_delivery_order_requested",
    "validate_operational_profile",
]
