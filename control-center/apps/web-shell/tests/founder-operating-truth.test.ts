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
            slots_next_24h: 30,
            slots_next_7d: 210,
            provider_errors: 0,
          },
          delegated_first_touch: {
            policy_version: "CFG-FIRST-TOUCH-ROUTING-v2",
            runtime_release_sha: "0123456789abcdef0123456789abcdef01234567",
            source_run_id: "run-current",
            queued_readback: 140,
            human_approved: 0,
            executor: "agent:first-touch-v2",
            commercial_authority: {
              source_run_id: "run-current",
              membership_hash: "mem-fixture",
              validated_at: "2026-08-26T02:00:00Z",
              valid_until: "2026-08-27T03:00:00Z",
              state: "CURRENT",
            },
            counts: { PREPARED: 180, QUEUED: 140, SENT: 20, HOLD: 8 },
            items: [{
              state: "QUEUED",
              source_run_id: "run-current",
              runtime_release_sha: "0123456789abcdef0123456789abcdef01234567",
              due_at: "2026-09-01T12:00:00Z",
            }],
          },
          working_overview: {
            reservoir_monitored: 1200,
            actionable_now: 1200,
            needs_contact: 1012,
            needs_review: 8,
            approved_scheduled: 140,
            watch_awaiting: 20,
            suppressed: 50,
            stale_context: 12,
            due_next_24h: 30,
            theoretical_slots_24h: 999,
            slots_next_24h: 30,
            slots_next_7d: 210,
            feed_age_seconds: 300,
            replenishment_state: "WAITING_FOR_EXTRA_CLI_REFRESH",
            stale_retired: 12,
            queue_fill_blocker: "WAITING_FOR_ELIGIBLE_BATCH",
          },
          outbound_outcomes: {
            attempted: 24,
            sent: 20,
            provider_accepted: 22,
            delivered: 18,
            replies: 3,
            bounces: 1,
            complaints: 0,
            suppressed: 50,
            provider_errors: 0,
          },
          mailbox_health: { healthy: 5, blocked: 1, unknown: 0 },
          overview: { exceptions: 8, replies: 3, bounces: 1, opt_outs: 0 },
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
        source: { system: "extra-cli", kind: "outbound-inventory", locator: "commercial-reservoir/current" },
        observed_at: "2026-08-26T02:54:00Z",
        freshness_status: "FRESH",
        payload: {
          current_feed: "full-national-commercial-reservoir",
          current_run: "run-current",
          target_confirmed: 2500,
          recipient_attributed: 1800,
          eligible_current: 1400,
          ready_reservoir: 1200,
          funnel_rows: [
            { key: "target_confirmed", count: 2500 },
            { key: "identity_safe", count: 1800 },
            { key: "warmbly_eligible", count: 1400 },
            { key: "email_send_ready", count: 1200 },
          ],
        },
      },
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
  assert.equal(truth.outbound.policy_version, "CFG-FIRST-TOUCH-ROUTING-v2");
  assert.equal(truth.outbound.source_run, "run-current");
  assert.equal(truth.outbound.queued, 140);
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
  assert.equal(truth.outbound_runway.transport.state.value, "PAUSED");
  assert.equal(truth.outbound_runway.stock.target_confirmed.value, 2500);
  assert.equal(truth.outbound_runway.stock.recipient_attributed.value, 1800);
  assert.equal(truth.outbound_runway.stock.eligible_current.value, 1400);
  assert.equal(truth.outbound_runway.stock.prepared.value, 348);
  assert.equal(truth.outbound_runway.stock.delegated_approved.value, 160);
  assert.equal(truth.outbound_runway.stock.human_approved.value, 0);
  assert.equal(truth.outbound_runway.stock.queued_reserved.value, 140);
  assert.equal(truth.outbound_runway.stock.sent.value, 20);
  assert.equal(truth.outbound_runway.stock.provider_accepted.value, 22);
  assert.equal(truth.outbound_runway.stock.delivered.value, 18);
  assert.equal(truth.outbound_runway.runway.estimated_days.value, 40);
  assert.equal(truth.outbound_runway.runway.estimated_days.source.system, "extra-cli+warmbly");
  assert.equal(truth.outbound_runway.runway.estimated_days.source.as_of, "2026-08-26T02:54:00Z");
  assert.equal(truth.outbound_runway.runway.slots_next_24h.value, 30);
  assert.equal(truth.outbound_runway.runway.slots_next_7d.value, 210);
  assert.equal(truth.outbound_runway.runway.reservoir_below_1000, false);
  assert.equal(truth.outbound_runway.integrity.source_run_match, "MATCH");
  assert.equal(truth.outbound_runway.transport.source_health.value, "FRESH");
  assert.equal(truth.outbound_runway.transport.commercial_state.value, "CURRENT");
  assert.ok(truth.exceptions.some((item) => item.bucket === "capacity_unknown"));
  assert.ok(truth.exceptions.some((item) => item.bucket === "payment_provider_ambiguity"));
  assert.ok(truth.primary_action);
  assert.equal(truth.primary_action.label, "Resolver blocker do refill");
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
  assert.equal(truth.outbound_runway.transport.state.value, "UNKNOWN");
  assert.equal(truth.outbound_runway.stock.target_confirmed.value, null);
  assert.equal(truth.outbound_runway.stock.queued_reserved.value, null);
  assert.equal(truth.outbound_runway.runway.estimated_days.value, null);
  assert.equal(truth.outbound_runway.runway.reservoir_below_1000, null);
  assert.equal(truth.outbound_runway.transport.source_health.value, "UNKNOWN");
  assert.equal(truth.outbound_runway.transport.commercial_state.value, "UNKNOWN");
  assert.equal(truth.outbound_runway.stock.hold_exceptions.value, null);
  assert.notEqual(truth.outbound_runway.stock.queued_reserved.value, 0);
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
  assert.equal(summary.founder_truth.primary_action?.label, "Resolver blocker do refill");
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
  assert.match(html, /data-outbound-runway="true"/);
  assert.match(html, /data-runway-group="transport"/);
  assert.match(html, /data-runway-metric="source-health"/);
  assert.match(html, /data-runway-metric="commercial-state"/);
  assert.match(html, /data-runway-group="stock"/);
  assert.match(html, /data-runway-group="runway"/);
  assert.match(html, /data-runway-group="health"/);
  assert.match(html, /data-runway-metric="provider-accepted"/);
  assert.match(html, /data-runway-metric="delivered"/);
  assert.match(html, /Dados PNCP/);
  assert.match(html, /Estoque comercial/);
  assert.match(html, />atual</);
  assert.match(html, /data-runway-metric="slots-next-24h"/);
  assert.doesNotMatch(html, /corrigir freshness/i);
  assert.match(html, />40 dias</);
  assert.match(html, /aguardando novo lote elegível/);
  assert.match(html, /href="#\/crescimento\?etapa=target_confirmed"/);
  assert.match(html, /href="#\/warmbly\/revisao\?filtro=queued"/);
  assert.doesNotMatch(html, /aprovar tudo/i);
  assert.equal((html.match(/data-runway-primary-action="true"/g) ?? []).length, 1);
  assert.equal((html.match(/class="runway-readback"/g) ?? []).length, 37);
});

