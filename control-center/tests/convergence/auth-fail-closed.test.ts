import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  COOKIE_POLICY,
  CORS_POLICY,
  CSRF_STRATEGY,
} from "../../security/src/constants.ts";
import { analyzeCaddyfile } from "../../security/src/caddy.ts";
import {
  defaultTrustedHopPolicy,
  parseForwardAuthIdentity,
} from "../../security/src/identity.ts";
import {
  classifyPath,
  healthPayload,
  inspectHealthBody,
  isPublicUnauthenticatedPath,
} from "../../security/src/health.ts";
import { bootLiveRuntime, httpJson } from "./live-runtime/harness.ts";

const ccRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

test("ForwardAuth spoof, untrusted proxy, unauthenticated, CSRF, CORS, cookies fail closed", async () => {
  const policy = defaultTrustedHopPolicy(["10.89.0.0/24", "127.0.0.1/32"]);
  const spoof = parseForwardAuthIdentity(
    {
      remoteAddress: "203.0.113.9",
      headers: {
        "Remote-User": "founder-local",
        "Remote-Groups": "operators",
        "Remote-Name": "Founder",
        "Remote-Email": "founder@confenge.invalid",
      },
    },
    policy,
  );
  assert.equal(spoof.ok, false);
  if (!spoof.ok) {
    assert.equal(spoof.code, "spoofed_identity");
  }

  const untrusted = parseForwardAuthIdentity(
    { remoteAddress: "203.0.113.9", headers: {} },
    policy,
  );
  assert.equal(untrusted.ok, false);
  if (!untrusted.ok) {
    assert.equal(untrusted.code, "untrusted_hop");
  }

  const missing = parseForwardAuthIdentity(
    { remoteAddress: "127.0.0.1", headers: {} },
    policy,
  );
  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.equal(missing.code, "missing_identity");
  }

  const ok = parseForwardAuthIdentity(
    {
      remoteAddress: "127.0.0.1",
      headers: {
        "Remote-User": "founder-local",
        "Remote-Groups": "operators",
        "Remote-Name": "Founder",
        "Remote-Email": "founder@confenge.invalid",
      },
    },
    policy,
  );
  assert.equal(ok.ok, true);

  assert.equal(isPublicUnauthenticatedPath("/v1/context"), false);
  assert.equal(classifyPath("/v1/context"), "protected");
  assert.equal(isPublicUnauthenticatedPath("/healthz"), true);
  const health = inspectHealthBody(healthPayload());
  assert.equal(health.ok, true);

  assert.equal(CORS_POLICY.mode, "deny-by-default");
  assert.equal(CORS_POLICY.allowOrigins.length, 0);
  assert.equal(CORS_POLICY.allowCredentials, false);
  assert.equal(CSRF_STRATEGY, "same-site-cookie-plus-cors-deny");
  assert.equal(COOKIE_POLICY.secure, true);
  assert.equal(COOKIE_POLICY.httpOnly, true);
  assert.equal(COOKIE_POLICY.sameSite, "lax");

  const caddy = analyzeCaddyfile(
    readFileSync(join(ccRoot, "security/examples/valid/Caddyfile"), "utf8"),
  );
  assert.equal(caddy.corsWildcard, false);
  assert.equal(caddy.hasForwardAuth, true);
  assert.equal(caddy.unauthenticatedAppProxyWithoutForwardAuth, false);

  const runtime = await bootLiveRuntime();
  try {
    const unauth = await httpJson(`${runtime.contextBaseUrl}/v1/context?scope=company`);
    assert.ok(unauth.status === 401 || unauth.status === 403);
    const spoofHttp = await httpJson(`${runtime.contextBaseUrl}/v1/context?scope=company`, {
      headers: { "x-actor-id": "not-the-founder", "x-actor-kind": "human" },
    });
    assert.ok(spoofHttp.status === 401 || spoofHttp.status === 403);
    const options = await fetch(`${runtime.contextBaseUrl}/v1/context?scope=company`, {
      method: "OPTIONS",
    });
    assert.notEqual(options.headers.get("access-control-allow-origin"), "*");
    const setCookie = options.headers.get("set-cookie");
    if (setCookie) {
      assert.match(setCookie, /HttpOnly/i);
      assert.match(setCookie, /Secure/i);
    }
  } finally {
    await runtime.stop();
  }
});
