import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { createStubListener } from "../src/stub-server.ts";

async function withStub(
  ready: boolean,
  fn: (base: string) => Promise<void>,
): Promise<void> {
  const server = createServer(
    createStubListener({
      service: "context",
      ready,
      host: "127.0.0.1",
      port: 0,
      now: () => "2026-08-20T06:00:00.000Z",
    }),
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

test("stub /healthz and /ready bodies are non-empty and distinguish ready vs not-ready", async () => {
  await withStub(true, async (base) => {
    const live = await fetch(`${base}/healthz`);
    assert.equal(live.status, 200);
    const liveBody = (await live.json()) as {
      ok: boolean;
      live: boolean;
      ready?: boolean;
      service: string;
      source: string;
      observed_at: string;
      freshness_status: string;
    };
    assert.equal(liveBody.ok, true);
    assert.equal(liveBody.live, true);
    assert.equal(liveBody.service, "context");
    assert.equal(liveBody.source, "control-center.deploy.stub.context");
    assert.equal(liveBody.observed_at, "2026-08-20T06:00:00.000Z");
    assert.equal(liveBody.freshness_status, "fresh");
    assert.ok(JSON.stringify(liveBody).length > 0);

    const ready = await fetch(`${base}/ready`);
    assert.equal(ready.status, 200);
    const readyBody = (await ready.json()) as { ok: boolean; ready: boolean };
    assert.equal(readyBody.ok, true);
    assert.equal(readyBody.ready, true);
    assert.ok(JSON.stringify(readyBody).length > 0);
  });

  await withStub(false, async (base) => {
    const live = await fetch(`${base}/healthz`);
    assert.equal(live.status, 200);
    const liveBody = (await live.json()) as { live: boolean; ready?: boolean };
    assert.equal(liveBody.live, true);
    assert.notEqual(liveBody.ready, false);

    const ready = await fetch(`${base}/ready`);
    assert.equal(ready.status, 503);
    const readyBody = (await ready.json()) as {
      ok: boolean;
      ready: boolean;
      reason: string;
      freshness_status: string;
    };
    assert.equal(readyBody.ok, false);
    assert.equal(readyBody.ready, false);
    assert.equal(readyBody.reason, "stub_not_ready");
    assert.equal(readyBody.freshness_status, "stale");
    assert.ok(JSON.stringify(readyBody).length > 0);
    assert.notEqual(JSON.stringify(readyBody), JSON.stringify(liveBody));
  });
});
