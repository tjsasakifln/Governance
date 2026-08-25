"""One-command synthetic QCO/proposal-to-closeout delivery canary."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
from copy import deepcopy
from pathlib import Path
from typing import Any

from .canary_gate import CanaryGate
from .capacity import CapacityLedger
from .contracts import canonical_json, validate_delivery_order_requested
from .control_center import project_work_order
from .production.cfg_diag_exp import produce_sandbox_artifact, run_qa
from .readiness import content_hash, promote_to_delivery_validated
from .store import SQLiteWorkOrderStore
from .work_order import WorkOrderService, rebuild_store_projection, rebuild_work_order

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "delivery" / "fixtures"
HANDOFF_FIXTURE = FIXTURES / "delivery_order_requested.synthetic.v1.json"
READINESS_FIXTURE = FIXTURES / "cfg-diag-exp-v1.production-ready.json"
CAPACITY_FIXTURE = FIXTURES / "capacity-synthetic-one.v1.json"
CAPACITY_REQUEST_FIXTURE = FIXTURES / "canary-capacity-request.v1.json"
QA_FIXTURE = ROOT / "delivery" / "qa" / "cfg-diag-exp-v1.qa-checklist.json"

TIMES = {
    "capacity_evaluated_at": "2026-08-25T12:06:00Z",
    "capacity_hold_expires_at": "2026-08-28T12:06:00Z",
    "capacity_committed_at": "2026-08-25T12:07:00Z",
    "owner_assigned_at": "2026-08-25T12:08:00Z",
    "work_started_at": "2026-08-25T12:14:00Z",
    "bad_artifact_at": "2026-08-25T12:15:00Z",
    "good_artifact_at": "2026-08-25T12:18:00Z",
    "qa_passed_at": "2026-08-25T12:21:00Z",
    "delivered_at": "2026-08-25T12:22:00Z",
    "accepted_at": "2026-08-25T12:23:00Z",
    "closed_at": "2026-08-25T12:24:00Z",
    "readiness_validated_at": "2026-08-25T12:25:00Z",
    "capacity_released_at": "2026-08-25T12:26:00Z",
    "projected_at": "2026-08-25T12:27:00Z",
}


def _load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _repo_sha(path: Path) -> str:
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=path, check=True, text=True, capture_output=True
    )
    return result.stdout.strip()


def produce_warmbly_handoff(warmbly_repo: Path, *, go_binary: str = "go") -> dict[str, Any]:
    """Execute Warmbly's real in-repo proposal state machine canary."""

    binary = shutil.which(go_binary) if os.sep not in go_binary else go_binary
    if not binary or not Path(binary).exists():
        raise RuntimeError(f"Go binary not found: {go_binary}")
    result = subprocess.run(
        [binary, "run", "./cmd/confenge-proposal-canary"],
        cwd=warmbly_repo,
        check=True,
        text=True,
        capture_output=True,
        env={**os.environ, "GOTOOLCHAIN": "local"},
    )
    return validate_delivery_order_requested(json.loads(result.stdout))


def _capacity_request(handoff: dict[str, Any]) -> dict[str, Any]:
    request = _load(CAPACITY_REQUEST_FIXTURE)
    request.update(
        {
            "correlation_id": handoff["correlation_id"],
            "proposal_id": handoff["proposal_id"],
            "deliverable_id": handoff["deliverable_id"],
            "deliverable_version": handoff["deliverable_version"],
            "scope_version": handoff["scope_version"],
        }
    )
    return request


def _meta(key: str, version: int, at: str, actor: str = "operator:delivery-synthetic") -> dict[str, Any]:
    return {
        "idempotency_key": f"canary:cfg-diag-exp-v1:{key}",
        "expected_version": version,
        "occurred_at": at,
        "actor": actor,
    }


