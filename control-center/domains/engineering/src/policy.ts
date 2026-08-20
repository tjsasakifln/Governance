import {
  DEFAULT_FRESHNESS_WINDOW_SECONDS,
  DEFAULT_PR_STALE_AFTER_SECONDS,
} from "./constants.js";

export type EngineeringPolicy = {
  prStaleAfterSeconds: number;
  freshnessWindowSeconds: number;
};

export const DEFAULT_POLICY: EngineeringPolicy = {
  prStaleAfterSeconds: DEFAULT_PR_STALE_AFTER_SECONDS,
  freshnessWindowSeconds: DEFAULT_FRESHNESS_WINDOW_SECONDS,
};

export function resolvePolicy(overrides?: Partial<EngineeringPolicy>): EngineeringPolicy {
  return {
    prStaleAfterSeconds:
      overrides?.prStaleAfterSeconds ?? DEFAULT_POLICY.prStaleAfterSeconds,
    freshnessWindowSeconds:
      overrides?.freshnessWindowSeconds ?? DEFAULT_POLICY.freshnessWindowSeconds,
  };
}

function readPositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

/**
 * Env vars carry thresholds only. No tokens, PATs, or identity.
 * CC_ENGINEERING_NOW is a replay clock (UTC Z), not a secret.
 */
export function policyFromEnv(
  env: NodeJS.Dict<string> = process.env,
): EngineeringPolicy {
  return {
    prStaleAfterSeconds: readPositiveInt(
      env.CC_ENGINEERING_PR_STALE_AFTER_SECONDS,
      DEFAULT_POLICY.prStaleAfterSeconds,
    ),
    freshnessWindowSeconds: readPositiveInt(
      env.CC_ENGINEERING_FRESHNESS_WINDOW_SECONDS,
      DEFAULT_POLICY.freshnessWindowSeconds,
    ),
  };
}

export function nowFromEnv(env: NodeJS.Dict<string> = process.env): Date | undefined {
  const raw = env.CC_ENGINEERING_NOW;
  if (!raw || raw.trim() === "") {
    return undefined;
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return date;
}