test("impossible denominators fail closed instead of publishing a plausible zero", () => {
  const input = envelope();
  const observations = input.source_observations as Array<Record<string, unknown>>;
  const extra = observations.find((row) => (row.source as Record<string, unknown>).system === "extra-cli")!;
  const payload = extra.payload as Record<string, unknown>;
  payload.recipient_attributed = 2600;

  const truth = projectFounderOperatingTruth(input);
  assert.equal(truth.outbound_runway.integrity.state, "ERROR");
  assert.ok(truth.outbound_runway.integrity.reason_codes.includes("RECIPIENT_ATTRIBUTED_GT_TARGET_CONFIRMED"));
  assert.equal(truth.outbound_runway.stock.target_confirmed.value, null);
  assert.equal(truth.outbound_runway.stock.recipient_attributed.value, null);
  assert.equal(truth.outbound_runway.stock.target_confirmed.source.freshness, "ERROR");
  assert.equal(truth.primary_action?.label, "Resolver divergência do outbound");
});

test("source-run mismatch does not revoke a still-valid commercial binding or paint a single STALE", () => {
  const input = envelope();
  const observations = input.source_observations as Array<Record<string, unknown>>;
  const extra = observations.find((row) => (row.source as Record<string, unknown>).system === "extra-cli")!;
  (extra.payload as Record<string, unknown>).current_run = "run-other";
  extra.freshness_status = "STALE";
  (extra.payload as Record<string, unknown>).feed_age_seconds = 400000;

  const truth = projectFounderOperatingTruth(input);
  assert.equal(truth.outbound_runway.integrity.source_run_match, "MISMATCH");
  assert.equal(truth.outbound_runway.integrity.state, "OK");
  assert.equal(truth.outbound_runway.stock.queued_reserved.value, 140);
  assert.equal(truth.outbound_runway.transport.commercial_state.value, "CURRENT");
  assert.equal(truth.outbound_runway.transport.source_health.value, "STALE");
  assert.equal(truth.outbound_runway.runway.estimated_days.value, null);
  assert.notEqual(truth.primary_action?.label, "Resolver divergência do outbound");
  const html = renderHoje(composeHoje({
    generated_at: NOW,
    headline: "cockpit",
    priorities: [], incidents: [], clients: [], commercial: null, finance: null,
    engineering: null, infra: [], activities: [], operational_envelope: input,
  }));
  assert.match(html, />atual</);
  assert.doesNotMatch(html, /corrigir freshness/i);
});

