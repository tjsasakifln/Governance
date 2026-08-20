import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  INVALID_FIXTURE_NAMES,
  RULE,
  invalidExampleDir,
  runCli,
  validateBundle,
  validExampleDir,
} from "../src/index.js";

function hasRule(dir: string, rule: string): void {
  const result = validateBundle(dir);
  assert.equal(result.ok, false, `${dir} should be rejected`);
  assert.ok(
    result.errors.some((err) => err.rule === rule),
    `${dir} should name ${rule}; got ${JSON.stringify(result.errors)}`,
  );
}

describe("security bundle validator", () => {
  it("accepts the valid example set", () => {
    const result = validateBundle(validExampleDir());
    assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
    assert.equal(result.errors.length, 0);
  });

  it("rejects hardcoded password", () => {
    hasRule(invalidExampleDir("hardcoded-password"), RULE.SECRET_INJECTION);
  });

  it("rejects secret URL as the only gate", () => {
    hasRule(invalidExampleDir("secret-url-only"), RULE.NO_SECRET_URL_GATE);
  });

  it("rejects public Postgres / Redis / NATS", () => {
    hasRule(invalidExampleDir("public-postgres"), RULE.INTERNAL_DATASTORES);
    hasRule(invalidExampleDir("public-redis"), RULE.INTERNAL_DATASTORES);
    hasRule(invalidExampleDir("public-nats"), RULE.INTERNAL_DATASTORES);
    const pg = validateBundle(invalidExampleDir("public-postgres"));
    assert.ok(pg.errors.some((e) => e.code === "public-postgres"));
    const redis = validateBundle(invalidExampleDir("public-redis"));
    assert.ok(redis.errors.some((e) => e.code === "public-redis"));
    const nats = validateBundle(invalidExampleDir("public-nats"));
    assert.ok(nats.errors.some((e) => e.code === "public-nats"));
  });

  it("rejects missing forward_auth /authz URI", () => {
    hasRule(invalidExampleDir("missing-forward-auth"), RULE.FORWARD_AUTH);
  });

  it("rejects missing TOTP+WebAuthn", () => {
    hasRule(invalidExampleDir("missing-mfa"), RULE.IDP_MFA);
  });

  it("rejects a health body that leaks state/identity/secrets", () => {
    hasRule(invalidExampleDir("leaking-health"), RULE.MINIMAL_HEALTH);
  });

  it("covers every named invalid fixture", () => {
    assert.deepEqual([...INVALID_FIXTURE_NAMES], [
      "hardcoded-password",
      "secret-url-only",
      "public-postgres",
      "public-redis",
      "public-nats",
      "missing-forward-auth",
      "missing-mfa",
      "leaking-health",
    ]);
    for (const name of INVALID_FIXTURE_NAMES) {
      const result = validateBundle(invalidExampleDir(name));
      assert.equal(result.ok, false, name);
    }
  });

  it("CLI accepts the valid set and rejects an invalid fixture with a named rule", () => {
    const ok = runCli([validExampleDir()]);
    assert.equal(ok.exitCode, 0);
    assert.match(ok.text, /^ACCEPT\n/);
    assert.match(ok.text, /"ok": true/);
    const bad = runCli([invalidExampleDir("missing-forward-auth")]);
    assert.equal(bad.exitCode, 1);
    assert.match(bad.text, /^REJECT\n/);
    assert.match(bad.text, /C-FORWARD-AUTH/);
    assert.match(bad.text, /forward_auth/);
  });
});
