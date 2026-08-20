import { header } from "./http.js";
import { asRecord, parseJson } from "./json.js";

export type RateLimitDecision = {
  stop: boolean;
  rateLimited: boolean;
  backoffMs: number | null;
  remaining: number | null;
  resetEpochSeconds: number | null;
};

export function inspectRateLimit(
  status: number,
  headers: Record<string, string>,
  body: string,
  nowMs: number,
): RateLimitDecision {
  const remainingRaw = header(headers, "x-ratelimit-remaining");
  const resetRaw = header(headers, "x-ratelimit-reset");
  const retryAfterRaw = header(headers, "retry-after");
  const remaining = remainingRaw !== undefined ? Number.parseInt(remainingRaw, 10) : null;
  const resetEpochSeconds =
    resetRaw !== undefined ? Number.parseInt(resetRaw, 10) : null;
  const retryAfterSeconds =
    retryAfterRaw !== undefined ? Number.parseInt(retryAfterRaw, 10) : null;

  const remainingKnown = remaining !== null && Number.isFinite(remaining);
  const remainingZero = remainingKnown && remaining === 0;
  const statusRateLimited =
    status === 429 || (status === 403 && isRateLimitBody(body, headers));

  const rateLimited = statusRateLimited || remainingZero;
  if (!rateLimited) {
    return {
      stop: false,
      rateLimited: false,
      backoffMs: null,
      remaining: remainingKnown ? remaining : null,
      resetEpochSeconds:
        resetEpochSeconds !== null && Number.isFinite(resetEpochSeconds)
          ? resetEpochSeconds
          : null,
    };
  }

  let backoffMs: number | null = null;
  if (retryAfterSeconds !== null && Number.isFinite(retryAfterSeconds)) {
    backoffMs = Math.max(0, retryAfterSeconds * 1000);
  } else if (resetEpochSeconds !== null && Number.isFinite(resetEpochSeconds)) {
    backoffMs = Math.max(0, resetEpochSeconds * 1000 - nowMs);
  } else {
    backoffMs = 60_000;
  }

  return {
    stop: true,
    rateLimited: true,
    backoffMs,
    remaining: remainingKnown ? remaining : null,
    resetEpochSeconds:
      resetEpochSeconds !== null && Number.isFinite(resetEpochSeconds)
        ? resetEpochSeconds
        : null,
  };
}

function isRateLimitBody(body: string, headers: Record<string, string>): boolean {
  const retryAfter = header(headers, "retry-after");
  if (retryAfter !== undefined) {
    return true;
  }
  const remaining = header(headers, "x-ratelimit-remaining");
  if (remaining === "0") {
    return true;
  }
  try {
    const parsed = asRecord(parseJson(body));
    const message = parsed ? String(parsed.message ?? "") : body;
    return /rate limit/i.test(message) || /secondary rate/i.test(message);
  } catch {
    return /rate limit/i.test(body);
  }
}
