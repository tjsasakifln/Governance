import assert from "node:assert/strict";
import { test } from "node:test";
import { createHttpAdapter } from "../src/adapters/index";
import { commercialFrom, financeFrom, maybeClientFrom, fallbackProvenance } from "../src/adapters/map";
import { paintShell } from "../src/app";
import { GROWTH_FUNNEL_HOPS } from "../src/ui/domains";
import { httpAdapterFor, jsonResponse, operationalRouter, pathOf } from "./helpers";

const FALLBACK = fallbackProvenance("test", "2026-08-21T12:00:00.000Z");

function authority(): Record<string, unknown> {
  return {
    catalog_authority: "governance",
    commercial_runtime: "warmbly",
    this_document: "read_model",
  };
}

function provenance(): Record<string, unknown> {
  return {
    source: { system: "warmbly", kind: "crm-read-model", locator: "x" },
    observed_at: "2026-08-21T12:00:00.000Z",
    freshness_status: "UNKNOWN",
    confidence: 0,
  };
}

test("commercialFrom leaves omitted funnel stages and counts undefined instead of zero", () => {
  const snap = commercialFrom(
    {
      schema_version: "control-center.commercial-snapshot.v1",
      id: "cc:commercial-snapshot:omitted",
      scope: "commercial",
      generated_at: "2026-08-21T12:00:00.000Z",
      provenance: provenance(),
      authority: authority(),
    },
    FALLBACK,
  );
  assert.equal(snap.funnel, undefined);
  assert.equal(snap.pipeline_open_count, undefined);
  assert.equal(snap.inbound_unread_count, undefined);
  assert.equal(snap.at_risk_client_count, undefined);
  assert.equal(snap.aging_count, undefined);
});

test("commercialFrom keeps an explicit zero distinct from an omitted stage", () => {
  const snap = commercialFrom(
    {
      id: "cc:commercial-snapshot:zero",
      scope: "commercial",
      generated_at: "2026-08-21T12:00:00.000Z",
      provenance: provenance(),
      authority: authority(),
      funnel: { new_leads: 0, opportunities: 2 },
    },
    FALLBACK,
  );
  assert.equal(snap.funnel?.new_leads, 0);
  assert.equal(snap.funnel?.opportunities, 2);
  assert.equal(snap.funnel?.qualified, undefined);
  assert.equal(snap.funnel?.proposals, undefined);
  assert.equal(snap.funnel?.clients, undefined);
});

test("financeFrom leaves omitted overdue and receivables undefined instead of zero money", () => {
  const snap = financeFrom(
    {
      schema_version: "control-center.finance-snapshot.v1",
      id: "cc:finance-snapshot:omitted",
      scope: "finance",
      generated_at: "2026-08-21T12:00:00.000Z",
      provenance: provenance(),
    },
    FALLBACK,
  );
  assert.equal(snap.overdue, undefined);
  assert.equal(snap.receivable, undefined);
  assert.equal(snap.receivables_open, undefined);
  assert.equal(snap.receivables_overdue, undefined);
  assert.equal(snap.paid, undefined);
  assert.equal(snap.effectively_received, undefined);
});

test("maybeClientFrom always exposes per-source presence and defaults omitted sources to UNKNOWN", () => {
  const mapped = maybeClientFrom(
    {
      id: "cc:client-status:no-sources",
      scope: "client:no-sources",
      client_slug: "no-sources",
      display_name: "Sem origens",
      lifecycle: "unknown",
      provenance: provenance(),
    },
    FALLBACK,
  );
  assert.ok(mapped, "a real identity must still map to a client");
  assert.equal(mapped.sources?.warmbly, "UNKNOWN");
  assert.equal(mapped.sources?.asaas, "UNKNOWN");
  assert.equal(mapped.sources?.governance, "UNKNOWN");
});