test("theoretical capacity never becomes runway when real slots are absent", () => {
  const input = envelope();
  const commercial = (((input.snapshots as Record<string, unknown>).commercial as Record<string, unknown>).snapshot as Record<string, unknown>);
  const operations = commercial.operations as Record<string, unknown>;
  const working = operations.working_overview as Record<string, unknown>;
  const dispatch = operations.dispatch as Record<string, unknown>;
  delete working.slots_next_24h;
  delete working.slots_next_7d;
  delete dispatch.slots_next_24h;
  delete dispatch.slots_next_7d;
  working.theoretical_slots_24h = 999;

  const truth = projectFounderOperatingTruth(input);
  assert.equal(truth.outbound_runway.runway.slots_next_24h.value, null);
  assert.equal(truth.outbound_runway.runway.slots_next_7d.value, null);
  assert.equal(truth.outbound_runway.runway.estimated_days.value, null);
});

test("stale numeric sources stay unknown and are never rendered as zero", () => {
  const input = envelope();
  const commercial = (input.snapshots as Record<string, unknown>).commercial as Record<string, unknown>;
  commercial.freshness_status = "STALE";

  const truth = projectFounderOperatingTruth(input);
  assert.equal(truth.outbound_runway.transport.state.value, "UNKNOWN");
  assert.equal(truth.outbound_runway.stock.queued_reserved.value, null);
  assert.equal(truth.outbound_runway.health.provider_errors.value, null);
  assert.equal(truth.outbound_runway.stock.queued_reserved.source.freshness, "STALE");

  const observations = input.source_observations as Array<Record<string, unknown>>;
  const extra = observations.find((row) => (row.source as Record<string, unknown>).system === "extra-cli")!;
  extra.freshness_status = "ERROR";
  const extraErrorTruth = projectFounderOperatingTruth(input);
  assert.equal(extraErrorTruth.outbound_runway.stock.target_confirmed.value, null);
  assert.equal(extraErrorTruth.outbound_runway.runway.ready_reservoir.value, null);
  assert.equal(extraErrorTruth.outbound_runway.runway.reservoir_below_1000, null);
});

test("reservoir threshold and exception-only review are explicit", () => {
  const input = envelope();
  const observations = input.source_observations as Array<Record<string, unknown>>;
  const extra = observations.find((row) => (row.source as Record<string, unknown>).system === "extra-cli")!;
  (extra.payload as Record<string, unknown>).ready_reservoir = 999;
  const commercial = (((input.snapshots as Record<string, unknown>).commercial as Record<string, unknown>).snapshot as Record<string, unknown>);
  const operations = commercial.operations as Record<string, unknown>;
  (operations.working_overview as Record<string, unknown>).queue_fill_blocker = "NO_BLOCKER";

  const truth = projectFounderOperatingTruth(input);
  assert.equal(truth.outbound_runway.runway.reservoir_below_1000, true);
  assert.equal(truth.primary_action?.label, "Revisar 8 exceção(ões) outbound");
  assert.match(truth.primary_action?.reason ?? "", /Somente HOLD, NEEDS_REVIEW e EXCEPTION/);

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
    operational_envelope: input,
  });
  const html = renderHoje(view);
  assert.match(html, /reservoir abaixo de 1 mil/);
  assert.doesNotMatch(html, /aprovar tudo/i);
});

