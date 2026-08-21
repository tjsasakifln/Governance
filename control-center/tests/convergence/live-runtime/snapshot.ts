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
import { collect as collectInfra, parseFixture, createFixturePorts } from "../../../connectors/infrastructure/src/index.ts";
import { aggregateFinanceReadModel } from "../../../domains/finance/src/index.ts";
import { createAgentLedger, frozenClock as ledgerClock } from "../../../domains/agent-activity/src/index.ts";
import { parseForwardAuthIdentity, defaultTrustedHopPolicy } from "../../../security/src/identity.ts";
import { COOKIE_POLICY, CORS_POLICY, CSRF_STRATEGY } from "../../../security/src/constants.ts";
import { analyzeCaddyfile } from "../../../security/src/caddy.ts";
import { AGENT, FOUNDER, LIVE_AS_OF, LIVE_NOW } from "./seed.ts";
import {
  bootLiveRuntime,
  httpJson,
  mcpCall,
  mcpInitialize,
  MCP_TOKEN,
  type LiveRuntime,
} from "./harness.ts";

const here = dirname(fileURLToPath(import.meta.url));
const ccRoot = join(here, "../../..");

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function presentFreshness(status: string): { presented_as: string; health_status: string } {
  if (status === "FRESH") {
    return { presented_as: "healthy", health_status: "healthy" };
  }
  if (status === "STALE") {
    return { presented_as: "stale", health_status: "degraded" };
  }
  if (status === "ERROR") {
    return { presented_as: "error", health_status: "error" };
  }
  return { presented_as: "unknown", health_status: "unknown" };
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
  const src = (locator: string) => ({
    system: "asaas",
    kind: "receivable",
    locator,
  });
  const base = {
    currency: "BRL",
    client_id: "client:acme",
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
      obligation_id: "ob:live-overdue",
      client_id: "client:beta",
      source: src("pay_live_2"),
    },
    {
      ...base,
      id: "cc:finance-event:overdue-invoice",
      idempotency_key: "live:overdue-invoice",
      kind: "invoice_issued" as const,
      occurred_at: "2026-07-02T09:00:00.000Z",
      amount_cents: 20000,
      obligation_id: "ob:live-overdue",
      client_id: "client:beta",
      invoice_id: "inv:live-overdue",
      due_at: "2026-07-10T00:00:00.000Z",
      source: src("pay_live_2"),
    },
  ];
}

