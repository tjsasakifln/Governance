"""One-command synthetic proof for the #120 commercial-to-closeout chain."""

from __future__ import annotations

import argparse
import json
import tempfile
from copy import deepcopy
from pathlib import Path
from typing import Any, Mapping

from commercial.e2e import (
    E2EContractError,
    SemanticReconciler,
    content_hash,
    onboarding_decision,
    project_control_center,
    stable_id,
    validate_acceptance_binding,
    validate_accepted_proposal,
    validate_checkout_fixture,
)
from delivery.canary import run_canary
from delivery.capacity import evaluate_admission_v2
from delivery.readiness import readiness_for_admission


ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "commercial" / "fixtures" / "e2e"
PROPOSAL = FIXTURES / "proposal.accepted.synthetic.v1.json"
ACCEPTANCE = FIXTURES / "acceptance-binding.synthetic.v1.json"
CHECKOUT = FIXTURES / "checkout.synthetic.v1.json"
PROVIDER_EVENTS = FIXTURES / "provider-events.synthetic.v1.json"
DELIVERY_FIXTURES = ROOT / "delivery" / "fixtures"
PROJECTED_AT = "2026-08-25T12:27:00Z"
ADMISSION_EVALUATED_AT = "2026-08-26T12:00:00Z"

WEB_CFG_SHA = "bad3f7c71f817bbbb3605b5a7214e0fd9784111b"
WARMBLY_SHA = "3368e7d8f46573eef300b42ec214df8844b082d0"
REGISTRY_HASH = "sha256:7d9a3223069cf382f7e645cc17b0a6df859bb48196fe2541d0b882e66fc8bbe2"


def _load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _event_map() -> dict[str, dict[str, Any]]:
    fixture = _load(PROVIDER_EVENTS)
    return {item["raw_event_type"]: item for item in fixture["events"]}


def _admission_decision(
    proposal: Mapping[str, Any], *, include_synthetic_staffed_capacity: bool
) -> dict[str, Any]:
    """Consume the canonical v2 evaluator for this exact commercial chain.

    The staffed fixture is admitted only for the synthetic sandbox path.  The
    production path deliberately supplies no staffed snapshot, matching the
    repository's current human-owned capacity truth.
    """

    request = _load(DELIVERY_FIXTURES / "canary-capacity-request.v1.json")
    request.update(
        {
            "request_id": stable_id(
                "capacity-request",
                {
                    "correlation_id": proposal["correlation_id"],
                    "proposal_id": proposal["proposal_id"],
                    "proposal_version": proposal["proposal_version"],
                },
            ),
            "correlation_id": proposal["correlation_id"],
            "proposal_id": proposal["proposal_id"],
            "deliverable_id": proposal["deliverable_id"],
            "deliverable_version": proposal["deliverable_version"],
            "scope_version": proposal["scope_version"],
        }
    )
    return evaluate_admission_v2(
        request=request,
        readiness=_load(DELIVERY_FIXTURES / "cfg-diag-exp-v1.production-ready.json"),
        policy_ceiling=_load(DELIVERY_FIXTURES / "policy-ceiling-input.v1.json"),
        capacity_snapshot=(
            _load(DELIVERY_FIXTURES / "capacity-synthetic-one.v2.json")
            if include_synthetic_staffed_capacity
            else None
        ),
        working_calendar=_load(
            DELIVERY_FIXTURES / "working-calendar-synthetic.v1.json"
        ),
        work_order_snapshot=_load(
            DELIVERY_FIXTURES / "work-orders-empty.capacity-snapshot.v1.json"
        ),
        allocation_snapshot=_load(
            DELIVERY_FIXTURES / "allocations-empty.model-only.v1.json"
        ),
        evaluated_at=ADMISSION_EVALUATED_AT,
    )


def _expect_contract_error(callable_: Any) -> str:
    try:
        callable_()
    except E2EContractError as error:
        return str(error)
    raise RuntimeError("negative contract path did not fail closed")


