import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { LiveSnapshot } from "../../../qa/src/live-port.ts";
import { saoPauloCalendarDate } from "../../../qa/src/utc.ts";
import { expandInheritedScopes } from "../../../services/context/src/scope.ts";
import { assertGetAllowed } from "../../../connectors/asaas/src/allowlist.ts";
import { AsaasMutationForbiddenError } from "../../../connectors/asaas/src/errors.ts";
import {
  collect as collectGithub,
  loadFixtureDir,
  MemoryEtagStore,
  parseCollectConfig,
} from "../../../connectors/github/src/index.ts";
import { classifyRequest, WarmblyClient } from "../../../connectors/warmbly/src/index.ts";
import { evaluatePncpContractPayload, evaluatePncpFreshness } from "../../../connectors/pncp/src/index.ts";
import {
  collect as collectInfra,
  parseFixture,
  createFixturePorts,
} from "../../../connectors/infrastructure/src/index.ts";
import { aggregateFinanceReadModel, toContractsStub } from "../../../domains/finance/src/index.ts";
import { parseForwardAuthIdentity, defaultTrustedHopPolicy } from "../../../security/src/identity.ts";
import { COOKIE_POLICY, CORS_POLICY, CSRF_STRATEGY } from "../../../security/src/constants.ts";
import { analyzeCaddyfile } from "../../../security/src/caddy.ts";
import { createHttpAdapter } from "../../../apps/web-shell/src/adapters/http.ts";
import { collectPresentedFreshness } from "./presented-freshness.ts";
import { FOUNDER, LIVE_AS_OF, LIVE_NOW } from "./seed.ts";
import {
  bootLiveRuntime,
  httpJson,
  mcpCall,
  mcpInitialize,
  type LiveRuntime,
} from "./harness.ts";

const here = dirname(fileURLToPath(import.meta.url));
const ccRoot = join(here, "../../..");

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function observedAt(value: unknown): string {
  const raw = typeof value === "string" ? value : LIVE_NOW;
  return raw.endsWith("Z") ? raw : `${raw}Z`;
}

async function githubCollect(name: string) {
  const loaded = loadFixtureDir(join(ccRoot, "connectors/github/fixtures", name));
  const parsed = parseCollectConfig({
    repos: loaded.manifest.repos ?? ["tjsasakifln/Governance"],
    token: "ghs_synthetic_not_a_live_credential",
    transport: loaded.transport,
    etagStore: new MemoryEtagStore(),
    now: () => new Date("2026-08-20T18:00:00.000Z"),
    logSink: () => undefined,
    env: { GITHUB_TOKEN: "ghs_synthetic_not_a_live_credential" },
  });
  if (!parsed.ok) {
    throw new Error(parsed.message);
  }
  return collectGithub(parsed.config);
}

