import assert from "node:assert/strict";
import { test } from "node:test";
import { projectFounderOperatingTruth } from "../src/founder-operating-truth";
import { summarizeDomains } from "../src/hoje-domains";
import { renderHoje } from "../src/ui/hoje";
import { composeHoje } from "../src/hoje-compose";

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

function envelope(): Record<string, unknown> {
  return {
    schema_version: "control-center.operational-envelope.v1",
    scope: "company",
    generated_at: NOW,
    freshness_status: "FRESH",
    confidence: 1,
    snapshots: {
      commercial: slot("commercial", "warmbly", {
        operations: {
          dispatch: {
            state: "PAUSED",
            observed: true,
            queued_approved: 1,
            sent_today: 0,
            daily_limit: 10,
            transport_health: "PAUSED_BY_KILL_SWITCH",
          },
          delegated_first_touch: {
            policy_version: "CFG-FIRST-TOUCH-ROUTING-v1",
            queued_readback: 1,
            items: [{ state: "QUEUED", source_run_id: "run-current", due_at: "2026-08-26T12:00:00Z" }],
          },
          overview: { exceptions: 1, replies: 0, bounces: 0, opt_outs: 0 },
          delivery: { active_work_orders: 0, exceptions: 0 },
          capacity: {
            policy_ceiling: 50,
            staffed_capacity_state: "UNKNOWN",
            staffed_capacity: null,
            committed: null,
            available: null,
            freshness: "UNKNOWN",
            admission: "UNKNOWN",
            source_ref: "commercial/authority/authority-overlay.v2.json",
          },
          governance: {
            checkout_gate: "BLOCKED",
            asaas_gate: "MISSING",
            authority_ref: "commercial/authority/authority-overlay.v2.json",
          },
        },
      }),
      finance: slot("finance", "asaas", { exception_count: 1 }),
      clients: slot("clients", "warmbly", {}),
      engineering: slot("engineering", "github", {}),
      infrastructure: slot("infrastructure", "collector", { status: "healthy", services: [] }),
      pncp: slot("pncp", "extra-cli", {
        current_feed: "pncp-current",
        current_run: "run-current",
        target_coverage: { covered: 1, total: 1 },
      }),
    },
    attention_now: [],
    today: [],
    source_observations: [
      {
        source: { system: "web-cfg", kind: "deploy-read", locator: "public/current" },
        observed_at: "2026-08-26T02:56:00Z",
        freshness_status: "FRESH",
        payload: {
          deploy_identity: "41cc328681507159ffdc12417d49e7474e2770a4",
          lead_sla_state: "UNKNOWN",
          gsc_readiness: "BLOCKED_GAPS",
          public_surface_health: "HEALTHY_200",
        },
      },
    ],
  };
}

test("first viewport projects the five founder questions without hiding UNKNOWN", () => {
  const truth = projectFounderOperatingTruth(envelope());
  assert.equal(truth.outbound.state, "PAUSED");
  assert.equal(truth.outbound.policy_version, "CFG-FIRST-TOUCH-ROUTING-v1");
  assert.equal(truth.outbound.source_run, "run-current");
  assert.equal(truth.outbound.queued, 1);
  assert.equal(truth.outbound.sends_today, 0);
  assert.equal(truth.data.target_coverage, "1/1");
  assert.equal(truth.inbound_web.gsc_readiness, "BLOCKED_GAPS");
  assert.equal(truth.delivery_finance.policy_ceiling, 50);
  assert.equal(truth.delivery_finance.staffed_capacity, null);
  assert.equal(truth.delivery_finance.staffed_capacity_state, "UNKNOWN");
  assert.equal(truth.delivery_finance.available, null);
  assert.equal(truth.delivery_finance.admission, "UNKNOWN");
  assert.equal(truth.delivery_finance.checkout_gate, "BLOCKED");
  assert.equal(truth.delivery_finance.asaas_gate, "MISSING");
  assert.ok(truth.exceptions.some((item) => item.bucket === "capacity_unknown"));
  assert.ok(truth.exceptions.some((item) => item.bucket === "payment_provider_ambiguity"));
  assert.ok(truth.primary_action);
  assert.equal(truth.primary_action.owner, "delivery_owner");
});