test("maybeClientFrom refuses to invent an identity for a row that has none", () => {
  assert.equal(maybeClientFrom({}, FALLBACK), null);
  assert.equal(
    maybeClientFrom(
      { schema_version: "control-center.clients-snapshot.v1", id: "cc:clients-snapshot:roll-up" },
      FALLBACK,
    ),
    null,
  );
  assert.equal(
    maybeClientFrom({ client_slug: "unknown", scope: "client:unknown", display_name: "Cliente" }, FALLBACK),
    null,
  );
});

test("Crescimento HTTP GET uses commercial scope, never inbound, and maps the commercial snapshot", async () => {
  const calls: string[] = [];
  const { adapter } = httpAdapterFor(operationalRouter(), calls);
  const result = await adapter.readDestination("crescimento");
  assert.equal(result.ok, true);
  if (!result.ok || result.loading) throw new Error("crescimento");
  const requested = calls.map(pathOf);
  assert.equal(
    requested.includes("/v1/domains/commercial?scope=commercial"),
    true,
    `missing commercial scope; got ${requested.join(",")}`,
  );
  assert.equal(
    requested.some((url) => url.includes("/v1/domains/commercial") && url.includes("scope=inbound")),
    false,
  );
  assert.equal(result.page.commercial?.funnel?.new_leads, 6);
});

test("HTTP commercial page with omitted funnel paints ausente, not zero", async () => {
  const router = (url: string) => {
    const path = url.split("?")[0] ?? url;
    if (path.endsWith("/v1/domains/commercial")) {
      return {
        schema_version: "control-center.commercial-snapshot.v1",
        id: "cc:commercial-snapshot:omitted",
        scope: "commercial",
        generated_at: "2026-08-21T12:00:00.000Z",
        provenance: provenance(),
        authority: authority(),
      };
    }
    return operationalRouter()(url);
  };
  const { adapter } = httpAdapterFor(router);
  const root = { innerHTML: "" };
  paintShell(root, adapter, "#/comercial");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(root.innerHTML, /Novos leads[\s\S]*?data-absent="true"[\s\S]*?ausente/);
  assert.doesNotMatch(root.innerHTML, /<dt>Novos leads<\/dt><dd>0<\/dd>/);
  assert.match(root.innerHTML, /Qualificados[\s\S]*?ausente/);
});

test("HTTP finance page with omitted overdue paints ausente, not R$ 0,00", async () => {
  const router = (url: string) => {
    const path = url.split("?")[0] ?? url;
    if (path.endsWith("/v1/domains/finance")) {
      return {
        schema_version: "control-center.finance-snapshot.v1",
        id: "cc:finance-snapshot:omitted",
        scope: "finance",
        generated_at: "2026-08-21T12:00:00.000Z",
        provenance: provenance(),
        read_model_only: true,
        provider_mutations: "forbidden",
      };
    }
    return operationalRouter()(url);
  };
  const { adapter } = httpAdapterFor(router);
  const root = { innerHTML: "" };
  paintShell(root, adapter, "#/financeiro");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(root.innerHTML, /Vencido[\s\S]*?data-absent="true"[\s\S]*?ausente/);
  assert.match(root.innerHTML, /A receber[\s\S]*?ausente/);
  assert.doesNotMatch(root.innerHTML, /data-amount-cents="0"/);
});

test("HTTP Crescimento paints all growth funnel hops even when operations.growth is absent", async () => {
  const { adapter } = httpAdapterFor();
  const root = { innerHTML: "" };
  paintShell(root, adapter, "#/crescimento");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(root.innerHTML, /Funil de crescimento/);
  for (const hop of GROWTH_FUNNEL_HOPS) {
    assert.match(root.innerHTML, new RegExp(`data-growth-hop="${hop}"`));
  }
  assert.match(root.innerHTML, /data-growth-hop="search_visibility"[^>]*data-absent="true"/);
  assert.match(root.innerHTML, /data-hop-status="BLOCKED"/);
});

