import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { migrateUp } from "@confenge/control-center-persistence";
import { isSecretOrPiiKey } from "@confenge/control-center-persistence";
import { startIsolatedTestPostgres, type TestPostgres } from "../../../persistence/tests/helpers/postgres.ts";
import type { CollectFn, CollectorName } from "../src/run.ts";
import {
  startCollectorServer,
  stopCollectorServer,
  whenCollectorSchedulerReady,
  whenCollectorServerListening,
} from "../src/server.ts";

let ctx: TestPostgres;
const TOKEN = "cc-test-internal-run-token";

function fixture(
  name: CollectorName,
  freshness: "FRESH" | "STALE" | "UNKNOWN" | "ERROR",
  extra: { error?: { code: string; message: string }; payload?: Record<string, unknown> } = {},
): CollectFn {
  return async ({ now }) => ({
    collector: name,
    freshness_status: freshness,
    observed_at: now.toISOString(),
    source: { system: name, kind: "collector-runner", locator: name },
    confidence: freshness === "FRESH" ? 0.9 : 0,
    payload: extra.payload ?? { ok: true, items: 1 },
    ...(extra.error ? { error: extra.error } : {}),
  });
}

function envFor(port = 0): NodeJS.ProcessEnv {
  return {
    HOST: "127.0.0.1",
    PORT: String(port),
    NODE_ENV: "test",
    CC_COLLECTOR_SCHEDULER: "1",
    CC_COLLECTOR_RUN_ON_START: "0",
    CC_COLLECTOR_INTERVAL_MS: "600000",
    CC_COLLECTOR_JITTER_MS: "0",
    CC_COLLECTOR_TIMEOUT_MS: "5000",
    CC_COLLECTOR_MANUAL_RUN: "1",
    CC_COLLECTOR_RUN_TOKEN: TOKEN,
  };
}

async function listen(
  collectFns: Partial<Record<CollectorName, CollectFn>>,
  extraEnv: NodeJS.ProcessEnv = {},
  extras: { schedulerEnabled?: boolean } = {},
) {
  const server = startCollectorServer(
    { ...envFor(), ...extraEnv },
    {
      persistence: ctx.persistence,
      pool: ctx.pool,
      collectFns,
      closePoolOnStop: false,
      schedulerEnabled: extras.schedulerEnabled,
      names: ["github", "warmbly"],
      clock: () => new Date("2026-08-21T15:00:00.000Z"),
    },
  );
  const port = await whenCollectorServerListening(server);
  if (extras.schedulerEnabled !== false) {
    await whenCollectorSchedulerReady(server);
  }
  return { server, base: `http://127.0.0.1:${port}` };
}

function walkKeys(value: unknown, keys: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) {
      walkKeys(item, keys);
    }
    return keys;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      keys.push(key);
      walkKeys(child, keys);
    }
  }
  return keys;
}

before(async () => {
  ctx = await startIsolatedTestPostgres();
  await migrateUp(ctx.pool);
});

after(async () => {
  await ctx.stop();
});

test("GET /healthz is liveness even without a database", async () => {
  const server = startCollectorServer({
    HOST: "127.0.0.1",
    PORT: "0",
    NODE_ENV: "test",
  });
  try {
    const port = await whenCollectorServerListening(server);
    const health = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(health.status, 200);
    const ready = await fetch(`http://127.0.0.1:${port}/ready`);
    assert.equal(ready.status, 503);
  } finally {
    await stopCollectorServer(server);
  }
});

test("GET /ready is 503 when scheduler is not initialized", async () => {
  const { server, base } = await listen({ github: fixture("github", "FRESH") }, {}, { schedulerEnabled: false });
  try {
    const health = await fetch(`${base}/healthz`);
    assert.equal(health.status, 200);
    const ready = await fetch(`${base}/ready`);
    assert.equal(ready.status, 503);
    const body = (await ready.json()) as { reason?: string };
    assert.equal(body.reason, "scheduler_not_initialized");
  } finally {
    await stopCollectorServer(server);
  }
});

test("GET /ready is 503 when expected migrations are missing and 200 when store is ready", async () => {
  const { server, base } = await listen({
    github: fixture("github", "FRESH"),
    warmbly: fixture("warmbly", "FRESH"),
  });
  try {
    const readyOk = await fetch(`${base}/ready`);
    assert.equal(readyOk.status, 200);
    await ctx.pool.query(`DELETE FROM control_center.schema_migrations WHERE id = $1`, [
      "004_operator_actions",
    ]);
    const readyMissing = await fetch(`${base}/ready`);
    assert.equal(readyMissing.status, 503);
    const body = (await readyMissing.json()) as { reason?: string };
    assert.equal(body.reason, "migrations_missing");
  } finally {
    await ctx.pool.query(
      `INSERT INTO control_center.schema_migrations (id, applied_at) VALUES ($1, now()) ON CONFLICT DO NOTHING`,
      ["004_operator_actions"],
    );
    await stopCollectorServer(server);
  }
});

