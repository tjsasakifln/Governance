import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { migrateDown, migrateUp, REQUIRED_TABLES } from "../../persistence/src/index.js";
import { startIsolatedTestPostgres } from "../../persistence/tests/helpers/postgres.js";
import { provenance } from "../../persistence/tests/helpers/fixtures.js";
import { isServiceError } from "../../services/context/src/errors.ts";
import { expandInheritedScopes, scopeVisibleUnderQuery } from "../../services/context/src/scope.ts";
import { assertGetAllowed } from "../../connectors/asaas/src/allowlist.ts";
import { AsaasMutationForbiddenError } from "../../connectors/asaas/src/errors.ts";
import {
  collect as collectGithub,
  loadFixtureDir,
  MemoryEtagStore,
  parseCollectConfig,
} from "../../connectors/github/src/index.ts";
import { classifyRequest, WarmblyClient } from "../../connectors/warmbly/src/index.ts";
import { evaluatePncpContractPayload, mapUpstreamStatus } from "../../connectors/pncp/src/index.ts";
import { collect as collectInfra, createFixturePorts, parseFixture } from "../../connectors/infrastructure/src/index.ts";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { aggregateFinanceReadModel } from "../../domains/finance/src/index.ts";
import { createAgentLedger, frozenClock } from "../../domains/agent-activity/src/index.ts";
import { DEFAULT_SCORING_CONFIG, rankAttention } from "../../intelligence/attention/src/index.ts";
import { SCOPE_PATTERN as ATTENTION_SCOPE_PATTERN } from "../../intelligence/attention/src/taxonomy.ts";
import {
  isScope,
  MIN_CLIENT_SLUG_LENGTH,
  RESERVED_CLIENT_SLUGS,
} from "../../contracts/src/index.ts";
import {
  MIN_CLIENT_SLUG_LENGTH as CLIENTS_DOMAIN_MIN_SLUG_LENGTH,
  RESERVED_CLIENT_SLUGS as CLIENTS_DOMAIN_RESERVED_SLUGS,
} from "../../domains/clients/src/index.ts";
import { projectCollector } from "../../connectors/runner/src/projectors/project.ts";
import { signalsFromSlot } from "../../services/context/src/operational/signals.ts";
import type { DomainSlot } from "../../services/context/src/operational/types.ts";
import {
  AGENT,
  FOUNDER,
  LIVE_AS_OF,
  LIVE_NOW,
} from "./live-runtime/seed.ts";
import {
  bootLiveRuntime,
  httpJson,
  mcpCall,
  mcpInitialize,
  MCP_TOKEN,
  type LiveRuntime,
} from "./live-runtime/harness.ts";

const ccRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

let runtime: LiveRuntime;

before(async () => {
  runtime = await bootLiveRuntime();
});

after(async () => {
  await runtime.stop();
});

test("Postgres migrate up-down-up is idempotent and named objects return", async () => {
  const pg = await startIsolatedTestPostgres();
  try {
    const first = await migrateUp(pg.pool);
    assert.ok(first.includes("001_init"));
    const down = await migrateDown(pg.pool);
    assert.ok(down.length > 0);
    const second = await migrateUp(pg.pool);
    assert.deepEqual(second, first);
    const named = await pg.persistence.listNamedObjects();
    for (const table of REQUIRED_TABLES) {
      assert.ok(named.tables.includes(table), table);
    }
  } finally {
    await pg.stop();
  }
});