test("HTTP Crescimento maps observed growth hops from the commercial snapshot", async () => {
  const router = (url: string) => {
    const path = url.split("?")[0] ?? url;
    const scope = new URLSearchParams((url.split("?")[1] ?? "")).get("scope");
    if (path.endsWith("/v1/domains/commercial") && scope === "commercial") {
      return {
        schema_version: "control-center.commercial-snapshot.v1",
        id: "cc:commercial-snapshot:growth",
        scope: "commercial",
        generated_at: "2026-08-21T12:00:00.000Z",
        provenance: provenance(),
        authority: authority(),
        operations: {
          growth: {
            schema_version: "control-center.growth-readmodel.v1",
            funnel_contract: [...GROWTH_FUNNEL_HOPS],
            attribution: { note: "Hops without a durable ID stay UNKNOWN/BLOCKED." },
            scoreboard: {
              stages: [{ id: "inbound_event", status: "FRESH", observation: "scoreboard hop" }],
            },
          },
        },
      };
    }
    return operationalRouter()(url);
  };
  const { adapter } = httpAdapterFor(router);
  const root = { innerHTML: "" };
  paintShell(root, adapter, "#/crescimento");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(root.innerHTML, /data-growth-hop="inbound_event"[^>]*data-hop-status="FRESH"/);
  assert.doesNotMatch(root.innerHTML, /data-growth-hop="inbound_event"[^>]*data-absent="true"/);
  assert.match(root.innerHTML, /data-growth-hop="search_visibility"[^>]*data-absent="true"/);
});

test("HTTP client 360 paints per-source absence for omitted Warmbly/Asaas/Governance", async () => {
  const { adapter } = httpAdapterFor();
  const mapped = await adapter.readDestination("clientes");
  assert.equal(mapped.ok, true);
  if (!mapped.ok || mapped.loading) throw new Error("clientes");
  const client = mapped.page.clients?.[0];
  assert.ok(client);
  assert.equal(client.sources?.warmbly, "UNKNOWN");
  assert.equal(client.sources?.asaas, "UNKNOWN");
  assert.equal(client.sources?.governance, "UNKNOWN");
  const root = { innerHTML: "" };
  paintShell(root, adapter, "#/clientes");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(root.innerHTML, /data-client-source="warmbly"[^>]*data-absent="true"/);
  assert.match(root.innerHTML, /data-client-source="asaas"[^>]*data-absent="true"/);
  assert.match(root.innerHTML, /data-client-source="governance"[^>]*data-absent="true"/);
});

test("HTTP client deep link reads the exact client scope instead of the empty roll-up", async () => {
  const seen: string[] = [];
  const { adapter } = httpAdapterFor((url) => {
    seen.push(url);
    return {
      schema_version: "control-center.clients-snapshot.v1",
      client_slug: "acme",
      display_name: "ACME",
      lifecycle: "active",
      id: "cc:operational-snapshot:01M0WXAZ0Y0MS54HTACEA9RA0R",
    };
  });
  const result = await adapter.readDestination("clientes", "#/clientes/acme");
  assert.equal(result.ok, true);
  if (!result.ok || result.loading) throw new Error("clientes/acme");
  assert.equal(result.page.clients?.[0]?.client_slug, "acme");
  assert.ok(seen.some((url) => url.includes("scope=client%3Aacme")));
});

test("operatorAction confirmation and error paint on the shipped HTTP path", async () => {
  const { adapter } = httpAdapterFor();
  const accepted = await adapter.operatorAction({
    action_type: "ACKNOWLEDGE_EXCEPTION",
    target_canonical_id: "cc:attention-item:x",
    target_source_id: "x",
    note: "visto pelo founder",
  });
  assert.equal(accepted.ok, true);
  assert.equal(adapter.lastOperatorResult?.ok, true);
  const root = { innerHTML: "" };
  paintShell(root, adapter, "#/comercial/excecoes");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(root.innerHTML, /data-operator-result="ok"/);
  assert.match(root.innerHTML, /ação registrada no Control Center; Warmbly não foi alterado/);
  assert.equal(/resolvid[oa] no Warmbly|exception resolved in Warmbly/i.test(root.innerHTML), false);

  const denied = await adapter.operatorAction({
    action_type: "SEND_EMAIL",
    target_canonical_id: "cc:attention-item:x",
    target_source_id: "x",
    note: "não enviar",
  });
  assert.equal(denied.ok, false);
  assert.equal(adapter.lastOperatorResult?.ok, false);
  paintShell(root, adapter, "#/comercial/excecoes");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(root.innerHTML, /data-operator-result="error"/);
  assert.match(root.innerHTML, /ação comercial proibida/);
});

