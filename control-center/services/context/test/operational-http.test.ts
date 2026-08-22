import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { validateOperationalEnvelope } from "../../../contracts/src/operational-envelope.ts";
import { frozenClock } from "../src/clock.ts";
import { createRequestListener } from "../src/http.ts";
import { silentLogger } from "../src/log.ts";
import { createFixtureOperationalPort, createUnavailableOperationalPort } from "../src/operational/fixture.ts";
import { representativeOperationalData } from "../src/operational/representative.ts";
import { createOperationalService } from "../src/operational/service.ts";
import { signalsFromSlot } from "../src/operational/signals.ts";
import type { OperationalReadPort } from "../src/operational/port.ts";
import { REPRESENTATIVE_REPO_DOMAINS } from "../src/representative.ts";
import { startServer } from "../src/server.ts";
import { AGENT, FOUNDER, NOW, makeService } from "./helpers.ts";

const here = dirname(fileURLToPath(import.meta.url));

function cloneData() {
  return structuredClone(representativeOperationalData());
}

function operationalService(port: OperationalReadPort) {
  return createOperationalService({
    port,
    clock: frozenClock(NOW),
    founderActorId: FOUNDER.id,
    repoDomains: REPRESENTATIVE_REPO_DOMAINS,
  });
}

async function withServer(
  port: OperationalReadPort,
  fn: (base: string) => Promise<void>,
): Promise<void> {
  const { service } = makeService();
  const server = createServer(
    createRequestListener({ service, operational: operationalService(port), logger: silentLogger }),
  );
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  const base = `http://127.0.0.1:${addr.port}`;
  try {
    await fn(base);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

function founderHeaders(): Record<string, string> {
  return { "x-actor-id": FOUNDER.id, "x-actor-kind": FOUNDER.kind };
}

function agentHeaders(): Record<string, string> {
  return { "x-actor-id": AGENT.id, "x-actor-kind": AGENT.kind };
}

async function getJson(base: string, path: string, headers: Record<string, string> = founderHeaders()) {
  const res = await fetch(`${base}${path}`, { headers });
  const body = (await res.json()) as Record<string, unknown>;
  return { res, body };
}

test("operational envelope HTTP: company, schema, attention, today, no provider I/O", async () => {
  await withServer(createFixtureOperationalPort(cloneData()), async (base) => {
      const first = await fetch(`${base}/v1/operational-snapshots?scope=company`, {
        headers: founderHeaders(),
      });
      const second = await fetch(`${base}/v1/operational-snapshots?scope=company`, {
        headers: agentHeaders(),
      });
      assert.equal(first.status, 200);
      assert.equal(second.status, 200);
      const text1 = await first.text();
      const text2 = await second.text();
      assert.equal(text1, text2);
      const body = JSON.parse(text1) as {
        schema_version: string;
        scope: string;
        generated_at: string;
        freshness_status: string;
        confidence: number;
        snapshots: Record<string, { presence: string; healthy: boolean; freshness_status: string; snapshot: Record<string, unknown> | null } | null>;
        attention_now: Array<{ forced_by_kill_rule: boolean; item_kind: string; title: string; score_breakdown: unknown; evidence_refs: unknown[] }>;
        today: unknown[];
        source_observations: Array<{ id: string; scope: string }>;
        hypotheses?: unknown;
        decisions?: unknown;
        facts?: unknown;
        audit?: unknown[];
      };
      assert.equal(body.schema_version, "control-center.operational-envelope.v1");
      assert.equal(body.scope, "company");
      assert.match(body.generated_at, /Z$/);
      assert.equal(body.generated_at, NOW);
      assert.ok(["FRESH", "STALE", "UNKNOWN", "ERROR"].includes(body.freshness_status));
      assert.equal(typeof body.confidence, "number");
      assert.deepEqual(Object.keys(body.snapshots).sort(), [
        "clients",
        "commercial",
        "engineering",
        "finance",
        "infrastructure",
        "pncp",
      ]);
      for (const key of Object.keys(body.snapshots)) {
        const slot = body.snapshots[key];
        assert.ok(slot);
        assert.equal(slot.presence, "present");
        assert.ok(slot.snapshot);
        assert.ok(slot.source);
        assert.match(slot.observed_at, /Z$/);
        assert.equal(typeof slot.confidence, "number");
      }
      assert.notEqual(body.freshness_status === "STALE" && body.snapshots.commercial?.healthy, true);
      const finance = body.snapshots.finance?.snapshot as {
        contracted: { amount_cents: number; currency: string; source: unknown; observed_at: string };
        billed: { amount_cents: number };
        paid: { amount_cents: number };
        effectively_received: { amount_cents: number };
      };
      assert.equal(finance.contracted.currency, "BRL");
      assert.equal(Number.isInteger(finance.paid.amount_cents), true);
      assert.equal(finance.paid.amount_cents, 2500000);
      assert.equal(finance.effectively_received.amount_cents, 1500000);
      assert.notEqual(finance.paid.amount_cents, finance.effectively_received.amount_cents);
      assert.ok(finance.contracted.source);
      assert.match(finance.contracted.observed_at, /Z$/);
      assert.equal(body.hypotheses, undefined);
      assert.equal(body.decisions, undefined);
      assert.equal(body.facts, undefined);
      assert.ok(body.attention_now.some((item) => item.forced_by_kill_rule === true));
      assert.ok(body.attention_now.some((item) => /incidente/i.test(item.title) || item.forced_by_kill_rule));
      assert.ok(body.today.length <= 3);
      assert.ok(body.today.length >= 1);
      assert.equal(
        body.source_observations.some((row) => row.scope.startsWith("repo:") || row.scope.startsWith("client:")),
        false,
      );
      const schema = validateOperationalEnvelope(body);
      assert.equal(schema.ok, true, JSON.stringify(schema.errors));
      assert.ok(Array.isArray(body.audit));

      const today = await getJson(base, "/v1/today?scope=company");
      assert.equal(today.res.status, 200);
      const todayList = today.body.today as unknown[];
      assert.ok(todayList.length <= 3);
      const todayAgain = await getJson(base, "/v1/today?scope=company");
      assert.deepEqual(today.body, todayAgain.body);

      const nowAttn = await getJson(base, "/v1/attention?scope=company&horizon=now");
      assert.equal(nowAttn.res.status, 200);
      assert.equal(nowAttn.body.horizon, "now");
      const todayAttn = await getJson(base, "/v1/attention?scope=company&horizon=today");
      assert.equal((todayAttn.body.items as unknown[]).length <= 3, true);

      for (const domain of ["commercial", "finance", "clients", "engineering", "infrastructure", "pncp"]) {
        const domainRes = await getJson(base, `/v1/domains/${domain}?scope=company`);
        assert.equal(domainRes.res.status, 200, domain);
        assert.equal(domainRes.body.domain, domain);
        assert.ok(domainRes.body.snapshot);
      }

      const observations = await getJson(base, "/v1/source-observations?scope=company&source=asaas");
      assert.equal(observations.res.status, 200);
      const obs = observations.body.source_observations as Array<{ source: { system: string } }>;
      assert.ok(obs.length >= 1);
      assert.ok(obs.every((row) => row.source.system === "asaas"));

      const context = await getJson(base, "/v1/context?scope=company", agentHeaders());
      assert.equal(context.res.status, 200);
      assert.ok(Array.isArray(context.body.hypotheses));
      assert.ok(Array.isArray(context.body.decisions));
    });
});

test("operational HTTP fail-closed: missing actor, unknown actor, identity header spoof, no mutation", async () => {
  await withServer(createFixtureOperationalPort(cloneData()), async (base) => {
    const missing = await fetch(`${base}/v1/operational-snapshots?scope=company`);
    assert.equal(missing.status, 401);
    const unknown = await fetch(`${base}/v1/operational-snapshots?scope=company`, {
      headers: { "x-actor-id": "stranger", "x-actor-kind": "human" },
    });
    assert.equal(unknown.status, 401);
    const role = await fetch(`${base}/v1/operational-snapshots?scope=company`, {
      headers: { "x-actor-id": FOUNDER.id, "x-actor-kind": "admin" },
    });
    assert.equal(role.status, 401);
    const spoof = await fetch(`${base}/v1/operational-snapshots?scope=company`, {
      headers: {
        "Remote-User": FOUNDER.id,
        "X-Admin": "true",
        Authorization: "Bearer admin",
        "X-Forwarded-For": "127.0.0.1",
      },
    });
    assert.equal(spoof.status, 401);
    const system = await fetch(`${base}/v1/operational-snapshots?scope=company`, {
      headers: { "x-actor-id": "system-ops", "x-actor-kind": "system" },
    });
    assert.equal(system.status, 401);
    const post = await fetch(`${base}/v1/operational-snapshots?scope=company`, {
      method: "POST",
      headers: { ...founderHeaders(), "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(post.status, 404);
    const badDomain = await getJson(base, "/v1/domains/marketing?scope=company");
    assert.equal(badDomain.res.status, 400);
    const todayBad = await getJson(base, "/v1/today?scope=finance");
    assert.equal(todayBad.res.status, 400);
    const attnBad = await getJson(base, "/v1/attention?scope=company");
    assert.equal(attnBad.res.status, 400);
  });
});

test("repo and client scopes do not leak siblings", async () => {
  await withServer(createFixtureOperationalPort(cloneData()), async (base) => {
    const repo = await getJson(base, "/v1/operational-snapshots?scope=repo:Governance");
    assert.equal(repo.res.status, 200);
    const dumped = JSON.stringify(repo.body);
    assert.equal(dumped.includes("repo-warmbly-only"), false);
    assert.equal(dumped.includes("repo:Warmbly"), false);
    assert.ok(repo.body.snapshots);
    const snaps = repo.body.snapshots as Record<string, { snapshot: Record<string, unknown> | null } | null>;
    assert.equal(snaps.commercial, null);
    assert.ok(snaps.engineering?.snapshot);
    assert.equal((snaps.engineering?.snapshot as { open_pr_count: number }).open_pr_count, 2);

    const sibling = await getJson(base, "/v1/operational-snapshots?scope=repo:Warmbly");
    const siblingSnaps = sibling.body.snapshots as Record<string, { snapshot: { open_pr_count?: number } | null } | null>;
    assert.equal(siblingSnaps.engineering?.snapshot?.open_pr_count, 9);
    assert.equal(JSON.stringify(sibling.body).includes("cc:operational-snapshot:engineering-governance"), false);
    assert.notEqual((snaps.engineering?.snapshot as { open_pr_count: number }).open_pr_count, 9);

    const client = await getJson(base, "/v1/operational-snapshots?scope=client:acme");
    const clientDump = JSON.stringify(client.body);
    assert.equal(clientDump.includes("client-other-only"), false);
    assert.ok(clientDump.includes("acme"));
    assert.equal(clientDump.includes('"client_slug":"other"'), false);

    const other = await getJson(base, "/v1/operational-snapshots?scope=client:other");
    const otherDump = JSON.stringify(other.body);
    assert.ok(otherDump.includes("other"));
    assert.equal(otherDump.includes('"client_slug":"acme"'), false);
  });
});

test("empty DB is no_data/UNKNOWN; unavailable DB is upstream_error/ERROR; neither looks healthy", async () => {
  await withServer(createFixtureOperationalPort(), async (base) => {
    const { res, body } = await getJson(base, "/v1/operational-snapshots?scope=company");
    assert.equal(res.status, 200);
    assert.equal(body.freshness_status, "UNKNOWN");
    assert.equal(body.confidence, 0);
    const snaps = body.snapshots as Record<string, { presence: string; absence_reason: string; healthy: boolean }>;
    for (const slot of Object.values(snaps)) {
      assert.equal(slot.presence, "absent");
      assert.equal(slot.absence_reason, "no_data");
      assert.equal(slot.healthy, false);
    }
    assert.deepEqual(body.attention_now, []);
    assert.deepEqual(body.today, []);
    assert.deepEqual(body.source_observations, []);
  });

  await withServer(createUnavailableOperationalPort(), async (base) => {
    const { res, body } = await getJson(base, "/v1/operational-snapshots?scope=company");
    assert.equal(res.status, 200);
    assert.equal(body.freshness_status, "ERROR");
    assert.notEqual(body.freshness_status, "UNKNOWN");
    const snaps = body.snapshots as Record<string, { absence_reason: string; healthy: boolean; freshness_status: string }>;
    for (const slot of Object.values(snaps)) {
      assert.equal(slot.absence_reason, "upstream_error");
      assert.equal(slot.freshness_status, "ERROR");
      assert.equal(slot.healthy, false);
    }
  });
});

test("stale, error, partial outage, not_configured stay distinct and never look healthy", async () => {
  const data = cloneData();
  const commercial = data.operational_snapshots.find((row) => row.id === "cc:operational-snapshot:commercial-company");
  assert.ok(commercial);
  commercial.freshness_status = "STALE";
  const finance = data.operational_snapshots.find((row) => row.id === "cc:operational-snapshot:finance-company");
  assert.ok(finance);
  finance.freshness_status = "ERROR";
  data.operational_snapshots = data.operational_snapshots.filter(
    (row) => row.snapshot_kind !== "pncp",
  );
  data.collector_runs = data.collector_runs.map((row) =>
    row.collector_name === "pncp-freshness"
      ? { ...row, status: "skipped" as const, error_code: "NOT_CONFIGURED", freshness_status: "UNKNOWN" as const }
      : row,
  );
  data.operational_snapshots = data.operational_snapshots.filter((row) => row.snapshot_kind !== "clients");
  data.collector_runs = data.collector_runs.filter((row) => row.collector_name !== "clients-ops");

  await withServer(createFixtureOperationalPort(data), async (base) => {
    const { body } = await getJson(base, "/v1/operational-snapshots?scope=company");
    const snaps = body.snapshots as Record<
      string,
      { freshness_status: string; healthy: boolean; presence: string; absence_reason?: string }
    >;
    assert.equal(snaps.commercial.freshness_status, "STALE");
    assert.equal(snaps.commercial.healthy, false);
    assert.equal(snaps.finance.freshness_status, "ERROR");
    assert.equal(snaps.finance.healthy, false);
    assert.equal(body.freshness_status, "ERROR");
    assert.notEqual(body.freshness_status, "UNKNOWN");
    assert.equal(snaps.pncp.presence, "absent");
    assert.equal(snaps.pncp.absence_reason, "not_configured");
    assert.equal(snaps.clients.presence, "absent");
    assert.equal(snaps.clients.absence_reason, "no_data");
    assert.ok(snaps.engineering.presence === "present");
  });
});

test("unreliable probability is omitted; secret keys are stripped", async () => {
  const data = cloneData();
  const commercial = data.operational_snapshots.find((row) => row.snapshot_kind === "commercial");
  assert.ok(commercial);
  commercial.payload.pipeline_weighted = { amount_cents: 0, currency: "BRL" };
  commercial.payload.password = "hunter2";
  await withServer(createFixtureOperationalPort(data), async (base) => {
    const { body } = await getJson(base, "/v1/operational-snapshots?scope=company");
    const snap = (body.snapshots as Record<string, { snapshot: Record<string, unknown> }>).commercial.snapshot;
    assert.equal("pipeline_weighted" in snap, false);
    assert.equal("password" in snap, false);
    const dumped = JSON.stringify(body);
    assert.equal(/"(password|secret|token|api_key)"\s*:/i.test(dumped), false);
  });
});

test("hypothesis stays in /v1/context and is absent from the operational envelope", async () => {
  const { service } = makeService();
  service.createDirective(FOUNDER, {
    kind: "hypothesis",
    title: "Maybe Extra is public",
    body: "Must never appear as a fact or decision.",
    scope: "company",
    source: { system: "manual", kind: "founder-entry", locator: "test" },
    confidence: 0.2,
  });
  service.createDirective(FOUNDER, {
    kind: "decision",
    title: "CONFIRMED is not received",
    body: "Founder decision stands; telemetry must not overwrite it.",
    scope: "company",
    source: { system: "manual", kind: "founder-entry", locator: "test" },
    confidence: 1,
  });
  const server = createServer(
    createRequestListener({
      service,
      operational: operationalService(createFixtureOperationalPort(cloneData())),
      logger: silentLogger,
    }),
  );
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  const base = `http://127.0.0.1:${addr.port}`;
  try {
    const ctx = await getJson(base, "/v1/context?scope=company");
    const hypotheses = ctx.body.hypotheses as Array<{ kind: string; title: string }>;
    const decisions = ctx.body.decisions as Array<{ kind: string; title: string }>;
    assert.ok(hypotheses.some((h) => h.kind === "hypothesis"));
    assert.ok(decisions.every((d) => d.kind === "decision"));
    assert.ok(decisions.some((d) => d.title.includes("CONFIRMED")));
    const op = await getJson(base, "/v1/operational-snapshots?scope=company");
    assert.equal(op.body.hypotheses, undefined);
    assert.equal(op.body.decisions, undefined);
    assert.equal(JSON.stringify(op.body).includes("Maybe Extra is public"), false);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

test("shipped startServer serves operational snapshots twice with identical bodies", async () => {
  const env = {
    CONTROL_CENTER_FOUNDER_ACTOR_ID: "founder-local",
    CONTEXT_SERVICE_FIXTURE: "representative",
    HOST: "127.0.0.1",
    PORT: "0",
  };
  const { server, host, port } = await startServer(env, { logger: silentLogger });
  try {
    const url = `http://${host}:${port}/v1/operational-snapshots?scope=company`;
    const headers = { "x-actor-id": "founder-local", "x-actor-kind": "human" };
    const res1 = await fetch(url, { headers });
    const res2 = await fetch(url, { headers });
    assert.equal(res1.status, 200);
    assert.equal(res2.status, 200);
    const text1 = await res1.text();
    const text2 = await res2.text();
    assert.equal(text1, text2);
    const body = JSON.parse(text1) as { schema_version: string; today: unknown[]; snapshots: Record<string, unknown> };
    assert.equal(body.schema_version, "control-center.operational-envelope.v1");
    assert.ok(body.snapshots.finance);
    assert.ok(body.today.length <= 3);
    const unauth = await fetch(url);
    assert.equal(unauth.status, 401);
    const todayRes = await fetch(`http://${host}:${port}/v1/today?scope=company`, { headers });
    assert.equal(todayRes.status, 200);
    const todayBody = (await todayRes.json()) as { today: unknown[] };
    assert.ok(todayBody.today.length <= 3);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

test("operational source never calls providers and names the frozen views", () => {
  const root = join(here, "..", "src", "operational");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".ts")) {
        files.push(full);
      }
    }
  };
  walk(root);
  assert.ok(files.length > 0);
  let views = 0;
  for (const file of files) {
    const body = readFileSync(file, "utf8");
    assert.doesNotMatch(body, /from ["']node:(http|https|net)["']/);
    assert.doesNotMatch(body, /\bfetch\s*\(/);
    assert.doesNotMatch(body, /api\.github\.com/);
    assert.doesNotMatch(body, /asaas\.com/);
    assert.doesNotMatch(body, /warmbly\.[a-z]+\/api/);
    if (body.includes("control_center.v_latest_collector_runs")) {
      views += 1;
    }
  }
  assert.ok(views >= 1);
});

test("an unidentified client record never raises 'Cliente em risco operacional'", () => {
  const base = {
    schema_version: "control-center.operational-domain.v1" as const,
    domain: "clients" as const,
    scope: "clients",
    source: { system: "warmbly", kind: "client-ops", locator: "clients/roll-up" },
    observed_at: NOW,
    freshness_status: "FRESH" as const,
    confidence: 0.8,
    presence: "present" as const,
    healthy: true,
  };

  // A snapshot whose only "client" is the identity placeholder. The declared
  // at-risk count must not survive: the record is a data-quality exception.
  const placeholderOnly = signalsFromSlot({
    ...base,
    snapshot: {
      schema_version: "control-center.clients-snapshot.v1",
      at_risk_client_count: 1,
      open_blocker_count: 0,
      clients: [{ client_slug: "unknown", scope: "client:unknown", display_name: "Cliente" }],
      unidentified_record_count: 1,
    },
  });
  assert.equal(
    placeholderOnly.some((item) => item.title === "Cliente em risco operacional"),
    false,
  );

  // A real client at risk still raises the alert.
  const realClient = signalsFromSlot({
    ...base,
    snapshot: {
      schema_version: "control-center.clients-snapshot.v1",
      at_risk_client_count: 1,
      open_blocker_count: 0,
      clients: [{ client_slug: "acme-industria", scope: "client:acme-industria", display_name: "Acme" }],
    },
  });
  assert.equal(
    realClient.some((item) => item.title === "Cliente em risco operacional"),
    true,
  );
});

test("the clients mapper forwards the identity queue instead of dropping it", () => {
  const assemble = readFileSync(join(here, "../src/operational/assemble.ts"), "utf8");
  assert.match(assemble, /"data_quality"/);
  assert.match(assemble, /"unidentified_record_count"/);
  assert.match(assemble, /"client_count"/);
});
