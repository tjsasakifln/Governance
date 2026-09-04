"""Drive the shipped ACQUISITION_PRESSURE cycle, not a parallel oracle."""

from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path

import pytest

from commercial.acquisition import (
    AUTHORITY_PATH,
    AcquisitionLedger,
    count_signature,
    load_policy,
    prove_replay,
    render_decision_text,
    run_acquisition_pressure_cycle,
)
from commercial.acquisition.cycle import main as acquisition_main
from scripts.validate_commercial_authority import ValidationError, load_json, schema_validate

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "commercial" / "fixtures" / "acquisition-pressure"
POLICY_SCHEMA = ROOT / "schemas" / "acquisition-pressure.v1.schema.json"
OBSERVATION_SCHEMA = ROOT / "schemas" / "acquisition-pressure-observation.v1.schema.json"
CYCLE_SCHEMA = ROOT / "schemas" / "acquisition-pressure-cycle.v1.schema.json"
EVALUATED_AT = "2026-09-03T12:00:00Z"
CANONICAL_STAGES = (
    "reached",
    "asset_visit",
    "useful_action",
    "monitor",
    "handraiser",
    "QCO",
    "proposal",
    "won",
)
DECISION_FIELDS = ("bottleneck", "evidence", "owner", "smallest_next_action", "confidence")
ORIGIN_MAIN_PYTEST = (
    "tests/test_first_touch_routing_policy.py",
    "tests/test_first_touch_routing_policy_v2.py",
    "tests/test_first_touch_routing_policy_v3.py",
    "tests/test_first_commercial_window_readiness.py",
)