test("operatorAction HTTP 4xx still paints the error banner", async () => {
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method === "POST") return jsonResponse({ error: "forbidden" }, 403);
    const url = String(input).replace(/^https?:\/\/[^/]+/, "");
    const payload = operationalRouter()(url);
    return jsonResponse(payload);
  }) as typeof fetch;
  const adapter = createHttpAdapter("http://127.0.0.1:8787", fetchImpl, {
    kind: "human",
    id: "founder-local",
  });
  const result = await adapter.operatorAction({
    action_type: "REVIEW_ACTIVITY",
    target_canonical_id: "cc:x",
    target_source_id: "x",
    note: "revisar",
  });
  assert.equal(result.ok, false);
  const root = { innerHTML: "" };
  paintShell(root, adapter, "#/comercial/atividade");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(root.innerHTML, /data-operator-result="error"/);
  assert.match(root.innerHTML, /recusado \(403\)/);
  assert.equal(result.outcome, "refused");
  assert.equal(result.status, 403);
});

test("operator action receipt preserves actor, correlation and duplicate outcome", async () => {
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(init?.method, "POST");
    return jsonResponse({
      id: "cc:operator-action:receipt-1",
      action_type: "START_EXCEPTION_WORK",
      target_canonical_id: "cc:attention-item:x",
      target_source_id: "x",
      actor: { kind: "human", id: "founder-local" },
      occurred_at: "2026-08-22T12:00:00.000Z",
      correlation_id: "corr-receipt-1",
      resulting_status: "duplicate",
    }, 201);
  }) as typeof fetch;
  const adapter = createHttpAdapter("http://127.0.0.1:8787", fetchImpl, {
    kind: "human",
    id: "founder-local",
  });
  const result = await adapter.operatorAction({
    action_type: "START_EXCEPTION_WORK",
    target_canonical_id: "cc:attention-item:x",
    target_source_id: "x",
    note: "tratar",
    idempotency_key: "corr-receipt-1",
  });
  assert.equal(result.outcome, "duplicate");
  assert.deepEqual(result.receipt, {
    id: "cc:operator-action:receipt-1",
    correlation_id: "corr-receipt-1",
    occurred_at: "2026-08-22T12:00:00.000Z",
    outcome: "duplicate",
    actor_id: "founder-local",
    target: "cc:attention-item:x",
    writes_to: "control-center",
  });
  assert.match(result.message, /requisição duplicada/);
});

test("operator action fails closed on a successful HTTP response without an exact receipt", async () => {
  for (const body of [
    {},
    {
      id: "cc:operator-action:x",
      action_type: "MARK_TRIAGED",
      target_canonical_id: "cc:attention-item:other",
      target_source_id: "x",
      actor: { kind: "human", id: "founder-local" },
      occurred_at: "2026-08-22T12:00:00.000Z",
      correlation_id: "corr-x",
      resulting_status: "accepted",
    },
    {
      id: "cc:operator-action:x",
      action_type: "SEND_EMAIL",
      target_canonical_id: "cc:attention-item:x",
      target_source_id: "x",
      actor: { kind: "human", id: "founder-local" },
      occurred_at: "2026-08-22T12:00:00.000Z",
      correlation_id: "corr-x",
      resulting_status: "accepted",
    },
  ]) {
    const adapter = createHttpAdapter(
      "http://127.0.0.1:8787",
      (async () => jsonResponse(body, 201)) as typeof fetch,
      { kind: "human", id: "founder-local" },
    );
    const result = await adapter.operatorAction({
      action_type: "MARK_TRIAGED",
      target_canonical_id: "cc:attention-item:x",
      target_source_id: "x",
      note: "triado",
    });
    assert.equal(result.ok, false);
    assert.equal(result.outcome, "unknown");
    assert.equal(result.code, "invalid_operator_receipt");
    assert.equal(result.receipt, undefined);
  }
});