function financeEvents() {
  const src = (locator: string) => ({ system: "asaas", kind: "receivable", locator });
  const base = {
    currency: "BRL" as const,
    billing_mode: "ONE_TIME" as const,
    billing_cycle: "NONE" as const,
    observed_at: LIVE_NOW,
    freshness_status: "FRESH" as const,
    confidence: 0.9,
    settlement_proven: false,
  };
  return [
    {
      ...base,
      id: "cc:finance-event:live-contract",
      idempotency_key: "live:contract",
      kind: "contract_signed" as const,
      occurred_at: "2026-08-02T09:00:00.000Z",
      amount_cents: 100000,
      client_id: "client:acme",
      obligation_id: "ob:live-acme",
      source: src("pay_live_1"),
    },
    {
      ...base,
      id: "cc:finance-event:live-invoice",
      idempotency_key: "live:invoice",
      kind: "invoice_issued" as const,
      occurred_at: "2026-08-03T09:00:00.000Z",
      amount_cents: 100000,
      client_id: "client:acme",
      obligation_id: "ob:live-acme",
      invoice_id: "inv:live-acme",
      due_at: "2026-08-25T00:00:00.000Z",
      source: src("pay_live_1"),
    },
    {
      ...base,
      id: "cc:finance-event:live-paid",
      idempotency_key: "live:paid",
      kind: "payment_confirmed" as const,
      occurred_at: "2026-08-06T09:00:00.000Z",
      amount_cents: 40000,
      client_id: "client:acme",
      obligation_id: "ob:live-acme",
      source: src("pay_live_1"),
    },
    {
      ...base,
      id: "cc:finance-event:live-received",
      idempotency_key: "live:received",
      kind: "settlement_received" as const,
      occurred_at: "2026-08-07T09:00:00.000Z",
      amount_cents: 40000,
      client_id: "client:acme",
      obligation_id: "ob:live-acme",
      settlement_proven: true,
      source: src("pay_live_1"),
    },
    {
      ...base,
      id: "cc:finance-event:live-refund",
      idempotency_key: "live:refund",
      kind: "refund" as const,
      occurred_at: "2026-08-08T09:00:00.000Z",
      amount_cents: 10000,
      client_id: "client:acme",
      obligation_id: "ob:live-acme",
      source: src("pay_live_refund"),
    },
    {
      ...base,
      id: "cc:finance-event:overdue-contract",
      idempotency_key: "live:overdue-contract",
      kind: "contract_signed" as const,
      occurred_at: "2026-07-01T09:00:00.000Z",
      amount_cents: 20000,
      client_id: "client:beta",
      obligation_id: "ob:live-overdue",
      source: src("pay_live_2"),
    },
    {
      ...base,
      id: "cc:finance-event:overdue-invoice",
      idempotency_key: "live:overdue-invoice",
      kind: "invoice_issued" as const,
      occurred_at: "2026-07-02T09:00:00.000Z",
      amount_cents: 20000,
      client_id: "client:beta",
      obligation_id: "ob:live-overdue",
      invoice_id: "inv:live-overdue",
      due_at: "2026-07-10T00:00:00.000Z",
      source: src("pay_live_2"),
    },
  ];
}

function directiveFromHttp(row: unknown): Record<string, unknown> | null {
  const rec = asRecord(row);
  if (!rec) {
    return null;
  }
  const created = asRecord(rec.created_by);
  const kind = String(rec.kind ?? "fact");
  return {
    id: String(rec.id ?? ""),
    kind,
    origin_kind: kind,
    scope: String(rec.scope ?? ""),
    status: String(rec.status ?? ""),
    title: String(rec.title ?? ""),
    conflict_key: String(rec.title ?? rec.id ?? ""),
    supersedes: Array.isArray(rec.supersedes) ? rec.supersedes : rec.supersedes ? [rec.supersedes] : [],
    created_by: {
      kind: String(created?.kind ?? "human"),
      id: String(created?.id ?? rec.created_by ?? ""),
      role: created?.kind === "human" ? "founder" : created?.kind,
    },
    presented_as: kind,
    source: rec.source,
    observed_at: rec.observed_at,
    freshness_status: rec.freshness_status,
    confidence: rec.confidence,
    audit: [],
  };
}