function firstTouchControl(input: Record<string, unknown>): Record<string, unknown> {
  const snapshots = input.snapshots as Record<string, Record<string, unknown>>;
  const commercial = snapshots.commercial!.snapshot as Record<string, unknown>;
  const operations = commercial.operations as Record<string, unknown>;
  return operations.delegated_first_touch as Record<string, unknown>;
}

function dropExtraObservation(input: Record<string, unknown>): void {
  const observations = input.source_observations as Array<Record<string, unknown>>;
  input.source_observations = observations.filter((row) => (row.source as Record<string, unknown>).system !== "extra-cli");
  const snapshots = input.snapshots as Record<string, Record<string, unknown>>;
  const pncp = snapshots.pncp!.snapshot as Record<string, unknown>;
  delete pncp.target_coverage;
}

/** Live production shape of GET /v1/confenge/first-touch/status, trimmed to the read fields. */
function withWarmblyControl(input: Record<string, unknown>, overrides: Record<string, unknown> = {}): void {
  const delegated = firstTouchControl(input);
  delegated.runway = { ready_reservoir_count: 880, runway_days: 4 };
  delegated.control = {
    prepared: 900,
    ready_reservoir: 1100,
    queued: 140,
    source: {
      run_id: "run-current",
      freshness_state: "fresh",
      target_membership_complete: true,
      target_membership_count: 2400,
      supplier_confirmed_count: 2400,
    },
    ...overrides,
  };
}

test("extra-cli keeps precedence over the Warmbly control block for the reservoir stocks", () => {
  const input = envelope();
  withWarmblyControl(input);

  const truth = projectFounderOperatingTruth(input);
  assert.equal(truth.outbound_runway.stock.target_confirmed.value, 2500);
  assert.equal(truth.outbound_runway.stock.target_confirmed.source.system, "extra-cli");
  assert.equal(truth.outbound_runway.runway.ready_reservoir.value, 1200);
  assert.equal(truth.outbound_runway.runway.ready_reservoir.source.system, "extra-cli");
  assert.equal(truth.outbound_runway.runway.ready_reservoir.href, "#/crescimento?etapa=ready_reservoir");
  assert.equal(truth.outbound_runway.runway.estimated_days.source.system, "extra-cli+warmbly");
  assert.equal(truth.data.target_coverage, "1/1");
});

test("Warmbly first-touch control fills the reservoir stocks only when extra-cli produced nothing", () => {
  const input = envelope();
  dropExtraObservation(input);
  withWarmblyControl(input);

  const truth = projectFounderOperatingTruth(input);
  // target_confirmed is deliberately NOT filled from Warmbly: target_membership_count is a
  // membership denominator, not this funnel stage. It stays extra-cli-only and therefore UNKNOWN.
  assert.equal(truth.outbound_runway.stock.target_confirmed.value, null);
  assert.equal(truth.outbound_runway.stock.target_confirmed.source.system, "extra-cli");
  assert.equal(truth.outbound_runway.runway.ready_reservoir.value, 1100);
  assert.equal(truth.outbound_runway.runway.ready_reservoir.source.system, "warmbly");
  assert.equal(truth.outbound_runway.runway.ready_reservoir.source.locator, "commercial/operations");
  // The drill-down follows the value too: extra-cli's growth view has no such stage to show.
  assert.equal(truth.outbound_runway.runway.ready_reservoir.href, "#/warmbly/revisao?etapa=ready_reservoir");
  assert.equal(truth.outbound_runway.runway.reservoir_below_1000, false);
  // The run reconciliation still gates the derived runway; the fallback does not bypass it.
  assert.equal(truth.outbound_runway.integrity.source_run_match, "MATCH");
  assert.equal(truth.outbound_runway.runway.estimated_days.value, 36.7);
  assert.equal(truth.outbound_runway.runway.estimated_days.source.system, "warmbly");
  // Nothing observed identity attribution or current eligibility, so both stay UNKNOWN.
  assert.equal(truth.outbound_runway.stock.recipient_attributed.value, null);
  assert.equal(truth.outbound_runway.stock.eligible_current.value, null);
  // A Warmbly-derived target never leaks into the extra-cli-attributed data block.
  assert.equal(truth.data.target_coverage, null);
});

