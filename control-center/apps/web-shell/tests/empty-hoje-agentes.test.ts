import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryRuntime, mount } from "../src/app";
import { pageIsEmpty } from "../src/page";
import { HOJE_SECTION_IDS, HOJE_SECTION_TITLES } from "../src/hoje-compose";
import { httpAdapterFor, readContractFixture } from "./helpers";

async function waitSettled(root: { innerHTML: string }): Promise<void> {
  for (let i = 0; i < 80; i += 1) {
    if (
      root.innerHTML.includes("data-view-state=") &&
      !root.innerHTML.includes('data-view-state="loading"')
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`view never settled: ${root.innerHTML.slice(0, 200)}`);
}

function emptyDayRouter(): (url: string) => unknown {
  const emptyToday = {
    generated_at: "2026-08-20T18:00:00Z",
    headline: "Nada exige atenção.",
    recommended_actions: [],
    incidents: [],
    clients: [],
    commercial: null,
    finance: null,
    engineering: null,
    infra: [],
    agent_activity: [],
  };
  return (url: string) => {
    const path = url.split("?")[0] ?? url;
    if (path.endsWith("/v1/today")) return emptyToday;
    if (path.endsWith("/v1/attention") || path.endsWith("/v1/agent-activities")) {
      return { items: [] };
    }
    if (path.endsWith("/v1/operational-snapshots")) {
      return { attention_items: [], top_priorities: [], health: [] };
    }
    return undefined;
  };
}

function agentesRouter(): (url: string) => unknown {
  const partial = readContractFixture("agent-activity") as Record<string, unknown>;
  const observed = {
    source: { system: "collector", kind: "report", locator: "agent-activity/ledger" },
    observed_at: "2026-08-20T18:10:00Z",
    freshness_status: "FRESH",
    confidence: 0.9,
  };
  const items = [
    { ...partial, id: "cc:agent-activity:running", status: "running", finished_at: null, provenance: { ...observed, freshness_status: "STALE" } },
    { ...partial, id: "cc:agent-activity:done", status: "done" },
    { ...partial, id: "cc:agent-activity:partial", status: "partial" },
    { ...partial, id: "cc:agent-activity:blocked", status: "blocked" },
    { ...partial, id: "cc:agent-activity:failed", status: "failed" },
    { ...partial, id: "cc:agent-activity:unknown", status: "not-a-status" },
  ];
  return (url: string) => {
    const path = url.split("?")[0] ?? url;
    if (path.endsWith("/v1/agent-activities")) return { items };
    return undefined;
  };
}

test("pageIsEmpty is false when activities are present even without attention or snapshots", () => {
  assert.equal(
    pageIsEmpty({
      id: "agentes",
      label: "Agentes",
      scope: "company",
      generated_at: "2026-08-20T18:00:00Z",
      operator: { kind: "human", id: "founder-local" },
      headline: "ledger",
      attention: [],
      priorities: [],
      activities: [
        {
          schema_version: "control-center.agent-activity.v1",
          id: "cc:agent-activity:partial",
          agent_id: "agent:cc-context",
          scope: "finance",
          status: "partial",
          presentation_status: "PARTIAL",
          started_at: "2026-08-20T17:50:00Z",
          finished_at: "2026-08-20T18:10:00Z",
          goal: "briefing",
          summary: "leftover work",
          provenance: {
            source: { system: "collector", kind: "report", locator: "x" },
            observed_at: "2026-08-20T18:10:00Z",
            freshness_status: "FRESH",
            confidence: 0.9,
          },
        },
      ],
    }),
    false,
  );
});

test("pageIsEmpty is false when a composed Hoje view exists with no exception rows", () => {
  assert.equal(
    pageIsEmpty({
      id: "hoje",
      label: "Hoje",
      scope: "company",
      generated_at: "2026-08-20T18:00:00Z",
      operator: { kind: "human", id: "founder-local" },
      headline: "quiet day",
      attention: [],
      priorities: [],
      hoje: {
        schema_version: "control-center.hoje-view.v1",
        generated_at: "2026-08-20T18:00:00Z",
        headline: "quiet day",
        charts_emitted: false,
        sections: HOJE_SECTION_TITLES.map((title, index) => ({
          id: HOJE_SECTION_IDS[index]!,
          title,
          compressed: HOJE_SECTION_IDS[index] !== "shortcuts",
          compressed_summary:
            HOJE_SECTION_IDS[index] === "shortcuts" ? null : "sem ocorrências nesta coleta",
          rows: [],
          shortcuts:
            HOJE_SECTION_IDS[index] === "shortcuts"
              ? [
                  {
                    kind: "decision" as const,
                    label: "Registrar decisão",
                    hint: "POST /v1/directives",
                  },
                ]
              : [],
        })),
      },
    }),
    false,
  );
});

test("HTTP #/agentes with Goal 04 activities paints ready ledger, not empty", async () => {
  const { adapter, calls } = httpAdapterFor(agentesRouter());
  const root = { innerHTML: "" };
  const handle = mount(root, adapter, createMemoryRuntime("#/agentes"));
  try {
    await waitSettled(root);
    assert.match(root.innerHTML, /data-destination="agentes"/);
    assert.match(root.innerHTML, /data-view-state="ready"/);
    assert.doesNotMatch(root.innerHTML, /data-view-state="empty"/);
    assert.match(root.innerHTML, /RUNNING/);
    assert.match(root.innerHTML, /DONE/);
    assert.match(root.innerHTML, /PARTIAL/);
    assert.match(root.innerHTML, /BLOCKED/);
    assert.match(root.innerHTML, /FAILED/);
    assert.match(root.innerHTML, /UNKNOWN/);
    assert.match(root.innerHTML, /data-stale-running="true"/);
    assert.match(calls.join("\n"), /\/v1\/agent-activities/);
    assert.doesNotMatch(calls.join("\n"), /\/v1\/context/);
  } finally {
    handle.unmount();
  }
});

test("HTTP empty-day Hoje still shows every section title and write shortcuts", async () => {
  const { adapter, calls } = httpAdapterFor(emptyDayRouter());
  const root = { innerHTML: "" };
  const handle = mount(root, adapter, createMemoryRuntime("#/hoje"));
  try {
    await waitSettled(root);
    assert.match(root.innerHTML, /data-destination="hoje"/);
    assert.doesNotMatch(root.innerHTML, /data-view-state="empty"/);
    assert.doesNotMatch(root.innerHTML, /data-view-state="error"/);
    const titles = HOJE_SECTION_TITLES.map((title) => root.innerHTML.indexOf(title));
    for (let i = 0; i < titles.length; i += 1) {
      assert.ok(titles[i]! >= 0, `missing ${HOJE_SECTION_TITLES[i]}`);
      if (i > 0) assert.ok(titles[i]! > titles[i - 1]!, "section order");
    }
    assert.match(root.innerHTML, /data-shortcut-form="decision"/);
    assert.match(root.innerHTML, /data-shortcut-form="nota"/);
    assert.match(root.innerHTML, /data-shortcut-form="risco"/);
    assert.match(root.innerHTML, /data-shortcut-form="hipotese"/);
    assert.match(root.innerHTML, /data-write-path="\/v1\/directives"/);
    assert.doesNotMatch(calls.join("\n"), /\/v1\/context/);
    assert.match(calls.join("\n"), /\/v1\/today/);
  } finally {
    handle.unmount();
  }
});
