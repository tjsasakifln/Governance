import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FIRST_WINDOW_READINESS_FIELDS,
  projectFirstCommercialWindowReadiness,
} from "../src/first-commercial-window-readiness";
import {
  classifyCommercialAuthority,
  classifySourceHealth,
  FIRST_WINDOW_V2,
} from "../src/first-touch-authority";

test("readiness projection lists every named field and never authorizes SMTP", () => {
  const ready = projectFirstCommercialWindowReadiness({
    governance_policy_ready: true,
    control_center_readback_ready: true,
    commercial_authority_observable: true,
    source_health_observable: true,
    reservoir_observable: true,
    queue_observable: true,
    transport_pause_observable: true,
    kill_switch_observable: true,
    mailbox_capacity_observable: true,
    exceptions_operable: true,
    cross_contract_version: "CFG-FIRST-TOUCH-ROUTING-v2",
  });
  for (const field of FIRST_WINDOW_READINESS_FIELDS) {
    assert.ok(field in ready, field);
  }
  assert.ok(Array.isArray(ready.blocking_reasons));
  assert.equal(ready.decision, "READY_FOR_FINAL_CONVERGENCE");
  assert.equal(ready.smtp_authorized, false);
  assert.equal(ready.provider_dispatch_authorized, false);
  assert.equal(ready.first_window_go, false);

  const blocked = projectFirstCommercialWindowReadiness({
    governance_policy_ready: true,
    control_center_readback_ready: false,
    commercial_authority_observable: true,
    source_health_observable: true,
    reservoir_observable: true,
    queue_observable: true,
    transport_pause_observable: true,
    kill_switch_observable: true,
    mailbox_capacity_observable: true,
    exceptions_operable: true,
    cross_contract_version: "CFG-FIRST-TOUCH-ROUTING-v2",
  });
  assert.equal(blocked.decision, "BLOCKED");
  assert.ok(blocked.blocking_reasons.includes("CONTROL_CENTER_READBACK_READY_ABSENT"));
  assert.equal(blocked.smtp_authorized, false);
});

test("first-window thresholds from a relative clock, not a calendar date", () => {
  assert.equal(classifyCommercialAuthority(0), "CURRENT");
  assert.equal(classifyCommercialAuthority(FIRST_WINDOW_V2.currentMaxSeconds), "CURRENT");
  assert.equal(classifyCommercialAuthority(FIRST_WINDOW_V2.currentMaxSeconds + 1), "DEGRADED");
  assert.equal(classifyCommercialAuthority(FIRST_WINDOW_V2.degradedMaxSeconds + 1), "FROZEN_FOR_NEW_ADMISSION");
  assert.equal(classifyCommercialAuthority(FIRST_WINDOW_V2.frozenMaxSeconds + 1), "EXPIRED");
  assert.equal(classifyCommercialAuthority(null), "UNKNOWN");
  assert.equal(classifySourceHealth(FIRST_WINDOW_V2.currentMaxSeconds + 1, "FRESH"), "DEGRADED");
  assert.equal(classifySourceHealth(null, "UNKNOWN"), "UNKNOWN");
  assert.equal(classifySourceHealth(null, "ERROR"), "UNKNOWN");
});