test("runway.ready_reservoir_count backs the reservoir when control.ready_reservoir is absent", () => {
  const input = envelope();
  dropExtraObservation(input);
  withWarmblyControl(input);
  delete (firstTouchControl(input).control as Record<string, unknown>).ready_reservoir;

  const truth = projectFounderOperatingTruth(input);
  assert.equal(truth.outbound_runway.runway.ready_reservoir.value, 880);
  assert.equal(truth.outbound_runway.runway.ready_reservoir.source.system, "warmbly");
  assert.equal(truth.outbound_runway.runway.reservoir_below_1000, true);
});

test("both sources absent leaves the reservoir stocks UNKNOWN instead of zero", () => {
  const input = envelope();
  dropExtraObservation(input);

  const truth = projectFounderOperatingTruth(input);
  assert.equal(truth.outbound_runway.stock.target_confirmed.value, null);
  assert.equal(truth.outbound_runway.runway.ready_reservoir.value, null);
  assert.equal(truth.outbound_runway.runway.reservoir_below_1000, null);
  assert.equal(truth.outbound_runway.runway.estimated_days.value, null);
  assert.equal(truth.outbound_runway.stock.target_confirmed.source.system, "extra-cli");
});

test("a stale or errored Warmbly reading is never adopted as reservoir stock", () => {
  for (const freshness of ["STALE", "ERROR", "UNKNOWN"]) {
    const input = envelope();
    dropExtraObservation(input);
    withWarmblyControl(input);
    ((input.snapshots as Record<string, Record<string, unknown>>).commercial!).freshness_status = freshness;

    const truth = projectFounderOperatingTruth(input);
    assert.equal(truth.outbound_runway.stock.target_confirmed.value, null, freshness);
    assert.equal(truth.outbound_runway.runway.ready_reservoir.value, null, freshness);
    assert.equal(truth.outbound_runway.runway.reservoir_below_1000, null, freshness);
    assert.equal(truth.outbound_runway.runway.estimated_days.value, null, freshness);
    // The number was not adopted at all, so the fact keeps the extra-cli attribution it always had.
    assert.equal(truth.outbound_runway.stock.target_confirmed.source.system, "extra-cli", freshness);
  }
});

test("an incomplete target membership reporting zero stays UNKNOWN and never becomes zero", () => {
  const input = envelope();
  dropExtraObservation(input);
  withWarmblyControl(input, {
    source: {
      run_id: "run-current",
      freshness_state: "invalid",
      target_membership_complete: false,
      target_membership_count: 0,
      supplier_confirmed_count: 0,
    },
  });

  const truth = projectFounderOperatingTruth(input);
  assert.equal(truth.outbound_runway.stock.target_confirmed.value, null);
  assert.equal(truth.outbound_runway.stock.target_confirmed.source.system, "extra-cli");
  // The reservoir, which carries no completeness qualifier, is still adopted.
  assert.equal(truth.outbound_runway.runway.ready_reservoir.value, 1100);
});

