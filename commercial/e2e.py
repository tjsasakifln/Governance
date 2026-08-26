"""Synthetic commercial-chain adapters used only by the #120 proof.

The module is deliberately a pure reducer.  It does not call a provider and it
does not persist billing truth.  Provider facts remain owned by Asaas and the
commercial ledger remains owned by Warmbly.  The reducer exists to prove the
cross-repository identity, receipt and financial-state contracts without
turning a fixture into live evidence.
"""

from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from dataclasses import dataclass, field
from typing import Any, Mapping


PROPOSAL_SCHEMA = "confenge.proposal.v1"
ACCEPTANCE_BINDING_SCHEMA = "confenge.acceptance_binding.v1"
CHECKOUT_FIXTURE_SCHEMA = "confenge.checkout_fixture.v1"
PROVIDER_EVENT_SCHEMA = "confenge.provider_event_fixture.v1"
SEMANTIC_RECEIPT_SCHEMA = "confenge.semantic_receipt.v1"
RECONCILIATION_SCHEMA = "confenge.financial_reconciliation.v1"
CONTROL_CENTER_SCHEMA = "confenge.commercial_chain_projection.v2"

CHAIN_HOPS = (
    "offer",
    "proposal_version",
    "acceptance",
    "financial_eligibility",
    "checkout",
    "provider_event",
    "semantic_reconciliation",
    "commercial_state",
    "onboarding",
    "work_order",
    "qa",
    "delivery",
    "closeout",
    "outcome",
)

FINANCIAL_STATES = frozenset(
    {
        "UNKNOWN",
        "PAYMENT_CREATED",
        "PAYMENT_CONFIRMED",
        "PAYMENT_RECEIVED",
        "OVERDUE",
        "REFUNDED",
        "CANCELED",
    }
)

RAW_TO_CANONICAL = {
    "PAYMENT_CREATED": "PAYMENT_CREATED",
    "PAYMENT_CONFIRMED": "PAYMENT_CONFIRMED",
    "PAYMENT_RECEIVED": "PAYMENT_RECEIVED",
    "PAYMENT_OVERDUE": "OVERDUE",
    "PAYMENT_REFUNDED": "REFUNDED",
    "PAYMENT_PARTIALLY_REFUNDED": "REFUNDED",
    "PAYMENT_DELETED": "CANCELED",
    "PAYMENT_CANCELED": "CANCELED",
    "PAYMENT_CANCELLED": "CANCELED",
}

ALLOWED_TRANSITIONS = {
    "UNKNOWN": {"PAYMENT_CREATED"},
    "PAYMENT_CREATED": {"PAYMENT_CONFIRMED", "OVERDUE", "CANCELED"},
    "PAYMENT_CONFIRMED": {"PAYMENT_RECEIVED", "OVERDUE", "REFUNDED", "CANCELED"},
    "PAYMENT_RECEIVED": {"REFUNDED", "CANCELED"},
    "OVERDUE": {"PAYMENT_CONFIRMED", "PAYMENT_RECEIVED", "CANCELED"},
    "REFUNDED": set(),
    "CANCELED": set(),
}

STATE_ORDER = {
    "UNKNOWN": 0,
    "PAYMENT_CREATED": 1,
    "PAYMENT_CONFIRMED": 2,
    "OVERDUE": 2,
    "PAYMENT_RECEIVED": 3,
    "REFUNDED": 4,
    "CANCELED": 4,
}

_PROPOSAL_SNAPSHOT_FIELDS = (
    "proposal_id",
    "proposal_version",
    "organization_id",
    "account_id",
    "client_ref",
    "opportunity_id",
    "qco_id",
    "deal_id",
    "offer_id",
    "offer_version",
    "deliverable_id",
    "deliverable_version",
    "scope_version",
    "price_version",
    "terms_version",
    "amount",
    "currency",
    "credits",
    "addons",
    "inputs",
    "exclusions",
    "deadline",
    "valid_until",
)


