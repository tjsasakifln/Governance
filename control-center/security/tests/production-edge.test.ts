import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { parse as parseYaml } from "yaml";
import {
  COOKIE_POLICY,
  FORWARD_AUTH_HEADERS,
  FORWARD_AUTH_URI,
  PUBLIC_HEALTH_PATHS,
  RULE,
  analyzeAuthelia,
  analyzeCaddyfile,
  analyzeCompose,
  defaultTrustedHopPolicy,
  healthPayload,
  inspectHealthBody,
  invalidExampleDir,
  packageRoot,
  parseForwardAuthIdentity,
  parsePolicy,
  runCli,
  scanTextForSecrets,
  validateBundle,
} from "../src/index.js";

const PRODUCTION_BUNDLE = path.join(packageRoot(), "production");
const OVERLAY_CADDY = path.resolve(
  packageRoot(),
  "..",
  "deploy",
  "overlays",
  "production-edge",
  "Caddyfile",
);
const OVERLAY_COMPOSE = path.resolve(
  packageRoot(),
  "..",
  "deploy",
  "overlays",
  "production-edge",
  "docker-compose.production-edge.yml",
);
const GENERATOR = path.join(PRODUCTION_BUNDLE, "secrets", "generate-local.sh");
const WORKFLOWS = path.resolve(packageRoot(), "..", "..", ".github", "workflows");
const tempDirs: string[] = [];

function scratchDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function readProduction(rel: string): string {
  return readFileSync(path.join(PRODUCTION_BUNDLE, rel), "utf8");
}

function copyProductionBundle(): string {
  const dir = scratchDir("cc-prod-bundle-");
  cpSync(PRODUCTION_BUNDLE, dir, {
    recursive: true,
    filter: (src) => !src.includes(`${path.sep}secrets${path.sep}local`),
  });
  return dir;
}

