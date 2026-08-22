import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

import { createRequestListener } from "../src/http.ts";
import type { WarmblyOperatorHttpRequest } from "../src/http.ts";
import { silentLogger } from "../src/log.ts";
import { createWarmblyOperatorHandlerFromEnv } from "../src/warmbly-operator/from-env.ts";
import { makeService } from "./helpers.ts";

const PAUSE = "/v1/warmbly/operator/dispatch/pause";

async function withServer(
  warmblyOperator: ((req: WarmblyOperatorHttpRequest) => Promise<{ status: number; body: unknown }>) | undefined,
  fn: (base: string) => Promise<void>,
): Promise<void> {
  const { service } = makeService();
  const server = createServer(
    createRequestListener({
      service,
      logger: silentLogger,
      ...(warmblyOperator ? { warmblyOperator } : {}),
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  try {
    await fn(`http://127.0.0.1:${addr.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
}

test("an unconfigured deployment 404s every operator route instead of half-mounting", async () => {
  await withServer(undefined, async (base) => {
    const res = await fetch(`${base}${PAUSE}`, { method: "POST", body: "{}" });
    assert.equal(res.status, 404);
    const body = (await res.json()) as { code?: string };
    assert.equal(body.code, "operator_channel_not_configured");
  });
});

test("the operator route never resolves its actor from the client-settable x-actor-id", async () => {
  // This is the whole point of mounting ahead of actorFromRequest: anything that
  // reaches this process can set x-actor-id, and it must not be able to pause or
  // resume outbound email by doing so.
  let seen: WarmblyOperatorHttpRequest | undefined;
  const handler = async (req: WarmblyOperatorHttpRequest) => {
    seen = req;
    return { status: 401, body: { ok: false, code: "missing_actor" } };
  };
  await withServer(handler, async (base) => {
    const res = await fetch(`${base}${PAUSE}`, {
      method: "POST",
      headers: { "x-actor-id": "founder", "x-actor-kind": "human", "content-type": "application/json" },
      body: JSON.stringify({ reason: "bounce spike" }),
    });
    assert.equal(res.status, 401, "a forged x-actor-id must not authenticate an operator write");
  });
  assert.ok(seen, "the channel must receive the request");
  // The channel gets the raw headers and resolves identity itself from Remote-*.
  assert.equal(seen?.headers["remote-user"], undefined);
  assert.equal(seen?.headers["x-actor-id"], "founder");
});

test("the channel receives the socket peer address so its trusted-hop check is real", async () => {
  let seen: WarmblyOperatorHttpRequest | undefined;
  const handler = async (req: WarmblyOperatorHttpRequest) => {
    seen = req;
    return { status: 202, body: { ok: true } };
  };
  await withServer(handler, async (base) => {
    await fetch(`${base}${PAUSE}`, { method: "POST", body: "{}" });
  });
  assert.ok(seen?.remoteAddress, "remoteAddress must be forwarded, not left undefined");
});

test("a non-POST operator route reaches the channel, which owns the 405", async () => {
  let method: string | undefined;
  const handler = async (req: WarmblyOperatorHttpRequest) => {
    method = req.method;
    return { status: 405, body: { ok: false, code: "method_not_allowed" } };
  };
  await withServer(handler, async (base) => {
    const res = await fetch(`${base}${PAUSE}`, { method: "GET" });
    assert.equal(res.status, 405);
  });
  assert.equal(method, "GET");
});

test("mounting is off by default and stays off when enabled but unconfigured", () => {
  assert.equal(createWarmblyOperatorHandlerFromEnv({}, { logger: silentLogger }), undefined);
  assert.equal(
    createWarmblyOperatorHandlerFromEnv(
      { CC_WARMBLY_OPERATOR_ENABLED: "true" },
      { logger: silentLogger },
    ),
    undefined,
    "enabled without a base url and token must stay off rather than run half-wired",
  );
  assert.equal(
    createWarmblyOperatorHandlerFromEnv(
      { CC_WARMBLY_OPERATOR_ENABLED: "false", CC_WARMBLY_BASE_URL: "http://x", CC_WARMBLY_OPERATOR_TOKEN: "t" },
      { logger: silentLogger },
    ),
    undefined,
  );
  assert.notEqual(
    createWarmblyOperatorHandlerFromEnv(
      { CC_WARMBLY_OPERATOR_ENABLED: "true", CC_WARMBLY_BASE_URL: "http://x", CC_WARMBLY_OPERATOR_TOKEN: "t" },
      { logger: silentLogger },
    ),
    undefined,
    "fully configured must mount",
  );
});

test("the mount does not shadow the service's own routes", async () => {
  const handler = async () => ({ status: 200, body: { ok: true } });
  await withServer(handler, async (base) => {
    const res = await fetch(`${base}/healthz`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { service?: string };
    assert.equal(body.service, "control-center-context");
  });
});