test("collector apply is idempotent and revisions are append-only with multi-supersede", async () => {
  const pg = runtime.pg;
  const key = "github:live:idempotent";
  const input = {
    collectorName: "github",
    idempotencyKey: key,
    scope: "company",
    ...provenance("company"),
    source: { system: "github", kind: "collector", locator: key },
  };
  const a = await pg.persistence.startCollectorRun(input);
  const b = await pg.persistence.startCollectorRun(input);
  assert.equal(a.inserted, true);
  assert.equal(b.inserted, false);
  assert.equal(a.run.id, b.run.id);
  assert.equal(await pg.persistence.countCollectorRunsByIdempotencyKey(key), 1);

  const first = await pg.persistence.createDirective({
    kind: "decision",
    title: "First price",
    body: "v1",
    effectiveFrom: new Date("2026-04-01T00:00:00.000Z"),
    ...provenance("finance"),
  });
  const original = await pg.pool.query(
    `SELECT id, title, body FROM control_center.directive_revisions WHERE id = $1`,
    [first.revision.id],
  );
  const snapshot = JSON.stringify(original.rows[0]);
  const second = await pg.persistence.supersedeDirective({
    existingId: first.directive.id,
    kind: "decision",
    title: "Second price",
    body: "v2",
    effectiveFrom: new Date("2026-04-02T00:00:00.000Z"),
    ...provenance("finance"),
  });
  const third = await pg.persistence.supersedeDirective({
    existingId: second.replacement.id,
    kind: "decision",
    title: "Third price",
    body: "v3",
    effectiveFrom: new Date("2026-04-03T00:00:00.000Z"),
    ...provenance("finance"),
  });
  const after = await pg.pool.query(
    `SELECT id, title, body FROM control_center.directive_revisions WHERE id = $1`,
    [first.revision.id],
  );
  assert.equal(JSON.stringify(after.rows[0]), snapshot);
  assert.deepEqual(third.replacement.supersedes, [second.replacement.id]);
  await assert.rejects(
    () =>
      pg.pool.query(`UPDATE control_center.directive_revisions SET title = 'mutated' WHERE id = $1`, [
        first.revision.id,
      ]),
    /append-only/,
  );
});

test("context inherits ancestors, denies sibling leak, founder authority, agent proposal, ERROR preserved", async () => {
  const acme = runtime.service.getContext(FOUNDER, "client:acme");
  const inherited = expandInheritedScopes("client:acme", {});
  assert.ok(inherited.includes("company"));
  assert.ok(inherited.includes("clients"));
  assert.ok(inherited.includes("client:acme"));
  assert.equal(
    acme.active_directives.some((d) => d.scope === "client:other"),
    false,
  );
  assert.equal(scopeVisibleUnderQuery("client:other", "client:acme", {}), false);
  assert.ok(acme.active_directives.some((d) => d.scope === "client:acme"));
  assert.ok(acme.active_directives.some((d) => d.scope === "company"));

  const errorRow = acme.active_directives
    .concat(runtime.service.getContext(FOUNDER, "infrastructure").active_directives)
    .find((d) => d.freshness_status === "ERROR");
  assert.ok(errorRow);
  assert.equal(errorRow.freshness_status, "ERROR");

  let agentDenied = false;
  try {
    runtime.service.createDirective(AGENT, {
      kind: "decision",
      title: "agent overwrite",
      body: "must fail",
      scope: "company",
      source: { system: "agent", kind: "directive", locator: "x" },
      observed_at: LIVE_NOW,
      freshness_status: "FRESH",
      confidence: 1,
    });
  } catch (err) {
    agentDenied = isServiceError(err) && err.code === "agent_mutation_forbidden";
  }
  assert.equal(agentDenied, true);

  const proposals = runtime.service.listProposals(FOUNDER);
  assert.ok(proposals.some((p) => p.status === "pending" && p.created_by.kind === "agent"));
  assert.equal(
    proposals.some((p) => p.kind === "decision" && p.status === "active"),
    false,
  );
});