describe("production-edge security bundle", () => {
  it("ACCEPTS the shipped production bundle via validateBundle and the CLI", () => {
    const result = validateBundle(PRODUCTION_BUNDLE);
    assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
    assert.equal(result.errors.length, 0);
    const cli = runCli([PRODUCTION_BUNDLE]);
    assert.equal(cli.exitCode, 0);
    assert.match(cli.text, /^ACCEPT\n/);
  });

  it("loads the shipped production Caddyfile (forward_auth, copy_headers, exact health, closed edge)", () => {
    const text = readProduction("Caddyfile");
    const overlay = readFileSync(OVERLAY_CADDY, "utf8");
    assert.equal(text, overlay);
    const analysis = analyzeCaddyfile(text);
    assert.equal(analysis.hasForwardAuth, true);
    assert.equal(analysis.hasForwardAuthUri, true);
    assert.ok(text.includes(FORWARD_AUTH_URI));
    assert.deepEqual([...analysis.missingCopyHeaders], []);
    for (const header of FORWARD_AUTH_HEADERS) {
      assert.ok(text.includes(header));
    }
    assert.equal(analysis.hasTls, true);
    assert.match(text, /tls\s+internal/);
    assert.match(text, /auto_https off/);
    assert.deepEqual([...analysis.missingSecurityHeaders], []);
    assert.equal(analysis.corsWildcard, false);
    assert.equal(analysis.hasHealthMatcher, true);
    assert.equal(analysis.hasBasicAuth, false);
    assert.equal(analysis.unauthenticatedAppProxyWithoutForwardAuth, false);
    for (const health of PUBLIC_HEALTH_PATHS) {
      assert.ok(text.includes(health));
    }
    assert.match(text, /respond `\{"status":"ok"\}` 200/);
    assert.match(text, /@cors_preflight method OPTIONS/);
    assert.match(text, /respond "CORS denied by default" 403/);
    assert.match(text, /http:\/\/ops\.confenge\.com\.br:18080/);
    assert.match(text, /http:\/\/auth\.ops\.confenge\.com\.br:18080/);
    assert.doesNotMatch(text, /listen 0\.0\.0\.0/);
    assert.doesNotMatch(text, /bind 0\.0\.0\.0/);
    assert.doesNotMatch(text, /^\s*:80\s*\{/m);
    assert.doesNotMatch(text, /^\s*:443\s*\{/m);
    assert.match(text, /auto_https off/);
    assert.doesNotMatch(text, /^\s*acme\b/im);
    assert.match(text, /path \/ready \/ready\/\* \/mcp \/mcp\/\*/);
    assert.match(text, /http:\/\/127\.0\.0\.1:18080/);
    assert.match(text, /header Authorization "Bearer \{\$CONFENGE_MCP_AUTH_TOKEN\}"/);
    assert.doesNotMatch(text, /handle \/ready/);
    const opsBlock = text.slice(
      text.indexOf("http://ops.confenge.com.br:18080"),
      text.indexOf("http://auth.ops.confenge.com.br:18080"),
    );
    assert.match(opsBlock, /import app_after_auth/);
    assert.match(opsBlock, /import deny_ready_mcp/);
    assert.doesNotMatch(opsBlock, /reverse_proxy mcp:8080/);
    assert.match(text, /\(app_after_auth\)[\s\S]*forward_auth/);
  });

  it("serves the exact minimal health body and keeps /ready and /mcp off the public allowlist", () => {
    const health = JSON.parse(readProduction("health-response.json")) as unknown;
    assert.deepEqual(health, healthPayload());
    assert.deepEqual(health, { status: "ok" });
    const inspection = inspectHealthBody(health);
    assert.equal(inspection.ok, true);
    const policy = parsePolicy(JSON.parse(readProduction("policy.json")) as unknown);
    assert.deepEqual(policy.publicUnauthenticatedPaths, ["/healthz", "/livez"]);
    assert.equal(policy.session.cookie.secure, COOKIE_POLICY.secure);
    assert.equal(policy.session.cookie.httpOnly, COOKIE_POLICY.httpOnly);
    assert.equal(policy.session.cookie.sameSite, "lax");
    assert.equal(policy.cors.mode, "deny-by-default");
    assert.deepEqual(policy.cors.allowOrigins, []);
    assert.equal(policy.session.rememberMe, false);
    assert.equal(policy.session.inactivity, "30 minutes");
    assert.equal(policy.session.expiration, "8 hours");
  });

  it("loads the shipped Authelia production bundle (deny, 2FA operators, cookie, regulation)", () => {
    const doc = parseYaml(readProduction("authelia/configuration.yml"));
    const analysis = analyzeAuthelia(doc);
    assert.equal(analysis.totpEnabled, true);
    assert.equal(analysis.webauthnEnabled, true);
    assert.equal(analysis.hasRegulation, true);
    assert.equal(analysis.hasSessionTimeout, true);
    assert.equal(analysis.rememberMeDisabled, true);
    assert.equal(analysis.sameSite, "lax");
    assert.equal(analysis.accessControlDefaultDeny, true);
    const record = doc as Record<string, unknown>;
    const access = record.access_control as Record<string, unknown>;
    const rules = access.rules as Array<Record<string, unknown>>;
    assert.ok(
      rules.some(
        (rule) =>
          rule.domain === "ops.confenge.com.br" &&
          rule.policy === "two_factor" &&
          JSON.stringify(rule.subject).includes("group:operators"),
      ),
    );
    const session = record.session as Record<string, unknown>;
    const cookie0 = (session.cookies as Array<Record<string, unknown>>)[0];
    assert.equal(cookie0?.domain, "ops.confenge.com.br");
    assert.equal(cookie0?.authelia_url, "https://auth.ops.confenge.com.br");
    assert.equal(cookie0?.same_site, "lax");
    assert.equal(cookie0?.remember_me, false);
    assert.equal(cookie0?.inactivity, "30 minutes");
    assert.equal(cookie0?.expiration, "8 hours");
    const backend = record.authentication_backend as Record<string, unknown>;
    const reset = backend.password_reset as Record<string, unknown>;
    assert.equal(reset.disable, true);
    const regulation = record.regulation as Record<string, unknown>;
    assert.equal(regulation.max_retries, 3);
    assert.equal(regulation.find_time, "2 minutes");
    assert.equal(regulation.ban_time, "15 minutes");
    const webauthn = record.webauthn as Record<string, unknown>;
    assert.equal(webauthn.enable_passkey_login, true);
  });

  it("analyzes the shipped production compose: loopback Caddy, unpublished datastores, internal+edge networks", () => {
    const overlayText = readFileSync(OVERLAY_COMPOSE, "utf8");
    const bundleText = readProduction("compose.yaml");
    const overlay = analyzeCompose(parseYaml(overlayText));
    const bundle = analyzeCompose(parseYaml(bundleText));
    for (const analysis of [overlay, bundle]) {
      assert.equal(analysis.internalNetworkDefined, true);
      assert.deepEqual([...analysis.publicDatastores], []);
      assert.deepEqual([...analysis.datastoresMissingInternalNetwork], []);
      const caddyPorts = analysis.published.filter((p) => p.service === "caddy");
      assert.ok(caddyPorts.some((p) => p.published === 18080 && p.hostIp === "127.0.0.1"));
      assert.ok(caddyPorts.some((p) => p.published === 18443 && p.hostIp === "127.0.0.1"));
      assert.ok(caddyPorts.every((p) => p.hostIp === "127.0.0.1"));
      assert.ok(!analysis.published.some((p) => p.published === 80 || p.published === 443));
      assert.ok(!analysis.published.some((p) => p.service === "postgres"));
      assert.ok(!analysis.published.some((p) => p.service === "redis"));
      assert.ok(!analysis.published.some((p) => p.service === "nats"));
    }
    assert.match(overlayText, /image:\s+redis:7-alpine@sha256:[0-9a-f]{64}/);
    assert.match(overlayText, /image:\s+authelia\/authelia:4.39@sha256:[0-9a-f]{64}/);
    assert.match(overlayText, /image:\s+postgres:16-alpine@sha256:[0-9a-f]{64}/);
    assert.match(overlayText, /image:\s+nats:2\.12\.6-alpine@sha256:[0-9a-f]{64}/);
    assert.match(overlayText, /internal:\s+true/);
    assert.match(overlayText, /cc_edge:/);
    assert.match(overlayText, /cc_internal:/);
    assert.doesNotMatch(overlayText, /["']0\.0\.0\.0["']/);
    assert.match(overlayText, /POSTGRES_DB: control_center/);
    assert.match(overlayText, /init-authelia\.sh/);
    assert.match(readProduction("authelia/configuration.yml"), /database: authelia/);
  });

  it("does not grant identity from spoofed Remote-*, untrusted hops, or X-Forwarded-For against the production policy", () => {
    const policyDoc = parsePolicy(JSON.parse(readProduction("policy.json")) as unknown);
    const hopPolicy = defaultTrustedHopPolicy(policyDoc.trustedHops);
    const headers = {
      "Remote-User": "operator",
      "Remote-Groups": "operators",
      "Remote-Name": "Op",
      "Remote-Email": "ops@example.invalid",
    };
    const spoofed = parseForwardAuthIdentity({ remoteAddress: "8.8.8.8", headers }, hopPolicy);
    assert.equal(spoofed.ok, false);
    if (!spoofed.ok) {
      assert.equal(spoofed.code, "spoofed_identity");
    }
    const untrusted = parseForwardAuthIdentity({ remoteAddress: "203.0.113.9", headers: {} }, hopPolicy);
    assert.equal(untrusted.ok, false);
    if (!untrusted.ok) {
      assert.equal(untrusted.code, "untrusted_hop");
    }
    const xff = parseForwardAuthIdentity(
      {
        remoteAddress: "203.0.113.9",
        headers: { ...headers, "X-Forwarded-For": "10.89.0.2", "X-Real-IP": "10.89.0.2" },
      },
      hopPolicy,
    );
    assert.equal(xff.ok, false);
    if (!xff.ok) {
      assert.equal(xff.code, "spoofed_identity");
    }
    const trusted = parseForwardAuthIdentity({ remoteAddress: "10.89.0.2", headers }, hopPolicy);
    assert.equal(trusted.ok, true);
  });

  it("REJECTS a copy of the production bundle with forward_auth removed", () => {
    const dir = copyProductionBundle();
    const caddyPath = path.join(dir, "Caddyfile");
    const stripped = readFileSync(caddyPath, "utf8")
      .replaceAll("forward_auth", "reverse_proxy")
      .replaceAll("uri /api/authz/forward-auth", "uri /gone");
    writeFileSync(caddyPath, stripped);
    const result = validateBundle(dir);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((err) => err.rule === RULE.FORWARD_AUTH));
    const cli = runCli([dir]);
    assert.equal(cli.exitCode, 1);
    assert.match(cli.text, /^REJECT\n/);
  });

  it("REJECTS a copy of the production bundle with a hardcoded password", () => {
    const dir = copyProductionBundle();
    writeFileSync(
      path.join(dir, "authelia", "users.yml"),
      `users:\n  operator:\n    password: "hunter2"\n    email: ops@example.invalid\n    groups: [operators]\n`,
    );
    const result = validateBundle(dir);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((err) => err.rule === RULE.SECRET_INJECTION));
    const cli = runCli([dir]);
    assert.equal(cli.exitCode, 1);
    assert.match(cli.text, /^REJECT\n/);
  });

  it("still REJECTS the named missing-forward-auth and hardcoded-password fixtures", () => {
    const missing = runCli([invalidExampleDir("missing-forward-auth")]);
    assert.equal(missing.exitCode, 1);
    assert.match(missing.text, /^REJECT\n/);
    const hardcoded = runCli([invalidExampleDir("hardcoded-password")]);
    assert.equal(hardcoded.exitCode, 1);
    assert.match(hardcoded.text, /^REJECT\n/);
  });

  it("lists required secret names/destinations only and keeps the generator out of CI", () => {
    const manifest = JSON.parse(readProduction("secrets/manifest.json")) as {
      secrets: Array<{ name: string; destination: string }>;
    };
    const names = manifest.secrets.map((row) => row.name);
    assert.deepEqual(names, [
      "POSTGRES_PASSWORD",
      "CONTROL_CENTER_DATABASE_URL",
      "CONTROL_CENTER_BACKUP_KEY",
      "CONFENGE_MCP_AUTH_TOKEN",
      "CONTROL_CENTER_FOUNDER_ACTOR_ID",
      "authelia_jwt",
      "authelia_session",
      "authelia_storage",
      "authelia_postgres_password",
      "CC_OPERATOR_PASSWORD_HASH",
      "CC_OPERATOR_USER",
      "CC_OPERATOR_EMAIL",
      "CC_PUBLIC_DOMAIN",
      "CC_AUTH_DOMAIN",
      "CC_COOKIE_DOMAIN",
      "CC_TRUSTED_PROXY_CIDRS",
    ]);
    for (const row of manifest.secrets) {
      assert.ok(row.destination.includes("${CC_SECRET_DIR}/"));
    }
    assert.equal(existsSync(GENERATOR), true);
    if (existsSync(WORKFLOWS)) {
      for (const name of readdirSync(WORKFLOWS)) {
        const text = readFileSync(path.join(WORKFLOWS, name), "utf8");
        assert.doesNotMatch(text, /generate-local\.sh/);
      }
    }
  });

  it("generator writes 0600 files, prints no values, and refuses placeholders and CI", () => {
    const dest = scratchDir("cc-secrets-");
    const operatorPassword = "cc-operator-test-only-not-for-production";
    const missing = spawnSync("bash", [GENERATOR, dest], {
      encoding: "utf8",
      env: {
        ...process.env,
        CI: "",
        GITHUB_ACTIONS: "",
        CC_OPERATOR_PASSWORD: "",
        CC_OPERATOR_PASSWORD_FILE: "/no/such/bootstrap-operator-password",
      },
    });
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /HUMAN_GATE_OPERATOR_PASSWORD/);
    const bootstrapFile = path.join(dest, "bootstrap-operator-password");
    writeFileSync(bootstrapFile, `${operatorPassword}\n`, { mode: 0o600 });
    const fromFile = spawnSync("bash", [GENERATOR, dest], {
      encoding: "utf8",
      env: {
        ...process.env,
        CI: "",
        GITHUB_ACTIONS: "",
        CC_OPERATOR_PASSWORD: "",
        CC_OPERATOR_PASSWORD_FILE: bootstrapFile,
      },
    });
    assert.equal(fromFile.status, 0, fromFile.stderr);
    assert.doesNotMatch(fromFile.stdout, new RegExp(operatorPassword));
    assert.doesNotMatch(fromFile.stderr, new RegExp(operatorPassword));
    const ok = spawnSync("bash", [GENERATOR, dest], {
      encoding: "utf8",
      env: { ...process.env, CI: "", GITHUB_ACTIONS: "", CC_OPERATOR_PASSWORD: operatorPassword },
    });
    assert.equal(ok.status, 0, ok.stderr);
    assert.doesNotMatch(ok.stdout, new RegExp(operatorPassword));
    assert.doesNotMatch(ok.stderr, new RegExp(operatorPassword));
    assert.match(ok.stdout, /wrote secret files/);
    const postgres = readFileSync(path.join(dest, "POSTGRES_PASSWORD"), "utf8");
    assert.ok(postgres.length >= 16);
    assert.doesNotMatch(ok.stdout, new RegExp(postgres));
    assert.doesNotMatch(ok.stderr, new RegExp(postgres));
    const mcp = readFileSync(path.join(dest, "CONFENGE_MCP_AUTH_TOKEN"), "utf8");
    assert.doesNotMatch(ok.stdout, new RegExp(mcp));
    for (const name of ["POSTGRES_PASSWORD", "authelia_jwt", "users.yml", ".env"]) {
      const mode = statSync(path.join(dest, name)).mode & 0o777;
      assert.equal(mode, 0o600, name);
    }
    const placeholder = spawnSync("bash", [GENERATOR, dest], {
      encoding: "utf8",
      env: { ...process.env, CI: "", GITHUB_ACTIONS: "", CC_OPERATOR_EMAIL: "change_me" },
    });
    assert.notEqual(placeholder.status, 0);
    assert.match(placeholder.stderr, /placeholder/i);
    const ci = spawnSync("bash", [GENERATOR, dest], {
      encoding: "utf8",
      env: { ...process.env, CI: "true" },
    });
    assert.notEqual(ci.status, 0);
    assert.match(ci.stderr, /CI/);
  });

  it("secret-scans the shipped production bundle text files", () => {
    const files = [
      "Caddyfile",
      "compose.yaml",
      "policy.json",
      "health-response.json",
      "env.example",
      "authelia/configuration.yml",
      "authelia/users.yml",
      "secrets/manifest.json",
    ];
    for (const rel of files) {
      const findings = scanTextForSecrets(readProduction(rel), rel);
      assert.deepEqual(findings, [], rel);
    }
  });
});
