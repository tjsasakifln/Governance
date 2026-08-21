import assert from "node:assert/strict";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import {
  SECURITY_HEADERS,
  applySecurityHeaders,
} from "../../apps/web-shell/scripts/serve-prod.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

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