class E2EContractError(ValueError):
    """Raised when the synthetic proof would cross an ambiguous boundary."""


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def stable_id(prefix: str, value: Any, *, size: int = 32) -> str:
    digest = hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()
    return f"{prefix}_{digest[:size]}"


def content_hash(value: Any) -> str:
    return "sha256:" + hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def _text(value: Any, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise E2EContractError(f"{field_name} must be a non-empty string")
    return value.strip()


def _string_set(value: Any, field_name: str, *, non_empty: bool = False) -> list[str]:
    if not isinstance(value, list) or not all(isinstance(item, str) and item.strip() for item in value):
        raise E2EContractError(f"{field_name} must be a string set")
    clean = sorted(set(item.strip() for item in value))
    if non_empty and not clean:
        raise E2EContractError(f"{field_name} must not be empty")
    if len(clean) != len(value):
        raise E2EContractError(f"{field_name} must not contain duplicates")
    return clean


def proposal_snapshot_hash(proposal: Mapping[str, Any]) -> str:
    """Reproduce Warmbly ``Proposal.AcceptedHash`` for the v1 contract."""

    if proposal.get("schema_version") != PROPOSAL_SCHEMA:
        raise E2EContractError(f"proposal.schema_version must be {PROPOSAL_SCHEMA}")
    snapshot: dict[str, Any] = {}
    for field_name in _PROPOSAL_SNAPSHOT_FIELDS:
        value = proposal.get(field_name)
        if field_name == "deal_id" and not value:
            continue
        if field_name in {"credits", "addons", "inputs", "exclusions"}:
            value = _string_set(value, f"proposal.{field_name}", non_empty=field_name == "inputs")
        elif field_name == "proposal_version":
            if not isinstance(value, int) or isinstance(value, bool) or value < 1:
                raise E2EContractError("proposal.proposal_version must be a positive integer")
        elif field_name == "amount":
            if not isinstance(value, int) or isinstance(value, bool) or value < 0:
                raise E2EContractError("proposal.amount must be non-negative integer minor units")
        else:
            value = _text(value, f"proposal.{field_name}")
        if field_name == "currency":
            value = value.upper()
        snapshot[field_name] = value

    # Go's encoding/json preserves struct field order.  Python dicts preserve
    # insertion order, so this matches Warmbly's immutable v1 snapshot exactly.
    raw = json.dumps(snapshot, ensure_ascii=False, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(raw.encode("utf-8")).hexdigest()


def acceptance_binding_hash(binding: Mapping[str, Any]) -> str:
    """Hash only the immutable cross-repository binding, never mutable evidence metadata."""

    material = {
        field_name: binding.get(field_name)
        for field_name in (
            "acceptance_id",
            "correlation_id",
            "proposal_id",
            "proposal_version",
            "accepted_snapshot_hash",
            "offer_id",
            "offer_version",
            "deliverable_id",
            "deliverable_version",
            "terms_version",
            "amount_cents",
            "accepted_at",
            "synthetic",
            "immutable",
        )
    }
    return "sha256:" + hashlib.sha256(canonical_json(material).encode("utf-8")).hexdigest()


def validate_accepted_proposal(
    proposal: Mapping[str, Any],
    *,
    expected_amount_cents: int,
    expected_offer_id: str,
    expected_deliverable_id: str,
    expected_deliverable_version: str,
) -> dict[str, Any]:
    """Validate the accepted proposal without repairing its snapshot in place."""

    clean = deepcopy(dict(proposal))
    if clean.get("decision_state") != "ACCEPTED":
        raise E2EContractError("proposal must be ACCEPTED")
    if clean.get("synthetic") is not True:
        raise E2EContractError("the no-money canary requires proposal.synthetic=true")
    if clean.get("amount") != expected_amount_cents:
        raise E2EContractError("proposal amount diverges from the pinned offer authority")
    expected = {
        "offer_id": expected_offer_id,
        "deliverable_id": expected_deliverable_id,
        "deliverable_version": expected_deliverable_version,
    }
    for field_name, value in expected.items():
        if clean.get(field_name) != value:
            raise E2EContractError(f"proposal.{field_name} diverges from the canary selection")
    claimed = _text(clean.get("accepted_snapshot_hash"), "proposal.accepted_snapshot_hash")
    calculated = proposal_snapshot_hash(clean)
    if claimed != calculated:
        raise E2EContractError("accepted proposal snapshot hash mismatch")
    return clean


def validate_acceptance_binding(
    binding: Mapping[str, Any], proposal: Mapping[str, Any]
) -> dict[str, Any]:
    """Validate the additive web-cfg acceptance-to-proposal binding."""

    if binding.get("schema_version") != ACCEPTANCE_BINDING_SCHEMA:
        raise E2EContractError(f"acceptance.schema_version must be {ACCEPTANCE_BINDING_SCHEMA}")
    if binding.get("synthetic") is not True or binding.get("immutable") is not True:
        raise E2EContractError("canary acceptance must be synthetic and immutable")
    for field_name in (
        "acceptance_id",
        "correlation_id",
        "proposal_id",
        "accepted_snapshot_hash",
        "offer_id",
        "offer_version",
        "deliverable_id",
        "deliverable_version",
        "terms_version",
        "accepted_at",
        "record_hash",
    ):
        _text(binding.get(field_name), f"acceptance.{field_name}")
    if (
        not isinstance(binding.get("proposal_version"), int)
        or isinstance(binding.get("proposal_version"), bool)
        or binding["proposal_version"] < 1
    ):
        raise E2EContractError("acceptance.proposal_version must be a positive integer")
    if (
        not isinstance(binding.get("amount_cents"), int)
        or isinstance(binding.get("amount_cents"), bool)
        or binding["amount_cents"] < 0
    ):
        raise E2EContractError("acceptance.amount_cents must be non-negative integer minor units")
    _string_set(binding.get("evidence_refs"), "acceptance.evidence_refs", non_empty=True)
    comparisons = {
        "correlation_id": "correlation_id",
        "proposal_id": "proposal_id",
        "proposal_version": "proposal_version",
        "accepted_snapshot_hash": "accepted_snapshot_hash",
        "offer_id": "offer_id",
        "offer_version": "offer_version",
        "deliverable_id": "deliverable_id",
        "deliverable_version": "deliverable_version",
        "terms_version": "terms_version",
        "amount_cents": "amount",
    }
    for binding_field, proposal_field in comparisons.items():
        if binding.get(binding_field) != proposal.get(proposal_field):
            raise E2EContractError(
                f"acceptance.{binding_field} diverges from proposal.{proposal_field}"
            )
    if binding["record_hash"] != acceptance_binding_hash(binding):
        raise E2EContractError("acceptance immutable binding hash mismatch")
    return deepcopy(dict(binding))


def validate_checkout_fixture(
    checkout: Mapping[str, Any], *, acceptance: Mapping[str, Any]
) -> dict[str, Any]:
    """Validate a labeled detached checkout stub without inventing a provider object."""

    if checkout.get("schema_version") != CHECKOUT_FIXTURE_SCHEMA:
        raise E2EContractError(f"checkout.schema_version must be {CHECKOUT_FIXTURE_SCHEMA}")
    if checkout.get("mode") != "DETACHED_STUB" or checkout.get("provider") != "asaas":
        raise E2EContractError("checkout fixture must be the detached Asaas stub")
    if checkout.get("environment") != "STUB" or checkout.get("synthetic") is not True:
        raise E2EContractError("checkout fixture must be labeled STUB/synthetic")
    if checkout.get("production_checkout_enabled") is not False:
        raise E2EContractError("production checkout must remain disabled")
    if checkout.get("real_money_mutation_approved") is not False:
        raise E2EContractError("real-money mutation must remain disabled")
    if checkout.get("provider_checkout_id") is not None:
        raise E2EContractError("STUB evidence cannot claim a provider checkout object")
    for field_name in (
        "checkout_attempt_id",
        "correlation_id",
        "acceptance_id",
        "offer_id",
        "offer_version",
        "external_reference",
        "created_at",
        "source_fixture_ref",
        "source_fixture_hash",
    ):
        _text(checkout.get(field_name), f"checkout.{field_name}")
    if checkout.get("correlation_id") != acceptance.get("correlation_id"):
        raise E2EContractError("checkout correlation diverges from acceptance")
    if checkout.get("acceptance_id") != acceptance.get("acceptance_id"):
        raise E2EContractError("checkout does not cite the accepted record")
    if checkout.get("offer_id") != acceptance.get("offer_id"):
        raise E2EContractError("checkout offer diverges from acceptance")
    if checkout.get("offer_version") != acceptance.get("offer_version"):
        raise E2EContractError("checkout offer version diverges from acceptance")
    if checkout.get("amount_cents") != acceptance.get("amount_cents"):
        raise E2EContractError("checkout amount diverges from acceptance")
    expected_external = f"cfg:{checkout['offer_id']}:{checkout['correlation_id']}"
    if checkout.get("external_reference") != expected_external:
        raise E2EContractError("checkout external_reference does not bind the chain")
    _string_set(checkout.get("evidence_refs"), "checkout.evidence_refs", non_empty=True)
    return deepcopy(dict(checkout))


def validate_provider_event(event: Mapping[str, Any], *, correlation_id: str) -> dict[str, Any]:
    if event.get("schema_version") != PROVIDER_EVENT_SCHEMA:
        raise E2EContractError(f"provider event schema must be {PROVIDER_EVENT_SCHEMA}")
    if event.get("provider") != "asaas" or event.get("environment") != "STUB":
        raise E2EContractError("the checked-in canary permits only the labeled Asaas STUB")
    if event.get("synthetic") is not True or event.get("real_money") is not False:
        raise E2EContractError("provider fixture must be synthetic with real_money=false")
    for field_name in (
        "provider_event_id",
        "correlation_id",
        "external_reference",
        "raw_event_type",
        "raw_status",
        "occurred_at",
        "source_fixture_ref",
        "source_fixture_hash",
    ):
        _text(event.get(field_name), f"provider_event.{field_name}")
    if event["correlation_id"] != correlation_id:
        raise E2EContractError("provider event correlation diverges from the chain")
    expected_external = f"cfg:{event.get('offer_id')}:{correlation_id}"
    if event["external_reference"] != expected_external:
        raise E2EContractError("provider event external_reference does not bind the chain")
    if event.get("provider_object_id") is not None:
        raise E2EContractError("STUB evidence cannot claim a provider object id")
    if (
        not isinstance(event.get("amount_cents"), int)
        or isinstance(event.get("amount_cents"), bool)
        or event["amount_cents"] < 0
    ):
        raise E2EContractError("provider event amount_cents must be non-negative integer minor units")
    _string_set(event.get("evidence_refs"), "provider_event.evidence_refs", non_empty=True)
    return deepcopy(dict(event))


@dataclass
class SemanticReconciler:
    """In-memory semantic reducer; chain identity is never the event dedupe key."""

    correlation_id: str
    synthetic: bool = True
    state: str = "UNKNOWN"
    receipts: dict[str, dict[str, Any]] = field(default_factory=dict)
    applied_events: list[dict[str, Any]] = field(default_factory=list)
    last_applied_event_id: str | None = None

    def _receipt(
        self,
        event: Mapping[str, Any],
        *,
        canonical_state: str,
        semantic_status: str,
        applied: bool,
        held: bool,
        duplicate: bool,
        reason: str,
        state_before: str,
    ) -> dict[str, Any]:
        basis = {
            "provider_event_id": event["provider_event_id"],
            "correlation_id": self.correlation_id,
        }
        return {
            "schema_version": SEMANTIC_RECEIPT_SCHEMA,
            "receipt_id": stable_id("receipt", basis),
            "provider_event_id": event["provider_event_id"],
            "event_deduplication_id": event["provider_event_id"],
            "correlation_id": self.correlation_id,
            "raw_event_type": event["raw_event_type"],
            "canonical_state": canonical_state,
            "state_before": state_before,
            "state_after": self.state,
            "semantic_status": semantic_status,
            "applied": applied,
            "held": held,
            "duplicate": duplicate,
            "reason": reason,
            "source": {
                "system": "asaas",
                "environment": "STUB",
                "evidence_class": "PROVEN_SYNTHETIC",
                "synthetic": True,
                "locator": event["source_fixture_ref"],
            },
            "freshness": {
                "observed_at": event["occurred_at"],
                "state": "FIXED_CLOCK",
            },
            "evidence_refs": sorted(set(event["evidence_refs"])),
        }

    def ingest(self, raw_event: Mapping[str, Any], *, replay: bool = False) -> dict[str, Any]:
        event = validate_provider_event(raw_event, correlation_id=self.correlation_id)
        event_id = event["provider_event_id"]
        previous = self.receipts.get(event_id)
        if previous is not None and not (replay and previous["held"]):
            duplicate = deepcopy(previous)
            duplicate.update(
                {
                    "semantic_status": "DUPLICATE",
                    "applied": False,
                    "duplicate": True,
                    "state_before": self.state,
                    "state_after": self.state,
                    "reason": "provider_event_id already has a semantic receipt",
                }
            )
            return duplicate

        before = self.state
        canonical = RAW_TO_CANONICAL.get(event["raw_event_type"].upper(), "UNKNOWN")
        if canonical == "UNKNOWN":
            receipt = self._receipt(
                event,
                canonical_state="UNKNOWN",
                semantic_status="HELD",
                applied=False,
                held=True,
                duplicate=False,
                reason="UNKNOWN_PROVIDER_EVENT",
                state_before=before,
            )
        elif canonical in ALLOWED_TRANSITIONS[before]:
            self.state = canonical
            self.last_applied_event_id = event_id
            receipt = self._receipt(
                event,
                canonical_state=canonical,
                semantic_status="APPLIED",
                applied=True,
                held=False,
                duplicate=False,
                reason="SEMANTIC_TRANSITION_APPLIED",
                state_before=before,
            )
            self.applied_events.append(event)
        elif STATE_ORDER[canonical] <= STATE_ORDER[before]:
            receipt = self._receipt(
                event,
                canonical_state=canonical,
                semantic_status="RETAINED",
                applied=False,
                held=False,
                duplicate=False,
                reason="OUT_OF_ORDER_STATE_REGRESSION_PREVENTED",
                state_before=before,
            )
        else:
            receipt = self._receipt(
                event,
                canonical_state=canonical,
                semantic_status="HELD",
                applied=False,
                held=True,
                duplicate=False,
                reason=f"MISSING_PREDECESSOR_FOR_{canonical}",
                state_before=before,
            )
        self.receipts[event_id] = deepcopy(receipt)
        return receipt

    @property
    def received_revenue_cents(self) -> int:
        if self.synthetic or self.state != "PAYMENT_RECEIVED":
            return 0
        matching = [
            event["amount_cents"]
            for event in self.applied_events
            if RAW_TO_CANONICAL.get(event["raw_event_type"].upper()) == "PAYMENT_RECEIVED"
        ]
        return matching[-1] if matching else 0

    def financial_gate(self) -> dict[str, Any]:
        if self.state not in {"PAYMENT_CONFIRMED", "PAYMENT_RECEIVED"}:
            return {
                "schema_version": "confenge.financial_gate.v1",
                "state": "UNKNOWN",
                "synthetic": self.synthetic,
                "source_event_id": None,
                "received_revenue": False,
                "evidence_refs": [],
            }
        if not self.synthetic:
            raise E2EContractError("the #120 canary cannot authorize non-synthetic financial evidence")
        receipt = self.receipts[self.last_applied_event_id or ""]
        return {
            "schema_version": "confenge.financial_gate.v1",
            "state": "SYNTHETIC_VALID",
            "synthetic": True,
            "source_event_id": self.last_applied_event_id,
            "received_revenue": False,
            "evidence_refs": [f"receipt:{receipt['receipt_id']}"],
        }

    def projection(self) -> dict[str, Any]:
        return {
            "schema_version": RECONCILIATION_SCHEMA,
            "correlation_id": self.correlation_id,
            "synthetic": self.synthetic,
            "provider_environment": "STUB",
            "current_state": self.state,
            "received_revenue_cents": self.received_revenue_cents,
            "last_applied_event_id": self.last_applied_event_id,
            "receipts": [deepcopy(self.receipts[key]) for key in sorted(self.receipts)],
            "event_deduplication_ids": sorted(self.receipts),
            "applied_event_count": len(self.applied_events),
            "second_ledger_created": False,
        }

    def rebuild(self) -> dict[str, Any]:
        rebuilt = SemanticReconciler(self.correlation_id, synthetic=self.synthetic)
        for event in self.applied_events:
            receipt = rebuilt.ingest(event)
            if not receipt["applied"]:
                raise E2EContractError("projector rebuild could not replay an applied event")
        return rebuilt.projection()


def onboarding_decision(
    *, financial_gate: Mapping[str, Any], capacity_decision: str, acceptance_bound: bool
) -> dict[str, Any]:
    allowed = (
        financial_gate.get("state") == "SYNTHETIC_VALID"
        and financial_gate.get("synthetic") is True
        and financial_gate.get("received_revenue") is False
        and capacity_decision == "CAN_ACCEPT"
        and acceptance_bound
    )
    return {
        "policy_version": "CFG-ONBOARDING-SYNTHETIC-CANARY-v1",
        "state": "ONBOARDING_ELIGIBLE" if allowed else "BLOCKED",
        "starts_automatically": False,
        "reason": "ALL_SYNTHETIC_GATES_SATISFIED" if allowed else "FINANCIAL_ACCEPTANCE_OR_CAPACITY_GATE_MISSING",
    }


def project_control_center(
    *, correlation_id: str, projected_at: str, hops: Mapping[str, Mapping[str, Any]]
) -> dict[str, Any]:
    """Build the v2 read model from receipts; it has no command surface."""

    _text(correlation_id, "correlation_id")
    _text(projected_at, "projected_at")
    if set(hops) != set(CHAIN_HOPS):
        raise E2EContractError("Control Center projection must contain every chain hop exactly once")
    projected_hops: dict[str, Any] = {}
    exceptions: list[dict[str, Any]] = []
    allowed = {"source", "freshness", "state", "receipt", "exception"}
    for hop_name in CHAIN_HOPS:
        hop = deepcopy(dict(hops[hop_name]))
        if set(hop) != allowed:
            raise E2EContractError(
                f"Control Center hop {hop_name} may expose only source/freshness/state/receipt/exception"
            )
        if not isinstance(hop["source"], Mapping) or not isinstance(hop["freshness"], Mapping):
            raise E2EContractError(f"Control Center hop {hop_name} source/freshness required")
        _text(hop["state"], f"hops.{hop_name}.state")
        if hop["receipt"] is not None:
            _text(hop["receipt"], f"hops.{hop_name}.receipt")
        if hop["exception"] is not None:
            if not isinstance(hop["exception"], Mapping):
                raise E2EContractError(f"hops.{hop_name}.exception must be object or null")
            exceptions.append(deepcopy(dict(hop["exception"])))
        projected_hops[hop_name] = hop
    return {
        "schema_version": CONTROL_CENTER_SCHEMA,
        "correlation_id": correlation_id,
        "projected_at": projected_at,
        "synthetic": True,
        "hops": projected_hops,
        "exceptions": exceptions,
        "mutations_performed": 0,
    }
