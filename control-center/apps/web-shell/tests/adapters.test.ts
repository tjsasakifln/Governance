import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ADAPTER_ACTIONS,
  CHAT_SURFACE_ACTIONS,
  FORBIDDEN_ADAPTER_ACTIONS,
  adapterAllows,
  createHttpAdapter,
  createMockAdapter,
  isForbiddenAdapterAction,
} from "../src/adapters/index";
import { paintShell } from "../src/app";
import { DESTINATION_IDS } from "../src/destinations";
import { FRESHNESS_STATUSES } from "../src/types";

test("adapter contract is read-only and forbids financial/provider mutations and chat", () => {
  assert.deepEqual([...ADAPTER_ACTIONS], ["read"]);
  assert.equal(adapterAllows("read"), true);
  for (const action of FORBIDDEN_ADAPTER_ACTIONS) {
    assert.equal(adapterAllows(action), false);
    assert.equal(isForbiddenAdapterAction(action), true);
  }
  for (const action of CHAT_SURFACE_ACTIONS) {
    assert.equal(adapterAllows(action), false);
  }
  const adapter = createMockAdapter();
  assert.deepEqual([...adapter.actions], ["read"]);
  assert.equal("readDestination" in adapter, true);
  assert.equal("charge" in adapter, false);
  assert.equal("checkout" in adapter, false);
  assert.equal("refund" in adapter, false);
  assert.equal("compose" in adapter, false);
});

test("mock adapter returns fixture data for every destination without network I/O", () => {
  const fetchCalls: unknown[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((...args: unknown[]) => {
    fetchCalls.push(args);
    return Promise.reject(new Error("network should not be used"));
  }) as typeof fetch;
  try {
    const adapter = createMockAdapter("default");
    assert.equal(adapter.mode, "mock");
    assert.equal(adapter.readOperator().id, "human:operator");
    assert.equal(adapter.readOperator().kind, "human");
    for (const id of DESTINATION_IDS) {
      const result = adapter.readDestination(id);
      assert.equal(result.ok, true);
      assert.equal(result.loading, false);
      if (!result.ok || result.loading) throw new Error("expected page");
      assert.equal(result.page.id, id);
      assert.ok(result.page.generated_at.endsWith("Z"));
      assert.equal(result.page.operator.id, "human:operator");
    }
    const hoje = adapter.readDestination("hoje");
    if (!hoje.ok || hoje.loading) throw new Error("hoje page");
    assert.ok(hoje.page.attention.length > 0);
    assert.ok(hoje.page.priorities.length <= 3);
    assert.equal(fetchCalls.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("finance page money is integer cents plus currency and mutations stay forbidden", () => {
  const adapter = createMockAdapter();
  const result = adapter.readDestination("financeiro");
  if (!result.ok || result.loading) throw new Error("financeiro page");
  const finance = result.page.finance;
  assert.ok(finance);
  assert.equal(finance.read_model_only, true);
  assert.equal(finance.provider_mutations, "forbidden");
  assert.ok(finance.receivables_open);
  assert.equal(Number.isInteger(finance.receivables_open.amount_cents), true);
  assert.equal(finance.receivables_open.currency, "BRL");
  assert.equal(finance.receivables_overdue?.amount_cents, 1500000);
});

test("fixture catalog covers every freshness status", () => {
  const adapter = createMockAdapter();
  const seen = new Set<string>();
  for (const id of DESTINATION_IDS) {
    const result = adapter.readDestination(id);
    if (!result.ok || result.loading) continue;
    for (const item of result.page.attention) {
      seen.add(item.provenance.freshness_status);
      assert.ok(item.provenance.source.system);
      assert.ok(item.provenance.observed_at.endsWith("Z"));
    }
  }
  for (const status of FRESHNESS_STATUSES) {
    assert.equal(seen.has(status), true, `missing freshness ${status}`);
  }
});

test("production HTTP adapter is not mock and maps frozen-path provenance", async () => {
  const seenHeaders: string[] = [];
  const seenUrls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    seenUrls.push(url);
    const headers = new Headers(init?.headers);
    seenHeaders.push(`${headers.get("x-actor-id")}:${headers.get("x-actor-kind")}`);
    const path = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0];
    if (path === "/v1/today") {
      return new Response(
        JSON.stringify({
          generated_at: "2026-08-20T12:00:00.000Z",
          headline: "HTTP not mock",
          recommended_actions: [
            {
              id: "cc:priority-recommendation:01",
              rank: 1,
              title: "Wire production adapters",
              rationale: "HTTP not mock",
              scope: "company",
              observed_at: "2026-08-20T12:00:00.000Z",
              freshness_status: "FRESH",
              confidence: 1,
              source: { system: "control-center", kind: "today", locator: "company" },
            },
          ],
          incidents: [
            {
              id: "cc:attention-item:01",
              kind: "risk",
              title: "Collector credentials missing",
              summary: "GitHub token absent",
              scope: "company",
              status: "open",
              severity: "high",
              homepage_eligible: true,
              detected_at: "2026-08-20T12:00:00.000Z",
              source: { system: "control-center", kind: "attention", locator: "company" },
              observed_at: "2026-08-20T12:00:00.000Z",
              freshness_status: "ERROR",
              confidence: 0,
            },
          ],
          clients: [],
          commercial: null,
          finance: null,
          engineering: null,
          infra: [],
          agent_activity: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (path === "/v1/attention" || path === "/v1/agent-activities") {
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (path === "/v1/operational-snapshots") {
      return new Response(JSON.stringify({ attention_items: [], top_priorities: [], health: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
  }) as typeof fetch;
  const adapter = createHttpAdapter("http://127.0.0.1:8787", fetchImpl, {
    kind: "human",
    id: "founder-local",
  });
  assert.equal(adapter.mode, "http");
  const page = await adapter.readDestination("hoje");
  assert.equal(page.ok, true);
  if (!page.ok || page.loading) throw new Error("expected http page");
  assert.equal(page.page.attention.length > 0, true);
  assert.ok(["FRESH", "STALE", "UNKNOWN", "ERROR"].includes(page.page.attention[0]?.provenance.freshness_status ?? ""));
  assert.equal(seenHeaders.includes("founder-local:human"), true);
  assert.equal(seenUrls.some((url) => url.includes("/v1/today")), true);
  assert.equal(seenUrls.some((url) => url.includes("/v1/context")), false);
});

test("async HTTP destination read paints loading before the promise settles", () => {
  const adapter = {
    mode: "http" as const,
    actions: ADAPTER_ACTIONS,
    readOperator: () => ({ kind: "human" as const, id: "founder-local" }),
    readDestination: () => new Promise<never>(() => undefined),
    readAttention: async () => [],
    readPriorities: async () => [],
  };
  const root = { innerHTML: "" };
  paintShell(root, adapter, "#/hoje");
  assert.match(root.innerHTML, /data-view-state="loading"/);
  assert.match(root.innerHTML, /Carregando observações/);
});

test("production HTTP adapter calls globalThis.fetch through a bound wrapper", async () => {
  const original = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async (_input: RequestInfo | URL, _init?: RequestInit) => {
    called = true;
    return new Response(JSON.stringify({ scope: "company", active_directives: [], priorities: [], risks: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  try {
    const adapter = createHttpAdapter("http://127.0.0.1:8787");
    const page = await adapter.readDestination("hoje");
    assert.equal(called, true);
    assert.equal(page.ok, true);
  } finally {
    globalThis.fetch = original;
  }
});
