import path from "node:path";
import { parse as parseYaml } from "yaml";
import { analyzeAuthelia } from "./authelia.js";
import { loadBundle, type SecurityBundle } from "./bundle.js";
import { analyzeCaddyfile } from "./caddy.js";
import { analyzeCompose } from "./compose.js";
import { RULE, type RuleId } from "./constants.js";
import { inspectHealthBody } from "./health.js";
import { packageRoot } from "./paths.js";
import { parsePolicy } from "./policy.js";
import { scanTextForSecrets, walkSecrets } from "./secrets.js";
import type { SecurityPolicy, ValidationIssue, ValidationResult } from "./types.js";

function issue(code: string, rule: RuleId, file: string, message: string): ValidationIssue {
  return { code, rule, path: file, message };
}

function parseJson(text: string, file: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`${file} is not JSON: ${reason}`);
  }
}

function parseYamlDoc(text: string, file: string): unknown {
  try {
    return parseYaml(text) as unknown;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`${file} is not YAML: ${reason}`);
  }
}

export function validateLoadedBundle(bundle: SecurityBundle): ValidationResult {
  const errors: ValidationIssue[] = [];
  const files = bundle.files;
  const root = packageRoot();
  const display = bundle.dir === root || bundle.dir.startsWith(`${root}${path.sep}`)
    ? path.relative(root, bundle.dir)
    : bundle.dir;

  let policy: SecurityPolicy | undefined;
  try {
    policy = parsePolicy(parseJson(files.policy, "policy.json"));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(issue("invalid-policy", RULE.FAIL_CLOSED_IDENTITY, "policy.json", message));
  }

  const caddy = analyzeCaddyfile(files.caddyfile);
  if (!caddy.hasForwardAuth || !caddy.hasForwardAuthUri) {
    errors.push(
      issue(
        "missing-forward-auth",
        RULE.FORWARD_AUTH,
        "Caddyfile",
        "Caddyfile must use forward_auth with uri /api/authz/forward-auth",
      ),
    );
  }
  if (caddy.missingCopyHeaders.length > 0) {
    errors.push(
      issue(
        "missing-copy-headers",
        RULE.COPY_HEADERS,
        "Caddyfile",
        `copy_headers must include ${caddy.missingCopyHeaders.join(", ")}`,
      ),
    );
  }
  if (!caddy.hasTls) {
    errors.push(issue("missing-tls", RULE.TLS, "Caddyfile", "TLS must terminate at the reverse proxy"));
  }
  if (caddy.missingSecurityHeaders.length > 0) {
    errors.push(
      issue(
        "missing-secure-headers",
        RULE.SECURE_HEADERS,
        "Caddyfile",
        `missing headers: ${caddy.missingSecurityHeaders.join(", ")}`,
      ),
    );
  }
  if (caddy.corsWildcard) {
    errors.push(
      issue("cors-wildcard", RULE.CORS_DENY, "Caddyfile", "CORS must deny by default; wildcard origin is forbidden"),
    );
  }
  if (!caddy.hasHealthMatcher) {
    errors.push(
      issue(
        "missing-health-allowlist",
        RULE.MINIMAL_HEALTH,
        "Caddyfile",
        "public unauthenticated routes must allowlist /healthz and /livez only",
      ),
    );
  }
  if (caddy.hasBasicAuth) {
    errors.push(
      issue(
        "homemade-identity",
        RULE.NO_SECRET_URL_GATE,
        "Caddyfile",
        "basic_auth is homemade identity; use Authelia ForwardAuth",
      ),
    );
  }
  if (caddy.obscureUnauthenticatedPath) {
    errors.push(
      issue(
        "secret-url-only",
        RULE.NO_SECRET_URL_GATE,
        "Caddyfile",
        "obscure path is not access control; Authelia ForwardAuth is required (C-NO-SECRET-URL-GATE)",
      ),
    );
  }
  if (caddy.unauthenticatedAppProxyWithoutForwardAuth && !caddy.hasForwardAuth) {
    errors.push(
      issue(
        "missing-forward-auth",
        RULE.FORWARD_AUTH,
        "Caddyfile",
        "app reverse_proxy without forward_auth is an open edge",
      ),
    );
  }

  let autheliaDoc: unknown;
  try {
    autheliaDoc = parseYamlDoc(files.authelia, "authelia/configuration.yml");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(issue("invalid-authelia", RULE.IDP_MFA, "authelia/configuration.yml", message));
  }
  const authelia = analyzeAuthelia(autheliaDoc);
  if (!authelia.totpEnabled || !authelia.webauthnEnabled) {
    errors.push(
      issue(
        "missing-mfa",
        RULE.IDP_MFA,
        "authelia/configuration.yml",
        "Authelia must enable TOTP and WebAuthn (disable must not be true)",
      ),
    );
  }
  if (!authelia.hasRegulation) {
    errors.push(
      issue(
        "missing-regulation",
        RULE.REGULATION,
        "authelia/configuration.yml",
        "Authelia regulation (max_retries, find_time, ban_time) is required for brute-force defense",
      ),
    );
  }
  if (!authelia.hasSessionTimeout) {
    errors.push(
      issue(
        "missing-session-timeout",
        RULE.SESSION_TIMEOUT,
        "authelia/configuration.yml",
        "session inactivity and expiration are required",
      ),
    );
  }
  if (!authelia.rememberMeDisabled) {
    errors.push(
      issue(
        "remember-me-enabled",
        RULE.SESSION_TIMEOUT,
        "authelia/configuration.yml",
        "remember_me must be disabled for the single operator session",
      ),
    );
  }
  if (authelia.sameSite !== "lax" && authelia.sameSite !== "strict") {
    errors.push(
      issue(
        "cookie-samesite",
        RULE.COOKIE_POLICY,
        "authelia/configuration.yml",
        "session cookie SameSite must be lax or strict",
      ),
    );
  }
  if (!authelia.accessControlDefaultDeny) {
    errors.push(
      issue(
        "acl-not-deny",
        RULE.FAIL_CLOSED_IDENTITY,
        "authelia/configuration.yml",
        "access_control.default_policy must be deny",
      ),
    );
  }

  let composeDoc: unknown;
  try {
    composeDoc = parseYamlDoc(files.compose, "compose.yaml");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(issue("invalid-compose", RULE.INTERNAL_DATASTORES, "compose.yaml", message));
  }
  const compose = analyzeCompose(composeDoc);
  if (!compose.internalNetworkDefined) {
    errors.push(
      issue(
        "missing-internal-network",
        RULE.INTERNAL_DATASTORES,
        "compose.yaml",
        "compose must define an internal:true network for datastores",
      ),
    );
  }
  for (const finding of compose.publicDatastores) {
    const kind = finding.startsWith("postgres")
      ? "public-postgres"
      : finding.startsWith("redis")
        ? "public-redis"
        : finding.startsWith("nats")
          ? "public-nats"
          : "public-datastore";
    errors.push(
      issue(
        kind,
        RULE.INTERNAL_DATASTORES,
        "compose.yaml",
        `${finding}; PostgreSQL, Redis, and NATS must not be on the public network`,
      ),
    );
  }
  for (const finding of compose.datastoresMissingInternalNetwork) {
    errors.push(issue("datastore-network", RULE.INTERNAL_DATASTORES, "compose.yaml", finding));
  }

  try {
    const health = parseJson(files.health, "health-response.json");
    const inspection = inspectHealthBody(health);
    if (!inspection.ok) {
      errors.push(
        issue(
          "leaking-health",
          RULE.MINIMAL_HEALTH,
          "health-response.json",
          `health body must not leak state, identity, or secrets: ${inspection.leaks.join("; ")}`,
        ),
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(issue("invalid-health", RULE.MINIMAL_HEALTH, "health-response.json", message));
  }

  if (policy && policy.trustedHops.length === 0) {
    errors.push(issue("empty-trusted-hops", RULE.TRUSTED_HOP, "policy.json", "trusted_hops must not be empty"));
  }

  for (const extra of bundle.extraTextFiles) {
    const base = path.basename(extra.path);
    if (base.endsWith(".md")) {
      continue;
    }
    for (const finding of scanTextForSecrets(extra.text, extra.path)) {
      errors.push(issue("hardcoded-password", RULE.SECRET_INJECTION, finding.path, finding.message));
    }
  }

  try {
    const users = parseYamlDoc(files.users, "authelia/users.yml");
    for (const finding of walkSecrets(users, "authelia/users.yml")) {
      errors.push(issue("hardcoded-password", RULE.SECRET_INJECTION, finding.path, finding.message));
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(issue("invalid-users", RULE.SECRET_INJECTION, "authelia/users.yml", message));
  }

  if (autheliaDoc) {
    for (const finding of walkSecrets(autheliaDoc, "authelia/configuration.yml")) {
      errors.push(issue("hardcoded-password", RULE.SECRET_INJECTION, finding.path, finding.message));
    }
  }
  if (composeDoc) {
    for (const finding of walkSecrets(composeDoc, "compose.yaml")) {
      errors.push(issue("hardcoded-password", RULE.SECRET_INJECTION, finding.path, finding.message));
    }
  }

  return {
    ok: errors.length === 0,
    bundle: display,
    errors,
  };
}

export function validateBundle(dir: string): ValidationResult {
  try {
    const bundle = loadBundle(dir);
    return validateLoadedBundle(bundle);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      bundle: dir,
      errors: [issue("bundle-load", RULE.FAIL_CLOSED_IDENTITY, dir, message)],
    };
  }
}
