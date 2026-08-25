"""Typed failures used by the cross-repository handoff contract."""


class DeliveryError(Exception):
    """Base fail-closed Delivery OS error."""

    code = "delivery_error"


class ContractError(DeliveryError):
    code = "contract_invalid"
