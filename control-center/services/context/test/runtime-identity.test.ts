import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { createRequestListener } from "../src/http.ts";
import { silentLogger } from "../src/log.ts";
import {
  REQUIRED_RUNTIME_BASELINE_SHA,
  runtimeIdentityFromEnv,
} from "../src/runtime-identity.ts";
import { makeService } from "./helpers.ts";

const RELEASE_SHA = "8a2eb1f012345678901234567890123456789012";

async function withRuntimeServer(
  env: NodeJS.ProcessEnv,
  fn: (base: string) => Promise<void>,
): Promise<void> {
  const { service } = makeService();
  const server = createServer(createRequestListener({
    service,
    logger: silentLogger,
    runtimeIdentity: runtimeIdentityFromEnv(env, "control-center-context"),
  }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("runtime identity accepts only a full immutable SHA and pins the required baseline", () => {
  const local = runtimeIdentityFromEnv({
    CONTROL_CENTER_ENV: "production",
    CC_RELEASE_SHA: "local",
  }, "control-center-context");
  assert.equal(local.release_sha, null);
  assert.equal(local.release_status, "UNVERIFIED");
  assert.equal(local.production_required, true);
  assert.equal(local.required_baseline_sha, REQUIRED_RUNTIME_BASELINE_SHA);

  const pinned = runtimeIdentityFromEnv({
    CONTROL_CENTER_ENV: "production",
    CC_RELEASE_SHA: RELEASE_SHA,
  }, "control-center-context");
  assert.equal(pinned.release_sha, RELEASE_SHA);
  assert.equal(pinned.release_status, "PINNED");

  const uppercase = runtimeIdentityFromEnv({
    CONTROL_CENTER_ENV: "production",
    CC_RELEASE_SHA: RELEASE_SHA.toUpperCase(),
  }, "control-center-context");
  assert.equal(uppercase.release_status, "UNVERIFIED");

  const standardProduction = runtimeIdentityFromEnv({
    NODE_ENV: "production",
    CC_RELEASE_SHA: "local",
  }, "control-center-context");
  assert.equal(standardProduction.production_required, true);
});

test("production readiness fails closed without release identity", async () => {
  await withRuntimeServer({ CONTROL_CENTER_ENV: "production", CC_RELEASE_SHA: "local" }, async (base) => {
    const health = await fetch(`${base}/healthz`);
    assert.equal(health.status, 200);
    assert.doesNotMatch(await health.text(), /release_sha/i);

    const identity = await fetch(`${base}/v1/runtime-identity`);
    assert.equal(identity.status, 200);
    const identityBody = (await identity.json()) as { release_sha: string | null; release_status: string };
    assert.equal(identityBody.release_sha, null);
    assert.equal(identityBody.release_status, "UNVERIFIED");

    const ready = await fetch(`${base}/ready`);
    assert.equal(ready.status, 503);
    const readyBody = (await ready.json()) as { ready: boolean; release_status: string };
    assert.equal(readyBody.ready, false);
    assert.equal(readyBody.release_status, "UNVERIFIED");
  });
});

test("pinned context reports the exact same SHA through identity and readiness", async () => {
  await withRuntimeServer({ CONTROL_CENTER_ENV: "production", CC_RELEASE_SHA: RELEASE_SHA }, async (base) => {
    const identity = await fetch(`${base}/v1/runtime-identity`);
    const identityBody = (await identity.json()) as { release_sha: string; release_status: string };
    assert.equal(identityBody.release_sha, RELEASE_SHA);
    assert.equal(identityBody.release_status, "PINNED");

    const ready = await fetch(`${base}/ready`);
    assert.equal(ready.status, 200);
    const readyBody = (await ready.json()) as { ready: boolean; release_sha: string };
    assert.equal(readyBody.ready, true);
    assert.equal(readyBody.release_sha, RELEASE_SHA);
  });
});
