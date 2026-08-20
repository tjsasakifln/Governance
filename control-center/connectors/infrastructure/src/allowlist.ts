import { CHECK_KINDS, type Allowlist, type AllowlistTarget, type CheckKind } from "./types.js";

const TARGET_ID = /^[a-z0-9][a-z0-9._-]{0,62}$/;
const COLLECTOR_ID = /^[a-z0-9][a-z0-9._-]{0,80}$/;
const SECRET_KEY =
  /^(.*(_|-))?((pass(word)?)|secret|token|api[_-]?key|authorization|private[_-]?key|ssh|credential|pem|identity)((_|-).*)?$/i;
const FORBIDDEN_VALUE = /BEGIN [A-Z ]*(PRIVATE KEY|CERTIFICATE)|ssh-rsa |ssh-ed25519 /i;

class AllowlistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AllowlistError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function rejectSecrets(node: unknown, path: string): void {
  if (Array.isArray(node)) {
    node.forEach((item, i) => rejectSecrets(item, `${path}[${i}]`));
    return;
  }
  if (!isRecord(node)) {
    if (typeof node === "string" && FORBIDDEN_VALUE.test(node)) {
      throw new AllowlistError(`${path} contains material that looks like a secret or key`);
    }
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (SECRET_KEY.test(key)) {
      throw new AllowlistError(`${path}.${key} is not allowed (secrets stay out of allowlist/config)`);
    }
    rejectSecrets(value, `${path}.${key}`);
  }
}

function asPositiveInt(value: unknown, path: string, fallback?: number): number {
  if (value === undefined && fallback !== undefined) {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new AllowlistError(`${path} must be a positive integer`);
  }
  return value;
}

function asPct(value: unknown, path: string, fallback: number): number {
  const n = value === undefined ? fallback : value;
  if (typeof n !== "number" || Number.isNaN(n) || n < 1 || n > 100) {
    throw new AllowlistError(`${path} must be a percentage between 1 and 100`);
  }
  return n;
}

function asCheck(value: unknown, path: string): CheckKind {
  if (typeof value !== "string" || !CHECK_KINDS.includes(value as CheckKind)) {
    throw new AllowlistError(`${path} must be one of: ${CHECK_KINDS.join(", ")}`);
  }
  return value as CheckKind;
}