def _handoff(
    proposal: Mapping[str, Any], gate: Mapping[str, Any], onboarding_ref: str
) -> dict[str, Any]:
    return {
        "event_id": "e1200000-0000-4000-8000-000000000001",
        "schema_version": "confenge.delivery_order_requested.v1",
        "synthetic": True,
        "correlation_id": proposal["correlation_id"],
        "causation_id": gate["source_event_id"],
        "idempotency_key": (
            f"delivery-order:{proposal['proposal_id']}:{proposal['proposal_version']}:"
            f"{proposal['accepted_snapshot_hash']}:{gate['source_event_id']}"
        ),
        "organization_id": proposal["organization_id"],
        "account_id": proposal["account_id"],
        "client_ref": proposal["client_ref"],
        "opportunity_id": proposal["opportunity_id"],
        "qco_id": proposal["qco_id"],
        "proposal_id": proposal["proposal_id"],
        "proposal_version": proposal["proposal_version"],
        "accepted_snapshot_hash": proposal["accepted_snapshot_hash"],
        "offer_id": proposal["offer_id"],
        "offer_version": proposal["offer_version"],
        "deliverable_id": proposal["deliverable_id"],
        "deliverable_version": proposal["deliverable_version"],
        "scope_version": proposal["scope_version"],
        "price_version": proposal["price_version"],
        "terms_version": proposal["terms_version"],
        "financial_gate": dict(gate),
        "onboarding_ref": onboarding_ref,
        "occurred_at": "2026-08-17T12:06:00Z",
        "evidence_refs": sorted(
            {
                *proposal["evidence_refs"],
                *gate["evidence_refs"],
                f"onboarding:{onboarding_ref}",
            }
        ),
    }


def _source(system: str, kind: str, locator: str, evidence_class: str) -> dict[str, Any]:
    return {
        "system": system,
        "kind": kind,
        "locator": locator,
        "evidence_class": evidence_class,
    }


def _fresh(observed_at: str) -> dict[str, Any]:
    return {"observed_at": observed_at, "state": "FIXED_CLOCK"}


def _hop(
    *, source: Mapping[str, Any], observed_at: str, state: str, receipt: str | None,
    exception: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "source": dict(source),
        "freshness": _fresh(observed_at),
        "state": state,
        "receipt": receipt,
        "exception": None if exception is None else dict(exception),
    }


def _chain_record(
    *, hop: str, identity: str, version: str, state: str, value: Mapping[str, Any],
    proof_status: str, live_residual: str, receipt: str | None,
) -> dict[str, Any]:
    return {
        "hop": hop,
        "id": identity,
        "version": version,
        "hash": content_hash(value),
        "state": state,
        "proof_status": proof_status,
        "live_residual": live_residual,
        "receipt": receipt,
    }


