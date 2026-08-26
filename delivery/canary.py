"""One-command synthetic QCO/proposal-to-closeout delivery canary."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from .canary_gate import CanaryGate
from .capacity import CapacityLedger
from .contracts import validate_delivery_order_requested
from .production.cfg_diag_exp import produce_sandbox_artifact, run_qa
from .readiness import promote_to_delivery_validated

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "delivery" / "fixtures"
HANDOFF_FIXTURE = FIXTURES / "delivery_order_requested.synthetic.v1.json"
READINESS_FIXTURE = FIXTURES / "cfg-diag-exp-v1.production-ready.json"
CAPACITY_FIXTURE = FIXTURES / "capacity-synthetic-one.v1.json"
CAPACITY_REQUEST_FIXTURE = FIXTURES / "canary-capacity-request.v1.json"
CROSS_REPO_PINS_FIXTURE = FIXTURES / "cross-repo-canary-pins.v1.json"

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


def _repo_sha(path: Path, fallback: str | None = None) -> str:
    if not path.exists():
        if fallback is None or len(fallback) != 40:
            raise RuntimeError(f"repository unavailable and no valid SHA pin exists: {path}")
        return fallback
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=path, check=True, text=True, capture_output=True
    )
    return result.stdout.strip()


def produce_warmbly_handoff(warmbly_repo: Path, *, go_binary: str = "go") -> dict[str, Any]:
    """Execute Warmbly's real in-repo proposal state-machine canary."""

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


