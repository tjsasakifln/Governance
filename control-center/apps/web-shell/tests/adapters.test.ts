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
  assert.equal(Number.isInteger(finance.receivables_open.amount_cents), true);
  assert.equal(finance.receivables_open.currency, "BRL");
  assert.equal(finance.receivables_overdue.amount_cents, 1500000);
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

test("production HTTP adapter is not mock and maps context provenance", async () => {
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    assert.match(url, /\/v1\/context/);
    return new Response(
      JSON.stringify({
        scope: "company",
        active_directives: [
          {
            id: "cc:directive:01",
            kind: "risk",
            title: "Collector credentials missing",
            body: "GitHub token absent",
            scope: "company",
            status: "active",
            source: { system: "control-center", kind: "context", locator: "company" },
            observed_at: "2026-08-20T12:00:00.000Z",
            freshness_status: "ERROR",
            confidence: 0,
          },
        ],
        priorities: [
          {
            id: "cc:directive:02",
            kind: "priority",
            title: "Wire production adapters",
            body: "HTTP not mock",
            scope: "company",
            observed_at: "2026-08-20T12:00:00.000Z",
            freshness_status: "FRESH",
            confidence: 1,
            source: { system: "control-center", kind: "context", locator: "company" },
          },
        ],
        source: { system: "control-center", kind: "context", locator: "company" },
        observed_at: "2026-08-20T12:00:00.000Z",
        freshness_status: "ERROR",
        confidence: 0,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  const adapter = createHttpAdapter("http://127.0.0.1:8787", fetchImpl);
  assert.equal(adapter.mode, "http");
  const page = await adapter.readDestination("hoje");
  assert.equal(page.ok, true);
  if (!page.ok || page.loading) throw new Error("expected http page");
  assert.equal(page.page.attention.length > 0, true);
  assert.ok(["FRESH", "STALE", "UNKNOWN", "ERROR"].includes(page.page.attention[0]?.provenance.freshness_status ?? ""));
});