test("operator action refuses impossible and future receipt timestamps", async () => {
  for (const occurredAt of ["2026-02-30T12:00:00Z", "2050-01-01T00:00:00Z", "2026-08-22T12:00:00+00:00"]) {
    let request: Record<string, unknown> = {};
    const adapter = createHttpAdapter(
      "http://127.0.0.1:8787",
      (async (_input: RequestInfo | URL, init?: RequestInit) => {
        request = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return jsonResponse({
          id: "cc:operator-action:hostile-time",
          action_type: request.action_type,
          target_canonical_id: request.target_canonical_id,
          target_source_id: request.target_source_id,
          actor: { kind: "human", id: "founder-local" },
          correlation_id: request.correlation_id,
          occurred_at: occurredAt,
          resulting_status: "accepted",
        }, 201);
      }) as typeof fetch,
      { kind: "human", id: "founder-local" },
    );
    const result = await adapter.operatorAction({
      action_type: "MARK_TRIAGED",
      target_canonical_id: "cc:attention-item:x",
      target_source_id: "x",
      note: "triado",
    });
    assert.equal(result.ok, false);
    assert.equal(result.outcome, "unknown");
    assert.equal(result.code, "invalid_operator_receipt");
  }
});

test("generated idempotency keys are bounded and never expose the operator note", async () => {
  let requestBody: Record<string, unknown> = {};
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return jsonResponse({
      id: "cc:operator-action:x",
      action_type: "MARK_TRIAGED",
      target_canonical_id: "cc:attention-item:x",
      target_source_id: "x",
      actor: { kind: "human", id: "founder-local" },
      correlation_id: String(requestBody.correlation_id),
      occurred_at: "2026-08-22T12:00:00.000Z",
      resulting_status: "accepted",
    }, 201);
  }) as typeof fetch;
  const adapter = createHttpAdapter("http://127.0.0.1:8787", fetchImpl, { kind: "human", id: "founder-local" });
  const sensitiveNote = "Fixture com nome de cliente que não deve ir para a chave";
  await adapter.operatorAction({
    action_type: "MARK_TRIAGED",
    target_canonical_id: "cc:attention-item:x",
    target_source_id: "x",
    note: sensitiveNote,
  });
  assert.equal(String(requestBody.note), sensitiveNote);
  assert.doesNotMatch(String(requestBody.idempotency_key), /Fixture|cliente|chave/);
  assert.match(String(requestBody.idempotency_key), /^cc-web:MARK_TRIAGED:/);
  assert.ok(String(requestBody.idempotency_key).length < 80);
});

test("operator action timeout is UNKNOWN and tells the operator not to repeat blindly", async () => {
  const fetchImpl = (async () => {
    throw new DOMException("timeout", "TimeoutError");
  }) as typeof fetch;
  const adapter = createHttpAdapter("http://127.0.0.1:8787", fetchImpl, {
    kind: "human",
    id: "founder-local",
  });
  const result = await adapter.operatorAction({
    action_type: "ASSIGN_TRIAGE",
    target_canonical_id: "cc:attention-item:x",
    target_source_id: "x",
    note: "assumir",
  });
  assert.equal(result.ok, false);
  assert.equal(result.outcome, "unknown");
  const root = { innerHTML: "" };
  paintShell(root, adapter, "#/comercial/atividade");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(root.innerHTML, /Não repita agora/);
  assert.match(root.innerHTML, /data-operator-outcome="unknown"/);
});
