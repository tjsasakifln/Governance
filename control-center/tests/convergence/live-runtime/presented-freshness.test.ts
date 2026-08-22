/**
 * Capability proof for the `stale data mostrado como saudável` evaluator as it
 * is wired by the live-runtime snapshot.
 *
 * The evaluator is only an oracle if the payload the live snapshot builds can
 * actually make it say `fail`. These tests drive the real collector over real
 * cockpit view models and assert both directions: a stale-but-healthy page
 * fails, an honestly-labelled page passes.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateStaleDataShownAsHealthy } from "../../../qa/src/index.ts";
import type { DestinationPage } from "../../../apps/web-shell/src/adapters/contract.ts";
import type { HojeViewModel } from "../../../apps/web-shell/src/hoje-compose.ts";
import type { Provenance, ServiceHealth, SourceRef } from "../../../apps/web-shell/src/types.ts";
import { collectPresentedFreshness } from "./presented-freshness.ts";

const AS_OF = "2026-08-20T15:00:00.000Z";
const SOURCE: SourceRef = { system: "collector", kind: "host-health", locator: "infrastructure/hosts" };

function provenance(freshness: Provenance["freshness_status"], observedAt: string): Provenance {
  return { source: SOURCE, observed_at: observedAt, freshness_status: freshness, confidence: 0.9 };
}

function serviceHealth(
  status: ServiceHealth["status"],
  prov: Provenance,
  extra: Partial<ServiceHealth> = {},
): ServiceHealth {
  return {
    schema_version: "control-center.service-health.v1",
    id: "cc:service-health:edge",
    scope: "infrastructure",
    service_name: "edge",
    status,
    provenance: prov,
    checked_at: prov.observed_at,
    ...extra,
  };
}

function page(overrides: Partial<DestinationPage>): DestinationPage {
  return {
    id: "infra",
    label: "Infra",
    scope: "infrastructure",
    generated_at: AS_OF,
    operator: { kind: "human", id: "founder-local" },
    headline: "infra",
    attention: [],
    priorities: [],
    ...overrides,
  };
}

function evaluate(pages: DestinationPage[]) {
  const records = pages.flatMap((item) => collectPresentedFreshness(item));
  return { records, verdict: evaluateStaleDataShownAsHealthy({ as_of: AS_OF, records }) };
}

test("a STALE service still painted 'healthy' makes the live gate check fail", () => {
  const { records, verdict } = evaluate([
    page({ health: [serviceHealth("healthy", provenance("STALE", "2026-08-18T12:00:00.000Z"))] }),
  ]);
  const row = records.find((r) => r.id.endsWith(":health:cc:service-health:edge"));
  assert.ok(row, "collector must emit a record for the rendered health card");
  assert.equal(row.freshness_status, "STALE");
  assert.equal(row.health_status, "healthy", "health card renders its status pill verbatim");
  assert.notEqual(
    row.presented_as,
    row.health_status,
    "presented_as and health_status must carry independent signals",
  );
  assert.equal(verdict.state, "fail", verdict.reason);
  assert.deepEqual(verdict.evidence.offender_ids, [row.id]);
});

test("an UNKNOWN-freshness service reported 'ok' on a sub-check fails too", () => {
  const { verdict } = evaluate([
    page({
      health: [
        serviceHealth("degraded", provenance("UNKNOWN", "2026-08-20T14:50:00.000Z"), {
          http: { status: "ok", detail: "200" },
        }),
      ],
    }),
  ]);
  assert.equal(verdict.state, "fail", verdict.reason);
  assert.deepEqual(verdict.evidence.offender_ids, ["ui:infra:health-http:cc:service-health:edge"]);
});

test("a FRESH observation older than its window and painted healthy fails", () => {
  const stale: Provenance = {
    ...provenance("FRESH", "2026-08-20T10:00:00.000Z"),
    freshness_window_seconds: 1800,
  };
  const { verdict } = evaluate([page({ health: [serviceHealth("healthy", stale)] })]);
  assert.equal(verdict.state, "fail", verdict.reason);
});

test("a Hoje row painted green while not FRESH fails", () => {
  const hoje: HojeViewModel = {
    schema_version: "control-center.hoje-view.v1",
    generated_at: AS_OF,
    headline: "hoje",
    sections: [
      {
        id: "incidents",
        title: "Incidentes, blockers e riscos.",
        compressed: false,
        compressed_summary: null,
        shortcuts: [],
        rows: [
          {
            id: "cc:attention-item:edge-down",
            title: "edge",
            summary: "edge",
            source: SOURCE,
            observed_at: "2026-08-18T12:00:00.000Z",
            observed_at_local: "18/08/2026 09:00",
            freshness_status: "STALE",
            // the bug this guards: an untrusted row wearing the healthy tone
            freshness_tone: "green",
            confidence: 0.9,
          },
        ],
      },
    ],
    charts_emitted: false,
  };
  const { verdict } = evaluate([page({ id: "hoje", hoje })]);
  assert.equal(verdict.state, "fail", verdict.reason);
  assert.deepEqual(verdict.evidence.offender_ids, ["ui:hoje:hoje-incidents:cc:attention-item:edge-down"]);
});

test("honest labelling passes: stale is shown as degraded, fresh is shown as healthy", () => {
  const { records, verdict } = evaluate([
    page({ health: [serviceHealth("degraded", provenance("STALE", "2026-08-18T12:00:00.000Z"))] }),
    page({
      id: "financeiro",
      health: [serviceHealth("healthy", provenance("FRESH", "2026-08-20T14:50:00.000Z"))],
    }),
  ]);
  assert.equal(verdict.state, "pass", verdict.reason);
  assert.equal(verdict.evidence.inspected, records.length);
});

test("the previous wiring — freshness echoed into both fields — could not fail", () => {
  // Regression guard. This is the payload shape the snapshot used to build; it
  // is kept here only to show why the detector was blind.
  const blind = [
    {
      id: "ui:infrastructure/hosts",
      freshness_status: "STALE",
      observed_at: "2026-08-18T12:00:00.000Z",
      freshness_window_seconds: 86400,
      presented_as: "STALE",
      health_status: "STALE",
    },
  ];
  assert.equal(evaluateStaleDataShownAsHealthy({ as_of: AS_OF, records: blind }).state, "pass");

  const wired = collectPresentedFreshness(
    page({ health: [serviceHealth("healthy", provenance("STALE", "2026-08-18T12:00:00.000Z"))] }),
  );
  assert.equal(evaluateStaleDataShownAsHealthy({ as_of: AS_OF, records: wired }).state, "fail");
});
