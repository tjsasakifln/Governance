import {
  COOKIE_POLICY,
  CORS_POLICY,
  CSRF_STRATEGY,
  DATASTORE_NAMES,
  DEFAULT_TRUSTED_HOPS,
  FORWARD_AUTH_HEADERS,
  FORWARD_AUTH_URI,
  HEALTH_BODY_KEYS,
  IDP_NAME,
  PROXY_NAME,
  PUBLIC_HEALTH_PATHS,
  REQUIRED_GROUPS,
  SECRET_INJECTION_METHODS,
  SECURITY_POLICY_VERSION,
} from "./constants.js";
import { parseCidr } from "./hop.js";
import type { SecurityPolicy } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value;
}

function asBooleanTrue(value: unknown, path: string): true {
  if (value !== true) {
    throw new Error(`${path} must be true`);
  }
  return true;
}

function asBooleanFalse(value: unknown, path: string): false {
  if (value !== false) {
    throw new Error(`${path} must be false`);
  }
  return false;
}

function asStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${path} must be an array of strings`);
  }
  return value;
}

function asPositiveInt(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`${path} must be a positive integer`);
  }
  return value;
}

function requireIncludes(actual: readonly string[], required: readonly string[], path: string): void {
  for (const item of required) {
    if (!actual.includes(item)) {
      throw new Error(`${path} must include ${item}`);
    }
  }
}

export function parsePolicy(raw: unknown): SecurityPolicy {
  if (!isRecord(raw)) {
    throw new Error("policy.json must be an object");
  }
  const schemaVersion = asString(raw.schema_version, "schema_version");
  if (schemaVersion !== SECURITY_POLICY_VERSION) {
    throw new Error(`schema_version must be ${SECURITY_POLICY_VERSION}`);
  }
  if (raw.idp !== IDP_NAME) {
    throw new Error(`idp must be ${IDP_NAME}`);
  }
  if (raw.proxy !== PROXY_NAME) {
    throw new Error(`proxy must be ${PROXY_NAME}`);
  }
  if (!isRecord(raw.forward_auth)) {
    throw new Error("forward_auth must be an object");
  }
  const uri = asString(raw.forward_auth.uri, "forward_auth.uri");
  if (uri !== FORWARD_AUTH_URI) {
    throw new Error(`forward_auth.uri must be ${FORWARD_AUTH_URI}`);
  }
  const copyHeaders = asStringArray(raw.forward_auth.copy_headers, "forward_auth.copy_headers");
  requireIncludes(copyHeaders, FORWARD_AUTH_HEADERS, "forward_auth.copy_headers");

  if (!isRecord(raw.mfa)) {
    throw new Error("mfa must be an object");
  }
  asBooleanTrue(raw.mfa.totp, "mfa.totp");
  asBooleanTrue(raw.mfa.webauthn, "mfa.webauthn");

  if (!isRecord(raw.session)) {
    throw new Error("session must be an object");
  }
  const inactivity = asString(raw.session.inactivity, "session.inactivity");
  const expiration = asString(raw.session.expiration, "session.expiration");
  asBooleanFalse(raw.session.remember_me, "session.remember_me");
  if (!isRecord(raw.session.cookie)) {
    throw new Error("session.cookie must be an object");
  }
  asBooleanTrue(raw.session.cookie.secure, "session.cookie.secure");
  asBooleanTrue(raw.session.cookie.httpOnly, "session.cookie.httpOnly");
  const sameSite = asString(raw.session.cookie.sameSite, "session.cookie.sameSite");
  if (sameSite !== "lax" && sameSite !== "strict") {
    throw new Error("session.cookie.sameSite must be lax or strict");
  }

  if (!isRecord(raw.regulation)) {
    throw new Error("regulation must be an object");
  }
  const maxRetries = asPositiveInt(raw.regulation.max_retries, "regulation.max_retries");
  const findTime = asString(raw.regulation.find_time, "regulation.find_time");
  const banTime = asString(raw.regulation.ban_time, "regulation.ban_time");

  if (!isRecord(raw.cors)) {
    throw new Error("cors must be an object");
  }
  if (raw.cors.mode !== CORS_POLICY.mode) {
    throw new Error(`cors.mode must be ${CORS_POLICY.mode}`);
  }
  const allowOrigins = asStringArray(raw.cors.allow_origins, "cors.allow_origins");
  if (allowOrigins.length !== 0) {
    throw new Error("cors.allow_origins must be empty (deny-by-default)");
  }
  asBooleanFalse(raw.cors.allow_credentials, "cors.allow_credentials");

  const csrfStrategy = asString(raw.csrf_strategy, "csrf_strategy");
  if (csrfStrategy !== CSRF_STRATEGY) {
    throw new Error(`csrf_strategy must be ${CSRF_STRATEGY}`);
  }

  const trustedHops = asStringArray(raw.trusted_hops, "trusted_hops");
  if (trustedHops.length === 0) {
    throw new Error("trusted_hops must not be empty");
  }
  for (const hop of trustedHops) {
    parseCidr(hop);
  }

  const requiredGroups = asStringArray(raw.required_groups, "required_groups");
  requireIncludes(requiredGroups, REQUIRED_GROUPS, "required_groups");

  const publicPaths = asStringArray(
    raw.public_unauthenticated_paths,
    "public_unauthenticated_paths",
  );
  for (const item of publicPaths) {
    if (!(PUBLIC_HEALTH_PATHS as readonly string[]).includes(item)) {
      throw new Error(`public_unauthenticated_paths may only contain health paths; got ${item}`);
    }
  }
  requireIncludes(publicPaths, PUBLIC_HEALTH_PATHS, "public_unauthenticated_paths");

  const healthBodyKeys = asStringArray(raw.health_body_keys, "health_body_keys");
  requireIncludes(healthBodyKeys, HEALTH_BODY_KEYS, "health_body_keys");
  if (healthBodyKeys.length !== HEALTH_BODY_KEYS.length) {
    throw new Error("health_body_keys must be exactly the allowlisted keys");
  }

  const datastores = asStringArray(raw.datastores_internal_only, "datastores_internal_only");
  requireIncludes(datastores, DATASTORE_NAMES, "datastores_internal_only");

  const secretInjection = asStringArray(raw.secret_injection, "secret_injection");
  requireIncludes(secretInjection, SECRET_INJECTION_METHODS, "secret_injection");

  if (raw.tls_termination !== "proxy") {
    throw new Error("tls_termination must be proxy");
  }

  return {
    schemaVersion,
    idp: "authelia",
    proxy: "caddy",
    forwardAuth: { uri, copyHeaders },
    mfa: { totp: true, webauthn: true },
    session: {
      inactivity,
      expiration,
      rememberMe: false,
      cookie: {
        secure: COOKIE_POLICY.secure,
        httpOnly: COOKIE_POLICY.httpOnly,
        sameSite,
      },
    },
    regulation: { maxRetries, findTime, banTime },
    cors: {
      mode: "deny-by-default",
      allowOrigins: [],
      allowCredentials: false,
    },
    csrfStrategy,
    trustedHops,
    requiredGroups,
    publicUnauthenticatedPaths: publicPaths,
    healthBodyKeys,
    datastoresInternalOnly: datastores,
    secretInjection,
    tlsTermination: "proxy",
  };
}

export function defaultPolicyDocument(): Record<string, unknown> {
  return {
    schema_version: SECURITY_POLICY_VERSION,
    idp: IDP_NAME,
    proxy: PROXY_NAME,
    forward_auth: {
      uri: FORWARD_AUTH_URI,
      copy_headers: [...FORWARD_AUTH_HEADERS],
    },
    mfa: { totp: true, webauthn: true },
    session: {
      inactivity: "30 minutes",
      expiration: "8 hours",
      remember_me: false,
      cookie: {
        secure: COOKIE_POLICY.secure,
        httpOnly: COOKIE_POLICY.httpOnly,
        sameSite: COOKIE_POLICY.sameSite,
      },
    },
    regulation: {
      max_retries: 3,
      find_time: "2 minutes",
      ban_time: "15 minutes",
    },
    cors: {
      mode: CORS_POLICY.mode,
      allow_origins: [...CORS_POLICY.allowOrigins],
      allow_credentials: CORS_POLICY.allowCredentials,
    },
    csrf_strategy: CSRF_STRATEGY,
    trusted_hops: [...DEFAULT_TRUSTED_HOPS],
    required_groups: [...REQUIRED_GROUPS],
    public_unauthenticated_paths: [...PUBLIC_HEALTH_PATHS],
    health_body_keys: [...HEALTH_BODY_KEYS],
    datastores_internal_only: [...DATASTORE_NAMES],
    secret_injection: [...SECRET_INJECTION_METHODS],
    tls_termination: "proxy",
  };
}