test("POST /run without enablement or token is refused", async () => {
  const { server, base } = await listen(
    { github: fixture("github", "FRESH") },
    { NODE_ENV: "production", CC_COLLECTOR_MANUAL_RUN: "0", CC_COLLECTOR_RUN_TOKEN: TOKEN },
  );
  try {
    const denied = await fetch(`${base}/run`, { method: "POST", headers: { "x-cc-collector-run-token": TOKEN } });
    assert.equal(denied.status, 403);
    const noToken = await listen({ github: fixture("github", "FRESH") }, { CC_COLLECTOR_RUN_TOKEN: "" });
    try {
      const refused = await fetch(`${noToken.base}/run`, { method: "POST" });
      assert.equal(refused.status, 403);
    } finally {
      await stopCollectorServer(noToken.server);
    }
    const { server: authed, base: authedBase } = await listen({ github: fixture("github", "FRESH") });
    try {
      const unauthorized = await fetch(`${authedBase}/run`, {
        method: "POST",
        headers: { "x-cc-collector-run-token": "wrong" },
      });
      assert.equal(unauthorized.status, 401);
    } finally {
      await stopCollectorServer(authed);
    }
  } finally {
    await stopCollectorServer(server);
  }
});

test("persisted collect survives process restart on GET /last and is sanitized", async () => {
  const collectFns = {
    github: fixture("github", "FRESH"),
    warmbly: fixture("warmbly", "FRESH"),
  };
  const first = await listen(collectFns);
  let runId: string | undefined;
  try {
    const ran = await fetch(`${first.base}/run`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-cc-collector-run-token": TOKEN,
      },
      body: JSON.stringify({ names: ["github"] }),
    });
    assert.equal(ran.status, 200);
    const last = await fetch(`${first.base}/last`);
    assert.equal(last.status, 200);
    const lastBody = (await last.json()) as { collectors: Array<{ collector: string; run_id: string; status: string }> };
    const github = lastBody.collectors.find((row) => row.collector === "github");
    assert.ok(github);
    assert.match(github.run_id, /^cc:collector-run:/);
    assert.equal(github.status, "DONE");
    runId = github.run_id;
    for (const key of walkKeys(lastBody)) {
      assert.equal(isSecretOrPiiKey(key), false, key);
    }
    const status = await fetch(`${first.base}/status`);
    assert.equal(status.status, 200);
    const statusBody = (await status.json()) as {
      sources: Array<{ collector: string; freshness_status: string; age_seconds: number | null; last_error: unknown }>;
    };
    const githubStatus = statusBody.sources.find((row) => row.collector === "github");
    assert.equal(githubStatus?.freshness_status, "FRESH");
    assert.equal(typeof githubStatus?.age_seconds, "number");
    assert.equal(githubStatus?.last_error, null);
    for (const key of walkKeys(statusBody)) {
      assert.equal(isSecretOrPiiKey(key), false, key);
    }
    assert.equal(JSON.stringify(statusBody).includes("api_key"), false);
    assert.equal(JSON.stringify(statusBody).includes("password"), false);
  } finally {
    await stopCollectorServer(first.server);
  }

  const second = await listen(collectFns);
  try {
    const ready = await fetch(`${second.base}/ready`);
    assert.equal(ready.status, 200);
    const last = await fetch(`${second.base}/last`);
    assert.equal(last.status, 200);
    const lastBody = (await last.json()) as { collectors: Array<{ collector: string; run_id: string; status: string }> };
    const github = lastBody.collectors.find((row) => row.collector === "github");
    assert.ok(github);
    assert.equal(github.run_id, runId);
    assert.equal(github.status, "DONE");
    assert.notEqual(lastBody.collectors.length, 0);
  } finally {
    await stopCollectorServer(second.server);
  }
});

test("one source failure leaves the healthy source persisted as PARTIAL overall", async () => {
  const { server, base } = await listen({
    github: fixture("github", "ERROR", { error: { code: "collect_failed", message: "upstream timeout" } }),
    warmbly: fixture("warmbly", "FRESH"),
  });
  try {
    const ran = await fetch(`${base}/run`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-cc-collector-run-token": TOKEN,
      },
      body: JSON.stringify({ names: ["github", "warmbly"] }),
    });
    assert.equal(ran.status, 200);
    const body = (await ran.json()) as {
      status: string;
      collectors: Array<{ collector: string; status: string; error_code: string | null }>;
    };
    const github = body.collectors.find((row) => row.collector === "github");
    const warmbly = body.collectors.find((row) => row.collector === "warmbly");
    assert.equal(github?.status, "FAILED");
    assert.equal(github?.error_code, "collect_failed");
    assert.equal(warmbly?.status, "DONE");
    assert.equal(body.status, "PARTIAL");
    const last = await fetch(`${base}/last`);
    const lastBody = (await last.json()) as { collectors: Array<{ collector: string; status: string }> };
    assert.equal(lastBody.collectors.find((row) => row.collector === "warmbly")?.status, "DONE");
  } finally {
    await stopCollectorServer(server);
  }
});
