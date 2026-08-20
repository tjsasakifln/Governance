export const SECURITY_POLICY_VERSION = "control-center.security-policy.v1";

export const IDP_NAME = "authelia";
export const PROXY_NAME = "caddy";

export const FORWARD_AUTH_URI = "/api/authz/forward-auth";

export const FORWARD_AUTH_HEADERS = [
  "Remote-User",
  "Remote-Groups",
  "Remote-Name",
  "Remote-Email",
] as const;

export const PUBLIC_HEALTH_PATHS = ["/healthz", "/livez"] as const;

export const HEALTH_BODY_KEYS = ["status"] as const;
export const HEALTH_STATUS_OK = "ok" as const;

export const DATASTORE_NAMES = ["postgres", "redis", "nats"] as const;

export const DATASTORE_PUBLIC_PORTS: Readonly<Record<number, (typeof DATASTORE_NAMES)[number]>> = {
  5432: "postgres",
  6379: "redis",
  4222: "nats",
  6222: "nats",
  8222: "nats",
};

export const REQUIRED_SECURITY_HEADERS = [
  "Strict-Transport-Security",
  "X-Content-Type-Options",
  "X-Frame-Options",
  "Referrer-Policy",
  "Content-Security-Policy",
] as const;

export const COOKIE_POLICY = {
  secure: true,
  httpOnly: true,
  sameSite: "lax",
} as const;

export const CORS_POLICY = {
  mode: "deny-by-default",
  allowOrigins: [] as const,
  allowCredentials: false,
} as const;

export const CSRF_STRATEGY = "same-site-cookie-plus-cors-deny";

export const REQUIRED_GROUPS = ["operators"] as const;

export const DEFAULT_TRUSTED_HOPS = ["10.89.0.0/24", "127.0.0.1/32", "::1/128"] as const;

export const SECRET_INJECTION_METHODS = ["env", "file"] as const;

export const RULE = {
  FORWARD_AUTH: "C-FORWARD-AUTH",
  COPY_HEADERS: "C-COPY-HEADERS",
  TRUSTED_HOP: "C-TRUSTED-HOP",
  FAIL_CLOSED_IDENTITY: "C-FAIL-CLOSED-IDENTITY",
  IDP_MFA: "C-IDP-MFA",
  NO_SECRET_URL_GATE: "C-NO-SECRET-URL-GATE",
  REGULATION: "C-REGULATION",
  SESSION_TIMEOUT: "C-SESSION-TIMEOUT",
  INTERNAL_DATASTORES: "C-INTERNAL-DATASTORES",
  SECRET_INJECTION: "C-SECRET-INJECTION",
  MINIMAL_HEALTH: "C-MINIMAL-HEALTH",
  LOG_REDACTION: "C-LOG-REDACTION",
  SECURE_HEADERS: "C-SECURE-HEADERS",
  CORS_DENY: "C-CORS-DENY",
  COOKIE_POLICY: "C-COOKIE-POLICY",
  TLS: "C-TLS",
} as const;

export type RuleId = (typeof RULE)[keyof typeof RULE];

export const THREAT_IDS = [
  "T-SPOOF-HEADERS",
  "T-SECRET-URL",
  "T-BRUTE-FORCE",
  "T-DATASTORE-EXPOSURE",
  "T-SECRET-LEAK",
] as const;

export type ThreatId = (typeof THREAT_IDS)[number];

export const THREAT_CONTROLS: Readonly<Record<ThreatId, readonly RuleId[]>> = {
  "T-SPOOF-HEADERS": [RULE.TRUSTED_HOP, RULE.FAIL_CLOSED_IDENTITY, RULE.FORWARD_AUTH, RULE.COPY_HEADERS],
  "T-SECRET-URL": [RULE.IDP_MFA, RULE.NO_SECRET_URL_GATE, RULE.FORWARD_AUTH],
  "T-BRUTE-FORCE": [RULE.REGULATION, RULE.SESSION_TIMEOUT],
  "T-DATASTORE-EXPOSURE": [RULE.INTERNAL_DATASTORES],
  "T-SECRET-LEAK": [RULE.SECRET_INJECTION, RULE.MINIMAL_HEALTH, RULE.LOG_REDACTION],
};

export const INVALID_FIXTURE_NAMES = [
  "hardcoded-password",
  "secret-url-only",
  "public-postgres",
  "public-redis",
  "public-nats",
  "missing-forward-auth",
  "missing-mfa",
  "leaking-health",
] as const;

export type InvalidFixtureName = (typeof INVALID_FIXTURE_NAMES)[number];
