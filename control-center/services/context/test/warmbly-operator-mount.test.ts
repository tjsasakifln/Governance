import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

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
    await fetch(`${base}${PAUSE}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
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

test("mounting is off by default and stays off when enabled but unconfigured", async () => {
  assert.equal(await createWarmblyOperatorHandlerFromEnv({}, { logger: silentLogger }), undefined);
  assert.equal(
    await createWarmblyOperatorHandlerFromEnv(
      { CC_WARMBLY_OPERATOR_ENABLED: "true" },
      { logger: silentLogger },
    ),
    undefined,
    "enabled without a base url and token must stay off rather than run half-wired",
  );
  assert.equal(
    await createWarmblyOperatorHandlerFromEnv(
      { CC_WARMBLY_OPERATOR_ENABLED: "false", CC_WARMBLY_BASE_URL: "http://x", CC_WARMBLY_OPERATOR_TOKEN: "t" },
      { logger: silentLogger },
    ),
    undefined,
  );
  assert.notEqual(
    await createWarmblyOperatorHandlerFromEnv(
      {
        CC_WARMBLY_OPERATOR_ENABLED: "true",
        CC_WARMBLY_BASE_URL: "http://x",
        CC_WARMBLY_OPERATOR_TOKEN: "t",
        CC_WARMBLY_OPERATOR_TRUSTED_HOPS: "10.89.0.2/32",
      },
      { logger: silentLogger },
    ),
    undefined,
    "fully configured must mount",
  );
});

test("production can mount from a file-backed credential without putting it in env", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-warmbly-credential-"));
  const file = join(dir, "credential");
  writeFileSync(file, "wmbly_fixture_file_only_123456\n", { mode: 0o600 });
  try {
    const handler = await createWarmblyOperatorHandlerFromEnv(
      {
        CC_WARMBLY_OPERATOR_ENABLED: "true",
        CC_WARMBLY_BASE_URL: "http://x",
        CC_WARMBLY_OPERATOR_TOKEN_FILE: file,
        CC_WARMBLY_OPERATOR_TRUSTED_HOPS: "10.89.0.2/32",
      },
      { logger: silentLogger },
    );
    assert.notEqual(handler, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an unreadable or empty file-backed credential fails closed even if a legacy env value exists", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-warmbly-empty-"));
  const empty = join(dir, "empty");
  writeFileSync(empty, "\n", { mode: 0o600 });
  const base = {
    CC_WARMBLY_OPERATOR_ENABLED: "true",
    CC_WARMBLY_BASE_URL: "http://x",
    CC_WARMBLY_OPERATOR_TOKEN: "must-not-be-used-as-fallback",
    CC_WARMBLY_OPERATOR_TRUSTED_HOPS: "10.89.0.2/32",
  };
  try {
    assert.equal(
      await createWarmblyOperatorHandlerFromEnv(
        { ...base, CC_WARMBLY_OPERATOR_TOKEN_FILE: empty },
        { logger: silentLogger },
      ),
      undefined,
    );
    assert.equal(
      await createWarmblyOperatorHandlerFromEnv(
        { ...base, CC_WARMBLY_OPERATOR_TOKEN_FILE: join(dir, "missing") },
        { logger: silentLogger },
      ),
      undefined,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the connector is never a static import, so a disabled feature cannot crash boot", () => {
  // A static import made an opt-in feature crash the container on any image
  // without the connector, feature off or not. That is what this pins.
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../src/warmbly-operator/from-env.ts"),
    "utf8",
  );
  const staticImport = /^\s*import\s[^\n]*@confenge\/control-center-warmbly-connector/m;
  assert.equal(
    staticImport.test(source),
    false,
    "the connector must be reached through a dynamic import inside the enabled branch",
  );
  assert.match(source, /await import\("@confenge\/control-center-warmbly-connector"\)|import\("@confenge\/control-center-warmbly-connector"\)/);
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

// --- Regressions from the second adversarial review -------------------------

test("a half-configured flag does not crash boot through the logger", async () => {
  // `has_token` matched the service logger's secret-NAME regex, which throws.
  // The branch meant to say "stay off" instead took the whole service down in a
  // restart loop, taking /healthz and every read with it.
  const thrown: unknown[] = [];
  const strictLogger = {
    info() {},
    warn() {},
    error(_msg: string, fields?: Record<string, string | number | boolean | null>) {
      for (const key of Object.keys(fields ?? {})) {
        if (/pass(word)?|secret|token|authorization|cookie/i.test(key)) {
          const err = new Error("refusing to log a secret-bearing field name");
          thrown.push(err);
          throw err;
        }
      }
    },
  };
  const handler = await createWarmblyOperatorHandlerFromEnv(
    { CC_WARMBLY_OPERATOR_ENABLED: "true", CC_WARMBLY_OPERATOR_TRUSTED_HOPS: "10.89.0.2/32" },
    { logger: strictLogger },
  );
  assert.equal(handler, undefined);
  assert.deepEqual(thrown, [], "no field name may trip the logger's secret guard");
});

test("the channel refuses to mount without an explicitly narrowed trusted hop", async () => {
  // The library default trusts 10.89.0.0/24, which in production is the whole
  // cc_edge network: web, mcp, collector and context sit there beside caddy.
  // Any of them could forge Remote-* and execute a resume.
  assert.equal(
    await createWarmblyOperatorHandlerFromEnv(
      {
        CC_WARMBLY_OPERATOR_ENABLED: "true",
        CC_WARMBLY_BASE_URL: "http://x",
        CC_WARMBLY_OPERATOR_TOKEN: "t",
      },
      { logger: silentLogger },
    ),
    undefined,
    "a missing trusted hop must fail closed, never fall back to the edge network",
  );
  assert.notEqual(
    await createWarmblyOperatorHandlerFromEnv(
      {
        CC_WARMBLY_OPERATOR_ENABLED: "true",
        CC_WARMBLY_BASE_URL: "http://x",
        CC_WARMBLY_OPERATOR_TOKEN: "t",
        CC_WARMBLY_OPERATOR_TRUSTED_HOPS: "10.89.0.2/32",
      },
      { logger: silentLogger },
    ),
    undefined,
  );
});

test("an operator write refuses a non-JSON content type", async () => {
  // <form enctype="text/plain"> is CORS-simple, so no preflight runs and the
  // lax session cookie is still sent from any *.confenge.com.br page.
  let reached = false;
  const handler = async () => {
    reached = true;
    return { status: 200, body: { ok: true } };
  };
  await withServer(handler, async (base) => {
    const res = await fetch(`${base}${PAUSE}`, {
      method: "POST",
      headers: { "content-type": "text/plain;charset=UTF-8" },
      body: '{"reason":"pausado pelo atacante"}',
    });
    assert.equal(res.status, 415);
    const body = (await res.json()) as { code?: string };
    assert.equal(body.code, "unsupported_media_type");
  });
  assert.equal(reached, false, "the channel must never see a cross-origin form body");
});

test("a JSON operator write still reaches the channel", async () => {
  let reached = false;
  const handler = async () => {
    reached = true;
    return { status: 200, body: { ok: true } };
  };
  await withServer(handler, async (base) => {
    const res = await fetch(`${base}${PAUSE}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "bounce spike" }),
    });
    assert.equal(res.status, 200);
  });
  assert.equal(reached, true);
});