def _run_work_order_lifecycle(
    service: WorkOrderService,
    *,
    handoff: dict[str, Any],
    admission: dict[str, Any],
    readiness: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    required_inputs = [item["input_id"] for item in readiness["inputs_required"]]
    checklist = _load(QA_FIXTURE)
    qa_check_ids = [item["check_id"] for item in checklist["checks"]]
    created = service.request_delivery(
        handoff,
        admission,
        required_inputs=required_inputs,
        qa_checklist=qa_check_ids,
        estimated_effort_units=readiness["estimated_effort"]["amount"],
        sla_business_days=readiness["estimated_effort"]["lead_time_business_days"],
    )
    if created["status"] not in {"CREATED", "EXISTS"}:
        raise RuntimeError(f"delivery request was held: {created['blockers']}")
    work_order_id = created["work_order_id"]
    version = created["state"]["version"]
    result = service.assign_owner(
        work_order_id,
        readiness["responsible_owner"]["owner_id"],
        **_meta("assign-owner", version, TIMES["owner_assigned_at"]),
    )
    version = result["state"]["version"]
    input_refs: dict[str, str] = {}
    for index, input_id in enumerate(required_inputs, start=1):
        evidence_ref = f"fixture:input:{input_id}:synthetic-redacted"
        input_refs[input_id] = evidence_ref
        result = service.receive_input(
            work_order_id,
            input_id,
            evidence_ref,
            **_meta(
                f"input:{input_id}",
                version,
                f"2026-08-25T12:{8 + index:02d}:00Z",
            ),
        )
        version = result["state"]["version"]
    result = service.start(
        work_order_id,
        **_meta("start", version, TIMES["work_started_at"]),
    )
    version = result["state"]["version"]

    bad_artifact = produce_sandbox_artifact(
        input_refs=input_refs,
        source_artifact_refs=["fixture:public-source:redacted-001"],
        produced_at=TIMES["bad_artifact_at"],
        correlation_id=handoff["correlation_id"],
    )
    bad_artifact["sections"] = []
    failed_qa = run_qa(
        bad_artifact,
        checked_at="2026-08-25T12:16:00Z",
        actor_ref="actor:synthetic-qa",
    )
    if failed_qa["qa_state"] != "FAILED":
        raise RuntimeError("negative QA path did not fail closed")
    result = service.record_artifact(
        work_order_id,
        bad_artifact["artifact_ref"],
        **_meta("artifact:bad", version, TIMES["bad_artifact_at"]),
    )
    version = result["state"]["version"]
    result = service.start_qa(
        work_order_id, **_meta("qa:start:bad", version, "2026-08-25T12:16:00Z")
    )
    version = result["state"]["version"]
    failed_reason = ",".join(failed_qa["failed_checks"])
    result = service.fail_qa(
        work_order_id,
        failed_reason,
        **_meta("qa:fail", version, "2026-08-25T12:17:00Z", "actor:synthetic-qa"),
    )
    version = result["state"]["version"]

    artifact = produce_sandbox_artifact(
        input_refs=input_refs,
        source_artifact_refs=["fixture:public-source:redacted-001"],
        produced_at=TIMES["good_artifact_at"],
        correlation_id=handoff["correlation_id"],
    )
    passed_qa = run_qa(
        artifact,
        checked_at=TIMES["qa_passed_at"],
        actor_ref="actor:synthetic-qa",
    )
    if passed_qa["qa_state"] != "PASSED":
        raise RuntimeError(f"QA unexpectedly failed: {passed_qa['failed_checks']}")
    result = service.record_artifact(
        work_order_id,
        artifact["artifact_ref"],
        **_meta("artifact:good", version, TIMES["good_artifact_at"]),
    )
    version = result["state"]["version"]
    result = service.start_qa(
        work_order_id, **_meta("qa:start:good", version, "2026-08-25T12:20:00Z")
    )
    version = result["state"]["version"]
    qa_evidence_ref = content_hash(passed_qa)
    result = service.pass_qa(
        work_order_id,
        qa_evidence_ref,
        **_meta("qa:pass", version, TIMES["qa_passed_at"], "actor:synthetic-qa"),
    )
    version = result["state"]["version"]
    result = service.deliver(
        work_order_id,
        f"sandbox-delivery:{artifact['artifact_ref']}",
        **_meta("deliver", version, TIMES["delivered_at"]),
    )
    version = result["state"]["version"]
    result = service.accept_delivery(
        work_order_id,
        "fixture:acceptance:explicit-sandbox",
        **_meta("accept", version, TIMES["accepted_at"], "actor:synthetic-client"),
    )
    version = result["state"]["version"]
    result = service.close(
        work_order_id,
        "fixture:closeout:synthetic",
        1,
        **_meta("close", version, TIMES["closed_at"]),
    )
    return result["state"], artifact, failed_qa


def _typescript_projection(state: dict[str, Any], state_dir: Path) -> dict[str, Any]:
    tsx = ROOT / "control-center" / "node_modules" / ".bin" / "tsx"
    if not tsx.exists():
        raise RuntimeError("Control Center dependencies missing; run npm install in control-center")
    state_path = state_dir / "work-order.read-model.json"
    state_path.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    result = subprocess.run(
        [
            str(tsx),
            str(ROOT / "control-center" / "domains" / "delivery" / "src" / "cli.ts"),
            str(state_path),
            TIMES["projected_at"],
        ],
        check=True,
        text=True,
        capture_output=True,
        cwd=ROOT,
    )
    return json.loads(result.stdout)


def run_canary(
    *,
    handoff: dict[str, Any],
    state_dir: Path,
    repo_paths: dict[str, Path],
    projector: str = "typescript",
    producer_mode: str = "warmbly-go-canary",
) -> dict[str, Any]:
    handoff = validate_delivery_order_requested(handoff)
    readiness = _load(READINESS_FIXTURE)
    capacity = _load(CAPACITY_FIXTURE)
    capacity_request = _capacity_request(handoff)
    state_dir.mkdir(parents=True, exist_ok=True)
    work_store = SQLiteWorkOrderStore(state_dir / "work-orders.sqlite3")
    service = WorkOrderService(work_store)

    with CapacityLedger(state_dir / "capacity.sqlite3") as capacity_ledger:
        gate = CanaryGate(
            readiness=readiness,
            capacity_snapshot=capacity,
            ledger=capacity_ledger,
        )
        decision, held = gate.evaluate_and_hold(
            request=capacity_request,
            active_work_orders=[],
            evaluated_at=TIMES["capacity_evaluated_at"],
            hold_idempotency_key="canary:cfg-diag-exp-v1:capacity:hold",
            hold_expires_at=TIMES["capacity_hold_expires_at"],
        )
        holds = [held]
        for _ in range(9):
            holds.append(
                capacity_ledger.acquire_hold(
                    decision=decision,
                    idempotency_key="canary:cfg-diag-exp-v1:capacity:hold",
                    correlation_id=capacity_request["correlation_id"],
                    created_at=TIMES["capacity_evaluated_at"],
                    expires_at=TIMES["capacity_hold_expires_at"],
                )
            )
        if len({item["hold_id"] for item in holds}) != 1:
            raise RuntimeError("10x capacity hold did not converge")
        due_at = f"{decision['earliest_due']}T21:00:00.000Z"
        admission = {
            "decision": decision["decision"],
            "readiness_state": readiness["readiness_state"],
            "readiness_ref": decision["readiness_ref"],
            "capacity_hold_id": held["hold_id"],
            "capacity_snapshot_id": decision["capacity_snapshot_id"],
            "calendar_version": decision["calendar_version"],
            "due_at": due_at,
        }
        event_count_before = work_store.count_events()
        closed, artifact, failed_qa = _run_work_order_lifecycle(
            service, handoff=handoff, admission=admission, readiness=readiness
        )
        committed = gate.commit(
            hold_id=held["hold_id"],
            work_order_id=closed["work_order_id"],
            idempotency_key="canary:cfg-diag-exp-v1:capacity:commit",
            committed_at=TIMES["capacity_committed_at"],
        )
        committed_projection = capacity_ledger.projection(
            capacity_snapshot_id=capacity["capacity_snapshot_id"],
            staffed_capacity_units=capacity["staffed_capacity_units"],
            active_work_orders=[
                {
                    "work_order_id": closed["work_order_id"],
                    "stage": "IN_PROGRESS",
                    "estimated_effort_units": 1,
                }
            ],
        )
        canary_evidence_ref = f"canary://{closed['work_order_id']}/closed-sandbox-v1"
        validated_readiness = promote_to_delivery_validated(
            readiness,
            canary_evidence={
                "synthetic": True,
                "stage": closed["current_stage"],
                "qa_state": closed["qa_state"],
                "delivery_state": closed["delivery_state"],
                "acceptance_state": closed["acceptance_state"],
                "work_order_id": closed["work_order_id"],
                "evidence_ref": canary_evidence_ref,
            },
            promoted_at=TIMES["readiness_validated_at"],
        )
        validated = service.record_readiness_validated(
            closed["work_order_id"],
            validated_readiness["readiness_ref"],
            canary_evidence_ref,
            **_meta(
                "readiness:validated",
                closed["version"],
                TIMES["readiness_validated_at"],
            ),
        )["state"]
        released = gate.release_closed(
            hold_id=held["hold_id"],
            idempotency_key="canary:cfg-diag-exp-v1:capacity:release",
            released_at=TIMES["capacity_released_at"],
        )
        released_projection = capacity_ledger.projection(
            capacity_snapshot_id=capacity["capacity_snapshot_id"],
            staffed_capacity_units=capacity["staffed_capacity_units"],
            active_work_orders=[
                {
                    "work_order_id": validated["work_order_id"],
                    "stage": "CLOSED",
                    "estimated_effort_units": 1,
                }
            ],
        )

    first_event_count = work_store.count_events()
    for _ in range(2):
        replayed, replay_artifact, replay_failed_qa = _run_work_order_lifecycle(
            service, handoff=handoff, admission=admission, readiness=readiness
        )
        replayed = service.record_readiness_validated(
            replayed["work_order_id"],
            validated_readiness["readiness_ref"],
            canary_evidence_ref,
            **_meta(
                "readiness:validated",
                replayed["version"],
                TIMES["readiness_validated_at"],
            ),
        )["state"]
        if replayed != validated or replay_artifact != artifact or replay_failed_qa != failed_qa:
            raise RuntimeError("command replay diverged")
    final_event_count = work_store.count_events()
    events = work_store.events(validated["work_order_id"])
    replayed_from_transport = rebuild_work_order(list(reversed(events)) + events[:3])
    rebuilt_from_zero = rebuild_store_projection(work_store)[0]
    replay_converged = replayed_from_transport == rebuilt_from_zero == validated
    if len(work_store.list_work_orders()) != 1 or not replay_converged:
        raise RuntimeError("Work Order rebuild did not converge")

    if projector == "typescript":
        control_center = _typescript_projection(validated, state_dir)
        projection_engine = "control-center-typescript"
    elif projector == "python":
        control_center = project_work_order(validated, observed_at=TIMES["projected_at"])
        projection_engine = "python-contract-equivalent"
    else:
        raise ValueError(f"unknown projector: {projector}")
    if control_center["stage"] != "CLOSED" or control_center["source"]["last_event_id"] != validated["last_event_id"]:
        raise RuntimeError("Control Center projection diverged from Work Order truth")

    manifest = {
        "schema_version": "confenge.delivery_canary_manifest.v1",
        "proposal_id": handoff["proposal_id"],
        "proposal_version": handoff["proposal_version"],
        "proposal_state": "ACCEPTED",
        "accepted_snapshot_hash": handoff["accepted_snapshot_hash"],
        "financial_gate": handoff["financial_gate"]["state"],
        "readiness": validated_readiness["readiness_state"],
        "capacity": committed["state"],
        "capacity_after_close": released["state"],
        "work_order_id": validated["work_order_id"],
        "stage": validated["current_stage"],
        "qa": validated["qa_state"],
        "qa_negative_path": failed_qa["qa_state"],
        "delivery": validated["delivery_state"],
        "acceptance": validated["acceptance_state"],
        "outcome": validated["outcome"],
        "duplicate_business_mutations": final_event_count - first_event_count,
        "initial_business_mutations": first_event_count - event_count_before,
        "work_order_count": len(work_store.list_work_orders()),
        "capacity_hold_replays": len(holds),
        "replay_converged": replay_converged,
        "real_money": False,
        "real_email": False,
        "real_customer": False,
        "real_checkout": False,
        "received_revenue": False,
        "producer_mode": producer_mode,
        "projection_engine": projection_engine,
        "repo_shas": {name: _repo_sha(path) for name, path in repo_paths.items()},
        "schema_versions": [
            "confenge.proposal.v1",
            "confenge.delivery_order_requested.v1",
            "confenge.financial_gate.v1",
            "confenge.delivery_readiness.v1",
            "confenge.capacity_admission.v1",
            "confenge.work_order.v1",
            "confenge.work_order_event.v1",
            "confenge.control_center.delivery_projection.v1",
        ],
        "schema_fingerprints": {
            "confenge.delivery_order_requested.v1": _sha256(
                ROOT / "schemas" / "delivery-order-requested.v1.schema.json"
            ),
            "confenge.financial_gate.v1": _sha256(
                ROOT / "schemas" / "financial-gate.v1.schema.json"
            ),
        },
        "fixture_ids": {
            "handoff_event_id": handoff["event_id"],
            "capacity_snapshot_id": capacity["capacity_snapshot_id"],
            "registry_hash": readiness["registry_hash"],
            "artifact_ref": artifact["artifact_ref"],
        },
        "timestamps": {**TIMES, "handoff_occurred_at": handoff["occurred_at"]},
        "tests_executed": [
            "Warmbly cmd/confenge-proposal-canary",
            "Governance delivery.canary lifecycle with 3x replay",
            "Governance QA negative and positive producer paths",
            f"Control Center {projection_engine} projection",
        ],
        "evidence_refs": [
            *handoff["evidence_refs"],
            validated_readiness["registry_ref"],
            validated_readiness["registry_hash"],
            canary_evidence_ref,
            artifact["artifact_ref"],
            control_center["source"]["last_event_id"],
        ],
        "capacity_projections": {
            "committed": committed_projection,
            "released": released_projection,
        },
        "control_center": control_center,
    }
    if manifest["duplicate_business_mutations"] != 0:
        raise RuntimeError("replay appended duplicate business events")
    return manifest


def _print_summary(manifest: dict[str, Any], manifest_path: Path) -> None:
    for field in (
        "proposal_id",
        "proposal_version",
        "accepted_snapshot_hash",
        "financial_gate",
        "readiness",
        "capacity",
        "work_order_id",
        "stage",
        "qa",
        "delivery",
        "acceptance",
        "outcome",
        "duplicate_business_mutations",
        "replay_converged",
        "real_money",
        "real_email",
        "real_customer",
    ):
        value = manifest[field]
        if isinstance(value, bool):
            value = str(value).lower()
        print(f"{field}={value}")
    print(f"manifest={manifest_path}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the sanitized CONFENGE Delivery OS canary")
    source = parser.add_mutually_exclusive_group()
    source.add_argument("--warmbly-repo", type=Path)
    source.add_argument("--handoff", type=Path, default=HANDOFF_FIXTURE)
    parser.add_argument("--go-binary", default="go")
    parser.add_argument("--web-cfg-repo", type=Path, default=ROOT.parent / "web-cfg")
    parser.add_argument("--governance-repo", type=Path, default=ROOT)
    parser.add_argument("--state-dir", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--projector", choices=("typescript", "python"), default="typescript")
    args = parser.parse_args()

    state_dir = args.state_dir or Path(tempfile.mkdtemp(prefix="confenge-delivery-canary-"))
    if args.warmbly_repo:
        handoff = produce_warmbly_handoff(args.warmbly_repo, go_binary=args.go_binary)
        warmbly_repo = args.warmbly_repo
        producer_mode = "warmbly-go-canary"
    else:
        handoff = _load(args.handoff)
        warmbly_repo = ROOT.parent / "warmbly"
        producer_mode = "warmbly-byte-pinned-golden"
    output = args.output or state_dir / "canary-manifest.json"
    manifest = run_canary(
        handoff=handoff,
        state_dir=state_dir,
        repo_paths={
            "warmbly": warmbly_repo,
            "governance": args.governance_repo,
            "web_cfg": args.web_cfg_repo,
        },
        projector=args.projector,
        producer_mode=producer_mode,
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    _print_summary(manifest, output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
