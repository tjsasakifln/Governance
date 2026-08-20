import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  FORWARD_AUTH_HEADERS,
  FORWARD_AUTH_URI,
  PUBLIC_HEALTH_PATHS,
  RULE,
  THREAT_CONTROLS,
  THREAT_IDS,
  defaultPolicyDocument,
  loadThreatModelFile,
  parsePolicy,
  redact,
  validExampleDir,
  validateThreatModel,
} from "../src/index.js";

function read(rel: string): string {
  return readFileSync(path.join(validExampleDir(), rel), "utf8");
}

describe("forward-auth contract lockstep", () => {
  it("keeps Caddy copy_headers and Authelia URI in the valid example", () => {
    const caddy = read("Caddyfile");
    assert.match(caddy, /forward_auth/);
    assert.ok(caddy.includes(FORWARD_AUTH_URI));
    assert.match(
      caddy,
      /copy_headers\s+Remote-User\s+Remote-Groups\s+Remote-Name\s+Remote-Email/,
    );
    for (const header of FORWARD_AUTH_HEADERS) {
      assert.ok(caddy.includes(header));
    }
    for (const health of PUBLIC_HEALTH_PATHS) {
      assert.ok(caddy.includes(health));
    }
    assert.match(caddy, /\btls\s+/);
    assert.doesNotMatch(caddy, /Access-Control-Allow-Origin\s+"?\*"?/i);
  });

  it("parses the committed policy.json through the shipped parser", () => {
    const raw = JSON.parse(read("policy.json")) as unknown;
    const policy = parsePolicy(raw);
    assert.equal(policy.forwardAuth.uri, FORWARD_AUTH_URI);
    assert.equal(policy.mfa.totp, true);
    assert.equal(policy.mfa.webauthn, true);
    assert.deepEqual(policy.publicUnauthenticatedPaths, [...PUBLIC_HEALTH_PATHS]);
    const generated = defaultPolicyDocument();
    assert.deepEqual(raw, generated);
  });

  it("maps the five named threats to controls", () => {
    const model = loadThreatModelFile();
    const errors = validateThreatModel(model);
    assert.deepEqual(errors, []);
    assert.deepEqual(
      model.threats.map((t) => t.id),
      [...THREAT_IDS],
    );
    for (const id of THREAT_IDS) {
      const row = model.threats.find((t) => t.id === id);
      assert.ok(row);
      for (const control of THREAT_CONTROLS[id]) {
        assert.ok(row.controls.includes(control), `${id} missing ${control}`);
      }
    }
    assert.ok(Object.values(RULE).every((id) => id.startsWith("C-")));
  });

  it("redacts secrets and PII in structured logs", () => {
    const redacted = redact({
      event: "forward_auth_denied",
      code: "spoofed_identity",
      password: "hunter2",
      email: "ops@example.invalid",
      token: "abc",
      nested: { jwt: "eyJhbGciOi", ok: true },
    });
    assert.deepEqual(redacted, {
      event: "forward_auth_denied",
      code: "spoofed_identity",
      password: "[redacted]",
      email: "[redacted]",
      token: "[redacted]",
      nested: { jwt: "[redacted]", ok: true },
    });
  });
});
