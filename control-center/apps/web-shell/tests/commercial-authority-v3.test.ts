import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { projectFounderOperatingTruth } from "../src/founder-operating-truth";
import { renderHoje } from "../src/ui/hoje";
import { composeHoje } from "../src/hoje-compose";
import {
  ACQUISITION_PLAN_CONDITION,
  ACQUISITION_PLAN_FRESH,
  FORBIDDEN_SOURCE_HEALTH_READBACKS,
  acquisitionPlanCondition,
  sourceHealthBlocksOutbound,
} from "../src/acquisition-plan";
import {
  COMMERCIAL_AUTHORITY_MISSING,
  COMMERCIAL_AUTHORITY_POLICY_V2,
  FIRST_TOUCH_ROUTING_V3,
  QUALIFICATION_WINDOW_YEARS,
  QUALIFYING_DATE_PRECEDENCE,
  RETIRED_FRESHNESS_BLOCKER,
  normalizeCommercialQualification,
  qualifiedUntilFor,
} from "../src/first-touch-authority";

const HERE = dirname(fileURLToPath(import.meta.url));
const GOVERNANCE_ROOT = join(HERE, "../../../..");
const V3_POLICY = JSON.parse(
  readFileSync(join(GOVERNANCE_ROOT, "commercial/outbound/cfg-first-touch-routing.v3.json"), "utf8"),
) as Record<string, any>;

const NOW = "2026-08-26T03:00:00Z";

function slot(domain: string, system: string, snapshot: Record<string, unknown>) {
  return {
    schema_version: "control-center.operational-domain.v1",
    domain,
    scope: domain === "pncp" ? "inbound" : domain,
    source: { system, kind: "read-model", locator: `${domain}/current` },
    observed_at: "2026-08-26T02:55:00Z",
    freshness_status: "FRESH",
    confidence: 1,
    presence: "present",
    healthy: true,
    snapshot,
  };
}

function envelope(commercialState: string | null, feedAgeSeconds: number): Record<string, unknown> {
  const authority: Record<string, unknown> = {
    basis_source_run_id: "run-current",
    basis_snapshot_hash: "snap-fixture",
    basis_membership_hash: "mem-fixture",
    basis_publication_semantic_hash: "sem-fixture",
    producer_identity: "producer-fixture",
    source_run_id: "run-current",
    membership_hash: "mem-fixture",
    policy_version: COMMERCIAL_AUTHORITY_POLICY_V2,
    qualifying_contract_date: "2025-06-02",
    qualifying_date_field: "data_assinatura",
    valid_until: "2028-06-02",
  };
  if (commercialState !== null) {
    authority.state = commercialState;
  }
  return {
    schema_version: "control-center.operational-envelope.v1",
    scope: "company",
    generated_at: NOW,
    freshness_status: "FRESH",
    confidence: 1,
    snapshots: {
      commercial: slot("commercial", "warmbly", {
        operations: {
          dispatch: { state: "PAUSED", observed: true, transport_health: "PAUSED_BY_KILL_SWITCH" },
          delegated_first_touch: {
            policy_version: FIRST_TOUCH_ROUTING_V3,
            runtime_release_sha: "0123456789abcdef0123456789abcdef01234567",
            source_run_id: "run-current",
            queued_readback: 140,
            human_approved: 0,
            commercial_authority: authority,
            counts: { PREPARED: 180, QUEUED: 140, SENT: 20 },
            items: [],
          },
        },
      }),
      pncp: slot("pncp", "extra-cli", {}),
    },
    source_observations: [
      {
        source: { system: "extra-cli", kind: "outbound-inventory", locator: "commercial-reservoir/current" },
        observed_at: "2026-08-26T02:54:00Z",
        freshness_status: feedAgeSeconds > 259200 ? "STALE" : "FRESH",
        confidence: 1,
        payload: {
          outbound_inventory: {
            current_run: "run-current",
            feed_age_seconds: feedAgeSeconds,
            target_confirmed: 2500,
            recipient_attributed: 1800,
            eligible_current: 1400,
            ready_reservoir: 1200,
          },
        },
      },
    ],
  };
}

function html(input: Record<string, unknown>): string {
  return renderHoje(
    composeHoje({
      generated_at: NOW,
      headline: "cockpit",
      priorities: [],
      incidents: [],
      clients: [],
      commercial: null,
      finance: null,
      engineering: null,
      infra: [],
      activities: [],
      operational_envelope: input,
    }),
  );
}

/* (a) A stale acquisition source never blocks a qualified member. */