test("a Warmbly-sourced reservoir does not bypass the monotonicity and run-match guards", () => {
  const mismatched = envelope();
  dropExtraObservation(mismatched);
  withWarmblyControl(mismatched);
  ((mismatched.snapshots as Record<string, Record<string, unknown>>).pncp!.snapshot as Record<string, unknown>).current_run = "run-other";

  const mismatchTruth = projectFounderOperatingTruth(mismatched);
  assert.equal(mismatchTruth.outbound_runway.integrity.source_run_match, "MISMATCH");
  assert.equal(mismatchTruth.outbound_runway.runway.ready_reservoir.value, 1100);
  assert.equal(mismatchTruth.outbound_runway.runway.ready_reservoir.source.freshness, "FRESH");
  assert.equal(mismatchTruth.outbound_runway.runway.estimated_days.value, null);

  const impossible = envelope();
  const observations = impossible.source_observations as Array<Record<string, unknown>>;
  const extra = observations.find((row) => (row.source as Record<string, unknown>).system === "extra-cli")!;
  const payload = extra.payload as Record<string, unknown>;
  // extra-cli publishes only the eligibility stage; the reservoir has to come from Warmbly.
  delete payload.ready_reservoir;
  (payload.funnel_rows as Array<Record<string, unknown>>).pop();
  payload.eligible_current = 10;
  withWarmblyControl(impossible);

  const impossibleTruth = projectFounderOperatingTruth(impossible);
  assert.ok(impossibleTruth.outbound_runway.integrity.reason_codes.includes("READY_RESERVOIR_GT_ELIGIBLE_CURRENT"));
  assert.equal(impossibleTruth.outbound_runway.integrity.state, "ERROR");
  assert.equal(impossibleTruth.outbound_runway.runway.ready_reservoir.value, null);
  assert.equal(impossibleTruth.outbound_runway.runway.ready_reservoir.source.freshness, "ERROR");
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

test("QUEUED comes only from queued_readback, never from dispatch.queued_approved", () => {
  const input = envelope();
  const delegated = firstTouchControl(input);
  delete delegated.queued_readback;
  const operations = ((input.snapshots as Record<string, Record<string, unknown>>).commercial!.snapshot as Record<string, unknown>).operations as Record<string, unknown>;
  (operations.dispatch as Record<string, unknown>).queued_approved = 99;
  const truth = projectFounderOperatingTruth(input);
  assert.equal(truth.outbound_runway.stock.queued_reserved.value, null);
  assert.equal(truth.outbound.queued, null);
});

test("expired commercial authority is not a single STALE and is a human exception", () => {
  const input = envelope();
  const delegated = firstTouchControl(input);
  delegated.commercial_authority = {
    source_run_id: "run-current",
    membership_hash: "mem-fixture",
    validated_at: "2026-08-18T03:00:00Z",
    valid_until: "2026-08-19T03:00:00Z",
    state: "EXPIRED",
  };
  const truth = projectFounderOperatingTruth(input);
  assert.equal(truth.outbound_runway.transport.commercial_state.value, "EXPIRED");
  assert.equal(truth.outbound_runway.transport.source_health.value, "FRESH");
  assert.equal(truth.outbound_runway.transport.commercial_until.value, "2026-08-19T03:00:00Z");
  assert.ok(truth.exceptions.some((item) => item.reason_group === "COMMERCIAL_AUTHORITY_EXPIRED"));
  assert.equal(truth.exceptions.some((item) => /corrigir freshness/i.test(item.next_action) || /corrigir freshness/i.test(item.reason)), false);
  const html = renderHoje(composeHoje({
    generated_at: NOW,
    headline: "cockpit",
    priorities: [], incidents: [], clients: [], commercial: null, finance: null,
    engineering: null, infra: [], activities: [], operational_envelope: input,
  }));
  assert.match(html, />expirada</);
  assert.match(html, /estoque expirado/);
  assert.doesNotMatch(html, /corrigir freshness/i);
});

test("producer DEGRADED and FROZEN commercial states stay visible with validade", () => {
  for (const [state, htmlToken] of [["DEGRADED", "degradada"], ["FROZEN_FOR_NEW_ADMISSION", "congelada"]] as const) {
    const input = envelope();
    firstTouchControl(input).commercial_authority = {
      source_run_id: "run-bound",
      validated_at: "2026-08-24T03:00:00Z",
      valid_until: "2026-08-31T03:00:00Z",
      state,
    };
    const truth = projectFounderOperatingTruth(input);
    assert.notEqual(truth.outbound_runway.transport.commercial_state.value, "UNKNOWN", state);
    assert.equal(
      truth.outbound_runway.transport.commercial_state.value,
      state === "FROZEN_FOR_NEW_ADMISSION" ? "FROZEN" : state,
      state,
    );
    assert.equal(truth.outbound_runway.transport.commercial_until.value, "2026-08-31T03:00:00Z", state);
    if (state === "FROZEN_FOR_NEW_ADMISSION") {
      assert.ok(truth.exceptions.some((item) => item.reason_group === "COMMERCIAL_AUTHORITY_FROZEN"));
    }
    const html = renderHoje(composeHoje({
      generated_at: NOW,
      headline: "cockpit",
      priorities: [], incidents: [], clients: [], commercial: null, finance: null,
      engineering: null, infra: [], activities: [], operational_envelope: input,
    }));
    assert.match(html, new RegExp(`>${htmlToken}<`));
    assert.doesNotMatch(html, />${state}</);
  }
});

test("pause actor/source and kill switch stay UNKNOWN when Warmbly omits them", () => {
  const truth = projectFounderOperatingTruth(envelope());
  assert.match(truth.outbound_runway.transport.pause.value ?? "", /UNKNOWN/);
  assert.equal(truth.outbound_runway.transport.kill_switch.value, "UNKNOWN");
  const html = renderHoje(composeHoje({
    generated_at: NOW,
    headline: "cockpit",
    priorities: [], incidents: [], clients: [], commercial: null, finance: null,
    engineering: null, infra: [], activities: [], operational_envelope: envelope(),
  }));
  assert.match(html, /data-runway-metric="pause"/);
  assert.match(html, /data-runway-metric="kill-switch"/);
  assert.match(html, /desconhecido · desconhecido/);
});

test("named exception reason groups from producer codes stay on the exception recorte", () => {
  const input = envelope();
  const commercial = (((input.snapshots as Record<string, unknown>).commercial as Record<string, unknown>).snapshot as Record<string, unknown>);
  const operations = commercial.operations as Record<string, unknown>;
  operations.exceptions = [
    { id: "e1", reason_group: "RECIPIENT_EXPIRED", reason: "destinatário caiu", owner: "outbound_owner" },
    { id: "e2", reason_codes: ["MEMBERSHIP_LEAVE_PROVEN"], reason: "saiu do membership", owner: "outbound_owner" },
    { id: "e3", reason_group: "READBACK_UNKNOWN", reason: "readback não confirmou", owner: "outbound_owner" },
  ];
  const truth = projectFounderOperatingTruth(input);
  assert.ok(truth.exceptions.some((item) => item.reason_group === "RECIPIENT_EXPIRED"));
  assert.ok(truth.exceptions.some((item) => item.reason_group === "MEMBERSHIP_DRIFT"));
  assert.ok(truth.exceptions.some((item) => item.reason_group === "READBACK_UNKNOWN"));
  const html = renderHoje(composeHoje({
    generated_at: NOW,
    headline: "cockpit",
    priorities: [], incidents: [], clients: [], commercial: null, finance: null,
    engineering: null, infra: [], activities: [], operational_envelope: input,
  }));
  assert.match(html, /data-reason-group="RECIPIENT_EXPIRED"/);
  assert.match(html, /data-reason-group="MEMBERSHIP_DRIFT"/);
  assert.match(html, /data-reason-group="READBACK_UNKNOWN"/);
});

test("SOURCE_HEALTH_DEGRADED is not forced into the human exception queue", () => {
  const input = envelope();
  const observations = input.source_observations as Array<Record<string, unknown>>;
  const extra = observations.find((row) => (row.source as Record<string, unknown>).system === "extra-cli")!;
  extra.freshness_status = "STALE";
  (extra.payload as Record<string, unknown>).feed_age_seconds = 200000;
  const truth = projectFounderOperatingTruth(input);
  assert.equal(truth.outbound_runway.transport.source_health.value, "DEGRADED");
  assert.equal(truth.outbound_runway.transport.commercial_state.value, "CURRENT");
  assert.equal(truth.exceptions.some((item) => item.reason_group === "SOURCE_HEALTH_DEGRADED"), false);
  const html = renderHoje(composeHoje({
    generated_at: NOW,
    headline: "cockpit",
    priorities: [], incidents: [], clients: [], commercial: null, finance: null,
    engineering: null, infra: [], activities: [], operational_envelope: input,
  }));
  assert.match(html, />degradada</);
  assert.match(html, />atual</);
});

test("unknown policy version stays unknown and does not look like v2", () => {
  const input = envelope();
  firstTouchControl(input).policy_version = "CFG-FIRST-TOUCH-ROUTING-v9";
  const truth = projectFounderOperatingTruth(input);
  assert.equal(truth.outbound.policy_version, "CFG-FIRST-TOUCH-ROUTING-v9");
  const html = renderHoje(composeHoje({
    generated_at: NOW,
    headline: "cockpit",
    priorities: [], incidents: [], clients: [], commercial: null, finance: null,
    engineering: null, infra: [], activities: [], operational_envelope: input,
  }));
  assert.match(html, /CFG-FIRST-TOUCH-ROUTING-v9/);
});

