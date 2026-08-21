import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  createHttpAdapter,
  createProductionAdapter,
  destinationUsesContext,
  isContextPath,
  readPathsFor,
} from "../src/adapters/index";
import { createProductionAdapter as createProductionAdapterFromHttp } from "../src/adapters/http";
import { DESTINATION_IDS } from "../src/destinations";
import { paintShell } from "../src/app";
import { httpAdapterFor, jsonResponse, operationalRouter, pathOf } from "./helpers";

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "../src");

test("each destination requests the frozen GETs and only Memória hits /v1/context", async () => {
  const router = operationalRouter();
  for (const id of DESTINATION_IDS) {
    const calls: string[] = [];
    const { adapter } = httpAdapterFor(router, calls);
    const result = await adapter.readDestination(id);
    assert.equal(result.ok, true, `${id} should succeed`);
    const requested = calls.map(pathOf);
    const expected = [...readPathsFor(id)];
    for (const path of expected) {
      assert.equal(
        requested.includes(path),
        true,
        `${id} missing ${path}; got ${requested.join(",")}`,
      );
    }
    const contextGets = requested.filter((url) => isContextPath(url));
    if (destinationUsesContext(id)) {
      assert.ok(contextGets.length > 0, "memoria must request /v1/context");
    } else {
      assert.equal(contextGets.length, 0, `${id} must not request /v1/context`);
    }
  }
});

test("Hoje/Comercial/Clientes/Financeiro/Engenharia/Infra/Agentes never request /v1/context", async () => {
  const calls: string[] = [];
  const { adapter } = httpAdapterFor(operationalRouter(), calls);
  for (const id of ["hoje", "comercial", "clientes", "financeiro", "engenharia", "infra", "agentes"] as const) {
    calls.length = 0;
    await adapter.readDestination(id);
    assert.equal(
      calls.some((url) => url.includes("/v1/context")),
      false,
      `${id} leaked /v1/context`,
    );
  }
});

test("5xx and network failure paint unavailable/error rather than mock", async () => {
  const fetchImpl = (async () => jsonResponse({ error: "boom" }, 503)) as typeof fetch;
  const adapter = createHttpAdapter("http://127.0.0.1:8787", fetchImpl);
  const result = await adapter.readDestination("hoje");
  assert.equal(result.ok, false);
  if (result.ok || result.loading) throw new Error("expected error");
  assert.equal(result.error.code, "CONTEXT_UNAVAILABLE");
  assert.match(result.error.message, /indisponível|503/);
  const root = { innerHTML: "" };
  paintShell(root, adapter, "#/hoje");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.match(root.innerHTML, /data-view-state="error"/);
  assert.doesNotMatch(root.innerHTML, /modo mock/);
  assert.doesNotMatch(root.innerHTML, /Destravar os três inbound/);

  const net = createHttpAdapter("http://127.0.0.1:8787", (async () => {
    throw new Error("network down");
  }) as typeof fetch);
  const failed = await net.readDestination("comercial");
  assert.equal(failed.ok, false);
});

test("createProductionAdapter is HTTP and its source does not select mock", () => {
  assert.equal(createProductionAdapterFromHttp, createProductionAdapter);
  const httpSrc = readFileSync(join(srcDir, "adapters/http.ts"), "utf8");
  assert.match(httpSrc, /createHttpAdapter/);
  assert.doesNotMatch(httpSrc, /createMockAdapter/);
  assert.doesNotMatch(httpSrc, /from "\.\/mock"/);
  const bootSrc = readFileSync(join(srcDir, "boot.ts"), "utf8");
  assert.match(bootSrc, /createProductionAdapter/);
  assert.match(bootSrc, /__CC_TEST_ADAPTER__/);
  assert.match(bootSrc, /cc-use-mock/);
});

test("production HTTP adapter maps Goal 04 commercial/finance/engineering fixtures onto domain fields", async () => {
  const { adapter } = httpAdapterFor();
  const comercial = await adapter.readDestination("comercial");
  assert.equal(comercial.ok, true);
  if (!comercial.ok || comercial.loading) throw new Error("comercial");
  const snap = comercial.page.commercial;
  assert.ok(snap);
  assert.equal(snap.funnel?.new_leads, 6);
  assert.equal(snap.funnel?.qualified, 4);
  assert.equal(snap.funnel?.opportunities, 3);
  assert.equal(snap.funnel?.proposals, 2);
  assert.equal(snap.funnel?.clients, 1);
  assert.equal(snap.pipeline_nominal?.amount_cents, 4800000);
  assert.equal(snap.pipeline_weighted?.probability_reliable, true);
  assert.equal(snap.aging_count, 1);
  assert.equal(snap.missing_next_action_count, 2);
  assert.equal(snap.stalled_count, 1);

  const financeiro = await adapter.readDestination("financeiro");
  if (!financeiro.ok || financeiro.loading) throw new Error("financeiro");
  const finance = financeiro.page.finance;
  assert.ok(finance);
  assert.equal(finance.contracted?.amount_cents, 5000000);
  assert.equal(finance.billed?.amount_cents, 4000000);
  assert.equal(finance.paid?.amount_cents, 2500000);
  assert.equal(finance.effectively_received?.amount_cents, 2300000);
  assert.equal(finance.overdue?.amount_cents, 1500000);
  assert.equal(finance.receivable?.amount_cents, 2500000);
  assert.equal(finance.refunds?.amount_cents, 100000);
  assert.equal(finance.chargebacks?.amount_cents, 100000);
  assert.equal(finance.mrr?.applicable, true);
  assert.equal(finance.runway?.cash_reliable, true);

  const engenharia = await adapter.readDestination("engenharia");
  if (!engenharia.ok || engenharia.loading) throw new Error("engenharia");
  assert.equal(engenharia.page.engineering?.open_pr_count, 1);
  assert.equal(engenharia.page.engineering?.failing_check_count, 0);
});
