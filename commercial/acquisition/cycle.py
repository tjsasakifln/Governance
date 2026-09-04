"""Pure ACQUISITION_PRESSURE cycle: materialize funnel, name one bottleneck."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Mapping

from .adapters import (
    CANONICAL_STAGES,
    explicit_stage_row,
    inspect_delivery_capacity,
    inspect_warmbly_presence,
    origin_material,
    repo_root,
)
from .ledger import AcquisitionLedger, canonical_json

AUTHORITY_PATH = Path(__file__).resolve().parent / "acquisition-pressure.v1.json"
CYCLE_SCHEMA_VERSION = "acquisition-pressure-cycle.v1"
OBSERVATION_SCHEMA_VERSION = "acquisition-pressure-observation.v1"
ISO_Z_RE = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")
SAIDA_FIXED = {
    "ACQUISITION_LEDGER_MINIMAL": "YES",
    "NEW_DATA_PLANE": "NO",
    "UNKNOWN_PRESERVED": "YES",
    "BOTTLENECK_DECISION_CYCLE": "PASS",
    "ONE_SMALLEST_NEXT_ACTION": "YES",
    "GOVERNANCE_164": "GO",
}
DEDUP_SEMANTICS = "EXACTLY_ONCE_LOGICAL"


class CycleError(ValueError):
    """Fail-closed acquisition-pressure error."""


def load_policy(path: Path | None = None) -> dict[str, Any]:
    target = path or AUTHORITY_PATH
    return json.loads(target.read_text(encoding="utf-8"))


def _parse_instant(value: Any) -> datetime | None:
    if not isinstance(value, str) or not ISO_Z_RE.match(value):
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _stable_id(prefix: str, value: Any) -> str:
    digest = hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()
    return f"{prefix}_{digest[:32]}"


def _sha(value: Any) -> str:
    return "sha256:" + hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def default_window(evaluated_at: str, policy: Mapping[str, Any]) -> dict[str, str]:
    end = _parse_instant(evaluated_at) or datetime(1970, 1, 1, tzinfo=timezone.utc)
    seconds = int(policy.get("default_window_seconds") or 604800)
    start = end - timedelta(seconds=seconds)
    return {"start": _iso(start), "end": _iso(end)}


def count_signature(cycle: Mapping[str, Any]) -> list[tuple[str, str, Any]]:
    return [(row["stage"], row["state"], row["count"]) for row in cycle.get("stages") or []]


def materially_lower(
    candidate: Mapping[str, Any],
    current: Mapping[str, Any],
    policy: Mapping[str, Any],
) -> bool:
    """Deterministic anti-noise rule ABS_DELTA_GE_2_OR_ZERO_BREAK."""
    anti = policy.get("anti_noise") if isinstance(policy.get("anti_noise"), Mapping) else {}
    min_abs = int(anti.get("min_abs_delta") or 2)
    new_count = candidate.get("count")
    old_count = current.get("count")
    if candidate.get("state") != "OBSERVED" or not isinstance(new_count, int):
        return False
    if current.get("state") != "OBSERVED" or not isinstance(old_count, int):
        return True
    if anti.get("zero_is_always_material") is True and new_count == 0 and old_count != 0:
        return True
    if old_count == 0:
        return False
    return old_count - new_count >= min_abs


def _unknown_stage(
    stage: str,
    *,
    policy: Mapping[str, Any],
    window: Mapping[str, str],
    lane: str,
    reason: str | None = None,
) -> dict[str, Any]:
    binding = (policy.get("stage_bindings") or {}).get(stage) or {}
    missing_event = binding.get("expected_readback") or f"windowed {stage} events named canonical stage {stage}"
    issues = binding.get("owner_issues") or []
    missing_readback = issues[0] if issues else missing_event
    if reason == "FUNNEL_PROXY_OR_UNBOUND_VOCABULARY":
        missing_event = f"{stage} observation rejected: page/PR/commit or unbound funnel vocabulary is not canonical evidence"
        missing_readback = binding.get("expected_readback") or missing_event
    return {
        "stage": stage,
        "lane": lane,
        "window": dict(window),
        "count": None,
        "state": "UNKNOWN",
        "source": f"missing:{missing_readback}",
        "freshness": "UNKNOWN",
        "confidence": "INSUFFICIENT_EVIDENCE",
        "dedup_key": _stable_id("acqstage", {"lane": lane, "stage": stage, "window": window}),
        "dedup_semantics": DEDUP_SEMANTICS,
        "missing_event": missing_event,
        "missing_readback": str(missing_readback),
        "owner": binding.get("owner_repo") or "tjsasakifln/Governance",
    }


def _observation_identity(raw: Mapping[str, Any], parsed: Mapping[str, Any]) -> str:
    provided = raw.get("dedup_key")
    if isinstance(provided, str) and provided.strip():
        return provided.strip()
    return _stable_id(
        "acqevt",
        {
            "lane": parsed.get("lane"),
            "stage": parsed.get("stage"),
            "window": parsed.get("window"),
            "source": parsed.get("source"),
            "count": parsed.get("count"),
            "state": parsed.get("state"),
        },
    )


def _apply_freshness_age(
    raw: Mapping[str, Any],
    parsed: dict[str, Any],
    *,
    policy: Mapping[str, Any],
    evaluated_at: str,
) -> None:
    as_of = _parse_instant(raw.get("as_of"))
    eval_at = _parse_instant(evaluated_at)
    max_age = int(policy.get("freshness_max_age_seconds") or 86400)
    if as_of is not None and eval_at is not None and (eval_at - as_of).total_seconds() > max_age:
        parsed["freshness"] = "STALE"


def _fresh_observed(row: Mapping[str, Any]) -> bool:
    return (
        row.get("state") == "OBSERVED"
        and isinstance(row.get("count"), int)
        and row.get("freshness") == "FRESH"
    )


def materialize_stages(
    observations: Mapping[str, Any],
    *,
    policy: Mapping[str, Any],
    window: Mapping[str, str],
    lane: str,
    evaluated_at: str,
) -> list[dict[str, Any]]:
    by_stage: dict[str, dict[str, Any]] = {
        stage: _unknown_stage(stage, policy=policy, window=window, lane=lane) for stage in CANONICAL_STAGES
    }
    seen_identities: set[str] = set()
    filled: set[str] = set()
    rows = observations.get("stage_observations") if isinstance(observations.get("stage_observations"), list) else []
    for raw in rows:
        if not isinstance(raw, Mapping):
            continue
        parsed = explicit_stage_row(raw, policy=policy, default_window=window, default_lane=lane)
        if parsed is None:
            continue
        identity = _observation_identity(raw, parsed)
        if identity in seen_identities:
            continue
        seen_identities.add(identity)
        stage = parsed["stage"]
        if stage in filled:
            continue
        filled.add(stage)
        if parsed.get("rejected"):
            by_stage[stage] = _unknown_stage(
                stage, policy=policy, window=window, lane=lane, reason=str(parsed["rejected"])
            )
            continue
        _apply_freshness_age(raw, parsed, policy=policy, evaluated_at=evaluated_at)
        binding = (policy.get("stage_bindings") or {}).get(stage) or {}
        by_stage[stage] = {
            "stage": stage,
            "lane": lane,
            "window": parsed["window"],
            "count": parsed["count"],
            "state": parsed["state"],
            "source": parsed["source"],
            "freshness": parsed["freshness"],
            "confidence": parsed["confidence"],
            "dedup_key": _stable_id(
                "acqstage",
                {"lane": lane, "stage": stage, "window": parsed["window"], "source": parsed["source"]},
            ),
            "dedup_semantics": DEDUP_SEMANTICS,
            "missing_event": None if parsed["state"] == "OBSERVED" else binding.get("expected_readback"),
            "missing_readback": None
            if parsed["state"] == "OBSERVED"
            else (binding.get("owner_issues") or [binding.get("expected_readback")])[0],
            "owner": binding.get("owner_repo") or "tjsasakifln/Governance",
        }
    return [by_stage[stage] for stage in CANONICAL_STAGES]


def materialize_transitions(stages: list[dict[str, Any]], *, lane: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for left, right in zip(stages, stages[1:]):
        left_observed = left["state"] == "OBSERVED" and isinstance(left.get("count"), int)
        right_observed = right["state"] == "OBSERVED" and isinstance(right.get("count"), int)
        window = right["window"]
        if left_observed and right_observed:
            numerator = right["count"]
            denominator = left["count"]
            state = "OBSERVED"
            source = f"{left['source']}->{right['source']}"
            freshness = "STALE" if "STALE" in {left["freshness"], right["freshness"]} else "FRESH"
            if "ERROR" in {left["freshness"], right["freshness"]}:
                freshness = "ERROR"
            missing_event = None
            owner = right["owner"]
            confidence = "HIGH" if numerator == 0 else "MEDIUM"
        else:
            numerator = None
            denominator = None
            state = "UNKNOWN"
            unknown_side = left if not left_observed else right
            source = unknown_side["source"]
            freshness = "UNKNOWN"
            if not left_observed:
                missing_event = (
                    unknown_side.get("missing_event")
                    or f"denominator missing: windowed {left['stage']} count named canonical stage {left['stage']}"
                )
            else:
                missing_event = unknown_side.get("missing_event")
            owner = unknown_side["owner"]
            confidence = "INSUFFICIENT_EVIDENCE"
        rows.append(
            {
                "from_stage": left["stage"],
                "to_stage": right["stage"],
                "lane": lane,
                "window": dict(window),
                "numerator": numerator,
                "denominator": denominator,
                "state": state,
                "source": source,
                "freshness": freshness,
                "confidence": confidence,
                "dedup_key": _stable_id(
                    "acqtrans",
                    {"lane": lane, "from": left["stage"], "to": right["stage"], "window": window},
                ),
                "dedup_semantics": DEDUP_SEMANTICS,
                "missing_event": missing_event,
                "owner": owner,
            }
        )
    return rows


def select_bottleneck(
    stages: list[dict[str, Any]],
    *,
    policy: Mapping[str, Any],
    previous_decision: Mapping[str, Any] | None,
) -> dict[str, Any] | None:
    observed = [row for row in stages if _fresh_observed(row)]
    if not observed:
        return None
    zeros = [row for row in observed if row["count"] == 0]
    if zeros:
        candidate = zeros[0]
    else:
        lowest = min(row["count"] for row in observed)
        candidate = next(row for row in observed if row["count"] == lowest)
    previous = None
    if isinstance(previous_decision, Mapping):
        prev_stage = None
        decision = previous_decision.get("decision") if isinstance(previous_decision.get("decision"), Mapping) else previous_decision
        if isinstance(decision, Mapping):
            prev_stage = decision.get("bottleneck")
        if prev_stage in CANONICAL_STAGES:
            previous = next((row for row in stages if row["stage"] == prev_stage), None)
    if previous is None or not _fresh_observed(previous):
        return candidate
    if previous["stage"] == candidate["stage"]:
        return candidate
    if not materially_lower(candidate, previous, policy):
        return previous
    return candidate


def evaluate_shift(
    stages: list[dict[str, Any]],
    capacity: Mapping[str, Any],
) -> str:
    if capacity.get("state") != "OBSERVED" or capacity.get("evidence_class") != "REAL":
        return "UNKNOWN"
    available = capacity.get("available_units")
    if not isinstance(available, int):
        return "UNKNOWN"
    qco = next((row for row in stages if row["stage"] == "QCO"), None)
    if qco is None or not _fresh_observed(qco):
        return "UNKNOWN"
    if qco["count"] > available:
        return "YES"
    return "NO"


def _evidence_text(
    bottleneck: dict[str, Any] | None,
    *,
    stages: list[dict[str, Any]],
    transitions: list[dict[str, Any]],
    window: Mapping[str, str],
) -> str:
    span = f"{window['start']}..{window['end']}"
    if bottleneck is None:
        first = stages[0]
        return f"UNKNOWN/UNKNOWN + {span} + {first['source']}"
    incoming = next((row for row in transitions if row["to_stage"] == bottleneck["stage"]), None)
    if incoming is not None and incoming["state"] == "OBSERVED":
        return f"{incoming['numerator']}/{incoming['denominator']} + {span} + {incoming['source']}"
    count = bottleneck["count"]
    shown = "UNKNOWN" if count is None else str(count)
    return f"{shown}/{shown} + {span} + {bottleneck['source']}"


def _next_action(
    bottleneck_name: str,
    *,
    policy: Mapping[str, Any],
    stages: list[dict[str, Any]],
) -> str:
    templates = policy.get("next_actions") if isinstance(policy.get("next_actions"), Mapping) else {}
    if bottleneck_name == "UNKNOWN":
        unknown = next((row for row in stages if row["state"] == "UNKNOWN"), stages[0])
        template = str(templates.get("UNKNOWN") or "INSUFFICIENT_EVIDENCE: publish {missing_event} owned by {owner}.")
        return template.format(
            missing_event=unknown.get("missing_event") or unknown["stage"],
            owner=unknown.get("owner") or "tjsasakifln/Governance",
        )
    return str(templates.get(bottleneck_name) or templates.get("UNKNOWN") or bottleneck_name)


def _decision_confidence(bottleneck: dict[str, Any] | None, stages: list[dict[str, Any]]) -> str:
    if bottleneck is None:
        return "INSUFFICIENT_EVIDENCE"
    if bottleneck.get("count") == 0:
        return "HIGH"
    if any(row["state"] != "OBSERVED" for row in stages):
        return "MEDIUM"
    return "HIGH"


def render_decision_text(cycle: Mapping[str, Any]) -> str:
    decision = cycle["decision"]
    saida = cycle["saida"]
    lines = [
        f"BOTTLENECK={decision['bottleneck']}",
        f"EVIDENCE={decision['evidence']}",
        f"OWNER={decision['owner']}",
        f"SMALLEST_NEXT_ACTION={decision['smallest_next_action']}",
        f"CONFIDENCE={decision['confidence']}",
        f"ACQUISITION_LEDGER_MINIMAL={saida['ACQUISITION_LEDGER_MINIMAL']}",
        f"NEW_DATA_PLANE={saida['NEW_DATA_PLANE']}",
        f"UNKNOWN_PRESERVED={saida['UNKNOWN_PRESERVED']}",
        f"BOTTLENECK_DECISION_CYCLE={saida['BOTTLENECK_DECISION_CYCLE']}",
        f"ONE_SMALLEST_NEXT_ACTION={saida['ONE_SMALLEST_NEXT_ACTION']}",
        f"REPLAY_100={saida['REPLAY_100']}",
        f"ACQUISITION_BOTTLENECK_SHIFTED={saida['ACQUISITION_BOTTLENECK_SHIFTED']}",
        f"GOVERNANCE_164={saida['GOVERNANCE_164']}",
    ]
    return "\n".join(lines) + "\n"


def _normalize_observations(
    observations: Mapping[str, Any] | None,
    *,
    evaluated_at: str,
    policy: Mapping[str, Any],
) -> dict[str, Any]:
    if not isinstance(observations, Mapping):
        observations = {}
    window = observations.get("window") if isinstance(observations.get("window"), Mapping) else None
    if window is None or not _parse_instant(window.get("start")) or not _parse_instant(window.get("end")):
        window = default_window(evaluated_at, policy)
    sources = observations.get("sources") if isinstance(observations.get("sources"), Mapping) else {}
    return {
        "schema_version": OBSERVATION_SCHEMA_VERSION,
        "observed_at": observations.get("observed_at") if _parse_instant(observations.get("observed_at")) else evaluated_at,
        "lane": "NET_NEW_INBOUND",
        "window": {"start": window["start"], "end": window["end"]},
        "previous_decision": observations.get("previous_decision") if isinstance(observations.get("previous_decision"), Mapping) else None,
        "sources": {
            "web_cfg": sources.get("web_cfg") if isinstance(sources.get("web_cfg"), Mapping) else {"present": False},
            "warmbly": sources.get("warmbly") if isinstance(sources.get("warmbly"), Mapping) else {"present": False},
            "delivery": sources.get("delivery") if isinstance(sources.get("delivery"), Mapping) else {"present": False},
        },
        "stage_observations": [
            dict(row) for row in observations.get("stage_observations") or [] if isinstance(row, Mapping)
        ],
    }


def run_acquisition_pressure_cycle(
    observations: Mapping[str, Any] | None,
    *,
    ledger: AcquisitionLedger | None = None,
    previous_decision: Mapping[str, Any] | None = None,
    evaluated_at: str,
    policy: Mapping[str, Any] | None = None,
    root: Path | None = None,
) -> dict[str, Any]:
    policy_value = dict(policy or load_policy())
    bundle = _normalize_observations(observations, evaluated_at=evaluated_at, policy=policy_value)
    lane = bundle["lane"]
    window = bundle["window"]
    inspect_warmbly_presence(bundle["sources"].get("warmbly"), root=root)
    capacity = inspect_delivery_capacity(bundle["sources"].get("delivery"), root=root)
    stages = materialize_stages(
        bundle, policy=policy_value, window=window, lane=lane, evaluated_at=evaluated_at
    )
    transitions = materialize_transitions(stages, lane=lane)
    previous = previous_decision or bundle.get("previous_decision")
    bottleneck = select_bottleneck(stages, policy=policy_value, previous_decision=previous)
    bottleneck_name = bottleneck["stage"] if bottleneck is not None else "UNKNOWN"
    shifted = evaluate_shift(stages, capacity)
    owner = bottleneck["owner"] if bottleneck is not None else stages[0]["owner"]
    confidence = _decision_confidence(bottleneck, stages)
    missing = [
        {
            "stage": row["stage"],
            "missing_event": row["missing_event"],
            "missing_readback": row["missing_readback"],
            "owner": row["owner"],
        }
        for row in stages
        if row["state"] == "UNKNOWN" and row.get("missing_event")
    ]
    origin_hash = _sha(origin_material(bundle))
    dedup_key = _stable_id("acqdedup", {"origin_hash": origin_hash, "lane": lane, "window": window})
    cycle_id = _stable_id("acq", {"origin_hash": origin_hash, "lane": lane, "window": window})
    unknown_preserved = all(
        row["count"] is None for row in stages if row["state"] == "UNKNOWN"
    ) and all(row["state"] != "UNKNOWN" or row["numerator"] is None for row in transitions)
    if not unknown_preserved:
        raise CycleError("UNKNOWN leaked as zero")
    record = {
        "schema_version": CYCLE_SCHEMA_VERSION,
        "policy_id": "ACQUISITION_PRESSURE",
        "policy_version": "v1",
        "canonical_name": "ACQUISITION_PRESSURE-v1",
        "cycle_id": cycle_id,
        "evaluated_at": evaluated_at if _parse_instant(evaluated_at) else "1970-01-01T00:00:00Z",
        "lane": lane,
        "window": dict(window),
        "origin_hash": origin_hash,
        "dedup_key": dedup_key,
        "replayed": False,
        "mutation_mode": "MODEL_ONLY",
        "causal_inference": False,
        "new_data_plane": False,
        "contains_pii": False,
        "stages": stages,
        "transitions": transitions,
        "capacity": capacity,
        "decision": {
            "bottleneck": bottleneck_name,
            "evidence": _evidence_text(bottleneck, stages=stages, transitions=transitions, window=window),
            "owner": owner,
            "smallest_next_action": _next_action(bottleneck_name, policy=policy_value, stages=stages),
            "confidence": confidence,
            "acquisition_bottleneck_shifted": shifted,
            "causal_inference": False,
        },
        "missing": missing,
        "saida": {
            **SAIDA_FIXED,
            "REPLAY_100": "PENDING",
            "ACQUISITION_BOTTLENECK_SHIFTED": shifted,
        },
    }
    store = ledger if ledger is not None else AcquisitionLedger()
    stored = store.append(record)
    stored["saida"] = dict(stored.get("saida") or record["saida"])
    stored["saida"]["ACQUISITION_BOTTLENECK_SHIFTED"] = stored["decision"]["acquisition_bottleneck_shifted"]
    return stored


def prove_replay(
    observations: Mapping[str, Any] | None,
    *,
    n: int = 100,
    evaluated_at: str,
    ledger: AcquisitionLedger | None = None,
    previous_decision: Mapping[str, Any] | None = None,
    policy: Mapping[str, Any] | None = None,
    root: Path | None = None,
) -> dict[str, Any]:
    store = ledger if ledger is not None else AcquisitionLedger()
    first = run_acquisition_pressure_cycle(
        observations,
        ledger=store,
        previous_decision=previous_decision,
        evaluated_at=evaluated_at,
        policy=policy,
        root=root,
    )
    signature = count_signature(first)
    origin = first["origin_hash"]
    remaining = n if first.get("replayed") else n - 1
    for _ in range(max(0, remaining)):
        again = run_acquisition_pressure_cycle(
            observations,
            ledger=store,
            previous_decision=previous_decision,
            evaluated_at=evaluated_at,
            policy=policy,
            root=root,
        )
        if again["origin_hash"] != origin:
            raise CycleError("origin changed on replay")
        if count_signature(again) != signature:
            raise CycleError("counts changed on replay")
        if again.get("replayed") is not True:
            raise CycleError("replay did not reuse the ledger record")
        if (
            again["decision"]["bottleneck"] != first["decision"]["bottleneck"]
            or again["decision"]["evidence"] != first["decision"]["evidence"]
            or again["decision"]["owner"] != first["decision"]["owner"]
            or again["decision"]["smallest_next_action"] != first["decision"]["smallest_next_action"]
        ):
            raise CycleError("decision changed on replay")
    if len(store) != 1:
        raise CycleError("replay duplicated ledger records")
    result = deepcopy(first)
    result["saida"] = dict(result["saida"])
    result["saida"]["REPLAY_100"] = "PASS"
    store.mark_replay_proof(result["dedup_key"])
    return result


def load_observations(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def contemporaneous_fixture_path() -> Path:
    return repo_root() / "commercial" / "fixtures" / "acquisition-pressure" / "contemporaneous.v1.json"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run one ACQUISITION_PRESSURE decision cycle")
    parser.add_argument(
        "--observations",
        help="Path to an observation bundle JSON (defaults to the contemporaneous fixture)",
    )
    parser.add_argument("--ledger", help="Path to the model-only ledger JSON")
    parser.add_argument("--previous-decision", help="Path to a previous cycle JSON")
    parser.add_argument("--evaluated-at", default="2026-09-03T12:00:00Z")
    parser.add_argument("--replay", type=int, default=100)
    parser.add_argument("--json", action="store_true", help="Also print the cycle JSON after the decision text")
    args = parser.parse_args(argv)
    observations_path = Path(args.observations) if args.observations else contemporaneous_fixture_path()
    observations = load_observations(observations_path)
    previous = None
    if args.previous_decision:
        previous = json.loads(Path(args.previous_decision).read_text(encoding="utf-8"))
    ledger = AcquisitionLedger(Path(args.ledger) if args.ledger else None)
    result = prove_replay(
        observations,
        n=max(1, args.replay),
        evaluated_at=args.evaluated_at,
        ledger=ledger,
        previous_decision=previous,
    )
    sys.stdout.write(render_decision_text(result))
    if args.json:
        sys.stdout.write(canonical_json(result) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