test("a duplicated Remote-Groups cannot smuggle an operator group", async () => {
  // Node joins duplicate headers into "operators, viewers", which splitGroups
  // then splits back into a group list — handing the caller whichever group it
  // appended. Only rawHeaders shows the duplicate, so the mount must forward it.
  let seen: { rawHeaders?: readonly string[] } | undefined;
  const handler = async (req: { rawHeaders?: readonly string[] }) => {
    seen = req;
    return { status: 401, body: { ok: false, code: "spoofed_identity" } };
  };
  await withServer(handler as never, async (base) => {
    const { request } = await import("node:http");
    await new Promise<void>((resolve, reject) => {
      const req = request(
        `${base}${PAUSE}`,
        { method: "POST", headers: { "content-type": "application/json" } },
        (res) => {
          res.resume();
          res.on("end", () => resolve());
        },
      );
      req.on("error", reject);
      // Two Remote-Groups on the wire: the client's copy and the proxy's.
      req.setHeader("Remote-User", "mallory");
      req.appendHeader?.("Remote-Groups", "operators");
      req.appendHeader?.("Remote-Groups", "viewers");
      req.end(JSON.stringify({ reason: "escalation probe" }));
    });
  });
  const raw = seen?.rawHeaders ?? [];
  const count = raw.filter((_v, i) => i % 2 === 0 && raw[i]?.toLowerCase() === "remote-groups").length;
  assert.ok(count >= 2, "the mount must forward rawHeaders so the duplicate is visible");
});