function assertSafeUrl(raw: string, path: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AllowlistError(`${path} is not a valid URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AllowlistError(`${path} must be http(s)`);
  }
  if (url.username || url.password) {
    throw new AllowlistError(`${path} must not embed credentials`);
  }
  for (const key of url.searchParams.keys()) {
    if (SECRET_KEY.test(key)) {
      throw new AllowlistError(`${path} query parameter ${key} looks like a secret`);
    }
  }
  return url;
}

function parseTarget(raw: unknown, index: number): AllowlistTarget {
  const path = `targets[${index}]`;
  if (!isRecord(raw)) {
    throw new AllowlistError(`${path} must be an object`);
  }
  if (typeof raw.id !== "string" || !TARGET_ID.test(raw.id)) {
    throw new AllowlistError(`${path}.id must match ${TARGET_ID}`);
  }
  if (typeof raw.display_name !== "string" || raw.display_name.trim().length === 0) {
    throw new AllowlistError(`${path}.display_name is required`);
  }
  if (!Array.isArray(raw.checks) || raw.checks.length === 0) {
    throw new AllowlistError(`${path}.checks must be a non-empty array`);
  }
  const checks = raw.checks.map((check, i) => asCheck(check, `${path}.checks[${i}]`));
  const unique = new Set(checks);
  if (unique.size !== checks.length) {
    throw new AllowlistError(`${path}.checks must not repeat`);
  }

  const target: AllowlistTarget = {
    id: raw.id,
    display_name: raw.display_name.trim(),
    checks,
  };

  if (raw.host !== undefined) {
    if (typeof raw.host !== "string" || raw.host.trim().length === 0) {
      throw new AllowlistError(`${path}.host must be a hostname`);
    }
    if (raw.host.includes("@") || raw.host.includes("/")) {
      throw new AllowlistError(`${path}.host must not contain credentials or paths`);
    }
    Object.assign(target, { host: raw.host.trim() });
  }
  if (raw.port !== undefined) {
    const port = asPositiveInt(raw.port, `${path}.port`);
    if (port > 65535) {
      throw new AllowlistError(`${path}.port out of range`);
    }
    Object.assign(target, { port });
  }
  if (raw.url !== undefined) {
    if (typeof raw.url !== "string") {
      throw new AllowlistError(`${path}.url must be a string`);
    }
    assertSafeUrl(raw.url, `${path}.url`);
    Object.assign(target, { url: raw.url });
  }
  if (raw.expect_status !== undefined) {
    const status = asPositiveInt(raw.expect_status, `${path}.expect_status`);
    if (status < 100 || status > 599) {
      throw new AllowlistError(`${path}.expect_status must be an HTTP status`);
    }
    Object.assign(target, { expect_status: status });
  }
  if (raw.timeout_ms !== undefined) {
    Object.assign(target, { timeout_ms: asPositiveInt(raw.timeout_ms, `${path}.timeout_ms`) });
  }
  if (raw.agent_id !== undefined) {
    if (typeof raw.agent_id !== "string" || !TARGET_ID.test(raw.agent_id)) {
      throw new AllowlistError(`${path}.agent_id must match ${TARGET_ID}`);
    }
    Object.assign(target, { agent_id: raw.agent_id });
  }

  if (checks.includes("http") && !target.url) {
    throw new AllowlistError(`${path} http check requires url`);
  }
  if ((checks.includes("reachability") || checks.includes("tls")) && !target.host) {
    throw new AllowlistError(`${path} reachability/tls checks require host`);
  }
  return target;
}

export function parseAllowlist(input: unknown): Allowlist {
  if (!isRecord(input)) {
    throw new AllowlistError("allowlist must be an object");
  }
  rejectSecrets(input, "allowlist");
  if (input.version !== 1) {
    throw new AllowlistError("allowlist.version must be 1");
  }
  if (typeof input.collector_id !== "string" || !COLLECTOR_ID.test(input.collector_id)) {
    throw new AllowlistError("allowlist.collector_id is invalid");
  }
  if (typeof input.source !== "string" || input.source.trim().length === 0) {
    throw new AllowlistError("allowlist.source is required");
  }
  if (!Array.isArray(input.targets) || input.targets.length === 0) {
    throw new AllowlistError("allowlist.targets must be a non-empty array");
  }

  const thresholdsRaw = isRecord(input.thresholds) ? input.thresholds : {};
  const thresholds = {
    stale_after_seconds: asPositiveInt(
      thresholdsRaw.stale_after_seconds,
      "thresholds.stale_after_seconds",
      300,
    ),
    disk_warn_pct: asPct(thresholdsRaw.disk_warn_pct, "thresholds.disk_warn_pct", 80),
    disk_crit_pct: asPct(thresholdsRaw.disk_crit_pct, "thresholds.disk_crit_pct", 90),
    mem_warn_pct: asPct(thresholdsRaw.mem_warn_pct, "thresholds.mem_warn_pct", 90),
    backup_max_age_seconds: asPositiveInt(
      thresholdsRaw.backup_max_age_seconds,
      "thresholds.backup_max_age_seconds",
      86_400,
    ),
    tls_warn_days: asPositiveInt(thresholdsRaw.tls_warn_days, "thresholds.tls_warn_days", 21),
    tls_crit_days: asPositiveInt(thresholdsRaw.tls_crit_days, "thresholds.tls_crit_days", 7),
  };
  if (thresholds.disk_crit_pct < thresholds.disk_warn_pct) {
    throw new AllowlistError("thresholds.disk_crit_pct must be >= disk_warn_pct");
  }
  if (thresholds.tls_crit_days > thresholds.tls_warn_days) {
    throw new AllowlistError("thresholds.tls_crit_days must be <= tls_warn_days");
  }

  const targets = input.targets.map((target, i) => parseTarget(target, i));
  const ids = new Set<string>();
  for (const target of targets) {
    if (ids.has(target.id)) {
      throw new AllowlistError(`duplicate target id ${target.id}`);
    }
    ids.add(target.id);
  }

  return {
    version: 1,
    collector_id: input.collector_id,
    source: input.source.trim(),
    default_timeout_ms: asPositiveInt(input.default_timeout_ms, "default_timeout_ms", 5_000),
    thresholds,
    targets,
  };
}

export function timeoutFor(allowlist: Allowlist, target: AllowlistTarget): number {
  return target.timeout_ms ?? allowlist.default_timeout_ms;
}