def load_fixture(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def cycle(observations, *, store=None, previous=None, evaluated_at=EVALUATED_AT):
    return run_acquisition_pressure_cycle(
        observations,
        ledger=store,
        previous_decision=previous,
        evaluated_at=evaluated_at,
        root=ROOT,
    )


def validate_policy(value):
    schema_validate(value, load_json(POLICY_SCHEMA))


def validate_observation(value):
    schema_validate(value, load_json(OBSERVATION_SCHEMA))


def validate_cycle(value):
    schema_validate(value, load_json(CYCLE_SCHEMA))


def stage_map(record):
    return {row["stage"]: row for row in record["stages"]}


def transition_map(record):
    return {(row["from_stage"], row["to_stage"]): row for row in record["transitions"]}


def _counts(*pairs: tuple[str, int], extra=None) -> dict:
    observations = load_fixture("contemporaneous.v1.json")
    observations["stage_observations"] = [
        {
            "lane": "NET_NEW_INBOUND",
            "stage": stage,
            "state": "OBSERVED",
            "count": count,
            "source": f"explicit.{stage}",
            "freshness": "FRESH",
            "confidence": "HIGH",
        }
        for stage, count in pairs
    ]
    if extra:
        observations["stage_observations"].extend(extra)
    return observations


def test_policy_is_closed_versioned_and_machine_readable():
    value = load_policy()
    validate_policy(value)
    assert value["canonical_name"] == "ACQUISITION_PRESSURE-v1"
    assert value["canonical_stages"] == list(CANONICAL_STAGES)
    assert value["lanes"] == ["NET_NEW_INBOUND"]
    assert value["evaluation"]["absence_is_unknown_not_zero"] is True
    assert value["invariants"]["page_pr_commit_as_funnel_success"] is False
    assert value["boundary"]["intake_frozen"] == "NET_NEW_INBOUND_HANDRAISER-v1"
    assert value["boundary"]["capacity_issue_state"] == "TRIGGERED"
    assert value["invariants"]["intake_schema_mutable"] is False
    assert AUTHORITY_PATH.is_file()
    unknown = deepcopy(value)
    unknown["dashboard"] = True
    with pytest.raises(ValidationError, match="unknown critical field"):
        validate_policy(unknown)


def test_contemporaneous_fixture_is_schema_valid_and_unbound():
    bundle = load_fixture("contemporaneous.v1.json")
    validate_observation(bundle)
    assert bundle["stage_observations"] == []
    assert bundle["sources"]["delivery"]["present"] is False


def test_absent_source_is_unknown_never_zero():
    record = cycle(load_fixture("contemporaneous.v1.json"))
    validate_cycle(record)
    assert [row["stage"] for row in record["stages"]] == list(CANONICAL_STAGES)
    assert len(record["transitions"]) == 7
    for row in record["stages"]:
        assert row["state"] == "UNKNOWN"
        assert row["count"] is None
        assert row["missing_event"]
        assert row["owner"]
        assert row["dedup_semantics"] == "EXACTLY_ONCE_LOGICAL"
    for row in record["transitions"]:
        assert row["state"] == "UNKNOWN"
        assert row["numerator"] is None
        assert row["denominator"] is None
        assert row["dedup_semantics"] == "EXACTLY_ONCE_LOGICAL"
    assert record["decision"]["bottleneck"] == "UNKNOWN"
    assert record["saida"]["UNKNOWN_PRESERVED"] == "YES"
    assert record["capacity"]["state"] == "UNKNOWN"
    assert record["capacity"]["available_units"] is None
    assert "Governance#123" in (record["capacity"]["missing_event"] or "")
    assert "windowed reached events named canonical stage reached" in record["decision"]["smallest_next_action"]
    assert "tjsasakifln/web-cfg" in record["decision"]["smallest_next_action"]
    assert record["decision"]["causal_inference"] is False


def test_confirmed_observed_zero_stays_zero_and_names_bottleneck():
    record = cycle(load_fixture("observed-zero.v1.json"))
    validate_cycle(record)
    rows = stage_map(record)
    assert rows["useful_action"]["state"] == "OBSERVED"
    assert rows["useful_action"]["count"] == 0
    assert rows["reached"]["count"] == 12
    assert rows["handraiser"]["state"] == "UNKNOWN"
    assert rows["handraiser"]["count"] is None
    assert record["decision"]["bottleneck"] == "useful_action"
    assert record["decision"]["causal_inference"] is False
    assert record["decision"]["evidence"].startswith("0/")
    assert record["decision"]["owner"] == "tjsasakifln/web-cfg"
    assert "useful_action" in record["decision"]["smallest_next_action"]


def test_one_decision_has_required_fields():
    record = cycle(load_fixture("contemporaneous.v1.json"))
    for field in DECISION_FIELDS:
        assert field in record["decision"]
        assert record["decision"][field]
    text = render_decision_text(record)
    lines = text.splitlines()
    assert lines[0].startswith("BOTTLENECK=")
    assert lines[1].startswith("EVIDENCE=")
    assert lines[2].startswith("OWNER=")
    assert lines[3].startswith("SMALLEST_NEXT_ACTION=")
    assert lines[4].startswith("CONFIDENCE=")
    assert sum(1 for line in lines if line.startswith("SMALLEST_NEXT_ACTION=")) == 1


def test_shift_cannot_be_yes_when_capacity_unknown():
    record = cycle(load_fixture("observed-zero.v1.json"))
    assert record["capacity"]["state"] == "UNKNOWN"
    assert record["decision"]["acquisition_bottleneck_shifted"] != "YES"
    assert record["saida"]["ACQUISITION_BOTTLENECK_SHIFTED"] == "UNKNOWN"


def test_synthetic_staffed_snapshot_keeps_capacity_unknown():
    observations = load_fixture("observed-zero.v1.json")
    observations["sources"]["delivery"] = {
        "present": True,
        "snapshot_ref": "delivery/fixtures/capacity-synthetic-one.v2.json",
        "payload_ref": None,
        "note": "synthetic must not measure #123",
    }
    record = cycle(observations)
    assert record["capacity"]["state"] == "UNKNOWN"
    assert record["capacity"]["evidence_class"] == "SYNTHETIC"
    assert record["decision"]["acquisition_bottleneck_shifted"] != "YES"


def test_shift_yes_only_when_observed_qco_exceeds_real_capacity(tmp_path):
    snapshot = {
        "schema_version": "confenge.staffed_capacity_snapshot.v2",
        "capacity_snapshot_id": "cap_acq_shift_rule_model_only",
        "version": 1,
        "synthetic": False,
        "as_of": "2026-09-03T12:00:00Z",
        "expires_at": "2026-09-04T12:00:00Z",
        "freshness": {"basis": "EXPLICIT_EXPIRY", "max_age_seconds": 86400},
        "staffed_capacity_units": 1,
        "unit": "delivery_slot",
        "working_calendar_version": "CFG-CALENDAR-MODEL-ONLY-v1",
        "evidence_refs": ["fixture://acquisition-pressure/shift-rule"],
        "policy_ceiling_used_as_staffed_capacity": False,
        "mutation_mode": "MODEL_ONLY",
    }
    snap_path = tmp_path / "staffed.json"
    snap_path.write_text(json.dumps(snapshot), encoding="utf-8")
    observations = load_fixture("observed-zero.v1.json")
    observations["sources"]["delivery"] = {
        "present": True,
        "snapshot_ref": str(snap_path),
        "payload_ref": None,
        "note": "model-only shift rule input",
    }
    observations["stage_observations"].append(
        {
            "lane": "NET_NEW_INBOUND",
            "stage": "QCO",
            "state": "OBSERVED",
            "count": 3,
            "source": "warmbly.explicit.QCO",
            "freshness": "FRESH",
            "confidence": "HIGH",
        }
    )
    record = cycle(observations)
    assert record["capacity"]["state"] == "OBSERVED"
    assert record["capacity"]["available_units"] == 1
    assert record["decision"]["acquisition_bottleneck_shifted"] == "YES"


def test_page_pr_commit_are_rejected_as_funnel_evidence():
    observations = load_fixture("contemporaneous.v1.json")
    observations["stage_observations"] = [
        {
            "stage": "won",
            "state": "OBSERVED",
            "count": 12,
            "source": "github.commit_count",
            "page_count": 40,
        },
        {
            "stage": "proposal",
            "state": "OBSERVED",
            "count": 4,
            "source": "pull_requests",
        },
    ]
    record = cycle(observations)
    rows = stage_map(record)
    assert rows["won"]["state"] == "UNKNOWN"
    assert rows["won"]["count"] is None
    assert rows["proposal"]["state"] == "UNKNOWN"
    assert rows["proposal"]["count"] is None
    assert "page/PR/commit" in (rows["won"]["missing_event"] or "")


def test_commercial_snapshot_funnel_keys_do_not_map_silently():
    observations = load_fixture("contemporaneous.v1.json")
    observations["stage_observations"] = [
        {
            "stage": "handraiser",
            "state": "OBSERVED",
            "count": 5,
            "source": "warmbly.novos_leads",
        },
        {
            "stage": "QCO",
            "state": "OBSERVED",
            "count": 2,
            "source": "warmbly.opportunities",
        },
        {
            "stage": "won",
            "state": "OBSERVED",
            "count": 1,
            "source": "warmbly.clients",
        },
    ]
    record = cycle(observations)
    rows = stage_map(record)
    for stage in ("handraiser", "QCO", "won"):
        assert rows[stage]["state"] == "UNKNOWN"
        assert rows[stage]["count"] is None


def test_stale_observation_is_not_fresh_and_does_not_name_bottleneck():
    observations = _counts(("reached", 12), ("asset_visit", 8))
    observations["stage_observations"].append(
        {
            "lane": "NET_NEW_INBOUND",
            "stage": "useful_action",
            "state": "OBSERVED",
            "count": 0,
            "source": "web-cfg.explicit.useful_action",
            "freshness": "FRESH",
            "confidence": "HIGH",
            "as_of": "2026-08-01T12:00:00Z",
        }
    )
    record = cycle(observations)
    rows = stage_map(record)
    assert rows["useful_action"]["state"] == "OBSERVED"
    assert rows["useful_action"]["count"] == 0
    assert rows["useful_action"]["freshness"] == "STALE"
    assert record["decision"]["bottleneck"] == "asset_visit"
    stale_only = _counts()
    stale_only["stage_observations"] = [
        {
            "lane": "NET_NEW_INBOUND",
            "stage": "reached",
            "state": "OBSERVED",
            "count": 4,
            "source": "web-cfg.explicit.reached",
            "freshness": "STALE",
            "confidence": "LOW",
        }
    ]
    stale_record = cycle(stale_only)
    assert stage_map(stale_record)["reached"]["count"] == 4
    assert stage_map(stale_record)["reached"]["freshness"] == "STALE"
    assert stale_record["decision"]["bottleneck"] == "UNKNOWN"


def test_missing_denominator_is_unknown_not_zero():
    observations = _counts(("asset_visit", 4))
    record = cycle(observations)
    trans = transition_map(record)[("reached", "asset_visit")]
    assert trans["state"] == "UNKNOWN"
    assert trans["numerator"] is None
    assert trans["denominator"] is None
    assert "denominator missing" in (trans["missing_event"] or "") or trans["missing_event"]
    assert stage_map(record)["reached"]["count"] is None
    assert stage_map(record)["asset_visit"]["count"] == 4
    assert record["decision"]["bottleneck"] == "asset_visit"


def test_duplicate_event_does_not_double_count():
    duplicate = {
        "lane": "NET_NEW_INBOUND",
        "stage": "useful_action",
        "state": "OBSERVED",
        "count": 3,
        "source": "web-cfg.explicit.useful_action",
        "freshness": "FRESH",
        "confidence": "HIGH",
        "dedup_key": "evt_useful_action_same",
    }
    observations = _counts(("reached", 10), extra=[duplicate, dict(duplicate), dict(duplicate)])
    record = cycle(observations)
    assert stage_map(record)["useful_action"]["count"] == 3
    assert record["decision"]["bottleneck"] == "useful_action"


def test_mixed_lane_rows_are_ignored():
    observations = _counts(("reached", 9), ("asset_visit", 6))
    observations["stage_observations"].append(
        {
            "lane": "OUTBOUND",
            "stage": "useful_action",
            "state": "OBSERVED",
            "count": 0,
            "source": "explicit.useful_action",
            "freshness": "FRESH",
            "confidence": "HIGH",
        }
    )
    observations["stage_observations"].append(
        {
            "lane": "EXISTING_ACCOUNT",
            "stage": "won",
            "state": "OBSERVED",
            "count": 1,
            "source": "explicit.won",
            "freshness": "FRESH",
            "confidence": "HIGH",
        }
    )
    record = cycle(observations)
    rows = stage_map(record)
    assert rows["useful_action"]["state"] == "UNKNOWN"
    assert rows["useful_action"]["count"] is None
    assert rows["won"]["state"] == "UNKNOWN"
    assert rows["won"]["count"] is None
    assert rows["asset_visit"]["count"] == 6
    assert record["decision"]["bottleneck"] == "asset_visit"
    assert record["lane"] == "NET_NEW_INBOUND"


def test_replay_100_keeps_counts_origin_and_one_ledger_record():
    store = AcquisitionLedger()
    observations = load_fixture("observed-zero.v1.json")
    proved = prove_replay(
        observations,
        n=100,
        evaluated_at=EVALUATED_AT,
        ledger=store,
        root=ROOT,
    )
    assert proved["saida"]["REPLAY_100"] == "PASS"
    assert len(store) == 1
    first = store.records()[0]
    again = cycle(observations, store=store)
    assert again["replayed"] is True
    assert again["origin_hash"] == first["origin_hash"]
    assert count_signature(again) == count_signature(first)
    assert again["decision"]["bottleneck"] == first["decision"]["bottleneck"]
    assert len(store) == 1


def test_small_oscillation_does_not_change_bottleneck():
    first = cycle(_counts(("reached", 10), ("asset_visit", 5)))
    assert first["decision"]["bottleneck"] == "asset_visit"
    second = cycle(
        _counts(("reached", 10), ("asset_visit", 5), ("useful_action", 4)),
        previous=first,
    )
    assert second["decision"]["bottleneck"] == "asset_visit"
    assert second["decision"]["causal_inference"] is False


def test_zero_break_is_material_and_changes_bottleneck():
    first = cycle(_counts(("reached", 10), ("asset_visit", 5)))
    second = cycle(
        _counts(("reached", 10), ("asset_visit", 5), ("useful_action", 0)),
        previous=first,
    )
    assert second["decision"]["bottleneck"] == "useful_action"
    assert stage_map(second)["useful_action"]["count"] == 0


def test_intake_contract_is_named_frozen_and_not_shipped_here():
    value = load_policy()
    assert value["boundary"]["intake_frozen"] == "NET_NEW_INBOUND_HANDRAISER-v1"
    assert value["invariants"]["intake_schema_mutable"] is False
    assert "activate_123_without_trigger" in value["invariants"]
    assert value["invariants"]["activate_123_without_trigger"] is False


def test_cli_twice_emits_saida_and_does_not_duplicate_ledger(tmp_path, capsys):
    ledger = tmp_path / "ledger.json"
    argv = [
        "--observations",
        str(FIXTURES / "contemporaneous.v1.json"),
        "--ledger",
        str(ledger),
        "--evaluated-at",
        EVALUATED_AT,
        "--replay",
        "100",
    ]
    assert acquisition_main(argv) == 0
    first = capsys.readouterr().out
    assert acquisition_main(argv) == 0
    second = capsys.readouterr().out
    assert first == second
    for flag in (
        "BOTTLENECK=",
        "EVIDENCE=",
        "OWNER=",
        "SMALLEST_NEXT_ACTION=",
        "CONFIDENCE=",
        "ACQUISITION_LEDGER_MINIMAL=YES",
        "NEW_DATA_PLANE=NO",
        "UNKNOWN_PRESERVED=YES",
        "BOTTLENECK_DECISION_CYCLE=PASS",
        "ONE_SMALLEST_NEXT_ACTION=YES",
        "REPLAY_100=PASS",
        "ACQUISITION_BOTTLENECK_SHIFTED=UNKNOWN",
        "GOVERNANCE_164=GO",
    ):
        assert flag in first
    assert sum(1 for line in first.splitlines() if line.startswith("SMALLEST_NEXT_ACTION=")) == 1
    assert "GOVERNANCE_ACQUISITION_PRESSURE" not in first
    payload = json.loads(ledger.read_text(encoding="utf-8"))
    assert len(payload["records"]) == 1
    assert payload["records"][0]["origin_hash"].startswith("sha256:")
    assert payload["records"][0]["saida"]["REPLAY_100"] == "PASS"


def test_ci_workflow_runs_this_module():
    workflow = (ROOT / ".github" / "workflows" / "commercial-authority.yml").read_text(encoding="utf-8")
    pytest_line = next(line.strip() for line in workflow.splitlines() if "python -m pytest" in line)
    assert "tests/test_acquisition_pressure.py" in pytest_line
    for name in ORIGIN_MAIN_PYTEST:
        assert name in pytest_line
    assert "tests/test_net_new_inbound_handraiser.py" not in pytest_line