def run_e2e_canary(*, state_dir: Path) -> dict[str, Any]:
    proposal = validate_accepted_proposal(
        _load(PROPOSAL),
        expected_amount_cents=800000,
        expected_offer_id="CFG-DIAG-EXP-v1",
        expected_deliverable_id="CFG-DIAG-EXP-v1",
        expected_deliverable_version="v1",
    )
    mutated_proposal = deepcopy(proposal)
    mutated_proposal["amount"] += 1
    immutable_rejection = _expect_contract_error(
        lambda: validate_accepted_proposal(
            mutated_proposal,
            expected_amount_cents=800001,
            expected_offer_id="CFG-DIAG-EXP-v1",
            expected_deliverable_id="CFG-DIAG-EXP-v1",
            expected_deliverable_version="v1",
        )
    )
    acceptance = validate_acceptance_binding(_load(ACCEPTANCE), proposal)
    checkout = validate_checkout_fixture(_load(CHECKOUT), acceptance=acceptance)
    events = _event_map()
    correlation_id = proposal["correlation_id"]

    production_admission = _admission_decision(
        proposal, include_synthetic_staffed_capacity=False
    )
    synthetic_admission = _admission_decision(
        proposal, include_synthetic_staffed_capacity=True
    )
    production_commit = {
        "state": "BLOCKED",
        "admission_decision_id": production_admission["decision_id"],
        "reason_codes": production_admission["reason_codes"],
        "work_order_created": False,
        "real_reservation_created": False,
        "checkout_enabled": False,
    }
    if (
        production_admission["decision"] != "UNKNOWN"
        or production_admission["staffed"]["state"] != "UNKNOWN"
        or production_admission["actionability"]["promise_allowed"] is not False
        or "STAFFED_CAPACITY_UNKNOWN" not in production_admission["reason_codes"]
    ):
        raise RuntimeError("productive commit did not fail closed on UNKNOWN capacity")
    if (
        synthetic_admission["decision"] != "CAN_ACCEPT"
        or synthetic_admission["evidence_class"] != "SYNTHETIC"
        or synthetic_admission["actionability"]["promise_allowed"] is not False
        or synthetic_admission["actionability"]["checkout_enabled"] is not False
    ):
        raise RuntimeError("synthetic admission evidence became productive authority")

    before_financial = onboarding_decision(
        financial_gate={"state": "UNKNOWN", "synthetic": True, "received_revenue": False},
        capacity_decision=synthetic_admission["decision"],
        acceptance_bound=True,
    )
    readiness_fail_closed = readiness_for_admission(None, evaluated_at="2026-08-25T12:06:00Z")

    reconciler = SemanticReconciler(correlation_id)
    confirmed_held = reconciler.ingest(events["PAYMENT_CONFIRMED"])
    unknown_held = reconciler.ingest(events["CHECKOUT_CREATED"])
    created = reconciler.ingest(events["PAYMENT_CREATED"])
    confirmed = reconciler.ingest(events["PAYMENT_CONFIRMED"], replay=True)
    confirmed_duplicate = reconciler.ingest(events["PAYMENT_CONFIRMED"])
    late_created_event = deepcopy(events["PAYMENT_CREATED"])
    late_created_event["provider_event_id"] = "evt_synthetic_payment_created_retry_002"
    late_created = reconciler.ingest(late_created_event)
    reconciliation = reconciler.projection()
    rebuilt = reconciler.rebuild()
    rollback_replay_converged = all(
        rebuilt[field] == reconciliation[field]
        for field in ("current_state", "received_revenue_cents", "last_applied_event_id", "applied_event_count")
    )
    if not rollback_replay_converged:
        raise RuntimeError("semantic rollback/replay diverged")

    gate = reconciler.financial_gate()
    before_capacity = onboarding_decision(
        financial_gate=gate,
        capacity_decision=production_admission["decision"],
        acceptance_bound=True,
    )
    eligible = onboarding_decision(
        financial_gate=gate,
        capacity_decision=synthetic_admission["decision"],
        acceptance_bound=True,
    )
    if before_financial["state"] != "BLOCKED" or before_capacity["state"] != "BLOCKED":
        raise RuntimeError("onboarding did not fail closed")
    if eligible["state"] != "ONBOARDING_ELIGIBLE" or eligible["starts_automatically"]:
        raise RuntimeError("synthetic onboarding policy diverged")
    onboarding = {
        "onboarding_id": stable_id("onboarding", {"correlation_id": correlation_id}),
        "correlation_id": correlation_id,
        "state": "STARTED_SYNTHETIC_EXPLICITLY",
        "policy_version": eligible["policy_version"],
        "started_automatically": False,
        "started_at": "2026-08-17T12:05:30Z",
        "financial_receipt_id": confirmed["receipt_id"],
        "acceptance_id": acceptance["acceptance_id"],
    }

    received_reconciler = SemanticReconciler(correlation_id)
    for event_name in ("PAYMENT_CREATED", "PAYMENT_CONFIRMED", "PAYMENT_RECEIVED"):
        received_reconciler.ingest(events[event_name])
    overdue_reconciler = SemanticReconciler(correlation_id)
    overdue_reconciler.ingest(events["PAYMENT_CREATED"])
    overdue_reconciler.ingest(events["PAYMENT_OVERDUE"])
    refunded_reconciler = SemanticReconciler(correlation_id)
    for event_name in ("PAYMENT_CREATED", "PAYMENT_CONFIRMED", "PAYMENT_RECEIVED", "PAYMENT_REFUNDED"):
        refunded_reconciler.ingest(events[event_name])
    canceled_reconciler = SemanticReconciler(correlation_id)
    canceled_reconciler.ingest(events["PAYMENT_CREATED"])
    canceled_reconciler.ingest(events["PAYMENT_DELETED"])

    handoff = _handoff(proposal, gate, onboarding["onboarding_id"])
    missing_warmbly = state_dir / "external-warmbly-not-read-at-runtime"
    missing_web_cfg = state_dir / "external-web-cfg-not-read-at-runtime"
    delivery = run_canary(
        handoff=handoff,
        state_dir=state_dir / "delivery",
        repo_paths={"warmbly": missing_warmbly, "governance": ROOT, "web_cfg": missing_web_cfg},
        repo_sha_fallbacks={"warmbly": WARMBLY_SHA, "web_cfg": WEB_CFG_SHA},
        projector="typescript",
        producer_mode="governance-e2e-contract-adapter-v1",
    )
    if delivery["correlation_id"] != correlation_id or delivery["work_order_count"] != 1:
        raise RuntimeError("correlation identity or exactly-once Work Order invariant diverged")

    financial_branches = {
        "PAYMENT_CREATED": "PAYMENT_CREATED",
        "PAYMENT_CONFIRMED": reconciliation["current_state"],
        "PAYMENT_RECEIVED": received_reconciler.state,
        "OVERDUE": overdue_reconciler.state,
        "REFUNDED": refunded_reconciler.state,
        "CANCELED": canceled_reconciler.state,
        "UNKNOWN": unknown_held["canonical_state"],
    }
    if financial_branches != {state: state for state in financial_branches}:
        raise RuntimeError(f"financial semantic branch mismatch: {financial_branches}")
    if received_reconciler.received_revenue_cents != 0:
        raise RuntimeError("synthetic PAYMENT_RECEIVED must never compose received revenue")

    commercial_state = {
        "state_id": stable_id("commercial", {"correlation_id": correlation_id}),
        "correlation_id": correlation_id,
        "state": reconciliation["current_state"],
        "received_revenue_cents": 0,
        "ledger_owner": "warmbly",
        "second_ledger_created": False,
        "receipt_id": confirmed["receipt_id"],
    }
    qa = {
        "qa_id": stable_id("qa", {"work_order_id": delivery["work_order_id"]}),
        "state": delivery["qa"],
        "negative_state": delivery["qa_negative_path"],
        "version": "CFG-DIAG-EXP-QA-v1",
    }
    delivery_record = {
        "delivery_id": stable_id("delivery", {"work_order_id": delivery["work_order_id"]}),
        "state": delivery["delivery"],
        "artifact_ref": delivery["fixture_ids"]["artifact_ref"],
    }
    closeout = {
        "closeout_id": delivery["control_center"]["source"]["event_id"],
        "state": delivery["stage"],
        "acceptance": delivery["acceptance"],
    }
    outcome = {
        "outcome_id": stable_id("outcome", {"work_order_id": delivery["work_order_id"]}),
        "state": delivery["outcome"],
        "inferred_by_silence": False,
    }

    hops = {
        "offer": _hop(source=_source("web-cfg", "authority-pin", "data/commercial/deliverables-registry.v1.json#/containers/0/plans/0", "PROVEN_SYNTHETIC"), observed_at="2026-08-25T00:00:00Z", state="PINNED", receipt=REGISTRY_HASH),
        "proposal_version": _hop(source=_source("warmbly", "proposal-contract-adapter", str(PROPOSAL.relative_to(ROOT)), "PROVEN_SYNTHETIC"), observed_at=proposal["decision_at"], state="ACCEPTED", receipt=proposal["accepted_snapshot_hash"]),
        "acceptance": _hop(source=_source("web-cfg", "acceptance-binding-adapter", str(ACCEPTANCE.relative_to(ROOT)), "PROVEN_SYNTHETIC"), observed_at=acceptance["accepted_at"], state="ACCEPTED_BOUND", receipt=acceptance["record_hash"]),
        "financial_eligibility": _hop(source=_source("governance", "financial-gate", "confenge.financial_gate.v1", "PROVEN_SYNTHETIC"), observed_at=events["PAYMENT_CONFIRMED"]["occurred_at"], state=gate["state"], receipt=confirmed["receipt_id"]),
        "checkout": _hop(source=_source("web-cfg", "detached-checkout-stub", checkout["source_fixture_ref"], "PROVEN_SYNTHETIC"), observed_at=checkout["created_at"], state="STUB_CREATED", receipt=checkout["checkout_attempt_id"]),
        "provider_event": _hop(source=_source("asaas", "provider-event-stub", events["PAYMENT_CONFIRMED"]["source_fixture_ref"], "PROVEN_SYNTHETIC"), observed_at=events["PAYMENT_CONFIRMED"]["occurred_at"], state="PAYMENT_CONFIRMED", receipt=confirmed["receipt_id"]),
        "semantic_reconciliation": _hop(source=_source("warmbly", "semantic-contract-adapter", "commercial/e2e.py#SemanticReconciler", "PROVEN_SYNTHETIC"), observed_at=events["PAYMENT_CONFIRMED"]["occurred_at"], state=reconciliation["current_state"], receipt=confirmed["receipt_id"]),
        "commercial_state": _hop(source=_source("warmbly", "commercial-state-projection", "commercial/e2e.py#SemanticReconciler.projection", "PROVEN_SYNTHETIC"), observed_at=events["PAYMENT_CONFIRMED"]["occurred_at"], state=commercial_state["state"], receipt=commercial_state["receipt_id"]),
        "onboarding": _hop(source=_source("governance", "explicit-onboarding-receipt", "commercial/e2e_canary.py", "PROVEN_SYNTHETIC"), observed_at=onboarding["started_at"], state=onboarding["state"], receipt=onboarding["onboarding_id"]),
        "work_order": _hop(source=_source("governance", "canonical-work-order-event-store", "control-center/domains/delivery", "PROVEN_SYNTHETIC"), observed_at=delivery["timestamps"]["closed_at"], state=delivery["stage"], receipt=delivery["work_order_id"]),
        "qa": _hop(source=_source("governance", "qa-receipt", "delivery/production/cfg_diag_exp.py#run_qa", "PROVEN_SANDBOX"), observed_at=delivery["timestamps"]["qa_passed_at"], state=qa["state"], receipt=qa["qa_id"]),
        "delivery": _hop(source=_source("governance", "sandbox-artifact", delivery_record["artifact_ref"], "PROVEN_SANDBOX"), observed_at=delivery["timestamps"]["delivered_at"], state=delivery_record["state"], receipt=delivery_record["delivery_id"]),
        "closeout": _hop(source=_source("governance", "canonical-work-order-event", closeout["closeout_id"], "PROVEN_SYNTHETIC"), observed_at=delivery["timestamps"]["closed_at"], state=closeout["state"], receipt=closeout["closeout_id"]),
        "outcome": _hop(source=_source("governance", "explicit-unknown-projection", "control-center.work-order-projection.v1", "PROVEN_SYNTHETIC"), observed_at=delivery["timestamps"]["projected_at"], state=outcome["state"], receipt=outcome["outcome_id"]),
    }
    control_center = project_control_center(
        correlation_id=correlation_id, projected_at=PROJECTED_AT, hops=hops
    )

    records = [
        _chain_record(hop="offer", identity=proposal["offer_id"], version=proposal["offer_version"], state="PINNED", value={"registry_hash": REGISTRY_HASH, "offer_id": proposal["offer_id"]}, proof_status="PROVEN_SYNTHETIC", live_residual="BLOCKED_EXTERNAL", receipt=REGISTRY_HASH),
        _chain_record(hop="proposal_version", identity=proposal["proposal_id"], version=str(proposal["proposal_version"]), state="ACCEPTED", value=proposal, proof_status="PROVEN_SYNTHETIC", live_residual="MISSING", receipt=proposal["accepted_snapshot_hash"]),
        _chain_record(hop="acceptance", identity=acceptance["acceptance_id"], version=acceptance["schema_version"], state="ACCEPTED_BOUND", value=acceptance, proof_status="PROVEN_SYNTHETIC", live_residual="MISSING", receipt=acceptance["record_hash"]),
        _chain_record(hop="financial_eligibility", identity=gate["source_event_id"], version=gate["schema_version"], state=gate["state"], value=gate, proof_status="PROVEN_SYNTHETIC", live_residual="BLOCKED_EXTERNAL", receipt=confirmed["receipt_id"]),
        _chain_record(hop="checkout", identity=checkout["checkout_attempt_id"], version=checkout["schema_version"], state="STUB_CREATED", value=checkout, proof_status="PROVEN_SYNTHETIC", live_residual="BLOCKED_EXTERNAL", receipt=checkout["checkout_attempt_id"]),
        _chain_record(hop="provider_event", identity=events["PAYMENT_CONFIRMED"]["provider_event_id"], version=events["PAYMENT_CONFIRMED"]["schema_version"], state="PAYMENT_CONFIRMED", value=events["PAYMENT_CONFIRMED"], proof_status="PROVEN_SYNTHETIC", live_residual="BLOCKED_EXTERNAL", receipt=confirmed["receipt_id"]),
        _chain_record(hop="semantic_reconciliation", identity=stable_id("reconciliation", {"correlation_id": correlation_id}), version=reconciliation["schema_version"], state=reconciliation["current_state"], value=reconciliation, proof_status="PROVEN_SYNTHETIC", live_residual="MISSING", receipt=confirmed["receipt_id"]),
        _chain_record(hop="commercial_state", identity=commercial_state["state_id"], version="confenge.commercial_state.v1", state=commercial_state["state"], value=commercial_state, proof_status="PROVEN_SYNTHETIC", live_residual="MISSING", receipt=commercial_state["receipt_id"]),
        _chain_record(hop="onboarding", identity=onboarding["onboarding_id"], version=onboarding["policy_version"], state=onboarding["state"], value=onboarding, proof_status="PROVEN_SYNTHETIC", live_residual="BLOCKED_EXTERNAL", receipt=onboarding["onboarding_id"]),
        _chain_record(hop="work_order", identity=delivery["work_order_id"], version="confenge.work_order.v1", state=delivery["stage"], value={"work_order_id": delivery["work_order_id"], "correlation_id": correlation_id, "count": delivery["work_order_count"]}, proof_status="PROVEN_SYNTHETIC", live_residual="BLOCKED_EXTERNAL", receipt=delivery["work_order_id"]),
        _chain_record(hop="qa", identity=qa["qa_id"], version=qa["version"], state=qa["state"], value=qa, proof_status="PROVEN_SANDBOX", live_residual="BLOCKED_EXTERNAL", receipt=qa["qa_id"]),
        _chain_record(hop="delivery", identity=delivery_record["delivery_id"], version="CFG-DIAG-EXP-SANDBOX-PRODUCER-v1", state=delivery_record["state"], value=delivery_record, proof_status="PROVEN_SANDBOX", live_residual="BLOCKED_EXTERNAL", receipt=delivery_record["artifact_ref"]),
        _chain_record(hop="closeout", identity=closeout["closeout_id"], version="confenge.work_order_event.v1", state=closeout["state"], value=closeout, proof_status="PROVEN_SYNTHETIC", live_residual="BLOCKED_EXTERNAL", receipt=closeout["closeout_id"]),
        _chain_record(hop="outcome", identity=outcome["outcome_id"], version="control-center.work-order-projection.v1", state=outcome["state"], value=outcome, proof_status="PROVEN_SYNTHETIC", live_residual="MISSING", receipt=outcome["outcome_id"]),
    ]

    return {
        "schema_version": "confenge.commercial_e2e_evidence.v1",
        "evidence_pack_id": "CFG-COMMERCIAL-E2E-SYNTHETIC-120-v1",
        "correlation_id": correlation_id,
        "canary": {"offer_id": proposal["offer_id"], "offer_version": proposal["offer_version"], "deliverable_id": proposal["deliverable_id"], "deliverable_version": proposal["deliverable_version"], "synthetic": True},
        "authority_pins": {"web_cfg_main_sha": WEB_CFG_SHA, "warmbly_main_sha": WARMBLY_SHA, "deliverables_registry_blob": "32576ad2e704881368699ceacdefc6c783dcfa00", "deliverables_registry_hash": REGISTRY_HASH, "naming_blob": "ee97d54155536378041693153d0c9316baa6596b", "naming_hash": "sha256:856fed4281a48c3704c204f7f2109142f992d8f0d73d6a144c6ca50d76237419"},
        "chain_hops": records,
        "financial_semantics": {
            "branches": financial_branches,
            "positive_path_terminal_state": reconciliation["current_state"],
            "received_revenue_cents": 0,
            "synthetic_received_branch_revenue_cents": received_reconciler.received_revenue_cents,
            "unknown_receipt": unknown_held,
        },
        "reliability": {
            "confirmed_before_created": confirmed_held["semantic_status"],
            "confirmed_replayed_after_created": confirmed["semantic_status"],
            "duplicate": confirmed_duplicate["semantic_status"],
            "late_created_retry": late_created["semantic_status"],
            "rollback_replay_converged": rollback_replay_converged,
            "event_deduplication_id": confirmed["event_deduplication_id"],
            "chain_identity_is_deduplication_id": confirmed["event_deduplication_id"] == correlation_id,
        },
        "gates": {
            "proposal_mutation_rejected": immutable_rejection,
            "readiness_without_profile": readiness_fail_closed,
            "admission_control": {
                "contract_version": "confenge.capacity_admission.v2",
                "production": production_admission,
                "synthetic": synthetic_admission,
            },
            "production_commit": production_commit,
            "onboarding_before_financial": before_financial,
            "onboarding_without_capacity": before_capacity,
            "onboarding_eligible": eligible,
            "production_checkout_enabled": False,
            "real_money_mutation_approved": False,
        },
        "commercial_reconciliation": reconciliation,
        "delivery_manifest": delivery,
        "control_center": control_center,
        "invariants": {
            "single_correlation_identity": True,
            "second_catalog_created": False,
            "second_ledger_created": False,
            "provider_event_idempotent": confirmed_duplicate["duplicate"],
            "work_order_exactly_once": delivery["work_order_count"] == 1,
            "unknown_preserved": unknown_held["canonical_state"] == "UNKNOWN",
            "qa_delivery_closeout_not_inferred_by_silence": delivery["qa_negative_path"] == "FAILED" and outcome["state"] == "UNKNOWN",
            "synthetic_never_customer_revenue_or_real_delivery": delivery["real_customer"] is False and delivery["received_revenue"] is False and delivery["delivery"] == "SANDBOX",
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the sanitized Governance #120 E2E proof")
    parser.add_argument("--state-dir", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    state_dir = args.state_dir or Path(tempfile.mkdtemp(prefix="confenge-commercial-e2e-"))
    evidence = run_e2e_canary(state_dir=state_dir)
    output = args.output or state_dir / "EVIDENCE.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"correlation_id={evidence['correlation_id']}")
    print(f"work_order_id={evidence['delivery_manifest']['work_order_id']}")
    print(f"financial_state={evidence['financial_semantics']['positive_path_terminal_state']}")
    print(f"received_revenue_cents={evidence['financial_semantics']['received_revenue_cents']}")
    print(f"output={output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
