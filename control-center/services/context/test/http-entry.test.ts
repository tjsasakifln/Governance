import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { createRequestListener } from "../src/http.ts";
import { silentLogger } from "../src/log.ts";
import { startServer } from "../src/server.ts";
import { LIMITS } from "../src/types.ts";
import { AGENT, FOUNDER, makeService } from "./helpers.ts";
import { REPRESENTATIVE_IDS, REPRESENTATIVE_SCOPE } from "../src/representative.ts";

async function withServer(
  fn: (base: string) => Promise<void>,
): Promise<void> {
  const { service } = makeService();
  const server = createServer(createRequestListener({ service, logger: silentLogger }));
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

test("HTTP entry drives shipped get_context and rejects agent mutation plus oversized payload", async () => {
  await withServer(async (base) => {
    const created = await fetch(`${base}/v1/directives`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-actor-id": FOUNDER.id,
        "x-actor-kind": FOUNDER.kind,
      },
      body: JSON.stringify({
        kind: "priority",
        title: "Now",
        body: "Do the important thing.",
        scope: "company",
        source: { system: "manual", kind: "founder-entry", locator: "http-test" },
        confidence: 1,
      }),
    });
    assert.equal(created.status, 201);
    const rec = (await created.json()) as { id: string; kind: string; created_by: { kind: string } };
    assert.equal(rec.kind, "priority");
    assert.match(rec.id, /^cc:directive:/);
    assert.equal(rec.created_by.kind, "human");

    const missing = await fetch(`${base}/v1/context?scope=company`);
    assert.equal(missing.status, 401);
    const missingBody = (await missing.json()) as { error: string };
    assert.equal(missingBody.error, "missing_actor");

    const agentWrite = await fetch(`${base}/v1/directives`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-actor-id": AGENT.id,
        "x-actor-kind": AGENT.kind,
      },
      body: JSON.stringify({
        kind: "decision",
        title: "Agent decision",
        body: "Should fail.",
        scope: "company",
        source: { system: "collector", kind: "agent-report", locator: "http" },
        confidence: 1,
      }),
    });
    assert.equal(agentWrite.status, 403);
    const agentBody = (await agentWrite.json()) as { error: string };
    assert.equal(agentBody.error, "agent_mutation_forbidden");

    const oversized = await fetch(`${base}/v1/directives`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-actor-id": FOUNDER.id,
        "x-actor-kind": FOUNDER.kind,
      },
      body: "x".repeat(LIMITS.jsonBytes + 8),
    });
    assert.equal(oversized.status, 413);

    const legacy = await fetch(`${base}/v1/context?company=confenge&domain=commercial`, {
      headers: { "x-actor-id": AGENT.id, "x-actor-kind": AGENT.kind },
    });
    assert.equal(legacy.status, 400);

    const ctx = await fetch(`${base}/v1/context?scope=company`, {
      headers: { "x-actor-id": AGENT.id, "x-actor-kind": AGENT.kind },
    });
    assert.equal(ctx.status, 200);
    const ctxText = await ctx.text();
    const payload = JSON.parse(ctxText) as {
      scope: string;
      active_directives: Array<{
        id: string;
        source: { system: string };
        observed_at: string;
        freshness_status: string;
        confidence: number;
      }>;
      priorities: Array<{ id: string }>;
      hypotheses: Array<{ kind: string }>;
      decisions: Array<{ kind: string }>;
    };
    assert.equal(typeof payload.scope, "string");
    assert.ok(payload.active_directives.some((d) => d.id === rec.id));
    assert.ok(payload.priorities.some((d) => d.id === rec.id));
    const first = payload.active_directives[0];
    assert.ok(first?.source?.system);
    assert.ok(first?.observed_at);
    assert.ok(["FRESH", "STALE", "UNKNOWN", "ERROR"].includes(first?.freshness_status ?? ""));
    assert.equal(typeof first?.confidence, "number");
    assert.ok(payload.hypotheses.every((d) => d.kind === "hypothesis"));
    assert.ok(payload.decisions.every((d) => d.kind === "decision"));

    const ctx2 = await fetch(`${base}/v1/context?scope=company`, {
      headers: { "x-actor-id": AGENT.id, "x-actor-kind": AGENT.kind },
    });
    assert.equal(ctxText, await ctx2.text());
  });
});

test("shipped startServer binds HTTP and serves representative get_context twice", async () => {
  const env = {
    CONTROL_CENTER_FOUNDER_ACTOR_ID: "founder-local",
    CONTEXT_SERVICE_FIXTURE: "representative",
    HOST: "127.0.0.1",
    PORT: "0",
  };
  const { server, host, port } = await startServer(env, { logger: silentLogger });
  try {
    const url = `http://${host}:${port}/v1/context?scope=${encodeURIComponent(REPRESENTATIVE_SCOPE)}`;
    const headers = { "x-actor-id": "agent-session-launch", "x-actor-kind": "agent" };
    const res1 = await fetch(url, { headers });
    const res2 = await fetch(url, { headers });
    assert.equal(res1.status, 200);
    assert.equal(res2.status, 200);
    const text1 = await res1.text();
    const text2 = await res2.text();
    assert.equal(text1, text2);
    const body = JSON.parse(text1) as {
      scope: string;
      active_directives: Array<{ id: string; kind: string; freshness_status: string }>;
      hypotheses: Array<{ id: string; kind: string }>;
      decisions: Array<{ kind: string }>;
      facts: Array<{ kind: string }>;
    };
    assert.equal(typeof body.scope, "string");
    assert.equal(body.scope, REPRESENTATIVE_SCOPE);
    const ids = body.active_directives.map((d) => d.id);
    assert.ok(ids.includes(REPRESENTATIVE_IDS.companyPriority));
    assert.ok(ids.includes(REPRESENTATIVE_IDS.resourceFact));
    assert.equal(ids.includes(REPRESENTATIVE_IDS.siblingFact), false);
    assert.equal(ids.includes(REPRESENTATIVE_IDS.expired), false);
    assert.equal(ids.includes(REPRESENTATIVE_IDS.clientFact), false);
    assert.ok(body.hypotheses.some((d) => d.id === REPRESENTATIVE_IDS.hypothesis));
    assert.ok(body.hypotheses.every((d) => d.kind === "hypothesis"));
    assert.ok(body.decisions.every((d) => d.kind === "decision"));
    assert.ok(body.facts.every((d) => d.kind === "fact"));
    const company = await fetch(`http://${host}:${port}/v1/context?scope=company`, { headers });
    assert.equal(company.status, 200);
    const companyBody = (await company.json()) as {
      risks: Array<{ id: string; kind: string }>;
      priorities: Array<{ id: string }>;
    };
    assert.ok(companyBody.risks.some((d) => d.id === REPRESENTATIVE_IDS.companyRisk && d.kind === "risk"));
    assert.ok(companyBody.priorities.some((d) => d.id === REPRESENTATIVE_IDS.companyPriority));
    const errorItem = body.active_directives.find((d) => d.id === REPRESENTATIVE_IDS.collectionError);
    assert.equal(errorItem?.freshness_status, "ERROR");
    for (const item of body.active_directives) {
      assert.match(item.id, /^cc:/);
      assert.ok(["FRESH", "STALE", "UNKNOWN", "ERROR"].includes(item.freshness_status));
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});
