from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
VALIDATOR_PATH = ROOT / "scripts" / "validate_commercial_authority.py"
EVALUATOR_PATH = ROOT / "commercial" / "outbound" / "first_touch_v2.py"
SCHEMA_PATH = ROOT / "schemas" / "first-commercial-window-readiness.v1.schema.json"
READY_FIXTURE = ROOT / "commercial" / "fixtures" / "first-touch-routing-v2" / "readiness-ready.v1.json"
BLOCKED_FIXTURE = ROOT / "commercial" / "fixtures" / "first-touch-routing-v2" / "readiness-blocked.v1.json"


def load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


v = load_module(VALIDATOR_PATH, "validate_commercial_authority")
ev = load_module(EVALUATOR_PATH, "first_touch_v2")


def validate(artifact):
    v.schema_validate(artifact, v.load_json(SCHEMA_PATH))


def test_ready_fixture_is_convergence_without_smtp_go():
    observation = v.load_json(READY_FIXTURE)
    artifact = ev.project_first_commercial_window_readiness(observation)
    validate(artifact)
    for field in ev.READINESS_FIELDS:
        assert field in artifact
    assert isinstance(artifact["blocking_reasons"], list)
    assert artifact["blocking_reasons"] == []
    assert artifact["decision"] == "READY_FOR_FINAL_CONVERGENCE"
    assert artifact["smtp_authorized"] is False
    assert artifact["provider_dispatch_authorized"] is False
    assert artifact["first_window_go"] is False
    assert "smtp" not in artifact["decision"].lower()
    assert artifact["cross_contract_version"] == "CFG-FIRST-TOUCH-ROUTING-v2"


def test_blocked_fixture_names_reasons_and_still_forbids_smtp():
    observation = v.load_json(BLOCKED_FIXTURE)
    artifact = ev.project_first_commercial_window_readiness(observation)
    validate(artifact)
    assert artifact["decision"] == "BLOCKED"
    assert artifact["blocking_reasons"]
    assert artifact["smtp_authorized"] is False
    assert artifact["provider_dispatch_authorized"] is False
    assert artifact["first_window_go"] is False


def test_unknown_observability_is_blocked_not_zero():
    artifact = ev.project_first_commercial_window_readiness({})
    validate(artifact)
    assert artifact["decision"] == "BLOCKED"
    assert "GOVERNANCE_POLICY_READY_UNKNOWN" in artifact["blocking_reasons"]
    assert artifact["governance_policy_ready"] is False
    assert artifact["smtp_authorized"] is False


def test_readiness_never_gains_a_go_field():
    artifact = ev.project_first_commercial_window_readiness(v.load_json(READY_FIXTURE))
    forbidden = {"smtp_go", "go", "dispatch_authorized", "send_authorized"}
    assert forbidden.isdisjoint(artifact)
    with pytest.raises(v.ValidationError):
        smuggled = dict(artifact, smtp_authorized=True)
        validate(smuggled)
