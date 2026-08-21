import assert from "node:assert/strict";
import { test } from "node:test";
import { createMockAdapter } from "../src/adapters/index";
import { mount, createMemoryRuntime, paintShell } from "../src/app";
import {
  HOJE_SECTION_IDS,
  HOJE_SECTION_TITLES,
  assertNoGreenForUntrusted,
  composeHoje,
  hojeHasUntrustedGreen,
} from "../src/hoje-compose";
import {
  ATTENTION_FIXTURES,
  CLIENT_FIXTURES,
  COMMERCIAL_SNAPSHOT,
  ENGINEERING_SNAPSHOT,
  FINANCE_SNAPSHOT,
  HEALTH_FIXTURES,
  AGENT_ACTIVITY_FIXTURES,
  PRIORITY_FIXTURES,
} from "../src/fixtures/catalog";
import { httpAdapterFor } from "./helpers";
import { hasChatComposer, hasMutationControls, hasMcpNav, hasIntranetPath } from "../src/ui/render";

function sampleInput() {
  return {
    generated_at: "2026-08-20T18:00:00Z",
    headline: "cockpit",
    priorities: PRIORITY_FIXTURES,
    incidents: ATTENTION_FIXTURES,
    clients: CLIENT_FIXTURES,
    commercial: COMMERCIAL_SNAPSHOT,
    finance: FINANCE_SNAPSHOT,
    engineering: ENGINEERING_SNAPSHOT,
    infra: HEALTH_FIXTURES,
    activities: AGENT_ACTIVITY_FIXTURES,
  };
}

test("Hoje compose emits the eight section titles in criterion-2 order with ≤3 priorities", () => {
  const view = composeHoje(sampleInput());
  assert.equal(view.sections.length, 8);
  assert.deepEqual(
    view.sections.map((s) => s.title),
    [...HOJE_SECTION_TITLES],
  );
  assert.deepEqual(
    view.sections.map((s) => s.id),
    [...HOJE_SECTION_IDS],
  );
  assert.ok(view.sections[0]!.rows.length <= 3);
  assert.equal(view.charts_emitted, false);
  assert.equal(hojeHasUntrustedGreen(view), false);
  assertNoGreenForUntrusted(view);
});

test("exceptions are expanded and healthy KPIs are compressed", () => {
  const view = composeHoje(sampleInput());
  const byId = Object.fromEntries(view.sections.map((s) => [s.id, s]));
  assert.equal(byId.commercial?.compressed, false);
  assert.equal(byId.finance?.compressed, false);
  assert.equal(byId.engineering?.compressed, false);
  assert.equal(byId.incidents?.compressed, false);
  assert.equal(byId.clients?.compressed, false);
  const healthy = composeHoje({
    ...sampleInput(),
    incidents: [],
    clients: CLIENT_FIXTURES.filter((c) => c.lifecycle === "active"),
    commercial: {
      ...COMMERCIAL_SNAPSHOT,
      inbound_unread_count: 0,
      at_risk_client_count: 0,
      aging_count: 0,
      stalled_count: 0,
      missing_next_action_count: 0,
      offer_version_drift: { count: 0 },
    },
    finance: {
      ...FINANCE_SNAPSHOT,
      overdue: { amount_cents: 0, currency: "BRL" },
      receivables_overdue: { amount_cents: 0, currency: "BRL" },
      chargebacks: { amount_cents: 0, currency: "BRL" },
      provenance: { ...FINANCE_SNAPSHOT.provenance, freshness_status: "FRESH" },
    },
    engineering: {
      ...ENGINEERING_SNAPSHOT,
      failing_check_count: 0,
      open_incident_count: 0,
      p0_count: 0,
      p1_count: 0,
      blockers: [],
    },
    infra: HEALTH_FIXTURES.filter((s) => s.status === "healthy" && s.provenance.freshness_status === "FRESH"),
    activities: [],
    priorities: [],
  });
  assert.equal(healthy.sections.find((s) => s.id === "commercial")?.compressed, true);
  assert.equal(healthy.sections.find((s) => s.id === "finance")?.compressed, true);
  assert.equal(healthy.sections.find((s) => s.id === "engineering")?.compressed, true);
  assert.match(healthy.sections.find((s) => s.id === "commercial")?.compressed_summary ?? "", /ignorar/);
});