test("MCP auth, reads, report persist as AgentActivity, decision mutation denied", async () => {
  await mcpInitialize(runtime.mcp);
  const unauth = await mcpCall(runtime.mcp, "confenge.get_context", { scope: "company" }, "");
  const unauthErr = unauth.error as { code?: string } | undefined;
  assert.ok(unauthErr);
  assert.equal(unauthErr.code === "UNAUTHENTICATED" || unauth.result === undefined, true);

  const read = await mcpCall(runtime.mcp, "confenge.get_context", { scope: "company" });
  const structured = (read.result as { structuredContent?: { data?: Record<string, unknown> } } | undefined)
    ?.structuredContent?.data;
  let readData = structured;
  if (!readData) {
    const content = (read.result as { content?: Array<{ text?: string }> } | undefined)?.content?.[0]?.text;
    const parsed = content ? (JSON.parse(content) as { data?: Record<string, unknown> }) : {};
    readData = parsed.data;
  }
  assert.ok(readData);
  assert.ok(readData.freshness_status);
  assert.ok(String(readData.observed_at).endsWith("Z"));
  assert.ok(readData.source);

  const mutate = await mcpCall(runtime.mcp, "confenge.update_decision", {
    kind: "decision",
    action: "update",
  });
  const mutateCode = (mutate.error as { data?: { error?: { code?: string } } } | undefined)?.data
    ?.error?.code;
  assert.equal(mutateCode, "FORBIDDEN_MUTATION");

  const reported = await mcpCall(runtime.mcp, "confenge.report_session_result", {
    scope: "company",
    summary: "domain-gate session result",
    outcome: "completed",
    session_id: "sess-domain-gate",
  });
  assert.equal(reported.error, undefined);
  const blocker = await mcpCall(runtime.mcp, "confenge.report_blocker", {
    scope: "company",
    summary: "domain-gate blocker",
    severity: "medium",
    blocking: true,
  });
  assert.equal(blocker.error, undefined);

  const listed = await httpJson(`${runtime.contextBaseUrl}/v1/agent-activities?scope=company`, {
    headers: runtime.founderHeaders,
  });
  const items = Array.isArray((listed.body as { items?: unknown[] }).items)
    ? (listed.body as { items: Array<{ summary?: string; kind?: string }> }).items
    : [];
  assert.ok(items.some((row) => row.summary === "domain-gate session result"));
  assert.ok(items.some((row) => row.kind === "blocker" || row.summary === "domain-gate blocker"));
});

test("GitHub empty vs error, Warmbly RO, Asaas deny, PNCP map, infra partial outage", async () => {
  async function gh(name: string) {
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
    assert.equal(parsed.ok, true);
    if (!parsed.ok) throw new Error(parsed.message);
    return collectGithub(parsed.config);
  }
  const empty = await gh("empty-issues");
  const error = await gh("error-403");
  const emptyRepo = empty.snapshot.repos[0];
  const errorRepo = error.snapshot.repos[0];
  assert.ok(emptyRepo);
  assert.ok(errorRepo);
  assert.equal(emptyRepo.issues_collection.ok, true);
  assert.deepEqual(emptyRepo.open_issues, []);
  assert.equal(errorRepo.issues_collection.ok, false);
  assert.notEqual(error.snapshot.freshness_status, empty.snapshot.freshness_status);

  assert.equal(classifyRequest("POST", "/v1/contacts").allowed, false);
  const client = new WarmblyClient({
    baseUrl: "http://127.0.0.1:9",
    token: "wb_synthetic",
    fetchImpl: async () => {
      throw new Error("denied mutation must not fetch");
    },
    logger: () => undefined,
  });
  await assert.rejects(() => client.request({ method: "POST", path: "/v1/campaigns/x" }));

  assert.throws(() => assertGetAllowed("POST", "/v3/payments"), AsaasMutationForbiddenError);
  assert.throws(() => assertGetAllowed("GET", "/v3/payments/x/refund"), AsaasMutationForbiddenError);

  assert.equal(mapUpstreamStatus("FRESH").freshness_status, "FRESH");
  assert.equal(mapUpstreamStatus("DEGRADED").freshness_status, "STALE");
  assert.equal(mapUpstreamStatus("STALE").freshness_status, "STALE");
  assert.equal(mapUpstreamStatus("UNKNOWN").freshness_status, "UNKNOWN");
  const malformed = evaluatePncpContractPayload(
    { not: "a contract" },
    {
      adapterKind: "file",
      locator: "inline",
      collectedAt: new Date(LIVE_NOW),
    },
  );
  assert.equal(malformed.freshness_status, "ERROR");
  assert.equal(malformed.sourceObservation.provenance.freshness_status, "ERROR");

  const infraRaw = JSON.parse(
    readFileSync(join(ccRoot, "connectors/infrastructure/fixtures/partial-outage.json"), "utf8"),
  ) as unknown;
  const fixture = parseFixture(infraRaw);
  const infra = await collectInfra({ allowlist: fixture.allowlist, ports: createFixturePorts(fixture) });
  assert.ok(infra.service_health.some((h) => h.status !== "healthy"));
  assert.equal(
    infra.service_health.every((h) => h.status === "healthy"),
    false,
  );
});

