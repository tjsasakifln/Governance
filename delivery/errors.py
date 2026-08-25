"""Typed failures used by command handlers and contract tests."""


class DeliveryError(Exception):
    """Base fail-closed Delivery OS error."""

    code = "delivery_error"


class ContractError(DeliveryError):
    code = "contract_invalid"


class GateHeldError(DeliveryError):
    code = "gate_held"


class IllegalTransitionError(DeliveryError):
    code = "illegal_transition"


class OptimisticConcurrencyError(DeliveryError):
    code = "optimistic_concurrency"


class DuplicateEventConflictError(DeliveryError):
    code = "duplicate_event_conflict"


class ReplayError(DeliveryError):
    code = "replay_invalid"
