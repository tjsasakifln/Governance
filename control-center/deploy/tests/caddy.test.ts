import assert from "node:assert/strict";
import { test } from "node:test";
import { assertCaddyHook, loadCaddy } from "../src/caddy.ts";
import { CADDY_FILE } from "../src/paths.ts";

test("shipped Caddyfile reverse_proxies Control Center services and documents automatic HTTPS", () => {
  const { text, hook } = loadCaddy(CADDY_FILE);
  assertCaddyHook(hook);
  const upstreams = hook.reverseProxies.map((p) => p.upstream);
  assert.ok(upstreams.includes("context:8080"));
  assert.ok(upstreams.includes("mcp:8080"));
  assert.ok(upstreams.includes("web-shell:8080"));
  const paths = hook.reverseProxies.map((p) => p.path);
  assert.ok(paths.includes("/healthz"));
  assert.ok(paths.includes("/ready"));
  assert.ok(hook.documentsAutomaticHttps);
  assert.ok(hook.usesTlsInternal);
  assert.ok(hook.adminOff);
  assert.ok(hook.jsonLogs);
  assert.match(text, /reverse_proxy context:8080/);
  assert.match(text, /reverse_proxy mcp:8080/);
  assert.match(text, /reverse_proxy web-shell:8080/);
  assert.match(text, /automatic HTTPS/i);
  assert.match(text, /ACME/);
  assert.doesNotMatch(text, /^\s*:\s*80\s*\{/m);
  assert.doesNotMatch(text, /^\s*:\s*443\s*\{/m);
});