test("finance keeps contracted != billed != paid != received; refund distinct; no double count", () => {
  const model = aggregateFinanceReadModel(
    [
      {
        id: "cc:finance-event:c",
        idempotency_key: "gate:c",
        kind: "contract_signed",
        occurred_at: "2026-08-02T09:00:00.000Z",
        amount_cents: 100000,
        currency: "BRL",
        client_id: "client:acme",
        obligation_id: "ob:gate",
        billing_mode: "ONE_TIME",
        settlement_proven: false,
        source: { system: "asaas", kind: "charge", locator: "pay_gate" },
        observed_at: LIVE_NOW,
        freshness_status: "FRESH",
        confidence: 0.9,
      },
      {
        id: "cc:finance-event:i",
        idempotency_key: "gate:i",
        kind: "invoice_issued",
        occurred_at: "2026-08-03T09:00:00.000Z",
        amount_cents: 80000,
        currency: "BRL",
        client_id: "client:acme",
        obligation_id: "ob:gate",
        billing_mode: "ONE_TIME",
        settlement_proven: false,
        due_at: "2026-08-20T00:00:00.000Z",
        source: { system: "asaas", kind: "charge", locator: "pay_gate" },
        observed_at: LIVE_NOW,
        freshness_status: "FRESH",
        confidence: 0.9,
      },
      {
        id: "cc:finance-event:p",
        idempotency_key: "gate:p",
        kind: "payment_confirmed",
        occurred_at: "2026-08-04T09:00:00.000Z",
        amount_cents: 60000,
        currency: "BRL",
        client_id: "client:acme",
        obligation_id: "ob:gate",
        billing_mode: "ONE_TIME",
        settlement_proven: false,
        source: { system: "asaas", kind: "charge", locator: "pay_gate" },
        observed_at: LIVE_NOW,
        freshness_status: "FRESH",
        confidence: 0.9,
      },
      {
        id: "cc:finance-event:r",
        idempotency_key: "gate:r",
        kind: "settlement_received",
        occurred_at: "2026-08-05T09:00:00.000Z",
        amount_cents: 50000,
        currency: "BRL",
        client_id: "client:acme",
        obligation_id: "ob:gate",
        billing_mode: "ONE_TIME",
        settlement_proven: true,
        source: { system: "asaas", kind: "receivable", locator: "pay_gate" },
        observed_at: LIVE_NOW,
        freshness_status: "FRESH",
        confidence: 0.9,
      },
      {
        id: "cc:finance-event:rf",
        idempotency_key: "gate:rf",
        kind: "refund",
        occurred_at: "2026-08-06T09:00:00.000Z",
        amount_cents: 10000,
        currency: "BRL",
        client_id: "client:acme",
        obligation_id: "ob:gate",
        billing_mode: "ONE_TIME",
        settlement_proven: false,
        source: { system: "asaas", kind: "charge", locator: "pay_gate_rf" },
        observed_at: LIVE_NOW,
        freshness_status: "FRESH",
        confidence: 0.9,
      },
      {
        id: "cc:finance-event:dup",
        idempotency_key: "gate:r",
        kind: "settlement_received",
        occurred_at: "2026-08-05T09:00:00.000Z",
        amount_cents: 50000,
        currency: "BRL",
        client_id: "client:acme",
        obligation_id: "ob:gate",
        billing_mode: "ONE_TIME",
        settlement_proven: true,
        source: { system: "asaas", kind: "receivable", locator: "pay_gate" },
        observed_at: LIVE_NOW,
        freshness_status: "FRESH",
        confidence: 0.9,
      },
    ],
    {
      as_of: LIVE_AS_OF,
      cash_in_window: { from: "2026-08-01T00:00:00.000Z", to: "2026-08-31T23:59:59.000Z" },
    },
  );
  const c = model.figures.receita_contratada.amount_cents;
  const b = model.figures.receita_faturada.amount_cents;
  const p = model.figures.receita_paga.amount_cents;
  const r = model.figures.efetivamente_recebida.amount_cents;
  assert.notEqual(c, b);
  assert.notEqual(b, p);
  assert.notEqual(p, r);
  assert.equal(r, 40000);
  assert.equal(model.read_model_only, true);
  assert.equal(model.provider_mutations, "forbidden");
  assert.equal(Number.isInteger(c), true);
  assert.equal(model.currency, "BRL");
});