test("missing observations remain UNKNOWN and never become zero or healthy", () => {
  const truth = projectFounderOperatingTruth(null);
  assert.equal(truth.outbound.state, "UNKNOWN");
  assert.equal(truth.outbound.queued, null);
  assert.equal(truth.outbound.sends_today, null);
  assert.equal(truth.data.current_run, null);
  assert.equal(truth.inbound_web.public_surface_health, null);
  assert.equal(truth.delivery_finance.staffed_capacity_state, "UNKNOWN");
  assert.equal(truth.delivery_finance.active_work_orders, null);
  assert.equal(truth.delivery_finance.admission, "UNKNOWN");
});

test("Hoje renders one primary action and the complete exception evidence fields", () => {
  const summary = summarizeDomains(envelope());
  const view = composeHoje({
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
    operational_envelope: envelope(),
  });
  const html = renderHoje(view);
  assert.equal(summary.founder_truth.primary_action?.owner, "delivery_owner");
  assert.match(html, /data-founder-operating-truth="true"/);
  assert.match(html, /data-primary-action-count="1"/);
  for (const domain of ["outbound", "data", "inbound-web", "delivery-finance", "next-human-action"]) {
    assert.match(html, new RegExp(`data-morning-domain="${domain}"`));
  }
  assert.match(html, /Teto comercial \(não staffed\)/);
  assert.match(html, /Capacidade staffed/);
  assert.match(html, /Comprometido \(Work Orders\)/);
  assert.match(html, /desconhecid[oa]/i);
  assert.match(html, /data-(?:outbound|capacity)-state="UNKNOWN"/);
  assert.match(html, /Owner/);
  assert.match(html, /Idade/);
  assert.match(html, /Evidência/);
  assert.match(html, /freshness/i);
});

test("capacity v2 stays a read-only projection and exposes deadline blockers in the first viewport", () => {
  const value = envelope();
  const snapshots = value.snapshots as Record<string, Record<string, unknown>>;
  const commercial = snapshots.commercial!.snapshot as Record<string, unknown>;
  const operations = commercial.operations as Record<string, unknown>;
  operations.capacity = {
    schema_version: "confenge.capacity_projection.v2",
    policy_ceiling: 50,
    staffed_capacity_state: "KNOWN",
    staffed_capacity: 1,
    committed: 1,
    held: 0,
    available: 0,
    freshness: "FRESH",
    admission: "CANNOT_ACCEPT",
    deliverable_id: "CFG-DIAG-EXP-v1",
    deliverable_version: "v1",
    requested_deadline: "2026-08-27",
    deadline_risk: "INFEASIBLE",
    blockers: [{
      code: "REQUESTED_DEADLINE_INFEASIBLE",
      next_action: "Negociar prazo posterior à primeira data viável ou recusar a admissão.",
    }],
    next_action: "Negociar prazo posterior à primeira data viável ou recusar a admissão.",
  };
  const truth = projectFounderOperatingTruth(value);
  assert.equal(truth.delivery_finance.policy_ceiling, 50);
  assert.equal(truth.delivery_finance.staffed_capacity, 1);
  assert.equal(truth.delivery_finance.committed, 1);
  assert.equal(truth.delivery_finance.available, 0);
  assert.equal(truth.delivery_finance.deadline_risk, "INFEASIBLE");
  assert.deepEqual(truth.delivery_finance.blockers, ["Negociar prazo posterior à primeira data viável ou recusar a admissão."]);

  const html = renderHoje(composeHoje({
    generated_at: NOW,
    headline: "cockpit",
    priorities: [], incidents: [], clients: [], commercial: null, finance: null,
    engineering: null, infra: [], activities: [], operational_envelope: value,
  }));
  assert.match(html, /CFG-DIAG-EXP-v1/);
  assert.match(html, /Negociar prazo posterior à primeira data viável/);
  assert.match(html, /Risco de prazo/);
  assert.match(html, /inviável/);
  assert.doesNotMatch(html, /REQUESTED_DEADLINE_INFEASIBLE/);
});
