import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { migrateUp } from "@confenge/control-center-persistence";
import { startIsolatedTestPostgres, type TestPostgres } from "../../../persistence/tests/helpers/postgres.ts";
import type { CollectFn } from "../src/run.ts";
import {
  startCollectorServer,
  stopCollectorServer,
  whenCollectorSchedulerReady,
  whenCollectorServerListening,
} from "../src/server.ts";

let ctx: TestPostgres;
const TOKEN = "cc-test-lock-token";

before(async () => {
  ctx = await startIsolatedTestPostgres();
  await migrateUp(ctx.pool);
});

after(async () => {
  await ctx.stop();
});

test("two overlapping runner launches do not execute overlapping collects of the same source", async () => {
  let active = 0;
  let maxActive = 0;
  let started = 0;
  const collect: CollectFn = async ({ now }) => {
    started += 1;
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => {
      setTimeout(resolve, 250);
    });
    active -= 1;
    return {
      collector: "github",
      freshness_status: "FRESH",
      observed_at: now.toISOString(),
      source: { system: "github", kind: "collector-runner", locator: "github" },
      confidence: 0.9,
      payload: { ok: true, items: 1 },
    };
  };
  const env = {
    HOST: "127.0.0.1",
    PORT: "0",
    NODE_ENV: "test",
    CC_COLLECTOR_SCHEDULER: "1",
    CC_COLLECTOR_RUN_ON_START: "0",
    CC_COLLECTOR_INTERVAL_MS: "600000",
    CC_COLLECTOR_JITTER_MS: "0",
    CC_COLLECTOR_MANUAL_RUN: "1",
    CC_COLLECTOR_RUN_TOKEN: TOKEN,
  };
  const options = {
    persistence: ctx.persistence,
    pool: ctx.pool,
    collectFns: { github: collect },
    closePoolOnStop: false,
    names: ["github"] as const,
    clock: () => new Date("2026-08-21T16:00:00.000Z"),
  };
  const a = startCollectorServer({ ...env }, options);
  const b = startCollectorServer({ ...env }, options);
  try {
    const portA = await whenCollectorServerListening(a);
    const portB = await whenCollectorServerListening(b);
    await whenCollectorSchedulerReady(a);
    await whenCollectorSchedulerReady(b);
    const [one, two] = await Promise.all([
      fetch(`http://127.0.0.1:${portA}/run`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-cc-collector-run-token": TOKEN },
        body: JSON.stringify({ names: ["github"] }),
      }),
      fetch(`http://127.0.0.1:${portB}/run`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-cc-collector-run-token": TOKEN },
        body: JSON.stringify({ names: ["github"] }),
      }),
    ]);
    assert.equal(one.status, 200);
    assert.equal(two.status, 200);
    const bodyA = (await one.json()) as { results: Array<{ outcome: string }> };
    const bodyB = (await two.json()) as { results: Array<{ outcome: string }> };
    const outcomes = [...bodyA.results.map((row) => row.outcome), ...bodyB.results.map((row) => row.outcome)];
    assert.ok(outcomes.includes("ran"));
    assert.ok(outcomes.includes("skipped") || started === 1);
    assert.equal(maxActive, 1);
    assert.ok(started <= 1 || outcomes.includes("skipped"));
  } finally {
    await stopCollectorServer(a);
    await stopCollectorServer(b);
  }
});

test("slow default collect is timed out and a second runner cannot overlap it", async () => {
  const { createServer } = await import("node:http");
  let started = 0;
  const hang = createServer(() => {
    started += 1;
  });
  await new Promise<void>((resolve, reject) => {
    hang.listen(0, "127.0.0.1", () => resolve());
    hang.once("error", reject);
  });
  const address = hang.address();
  const hangPort = typeof address === "object" && address ? address.port : 0;
  const env = {
    HOST: "127.0.0.1",
    PORT: "0",
    NODE_ENV: "test",
    CC_COLLECTOR_SCHEDULER: "1",
    CC_COLLECTOR_RUN_ON_START: "0",
    CC_COLLECTOR_INTERVAL_MS: "600000",
    CC_COLLECTOR_JITTER_MS: "0",
    CC_COLLECTOR_TIMEOUT_MS: "200",
    CC_COLLECTOR_MANUAL_RUN: "1",
    CC_COLLECTOR_RUN_TOKEN: TOKEN,
    CC_INFRA_ALLOWLIST: JSON.stringify({
      version: 1,
      collector_id: "infrastructure.local",
      source: "infrastructure",
      default_timeout_ms: 1500,
      targets: [
        {
          id: "slow",
          display_name: "slow",
          url: `http://127.0.0.1:${hangPort}/health`,
          expect_status: 200,
          checks: ["http"],
        },
      ],
    }),
  };
  const options = {
    persistence: ctx.persistence,
    pool: ctx.pool,
    closePoolOnStop: false,
    names: ["infra"] as const,
    clock: () => new Date("2026-08-21T17:00:00.000Z"),
  };
  const a = startCollectorServer({ ...env }, options);
  const b = startCollectorServer({ ...env }, options);
  try {
    const portA = await whenCollectorServerListening(a);
    const portB = await whenCollectorServerListening(b);
    await whenCollectorSchedulerReady(a);
    await whenCollectorSchedulerReady(b);
    const [one, two] = await Promise.all([
      fetch(`http://127.0.0.1:${portA}/run`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-cc-collector-run-token": TOKEN },
        body: JSON.stringify({ names: ["infra"] }),
      }),
      fetch(`http://127.0.0.1:${portB}/run`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-cc-collector-run-token": TOKEN },
        body: JSON.stringify({ names: ["infra"] }),
      }),
    ]);
    assert.equal(one.status, 200);
    assert.equal(two.status, 200);
    const bodyA = (await one.json()) as {
      results: Array<{ outcome: string }>;
      collectors: Array<{ collector: string; error_code: string | null; status: string }>;
    };
    const bodyB = (await two.json()) as {
      results: Array<{ outcome: string }>;
      collectors: Array<{ collector: string; error_code: string | null; status: string }>;
    };
    const outcomes = [...bodyA.results.map((row) => row.outcome), ...bodyB.results.map((row) => row.outcome)];
    assert.ok(outcomes.includes("ran"), `outcomes=${outcomes.join(",")}`);
    assert.ok(outcomes.includes("skipped"), `outcomes=${outcomes.join(",")}`);
    assert.equal(started, 1);
    const infra = [...bodyA.collectors, ...bodyB.collectors].find((row) => row.collector === "infra");
    assert.equal(infra?.error_code, "timeout");
    assert.equal(infra?.status, "FAILED");
  } finally {
    await stopCollectorServer(a);
    await stopCollectorServer(b);
    await new Promise<void>((resolve) => hang.close(() => resolve()));
  }
});