test("stale RUNNING reconciles to UNKNOWN never DONE; attention is deterministic with stale penalty", () => {
  const ledger = createAgentLedger({
    now: frozenClock(new Date(LIVE_AS_OF)),
    idleThresholdSeconds: 60,
  });
  ledger.startSession({
    correlation_id: "sess.stale-running",
    agent: { id: "agent:live-qa", provider: "xai" },
    repo: "tjsasakifln/Governance",
    goal: "stale",
    started_at: "2026-08-20T10:00:00.000Z",
    actor: { kind: "agent", id: "agent:live-qa" },
    source: { system: "agent", kind: "start", locator: "sess.stale-running" },
    observed_at: "2026-08-20T10:00:00.000Z",
    freshness_status: "FRESH",
    confidence: 0.9,
  });
  const reconciled = ledger.reconcileStale();
  assert.equal(reconciled.length, 1);
  assert.equal(reconciled[0]?.status, "UNKNOWN");
  assert.notEqual(reconciled[0]?.status, "DONE");

  const signal = (id: string, freshness: "FRESH" | "STALE") => ({
    id,
    title: "Same work item",
    summary: "identical except freshness",
    category: "receita" as const,
    domain: "finance" as const,
    scope: "finance",
    impact: 80,
    urgency: 80,
    severity: "high" as const,
    status: "open" as const,
    correlation_key: id,
    evidence_refs: [{ source: { system: "asaas", kind: "receivable", locator: id } }],
    provenance: {
      source: { system: "asaas", kind: "receivable", locator: id },
      observed_at: LIVE_NOW,
      freshness_status: freshness,
      confidence: 0.9,
    },
  });
  const ranked = rankAttention({
    signals: [signal("cc:attention-item:fresh", "FRESH"), signal("cc:attention-item:stale", "STALE")],
    config: DEFAULT_SCORING_CONFIG,
    clock_now: LIVE_AS_OF,
    override: null,
  });
  const again = rankAttention({
    signals: [signal("cc:attention-item:fresh", "FRESH"), signal("cc:attention-item:stale", "STALE")],
    config: DEFAULT_SCORING_CONFIG,
    clock_now: LIVE_AS_OF,
    override: null,
  });
  assert.deepEqual(
    ranked.attention_now.map((i) => i.id),
    again.attention_now.map((i) => i.id),
  );
  const fresh = ranked.attention_now.find((i) => i.id === "cc:attention-item:fresh");
  const stale = ranked.attention_now.find((i) => i.id === "cc:attention-item:stale");
  assert.ok(fresh);
  assert.ok(stale);
  assert.ok(fresh.score_milli > stale.score_milli);
  assert.ok(ranked.attention_now.some((i) => i.title.startsWith("Dados stale:")));
});

/**
 * Client identity, end to end across the packages that own a piece of it:
 * the collector projector decides who is a client, the context risk engine
 * decides what that means for attention. The unit suites cannot see the seam
 * between them, and that seam is where "Cliente em risco operacional" was being
 * raised about nobody.
 */
const IDENTITY_NOW = "2026-08-21T12:00:00.000Z";

function clientsSlotFrom(payload: Record<string, unknown>): DomainSlot {
  return {
    schema_version: "control-center.operational-domain.v1",
    domain: "clients",
    scope: "clients",
    source: { system: "warmbly", kind: "client-ops", locator: "clients/roll-up" },
    observed_at: IDENTITY_NOW,
    freshness_status: "FRESH",
    confidence: 0.8,
    presence: "present",
    healthy: true,
    snapshot: payload,
  };
}

function clientsSnapshotOf(deals: Record<string, unknown>[], intelExceptions: Record<string, unknown>[]) {
  const projected = projectCollector({
    collector: "warmbly",
    freshness_status: "FRESH",
    observed_at: IDENTITY_NOW,
    source: { system: "warmbly", kind: "collector-runner", locator: "warmbly" },
    confidence: 0.8,
    payload: { counts: { deals_open: deals.length }, operations: { deals, intel_exceptions: intelExceptions } },
  });
  const clients = projected.find((row) => row.snapshot_kind === "clients");
  assert.ok(clients, "the collector must project a clients snapshot");
  return clients.payload;
}