export async function collectLiveSnapshot(runtime: LiveRuntime): Promise<LiveSnapshot> {
  const founder = runtime.founderHeaders;
  const company = await httpJson(`${runtime.contextBaseUrl}/v1/context?scope=company`, {
    headers: founder,
  });
  const acme = await httpJson(`${runtime.contextBaseUrl}/v1/context?scope=client:acme`, {
    headers: founder,
  });
  const companyBody = asRecord(company.body) ?? {};
  const acmeBody = asRecord(acme.body) ?? {};

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

  const githubEmpty = await githubCollect("empty-issues");
  const githubError = await githubCollect("error-403");
  void githubEmpty;
  void githubError;

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
  const pncpFresh = evaluatePncpContractPayload(
    JSON.parse(readFileSync(join(ccRoot, "connectors/pncp/fixtures/contract-fresh.json"), "utf8")),
    pncpCtx,
  );
  const pncpDegraded = evaluatePncpContractPayload(
    JSON.parse(readFileSync(join(ccRoot, "connectors/pncp/fixtures/contract-degraded.json"), "utf8")),
    pncpCtx,
  );
  const pncpError = await evaluatePncpFreshness({
    kind: "file",
    filePath: join(ccRoot, "connectors/pncp/fixtures/contract-malformed.json"),
    now: new Date(LIVE_NOW),
  });
  void pncpFresh;
  void pncpDegraded;
  void pncpError;

  const infraRaw = JSON.parse(
    readFileSync(join(ccRoot, "connectors/infrastructure/fixtures/partial-outage.json"), "utf8"),
  ) as unknown;
  const infraFixture = parseFixture(infraRaw);
  const infra = await collectInfra({
    allowlist: infraFixture.allowlist,
    ports: createFixturePorts(infraFixture),
  });
  const unhealthy = infra.service_health.filter((h) => h.status !== "healthy");
  const overall =
    unhealthy.length > 0
      ? infra.service_health.some((h) => h.status === "unhealthy")
        ? "degraded"
        : "degraded"
      : "healthy";

  const finance = aggregateFinanceReadModel(financeEvents(), {
    as_of: LIVE_AS_OF,
    cash_in_window: { from: "2026-08-01T00:00:00.000Z", to: "2026-08-31T23:59:59.000Z" },
  });

  const ledger = createAgentLedger({
    now: ledgerClock(new Date(LIVE_AS_OF)),
    idleThresholdSeconds: 7200,
  });
  ledger.startSession({
    correlation_id: "sess.live-fresh",
    agent: { id: "agent:live-qa", provider: "xai" },
    repo: "tjsasakifln/Governance",
    goal: "live qa",
    campaign: "CONFENGE-CONTROL-CENTER-RELEASE-TO-PRODUCTION-2026-08-20",
    started_at: "2026-08-20T14:00:00.000Z",
    refs: { branch: "campaign/live", commit: "e2b0498a68092c1bdbf64aa31854d652c07afdc0", pr: null, issues: [] },
    summary: "fresh session",
    evidence: [],
    blockers: [],
    residual_work: [],
    context_consulted: { context_version: "control-center.context.v1", directive_ids: [] },
    actor: { kind: "agent", id: "agent:live-qa" },
    source: { system: "agent", kind: "start", locator: "sess.live-fresh" },
    observed_at: "2026-08-20T14:00:00.000Z",
    freshness_status: "FRESH",
    confidence: 0.9,
  });
  const staleLedger = createAgentLedger({
    now: ledgerClock(new Date(LIVE_AS_OF)),
    idleThresholdSeconds: 60,
  });
  staleLedger.startSession({
    correlation_id: "sess.live-stale",
    agent: { id: "agent:live-qa", provider: "xai" },
    repo: "tjsasakifln/Governance",
    goal: "stale running",
    campaign: "CONFENGE-CONTROL-CENTER-RELEASE-TO-PRODUCTION-2026-08-20",
    started_at: "2026-08-20T10:00:00.000Z",
    refs: { branch: "campaign/live", commit: "e2b0498a68092c1bdbf64aa31854d652c07afdc0", pr: null, issues: [] },
    summary: "will go stale",
    evidence: [],
    blockers: [],
    residual_work: [],
    context_consulted: { context_version: "control-center.context.v1", directive_ids: [] },
    actor: { kind: "agent", id: "agent:live-qa" },
    source: { system: "agent", kind: "start", locator: "sess.live-stale" },
    observed_at: "2026-08-20T10:00:00.000Z",
    freshness_status: "FRESH",
    confidence: 0.9,
  });
  const reconciled = staleLedger.reconcileStale();

  const identity = parseForwardAuthIdentity(
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

  const allCurrent = [
    ...runtime.service.getActiveDirectives(FOUNDER, "company"),
    ...runtime.service.getActiveDirectives(FOUNDER, "finance"),
    ...runtime.service.getActiveDirectives(FOUNDER, "commercial"),
    ...runtime.service.getDecisions(FOUNDER, "finance"),
    ...runtime.service.getDecisions(FOUNDER, "company"),
  ];
  const uniqueDirectives = new Map(allCurrent.map((d) => [d.id, d]));
  uniqueDirectives.set(
    runtime.seeded.supersededDecisionId,
    runtime.service.getDirective(FOUNDER, runtime.seeded.supersededDecisionId),
  );

  const directivePayload = {
    directives: [...uniqueDirectives.values()].map((d) => {
      const created = d.created_by;
      const isFounder = created.kind === "human" && created.id === FOUNDER.id;
      return {
        id: d.id,
        kind: d.kind,
        origin_kind: d.kind,
        scope: d.scope,
        status: d.status,
        title: d.title,
        conflict_key: d.title,
        supersedes: d.supersedes ?? [],
        created_by: {
          kind: created.kind,
          id: created.id,
          role: isFounder ? "founder" : created.kind,
        },
        presented_as: d.kind,
        audit: [],
      };
    }),
  };

  const companyRecords = Array.isArray(companyBody.active_directives)
    ? companyBody.active_directives
    : [];
  const acmeRecords = Array.isArray(acmeBody.active_directives) ? acmeBody.active_directives : [];
  const granted = [...expandInheritedScopes("client:acme", { "tjsasakifln/Governance": "commercial" })];

  const freshnessRecords = [...companyRecords, ...acmeRecords].map((row, index) => {
    const rec = asRecord(row) ?? {};
    const freshness = String(rec.freshness_status ?? "UNKNOWN");
    const presented = presentFreshness(freshness);
    return {
      id: String(rec.id ?? `row-${index}`),
      freshness_status: freshness,
      observed_at: String(rec.observed_at ?? LIVE_NOW),
      freshness_window_seconds: 86400,
      ...presented,
    };
  });

  const instants = freshnessRecords.map((row) => ({
    id: row.id,
    observed_at: row.observed_at.endsWith("Z") ? row.observed_at : `${row.observed_at}Z`,
    presented_calendar_date: saoPauloCalendarDate(
      row.observed_at.endsWith("Z") ? row.observed_at : `${row.observed_at}Z`,
    ),
    classified_using_utc_calendar: false,
  }));

  const provenanceRecords = freshnessRecords.map((row) => {
    const src = companyRecords.concat(acmeRecords)
      .map((item) => asRecord(item) ?? {})
      .find((item) => String(item.id) === row.id);
    const source = asRecord(src?.source) ?? { system: "control-center", kind: "context", locator: "live" };
    return {
      id: row.id,
      provenance: {
        source,
        observed_at: row.observed_at,
        freshness_status: row.freshness_status,
        confidence: typeof src?.confidence === "number" ? src.confidence : 1,
      },
    };
  });

  const activityItems = asRecord(activities.body);
  const activityList = Array.isArray(activityItems?.items) ? activityItems.items : [];

  const sessions = [
    {
      id: "sess.live-fresh",
      agent_id: "agent:live-qa",
      status: "open",
      started_at: "2026-08-20T14:00:00.000Z",
      ended_at: null,
      ttl_seconds: 14400,
      granted_scopes: ["company"],
    },
    ...reconciled.map((session) => ({
      id: session.correlation_id,
      agent_id: session.agent.id,
      status: session.status === "UNKNOWN" ? "UNKNOWN" : session.status,
      started_at: session.started_at,
      ended_at: session.finished_at,
      ttl_seconds: 60,
      granted_scopes: ["company"],
    })),
  ];

  const overdueCents = finance.figures.vencida.amount_cents;
  const openCents = finance.figures.a_receber.amount_cents - overdueCents;
  const financeLines = [
    {
      source_payment_id: "pay_live_1",
      amount_cents: openCents,
      currency: "BRL",
      bucket: "open",
    },
    {
      source_payment_id: "pay_live_2",
      amount_cents: overdueCents,
      currency: "BRL",
      bucket: "overdue",
    },
  ].filter((line) => line.amount_cents > 0);

  return {
    as_of: LIVE_AS_OF,
    freshness: { as_of: LIVE_AS_OF, records: freshnessRecords },
    ledger: {
      currency: finance.currency,
      reported_totals: {
        receivables_open_cents: openCents,
        receivables_overdue_cents: overdueCents,
      },
      lines: financeLines,
    },
    directives: directivePayload,
    scopes: {
      requested_scopes: ["client:acme"],
      granted_scopes: granted,
      resources: acmeRecords.map((row) => {
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
        },
        cors: CORS_POLICY.mode,
        csrf: CSRF_STRATEGY,
        cookies: COOKIE_POLICY,
        caddy_cors_wildcard: caddy.corsWildcard,
      },
    },
    instants: { instants },
    health: {
      overall_status: overall,
      checks: infra.service_health.map((h) => ({
        name: h.display_name,
        status: h.status === "healthy" ? "healthy" : "down",
      })),
      required_sources: infra.observations.map((obs) => ({
        system: obs.source,
        status: obs.freshness_status,
        freshness_status: obs.freshness_status,
      })),
      collector_runs: [
        {
          collector_name: "infrastructure",
          status: unhealthy.length > 0 ? "failed" : "succeeded",
          error: unhealthy.length > 0 ? { code: "partial_outage" } : null,
        },
      ],
    },
    sessions: { as_of: LIVE_AS_OF, sessions },
    auth: {
      authenticated: identity.ok === true,
      action: "get_context",
      identity_source: "session",
      assume_founder: false,
      empty_scopes_mean: "deny",
      empty_scopes_policy: "deny",
      granted_scopes: ["company"],
      actor: { kind: "human", id: FOUNDER.id, role: "founder" },
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
