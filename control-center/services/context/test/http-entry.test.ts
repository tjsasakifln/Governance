import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { createRequestListener } from "../src/http.ts";
import { silentLogger } from "../src/log.ts";
import { startServer } from "../src/server.ts";
import { LIMITS } from "../src/types.ts";
import { AGENT, FOUNDER, makeService } from "./helpers.ts";

async function withServer(
  fn: (base: string) => Promise<void>,
): Promise<void> {
  const { service } = makeService();
  const server = createServer(createRequestListener({ service, logger: silentLogger }, "confenge"));
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
        "x-actor-role": FOUNDER.role,
      },
      body: JSON.stringify({
        kind: "priority",
        title: "Now",
        body: "Do the important thing.",
        scope: { company: "confenge" },
        source: "founder",
        confidence: 1,
      }),
    });
    assert.equal(created.status, 201);
    const rec = (await created.json()) as { id: string; kind: string };
    assert.equal(rec.kind, "priority");

    const missing = await fetch(`${base}/v1/context?company=confenge`);
    assert.equal(missing.status, 401);
    const missingBody = (await missing.json()) as { error: string };
    assert.equal(missingBody.error, "missing_actor");

    const agentWrite = await fetch(`${base}/v1/directives`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-actor-id": AGENT.id,
        "x-actor-role": AGENT.role,
      },
      body: JSON.stringify({
        kind: "decision",
        title: "Agent decision",
        body: "Should fail.",
        scope: { company: "confenge" },
        source: "agent",
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
        "x-actor-role": FOUNDER.role,
      },
      body: "x".repeat(LIMITS.jsonBytes + 8),
    });
    assert.equal(oversized.status, 413);

    const ctx = await fetch(`${base}/v1/context?company=confenge`, {
      headers: { "x-actor-id": AGENT.id, "x-actor-role": AGENT.role },
    });
    assert.equal(ctx.status, 200);
    const ctxText = await ctx.text();
    const payload = JSON.parse(ctxText) as {
      active_directives: Array<{ id: string; source: string; observed_at: string; freshness_status: string }>;
      priorities: Array<{ id: string }>;
    };
    assert.ok(payload.active_directives.some((d) => d.id === rec.id));
    assert.ok(payload.priorities.some((d) => d.id === rec.id));
    const first = payload.active_directives[0];
    assert.ok(first?.source);
    assert.ok(first?.observed_at);
    assert.ok(first?.freshness_status);

    const ctx2 = await fetch(`${base}/v1/context?company=confenge`, {
      headers: { "x-actor-id": AGENT.id, "x-actor-role": AGENT.role },
    });
    assert.equal(ctxText, await ctx2.text());
  });
});

test("shipped startServer binds HTTP and serves representative get_context", async () => {
  const { server, host, port } = await startServer(
    {
      CONTROL_CENTER_FOUNDER_ACTOR_ID: "founder-local",
      CONTEXT_SERVICE_FIXTURE: "representative",
      CONTROL_CENTER_COMPANY: "confenge",
      HOST: "127.0.0.1",
      PORT: "0",
    },
    { logger: silentLogger },
  );
  try {
    const url = `http://${host}:${port}/v1/context?company=confenge&domain=commercial&resource=offer:CFG-DIAG-EXP-v1`;
    const res = await fetch(url, {
      headers: { "x-actor-id": "agent-session-launch", "x-actor-role": "agent" },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { active_directives: Array<{ id: string; kind: string }>; hypotheses: Array<{ id: string }> };
    const ids = body.active_directives.map((d) => d.id);
    assert.ok(ids.includes("dir-company-priority"));
    assert.ok(ids.includes("dir-resource-fact"));
    assert.equal(ids.includes("dir-sibling-fact"), false);
    assert.equal(ids.includes("dir-resource-expired"), false);
    assert.ok(body.hypotheses.some((d) => d.id === "dir-company-hypothesis"));
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});