test("unidentifiable deals plus commercial exceptions never raise a client-risk alert", () => {
  const payload = clientsSnapshotOf(
    [
      { id: "deal-healthy-1", name: "Diagnóstico — Construtora Beta", account_id: null, status: "open", updated_at: IDENTITY_NOW },
      { id: "deal-stalled-1", name: "Diagnóstico — Escritório Gama", account_id: null, status: "open", updated_at: IDENTITY_NOW },
    ],
    [{ id: "x1", why: "a" }, { id: "x2", why: "b" }],
  );
  assert.deepEqual(payload.clients, []);
  assert.equal(payload.client_count, 0);
  assert.equal(payload.open_blocker_count, 2);

  const signals = signalsFromSlot(clientsSlotFrom(payload));
  const risk = signals.find((item) => item.title === "Cliente em risco operacional");
  assert.equal(risk, undefined, "a commercial exception count is not a client at risk");
  // The queue is not silent either: it gets its own honest, lower-severity signal.
  const queue = signals.find((item) => item.title === "Registros sem identidade de cliente");
  assert.ok(queue, "the identity queue must surface as its own signal");
  assert.equal(queue.severity, "medium");
  assert.match(String(queue.recommended_action), /conta\/empresa/);
});

test("a real client at risk still raises the client-risk alert", () => {
  const payload = clientsSnapshotOf(
    [
      {
        id: "deal-1",
        name: "Diagnóstico — Acme",
        account_id: "acct-77",
        company: "Acme Indústria",
        status: "open",
        updated_at: IDENTITY_NOW,
      },
    ],
    [{ id: "x1", source_id: "deal-1", why: "cliente sem retorno" }],
  );
  assert.equal(payload.client_count, 1);
  assert.equal(payload.at_risk_client_count, 1);
  const risk = signalsFromSlot(clientsSlotFrom(payload)).find(
    (item) => item.title === "Cliente em risco operacional",
  );
  assert.ok(risk, "an identified client with an open exception is real client risk");
  assert.equal(risk.severity, "critical");
});

test("a hand-written snapshot cannot smuggle a placeholder client into the risk count", () => {
  const signals = signalsFromSlot(
    clientsSlotFrom({
      schema_version: "control-center.clients-snapshot.v1",
      at_risk_client_count: 3,
      open_blocker_count: 0,
      clients: [{ client_slug: "unknown", scope: "client:unknown", display_name: "Cliente" }],
    }),
  );
  assert.equal(
    signals.some((item) => item.title === "Cliente em risco operacional"),
    false,
  );
});

test("client identity mirrors do not drift from the contracts taxonomy", () => {
  // domains/clients and apps/today-ui deliberately do not import the contracts
  // package. Their copies of the rule are pinned here so a change in one place
  // cannot silently diverge.
  assert.deepEqual([...CLIENTS_DOMAIN_RESERVED_SLUGS], [...RESERVED_CLIENT_SLUGS]);
  assert.equal(CLIENTS_DOMAIN_MIN_SLUG_LENGTH, MIN_CLIENT_SLUG_LENGTH);

  const todayUi = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../apps/today-ui/src/compose.ts"),
    "utf8",
  );
  for (const slug of RESERVED_CLIENT_SLUGS) {
    assert.ok(todayUi.includes(`"${slug}"`), `today-ui is missing reserved slug ${slug}`);
  }
});

test("a client scope built from a placeholder is not a scope anywhere in the ontology", () => {
  assert.equal(isScope("client:acme-industria"), true);
  assert.equal(isScope("client:unknown"), false);
  assert.equal(isScope("client:cliente"), false);
  // The attention engine keeps its own copy of the grammar; it must agree.
  assert.equal(new RegExp(ATTENTION_SCOPE_PATTERN).test("client:acme-industria"), true);
  assert.equal(new RegExp(ATTENTION_SCOPE_PATTERN).test("client:unknown"), false);
});
