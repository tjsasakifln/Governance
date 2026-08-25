import assert from "node:assert/strict";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import {
  SECURITY_HEADERS,
  applySecurityHeaders,
  createProductionServer,
  injectIdentity,
  runtimeIdentityFromEnv,
} from "../../apps/web-shell/scripts/serve-prod.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const RELEASE_SHA = "8a2eb1f012345678901234567890123456789012";

async function withProductionWeb(
  env: Record<string, string>,
  fn: (base: string) => Promise<void>,
): Promise<void> {
  const server = createProductionServer(env);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("production CSP is present, forbids unsafe-eval, and does not use wide script unsafe-inline", () => {
  const csp = SECURITY_HEADERS["Content-Security-Policy"];
  assert.equal(typeof csp, "string");
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'/);
  assert.doesNotMatch(csp, /unsafe-eval/);
  assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/);
  assert.match(SECURITY_HEADERS["X-Content-Type-Options"], /nosniff/);
});

test("serve-prod applies CSP on a real HTTP response", async () => {
  const server = createServer((req, res) => {
    applySecurityHeaders(res);
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  const url = `http://127.0.0.1:${addr.port}/healthz`;
  const res = await fetch(url);
  assert.equal(res.ok, true);
  assert.match(res.headers.get("content-security-policy") ?? "", /script-src 'self'/);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  server.close();
});

test("web sources do not bake env secrets into client code", () => {
  const vite = readFileSync(join(root, "apps/web-shell/vite.config.ts"), "utf8");
  assert.doesNotMatch(vite, /define:\s*\{[^}]*SECRET/);
  assert.doesNotMatch(vite, /loadEnv/);
  const main = readFileSync(join(root, "apps/web-shell/src/main.ts"), "utf8");
  assert.doesNotMatch(main, /process\.env\.(AWS_|POSTGRES_|BACKUP_|MCP_AUTH)/);
  const html = readFileSync(join(root, "apps/web-shell/index.html"), "utf8");
  assert.match(html, /file-protocol-guard\.js/);
  assert.doesNotMatch(html, /<script>\s*\(function \(\)/);
});

test("web production readiness fails closed when the release SHA is not pinned", async () => {
  await withProductionWeb({ CONTROL_CENTER_ENV: "production", CC_RELEASE_SHA: "local" }, async (base) => {
    const health = await fetch(`${base}/healthz`);
    assert.equal(health.status, 200);
    assert.doesNotMatch(await health.text(), /release_sha/i);

    const identity = await fetch(`${base}/runtime-identity`);
    const identityBody = (await identity.json()) as { release_sha: string | null; release_status: string };
    assert.equal(identityBody.release_sha, null);
    assert.equal(identityBody.release_status, "UNVERIFIED");

    const ready = await fetch(`${base}/ready`);
    assert.equal(ready.status, 503);
    assert.deepEqual(await ready.json(), {
      ready: false,
      service: "control-center-web",
      release_sha: null,
      release_status: "UNVERIFIED",
    });
  });

  await withProductionWeb({ NODE_ENV: "production", CC_RELEASE_SHA: "local" }, async (base) => {
    const ready = await fetch(`${base}/ready`);
    assert.equal(ready.status, 503);
    assert.equal((await ready.json() as { ready: boolean }).ready, false);
  });
});

test("web identity endpoint and authenticated cockpit carry the exact pinned SHA", async () => {
  const runtimeIdentity = runtimeIdentityFromEnv({
    CONTROL_CENTER_ENV: "production",
    CC_RELEASE_SHA: RELEASE_SHA,
  });
  assert.equal(runtimeIdentity.release_sha, RELEASE_SHA);
  const source = readFileSync(join(root, "apps/web-shell/index.html"), "utf8");
  const rendered = injectIdentity(source, {
    actorId: "founder",
    actorKind: "human",
    runtimeIdentity,
  });
  assert.match(rendered, new RegExp(`name="cc-release-sha" content="${RELEASE_SHA}"`));

  await withProductionWeb({ CONTROL_CENTER_ENV: "production", CC_RELEASE_SHA: RELEASE_SHA }, async (base) => {
    const identity = await fetch(`${base}/runtime-identity`);
    assert.equal(identity.status, 200);
    assert.equal((await identity.json() as { release_sha: string }).release_sha, RELEASE_SHA);
    const ready = await fetch(`${base}/ready`);
    assert.equal(ready.status, 200);
    assert.equal((await ready.json() as { release_sha: string }).release_sha, RELEASE_SHA);
  });
});