test("mounted Hoje HTML has the eight titles in order, no chart/KPI wall/MCP/intranet", () => {
  const root = { innerHTML: "" };
  const runtime = createMemoryRuntime("#/hoje");
  const handle = mount(root, createMockAdapter(), runtime);
  try {
    const titles = HOJE_SECTION_TITLES.map((title) => root.innerHTML.indexOf(title));
    for (let i = 0; i < titles.length; i += 1) {
      assert.ok(titles[i]! >= 0, `missing ${HOJE_SECTION_TITLES[i]}`);
      if (i > 0) assert.ok(titles[i]! > titles[i - 1]!, "section order");
    }
    assert.match(root.innerHTML, /data-compressed="false"/);
    assert.match(root.innerHTML, /data-compressed="true"|data-compressed="false"/);
    assert.doesNotMatch(root.innerHTML, /<canvas/i);
    assert.doesNotMatch(root.innerHTML, /data-chart|kpi-wall|chart\.js/i);
    assert.equal(hasChatComposer(root.innerHTML), false);
    assert.equal(hasMutationControls(root.innerHTML), false);
    assert.equal(hasMcpNav(root.innerHTML), false);
    assert.equal(hasIntranetPath(root.innerHTML), false);
    const ranks = [...root.innerHTML.matchAll(/data-rank="(\d+)"/g)].map((m) => Number(m[1]));
    assert.ok(ranks.length <= 3);
    assert.match(root.innerHTML, /data-shortcut-form="decision"/);
    assert.match(root.innerHTML, /data-shortcut-form="nota"/);
    assert.match(root.innerHTML, /data-shortcut-form="risco"/);
    assert.match(root.innerHTML, /data-shortcut-form="hipotese"/);
    assert.match(root.innerHTML, /data-write-path="\/v1\/directives"/);
  } finally {
    handle.unmount();
  }
});

test("partial-outage payload keeps ERROR out of the green tone", () => {
  const view = composeHoje({
    ...sampleInput(),
    infra: [
      {
        ...HEALTH_FIXTURES[2]!,
        status: "healthy",
        provenance: { ...HEALTH_FIXTURES[2]!.provenance, freshness_status: "FRESH" },
      },
      {
        ...HEALTH_FIXTURES[0]!,
        status: "unknown",
        provenance: { ...HEALTH_FIXTURES[0]!.provenance, freshness_status: "ERROR" },
        partial_outage: true,
      },
    ],
  });
  const errorRows = view.sections.flatMap((s) => s.rows).filter((r) => r.freshness_status === "ERROR");
  assert.ok(errorRows.length > 0);
  for (const row of errorRows) {
    assert.notEqual(row.freshness_tone, "green");
  }
  const fresh = view.sections.flatMap((s) => s.rows).filter((r) => r.freshness_status === "FRESH");
  assert.ok(fresh.length > 0);
  assertNoGreenForUntrusted(view);
});

test("HTTP Hoje compose uses injected frozen-path payloads, not /v1/context", async () => {
  const calls: string[] = [];
  const { adapter } = httpAdapterFor(undefined, calls);
  const root = { innerHTML: "" };
  paintShell(root, adapter, "#/hoje");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(root.innerHTML, /Se eu só puder fazer 3 coisas hoje\./);
  assert.match(root.innerHTML, /Incidentes, blockers e riscos\./);
  assert.doesNotMatch(calls.join("\n"), /\/v1\/context/);
  assert.match(calls.join("\n"), /\/v1\/today/);
  assert.match(calls.join("\n"), /\/v1\/attention/);
  assert.match(calls.join("\n"), /\/v1\/operational-snapshots/);
  assert.match(calls.join("\n"), /\/v1\/agent-activities/);
});

test("operational GET /v1/today.today paints .priority from ranked items, not recommended_actions", async () => {
  const router = (url: string) => {
    const path = url.split("?")[0] ?? url;
    if (path.endsWith("/v1/today")) {
      return {
        schema_version: "control-center.operational-envelope.v1",
        scope: "company",
        generated_at: "2026-08-20T12:00:00.000Z",
        freshness_status: "STALE",
        confidence: 0.4,
        today: [
          {
            id: "cc:attention-item:open-incident",
            rank: 1,
            title: "Fechar o incidente aberto",
            reason: "Kill-rule from an open incident.",
            scope: "company",
            horizon: "today",
            provenance: {
              source: { system: "github", kind: "repo-read", locator: "engineering/company" },
              observed_at: "2026-08-20T11:30:00.000Z",
              freshness_status: "STALE",
              confidence: 0.4,
            },
          },
        ],
      };
    }
    if (path.endsWith("/v1/attention")) return { items: [] };
    if (path.endsWith("/v1/operational-snapshots")) return { snapshots: {} };
    if (path.endsWith("/v1/agent-activities")) return { items: [] };
    return undefined;
  };
  const { adapter } = httpAdapterFor(router);
  const root = { innerHTML: "" };
  paintShell(root, adapter, "#/hoje");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(root.innerHTML, /class="card priority"/);
  assert.match(root.innerHTML, /Fechar o incidente aberto/);
  assert.doesNotMatch(root.innerHTML, /Nenhuma ação recomendada/);
});