export async function collectLiveSnapshot(runtime: LiveRuntime): Promise<LiveSnapshot> {
  const founder = runtime.founderHeaders;
  const scopes = ["company", "commercial", "infrastructure", "finance", "client:acme"] as const;
  const scoped = new Map<string, Record<string, unknown>>();
  for (const scope of scopes) {
    const res = await httpJson(`${runtime.contextBaseUrl}/v1/context?scope=${encodeURIComponent(scope)}`, {
      headers: founder,
    });
    scoped.set(scope, asRecord(res.body) ?? {});
  }
  const companyBody = scoped.get("company") ?? {};
  const commercialBody = scoped.get("commercial") ?? {};
  const infraBody = scoped.get("infrastructure") ?? {};
  const acmeBody = scoped.get("client:acme") ?? {};

  const adapter = createHttpAdapter(runtime.contextBaseUrl, fetch, {
    kind: "human",
    id: FOUNDER.id,
  });
  const hoje = await adapter.readDestination("hoje");
  const comercialPage = await adapter.readDestination("comercial");
  const infraPage = await adapter.readDestination("infra");
  const financeiroPage = await adapter.readDestination("financeiro");

  await mcpInitialize(runtime.mcp);
  const mcpRead = await mcpCall(runtime.mcp, "confenge.get_context", { scope: "company" });
  const mcpUnauth = await mcpCall(runtime.mcp, "confenge.get_context", { scope: "company" }, "");
  const mcpMutation = await mcpCall(runtime.mcp, "confenge.create_decision", {
    kind: "decision",
    title: "agent rewrite",
  });
  const mcpReport = await mcpCall(runtime.mcp, "confenge.report_session_result", {
    scope: "company",
    summary: "live qa session completed",
    outcome: "completed",
    session_id: "sess-live-qa",
  });
  const mcpBlocker = await mcpCall(runtime.mcp, "confenge.report_blocker", {
    scope: "company",
    summary: "blocked on founder confirmation",
    severity: "high",
    blocking: true,
  });
  void mcpRead;
  void mcpUnauth;
  void mcpMutation;
  void mcpReport;
  void mcpBlocker;

  const activities = await httpJson(`${runtime.contextBaseUrl}/v1/agent-activities?scope=company`, {
    headers: founder,
  });
  const unauthHttp = await httpJson(`${runtime.contextBaseUrl}/v1/context?scope=company`);
  const spoofHttp = await httpJson(`${runtime.contextBaseUrl}/v1/context?scope=company`, {
    headers: { "x-actor-id": "not-the-founder", "x-actor-kind": "human" },
  });
  const founderHttp = await httpJson(`${runtime.contextBaseUrl}/v1/context?scope=company`, {
    headers: founder,
  });

  const agentOverwrite = await httpJson(`${runtime.contextBaseUrl}/v1/directives`, {
    method: "POST",
    headers: { ...runtime.agentHeaders, "content-type": "application/json" },
    body: JSON.stringify({
      kind: "decision",
      title: "agent tries to overwrite founder",
      body: "must be denied",
      scope: "company",
      source: { system: "agent", kind: "directive", locator: "illegal" },
      observed_at: LIVE_NOW,
      freshness_status: "FRESH",
      confidence: 1,
    }),
  });

  const collectorKey = "github:repo:Governance:cursor:live";
  const firstRun = await runtime.persistence.startCollectorRun({
    collectorName: "github",
    idempotencyKey: collectorKey,
    scope: "repo:tjsasakifln/Governance",
    source: { system: "github", kind: "collector", locator: collectorKey },
    observedAt: new Date(LIVE_NOW),
    freshnessStatus: "FRESH",
    confidence: 0.8,
  });
  const retryRun = await runtime.persistence.startCollectorRun({
    collectorName: "github",
    idempotencyKey: collectorKey,
    scope: "repo:tjsasakifln/Governance",
    source: { system: "github", kind: "collector", locator: collectorKey },
    observedAt: new Date(LIVE_NOW),
    freshnessStatus: "FRESH",
    confidence: 0.8,
  });
  if (firstRun.inserted) {
    await runtime.persistence.finishCollectorRun({
      id: firstRun.run.id,
      status: "succeeded",
      observedAt: new Date(LIVE_NOW),
      freshnessStatus: "FRESH",
      confidence: 0.8,
    });
  }

  await githubCollect("empty-issues");
  await githubCollect("error-403");

  let asaasDenied = false;
  try {
    assertGetAllowed("POST", "/v3/payments");
  } catch (err) {
    asaasDenied = err instanceof AsaasMutationForbiddenError;
  }
  const warmblyClassified = classifyRequest("POST", "/v1/contacts");
  const warmbly = new WarmblyClient({
    baseUrl: "http://127.0.0.1:9",
    token: "wb_synthetic",
    fetchImpl: async () => {
      throw new Error("Warmbly fetch must not run for denied mutations");
    },
    logger: () => undefined,
  });
  let warmblyDenied = false;
  try {
    await warmbly.request({ method: "POST", path: "/v1/contacts" });
  } catch (err) {
    warmblyDenied = err instanceof Error && err.name === "MethodNotAllowedError";
  }

  const pncpCtx = {
    adapterKind: "file" as const,
    locator: "connectors/pncp/fixtures",
    collectedAt: new Date(LIVE_NOW),
  };
  evaluatePncpContractPayload(
    JSON.parse(readFileSync(join(ccRoot, "connectors/pncp/fixtures/contract-fresh.json"), "utf8")),
    pncpCtx,
  );
  evaluatePncpContractPayload(
    JSON.parse(readFileSync(join(ccRoot, "connectors/pncp/fixtures/contract-degraded.json"), "utf8")),
    pncpCtx,
  );
  await evaluatePncpFreshness({
    kind: "file",
    filePath: join(ccRoot, "connectors/pncp/fixtures/contract-malformed.json"),
    now: new Date(LIVE_NOW),
  });

  const infraRaw = JSON.parse(
    readFileSync(join(ccRoot, "connectors/infrastructure/fixtures/partial-outage.json"), "utf8"),
  ) as unknown;
  const infraFixture = parseFixture(infraRaw);
  const infra = await collectInfra({
    allowlist: infraFixture.allowlist,
    ports: createFixturePorts(infraFixture),
  });

  const finance = aggregateFinanceReadModel(financeEvents(), {
    as_of: LIVE_AS_OF,
    cash_in_window: { from: "2026-08-01T00:00:00.000Z", to: "2026-08-31T23:59:59.000Z" },
  });
  const financeStub = toContractsStub(finance);

  const spoofIdentity = parseForwardAuthIdentity(
    {
      remoteAddress: "203.0.113.9",
      headers: {
        "Remote-User": "founder-local",
        "Remote-Groups": "operators",
        "Remote-Name": "Founder",
        "Remote-Email": "founder@confenge.invalid",
      },
    },
    defaultTrustedHopPolicy(["10.89.0.0/24", "127.0.0.1/32"]),
  );
  const founderIdentity = parseForwardAuthIdentity(
    {
      remoteAddress: "127.0.0.1",
      headers: {
        "Remote-User": "founder-local",
        "Remote-Groups": "operators",
        "Remote-Name": "Founder",
        "Remote-Email": "founder@confenge.invalid",
      },
    },
    defaultTrustedHopPolicy(["127.0.0.1/32"]),
  );

  const caddy = analyzeCaddyfile(
    readFileSync(join(ccRoot, "security/examples/valid/Caddyfile"), "utf8"),
  );

  const httpDirectives = [
    ...asArray(companyBody.active_directives),
    ...asArray(commercialBody.active_directives),
    ...asArray(infraBody.active_directives),
    ...asArray(acmeBody.active_directives),
  ];
  const superseded = await httpJson(
    `${runtime.contextBaseUrl}/v1/directives/${encodeURIComponent(runtime.seeded.supersededDecisionId)}`,
    { headers: founder },
  );
  const uniqueDirectives = new Map<string, Record<string, unknown>>();
  for (const row of httpDirectives) {
    const mapped = directiveFromHttp(row);
    if (mapped && typeof mapped.id === "string" && mapped.id) {
      uniqueDirectives.set(mapped.id, mapped);
    }
  }
  const supersededMapped = directiveFromHttp(superseded.body);
  if (supersededMapped && typeof supersededMapped.id === "string") {
    uniqueDirectives.set(supersededMapped.id, supersededMapped);
  }

  const freshnessRecords: Array<Record<string, unknown>> = [];
  for (const [scope, body] of scoped.entries()) {
    for (const row of asArray(body.active_directives)) {
      const rec = asRecord(row) ?? {};
      const freshness = String(rec.freshness_status ?? body.freshness_status ?? "UNKNOWN");
      freshnessRecords.push({
        id: String(rec.id ?? `${scope}-row`),
        scope: String(rec.scope ?? scope),
        freshness_status: freshness,
        observed_at: observedAt(rec.observed_at ?? body.observed_at),
        freshness_window_seconds: 86400,
        presented_as: freshness,
        health_status: freshness,
      });
    }
  }
  for (const pageResult of [hoje, comercialPage, infraPage, financeiroPage]) {
    if (!pageResult.ok || pageResult.loading) {
      continue;
    }
    // The rendered health word and the rendered freshness pill are separate
    // signals. Echoing freshness into both made the evaluator compare freshness
    // to itself, so it could never fail.
    for (const presented of collectPresentedFreshness(pageResult.page)) {
      freshnessRecords.push({ ...presented, observed_at: observedAt(presented.observed_at) });
    }
  }

  const instants = freshnessRecords.map((row) => ({
    id: String(row.id),
    observed_at: String(row.observed_at),
    presented_calendar_date: saoPauloCalendarDate(String(row.observed_at)),
    classified_using_utc_calendar: false,
  }));

  const provenanceRecords = freshnessRecords.map((row) => {
    const src = httpDirectives
      .map((item) => asRecord(item) ?? {})
      .find((item) => String(item.id) === String(row.id));
    const source =
      asRecord(src?.source) ??
      asRecord(asRecord(scoped.get(String(row.scope ?? "company")))?.source) ?? {
        system: "control-center",
        kind: "context",
        locator: String(row.scope ?? "company"),
      };
    return {
      id: row.id,
      provenance: {
        source,
        observed_at: row.observed_at,
        freshness_status: row.freshness_status,
        confidence:
          typeof src?.confidence === "number"
            ? src.confidence
            : typeof asRecord(scoped.get(String(row.scope ?? "company")))?.confidence === "number"
              ? asRecord(scoped.get(String(row.scope ?? "company")))?.confidence
              : 1,
      },
    };
  });

  const activityList = asArray(asRecord(activities.body)?.items);
  const sessions = activityList.map((row) => {
    const rec = asRecord(row) ?? {};
    return {
      id: String(rec.id ?? rec.correlation_id ?? ""),
      agent_id: String(rec.agent_id ?? rec.actor ?? "agent"),
      status: String(rec.status ?? "done"),
      started_at: observedAt(rec.started_at ?? rec.observed_at),
      ended_at: rec.finished_at ?? rec.ended_at ?? null,
      ttl_seconds: 14400,
      granted_scopes: ["company"],
    };
  });

  const overallHealthy = infra.service_health.every((h) => h.status === "healthy");
  const mcpMutationDenied =
    (mcpMutation.error as { data?: { error?: { code?: string } } } | undefined)?.data?.error?.code ===
    "FORBIDDEN_MUTATION";

  return {
    as_of: LIVE_AS_OF,
    freshness: { as_of: LIVE_AS_OF, records: freshnessRecords },
    ledger: {
      currency: financeStub.receivables_open.currency,
      reported_totals: {
        receivables_open_cents: financeStub.receivables_open.amount_cents,
        receivables_overdue_cents: financeStub.receivables_overdue.amount_cents,
      },
      lines: [
        {
          source_payment_id: `${finance.id}:receivables_open`,
          amount_cents: financeStub.receivables_open.amount_cents,
          currency: financeStub.receivables_open.currency,
          bucket: "open",
        },
        {
          source_payment_id: `${finance.id}:receivables_overdue`,
          amount_cents: financeStub.receivables_overdue.amount_cents,
          currency: financeStub.receivables_overdue.currency,
          bucket: "overdue",
        },
      ].filter((line) => line.amount_cents > 0),
    },
    directives: { directives: [...uniqueDirectives.values()] },
    scopes: {
      requested_scopes: ["client:acme"],
      granted_scopes: [
        ...expandInheritedScopes("client:acme", { "tjsasakifln/Governance": "commercial" }),
      ],
      resources: asArray(acmeBody.active_directives).map((row) => {
        const rec = asRecord(row) ?? {};
        return { id: String(rec.id ?? ""), scope: String(rec.scope ?? "") };
      }),
    },
    events: {
      events: [
        {
          id: firstRun.run.id,
          collector_name: "github",
          idempotency_key: collectorKey,
          status: firstRun.inserted ? "succeeded" : "skipped",
          applied: firstRun.inserted,
          read_only: true,
        },
        {
          id: retryRun.run.id,
          collector_name: "github",
          idempotency_key: collectorKey,
          status: retryRun.inserted ? "succeeded" : "skipped",
          applied: retryRun.inserted,
          read_only: true,
        },
      ],
    },
    operations: {
      operations: [
        { name: "confenge.get_context", read_only: true },
        { name: "confenge.report_session_result", read_only: false },
      ],
      collectors: [
        { name: "github", read_only: true },
        { name: "warmbly", read_only: true },
        { name: "asaas", read_only: true },
      ],
      finance_snapshots: [
        {
          id: finance.id,
          read_model_only: finance.read_model_only,
          provider_mutations: finance.provider_mutations,
        },
      ],
      denials: {
        asaas_mutation: asaasDenied,
        warmbly_mutation: warmblyDenied && warmblyClassified.allowed === false,
        agent_directive: agentOverwrite.status === 403,
        mcp_decision_mutation: mcpMutationDenied,
      },
    },
    surfaces: {
      surfaces: {
        log_line: "collector github finished observations=0 request_id=req_live",
        url: `${runtime.contextBaseUrl}/v1/context?scope=client:acme`,
        payload: {
          actor_id: FOUNDER.id,
          idempotency_key: collectorKey,
          activity_count: activityList.length,
          unauth_status: unauthHttp.status,
          spoof_status: spoofHttp.status,
        },
        cors: CORS_POLICY.mode,
        csrf: CSRF_STRATEGY,
        cookies: COOKIE_POLICY,
        caddy_cors_wildcard: caddy.corsWildcard,
      },
    },
    instants: { instants },
    health: {
      overall_status: overallHealthy ? "healthy" : "degraded",
      checks: infra.service_health.map((h) => ({
        name: h.display_name,
        status: h.status,
      })),
      required_sources: infra.observations.map((obs) => ({
        name: obs.target_id,
        system: obs.source,
        status: obs.freshness_status,
        freshness_status: obs.freshness_status,
      })),
      collector_runs: [
        {
          collector_name: infra.collector_run.collector_id,
          status: infra.exceptions.length > 0 ? "failed" : "succeeded",
          error: infra.exceptions[0] ?? null,
        },
      ],
    },
    sessions: { as_of: LIVE_AS_OF, sessions },
    auth: {
      authenticated: founderHttp.status === 200 && unauthHttp.status >= 400 && spoofHttp.status >= 400,
      action: "get_context",
      identity_source: "session",
      assume_founder: false,
      empty_scopes_mean: "deny",
      empty_scopes_policy: "deny",
      granted_scopes: founderHttp.status === 200 ? ["company"] : [],
      actor:
        founderHttp.status === 200
          ? { kind: "human", id: FOUNDER.id, role: "founder" }
          : { kind: "human", id: "" },
      spoof_denied: spoofIdentity.ok === false,
      founder_identity_ok: founderIdentity.ok === true,
    },
    aggregates: { records: provenanceRecords },
  };
}

export async function collectAndStop(): Promise<{ snapshot: LiveSnapshot; runtimeNotes: string[] }> {
  const runtime = await bootLiveRuntime();
  try {
    const snapshot = await collectLiveSnapshot(runtime);
    return { snapshot, runtimeNotes: [`context=${runtime.contextBaseUrl}`, `mcp=${runtime.mcpBaseUrl}`] };
  } finally {
    await runtime.stop();
  }
}