def _artifacts(
    handoff: dict[str, Any], readiness: dict[str, Any]
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    input_refs = {
        item["input_id"]: f"fixture:input:{item['input_id']}:synthetic-redacted"
        for item in readiness["inputs_required"]
    }
    bad = produce_sandbox_artifact(
        input_refs=input_refs,
        source_artifact_refs=["fixture:public-source:redacted-001"],
        produced_at=TIMES["bad_artifact_at"],
        correlation_id=handoff["correlation_id"],
    )
    bad["sections"] = []
    failed_qa = run_qa(
        bad,
        checked_at="2026-08-25T12:16:00Z",
        actor_ref="actor:synthetic-qa",
    )
    if failed_qa["qa_state"] != "FAILED":
        raise RuntimeError("negative QA path did not fail closed")
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
    return bad, artifact, failed_qa


def _typescript_canary(
    canary_input: dict[str, Any], state_dir: Path, *, mode: str
) -> dict[str, Any]:
    tsx = ROOT / "control-center" / "node_modules" / ".bin" / "tsx"
    if not tsx.exists():
        raise RuntimeError("Control Center dependencies missing; run npm install in control-center")
    input_path = state_dir / "canonical-work-order-canary.input.json"
    input_path.write_text(json.dumps(canary_input, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    result = subprocess.run(
        [
            str(tsx),
            str(ROOT / "control-center" / "domains" / "delivery" / "src" / "canary-cli.ts"),
            mode,
            str(input_path),
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
    repo_sha_fallbacks: dict[str, str] | None = None,
    projector: str = "typescript",
    producer_mode: str = "warmbly-go-canary",
) -> dict[str, Any]:
    """Orchestrate readiness/capacity around the canonical TypeScript Work Order."""

    if projector != "typescript":
        raise ValueError("only the canonical TypeScript Work Order/projector is supported")
    handoff = validate_delivery_order_requested(handoff)
    readiness = _load(READINESS_FIXTURE)
    capacity = _load(CAPACITY_FIXTURE)
    capacity_request = _capacity_request(handoff)
    state_dir.mkdir(parents=True, exist_ok=True)
    bad_artifact, artifact, failed_qa = _artifacts(handoff, readiness)

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

        admission = {
            "decision": decision["decision"],
            "readiness_state": readiness["readiness_state"],
            "readiness_ref": decision["readiness_ref"],
            "capacity_hold_id": held["hold_id"],
            "capacity_snapshot_id": decision["capacity_snapshot_id"],
            "calendar_version": decision["calendar_version"],
            "due_at": f"{decision['earliest_due']}T21:00:00.000Z",
        }
        calendar = capacity["working_calendar"]
        canonical_input = {
            "handoff": handoff,
            "admission": admission,
            "readiness": readiness,
            "capacity_calendar": {
                "version": calendar["version"],
                "time_zone": calendar["timezone"],
                "holidays": calendar["holidays"],
            },
            "bad_artifact": bad_artifact,
            "artifact": artifact,
            "failed_qa": failed_qa,
            "times": TIMES,
        }
        derived = _typescript_canary(canonical_input, state_dir, mode="derive")
        work_order_id = derived["work_order_id"]
        committed = gate.commit(
            hold_id=held["hold_id"],
            work_order_id=work_order_id,
            idempotency_key="canary:cfg-diag-exp-v1:capacity:commit",
            committed_at=TIMES["capacity_committed_at"],
        )
        canonical = _typescript_canary(canonical_input, state_dir, mode="run")
        closed = canonical["work_order"]
        if (
            closed["work_order_id"] != work_order_id
            or closed["capacity_commitment_id"] != held["hold_id"]
        ):
            raise RuntimeError("capacity commitment and canonical Work Order diverged")
        committed_projection = capacity_ledger.projection(
            capacity_snapshot_id=capacity["capacity_snapshot_id"],
            staffed_capacity_units=capacity["staffed_capacity_units"],
            active_work_orders=[
                {
                    "work_order_id": work_order_id,
                    "current_stage": "IN_PROGRESS",
                    "estimated_capacity_units": closed["estimated_capacity_units"],
                }
            ],
        )
        canary_evidence_ref = f"canary://{work_order_id}/closed-sandbox-v1"
        validated_readiness = promote_to_delivery_validated(
            readiness,
            canary_evidence={
                "synthetic": True,
                "stage": closed["current_stage"],
                "qa_state": closed["QA_state"],
                "delivery_state": canonical["delivery_state"],
                "acceptance_state": canonical["acceptance_state"],
                "work_order_id": work_order_id,
                "evidence_ref": canary_evidence_ref,
            },
            promoted_at=TIMES["readiness_validated_at"],
        )
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
                    "work_order_id": work_order_id,
                    "current_stage": "CLOSED",
                    "estimated_capacity_units": closed["estimated_capacity_units"],
                }
            ],
        )

    control_center = canonical["projection"]
    if (
        control_center["stage"] != "CLOSED"
        or control_center["source"]["event_id"] != closed["last_event_id"]
    ):
        raise RuntimeError("Control Center projection diverged from Work Order truth")
    manifest = {
        "schema_version": "confenge.delivery_canary_manifest.v1",
        "correlation_id": handoff["correlation_id"],
        "handoff_event_id": handoff["event_id"],
        "proposal_id": handoff["proposal_id"],
        "proposal_version": handoff["proposal_version"],
        "proposal_state": "ACCEPTED",
        "accepted_snapshot_hash": handoff["accepted_snapshot_hash"],
        "financial_gate": handoff["financial_gate"]["state"],
        "readiness": validated_readiness["readiness_state"],
        "capacity": committed["state"],
        "capacity_after_close": released["state"],
        "work_order_id": work_order_id,
        "stage": closed["current_stage"],
        "qa": closed["QA_state"],
        "qa_negative_path": canonical["qa_negative_path"],
        "delivery": canonical["delivery_state"],
        "acceptance": canonical["acceptance_state"],
        "outcome": closed["outcome"],
        "duplicate_business_mutations": canonical["duplicate_business_mutations"],
        "initial_business_mutations": len(canonical["events"]),
        "work_order_count": canonical["work_order_count"],
        "capacity_hold_replays": len(holds),
        "replay_converged": canonical["replay_converged"],
        "real_money": False,
        "real_email": False,
        "real_customer": False,
        "real_checkout": False,
        "received_revenue": False,
        "producer_mode": producer_mode,
        "projection_engine": "control-center-typescript-canonical",
        "repo_shas": {
            name: _repo_sha(path, (repo_sha_fallbacks or {}).get(name))
            for name, path in repo_paths.items()
        },
        "schema_versions": [
            "confenge.proposal.v1",
            "confenge.delivery_order_requested.v1",
            "confenge.financial_gate.v1",
            "confenge.delivery_readiness.v1",
            "confenge.capacity_admission.v1",
            "confenge.work_order.v1",
            "confenge.work_order_event.v1",
            "control-center.work-order-projection.v1",
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
            "Governance canonical TypeScript Work Order lifecycle with 3x replay",
            "Governance QA negative and positive producer paths",
            "Control Center canonical TypeScript projection",
        ],
        "evidence_refs": [
            *handoff["evidence_refs"],
            validated_readiness["registry_ref"],
            validated_readiness["registry_hash"],
            canary_evidence_ref,
            artifact["artifact_ref"],
            closed["last_event_id"],
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
    parser.add_argument("--projector", choices=("typescript",), default="typescript")
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
    pins = _load(CROSS_REPO_PINS_FIXTURE)
    manifest = run_canary(
        handoff=handoff,
        state_dir=state_dir,
        repo_paths={
            "warmbly": warmbly_repo,
            "governance": args.governance_repo,
            "web_cfg": args.web_cfg_repo,
        },
        repo_sha_fallbacks={
            "warmbly": pins["repos"]["warmbly"]["sha"],
            "web_cfg": pins["repos"]["web_cfg"]["sha"],
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