test("STALE source with a QUALIFIED member is an acquisition-plan condition, not a block", () => {
  const input = envelope("QUALIFIED", 1_200_000);
  const truth = projectFounderOperatingTruth(input);
  assert.equal(truth.outbound_runway.transport.source_health.value, "STALE");
  assert.equal(truth.outbound_runway.transport.commercial_state.value, "QUALIFIED");
  assert.equal(truth.outbound_runway.runway.acquisition_plan_condition.value, ACQUISITION_PLAN_CONDITION);
  // Freshness emits no exception, no blocker and no human action of its own.
  assert.equal(truth.exceptions.some((item) => item.reason_group?.startsWith("COMMERCIAL_AUTHORITY")), false);
  assert.equal(
    truth.exceptions.some((item) => /freshness|desatualiz|stale/i.test(`${item.reason} ${item.next_action}`)),
    false,
  );
  assert.notEqual(truth.primary_action?.label, "Resolver divergência do outbound");

  const page = html(input);
  assert.match(page, /Plano de aquisição:/);
  assert.match(page, /Atualização de mercado atrasada; novos leads podem não estar refletidos\./);
  assert.match(page, /data-outbound-blocking="false"/);
  for (const forbidden of FORBIDDEN_SOURCE_HEALTH_READBACKS) {
    assert.doesNotMatch(page, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
  assert.doesNotMatch(page, new RegExp(RETIRED_FRESHNESS_BLOCKER, "i"));
});

test("source health is never a transport blocker in any observed state", () => {
  for (const [age, expected] of [
    [300, "FRESH"],
    [200_000, "DEGRADED"],
    [1_200_000, "STALE"],
  ] as const) {
    const truth = projectFounderOperatingTruth(envelope("QUALIFIED", age));
    assert.equal(truth.outbound_runway.transport.source_health.value, expected);
    assert.equal(truth.outbound_runway.transport.commercial_state.value, "QUALIFIED");
    assert.equal(sourceHealthBlocksOutbound(expected), false);
  }
  assert.equal(acquisitionPlanCondition("FRESH"), ACQUISITION_PLAN_FRESH);
  assert.equal(acquisitionPlanCondition("DEGRADED"), ACQUISITION_PLAN_CONDITION);
  assert.equal(acquisitionPlanCondition("STALE"), ACQUISITION_PLAN_CONDITION);
  assert.equal(acquisitionPlanCondition("MISSING"), ACQUISITION_PLAN_CONDITION);
});

/* (b) A fresh source never grants authority by fallback. */

test("FRESH source without commercial authority stays UNKNOWN and is never authorized", () => {
  const input = envelope(null, 300);
  const truth = projectFounderOperatingTruth(input);
  assert.equal(truth.outbound_runway.transport.source_health.value, "FRESH");
  assert.equal(truth.outbound_runway.transport.commercial_state.value, "UNKNOWN");
  assert.equal(normalizeCommercialQualification(null), "UNKNOWN");
  assert.equal(normalizeCommercialQualification("FRESH"), "UNKNOWN");
  assert.equal(normalizeCommercialQualification("CURRENT"), "UNKNOWN");
  assert.equal(V3_POLICY.separated_authorities.source_freshness_grants_commercial_authority_by_fallback, false);
  assert.equal(V3_POLICY.source_operational_health.replaced_readiness_blocker.removed, RETIRED_FRESHNESS_BLOCKER);
  assert.equal(V3_POLICY.source_operational_health.replaced_readiness_blocker.replacement, COMMERCIAL_AUTHORITY_MISSING);
});

/* (c) The rolling three-year window. */

test("qualified_until is derived from the contracting act plus three years", () => {
  assert.equal(QUALIFICATION_WINDOW_YEARS, 3);
  assert.equal(qualifiedUntilFor(new Date("2025-06-02T00:00:00Z")).toISOString().slice(0, 10), "2028-06-02");
  // Forward normalization, exactly like the runtime: never 2027-02-28.
  assert.equal(qualifiedUntilFor(new Date("2024-02-29T00:00:00Z")).toISOString().slice(0, 10), "2027-03-01");
  const outside = qualifiedUntilFor(new Date("2022-08-27T00:00:00Z"));
  assert.ok(outside.getTime() < new Date(NOW).getTime(), "a 2022 act is outside the window in 2026");
  const inside = qualifiedUntilFor(new Date("2025-06-02T00:00:00Z"));
  assert.ok(inside.getTime() > new Date(NOW).getTime());
  assert.equal(V3_POLICY.commercial_qualification.rolling_window_years, 3);
  assert.equal(V3_POLICY.commercial_qualification.ttl_seconds, null);
  assert.equal(V3_POLICY.commercial_qualification.grace_period_seconds, null);
  assert.deepEqual(V3_POLICY.commercial_qualification.qualifying_date_precedence, [...QUALIFYING_DATE_PRECEDENCE]);
  assert.deepEqual(V3_POLICY.commercial_qualification.excluded_date_fields, ["data_fim"]);
});

test("an expired qualification is a human exception, not a freshness problem", () => {
  const input = envelope("EXPIRED", 300);
  const truth = projectFounderOperatingTruth(input);
  assert.equal(truth.outbound_runway.transport.commercial_state.value, "EXPIRED");
  assert.equal(truth.outbound_runway.transport.source_health.value, "FRESH");
  assert.ok(truth.exceptions.some((item) => item.reason_group === "COMMERCIAL_AUTHORITY_EXPIRED"));
  assert.equal(truth.outbound_runway.runway.acquisition_plan_condition.value, ACQUISITION_PLAN_FRESH);
});

/* (d) The contracting body never qualifies. */

test("the Control Center never derives QUALIFIED and the policy refuses the contracting body", () => {
  for (const reported of ["BUYER", "CONTRATANTE", "ORGAO", "CONTRACTING_AUTHORITY", "SUPPLIER", "FRESH", ""]) {
    assert.equal(normalizeCommercialQualification(reported), "UNKNOWN", reported);
  }
  const block = V3_POLICY.commercial_qualification;
  assert.equal(block.qualifying_party_role, "SUPPLIER");
  assert.equal(block.contracting_body_never_qualifies, true);
  assert.deepEqual(block.forbidden_party_roles, ["BUYER", "CONTRACTING_AUTHORITY", "CONTRATANTE", "ORGAO"]);
  assert.ok(block.fail_closed_reason_codes.includes("commercial_qualification_party_role_invalid"));
  // A buyer-shaped payload reaches the founder as UNKNOWN, never as qualified.
  const truth = projectFounderOperatingTruth(envelope("CONTRATANTE", 300));
  assert.equal(truth.outbound_runway.transport.commercial_state.value, "UNKNOWN");
});

/* (e) Explicit revocation blocks. */

test("an explicitly revoked qualification blocks and opens a human exception", () => {
  const input = envelope("REVOKED", 300);
  const truth = projectFounderOperatingTruth(input);
  assert.equal(truth.outbound_runway.transport.commercial_state.value, "REVOKED");
  const exception = truth.exceptions.find((item) => item.reason_group === "COMMERCIAL_AUTHORITY_REVOKED");
  assert.ok(exception, "revocation must open a human exception");
  assert.equal(exception.owner, "outbound_owner");
  assert.equal(exception.severity, "high");
  assert.equal(V3_POLICY.revocation.explicit_deactivation_blocks_immediately, true);
  assert.equal(V3_POLICY.revocation.grace_period_seconds, null);
  assert.equal(V3_POLICY.revocation.time_alone_restores_nothing, true);
});

/* The published policy and this presentation layer agree. */

test("the v3 policy keeps source health outside the transport conjunction", () => {
  assert.equal(V3_POLICY.canonical_name, FIRST_TOUCH_ROUTING_V3);
  assert.equal(V3_POLICY.commercial_qualification.policy_version, COMMERCIAL_AUTHORITY_POLICY_V2);
  assert.equal(V3_POLICY.transport_authority.source_health_in_transport_conjunction, false);
  assert.equal(V3_POLICY.source_operational_health.is_transport_blocker, false);
  assert.equal(V3_POLICY.source_operational_health.presentation_class, "ACQUISITION_PLAN");
  assert.equal(V3_POLICY.source_operational_health.founder_readback_pt_br, ACQUISITION_PLAN_CONDITION);
  for (const forbidden of V3_POLICY.source_operational_health.forbidden_founder_readback_pt_br) {
    assert.ok(FORBIDDEN_SOURCE_HEALTH_READBACKS.includes(forbidden), forbidden);
  }
  for (const excluded of V3_POLICY.transport_conjunction.excluded_members) {
    assert.equal(V3_POLICY.transport_conjunction.members.includes(excluded), false, excluded);
  }
  assert.ok(V3_POLICY.transport_conjunction.members.includes("commercial_qualification_three_year_rule"));
  assert.equal(V3_POLICY.first_window_readiness.source_health_may_produce_a_blocker, false);
  assert.deepEqual(V3_POLICY.first_window_readiness.removed_blockers, [RETIRED_FRESHNESS_BLOCKER]);
  assert.ok(V3_POLICY.first_window_readiness.verdicts.includes("ARMED_FOR_NEXT_BUSINESS_WINDOW"));
  assert.ok(V3_POLICY.first_window_readiness.verdicts.includes("TRANSPORT_ACTIVE_IN_WINDOW"));
});
