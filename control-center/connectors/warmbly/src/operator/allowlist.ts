/**
 * Fail-closed write allowlist for the operator action channel.
 *
 * Separate from `src/http/allowlist.ts`, which stays read-only. Nothing here
 * widens the read client: the read client keeps refusing every write, and this
 * allowlist only ever accepts POST on three exact operational controls.
 */

import { pathnameOf } from "../http/allowlist.ts";
import type { DeniedRequest } from "../http/allowlist.ts";

export const OPERATOR_PAUSE_PATH = "/v1/confenge/dispatch/pause";
export const OPERATOR_RESUME_PATH = "/v1/confenge/dispatch/resume";
export const OPERATOR_ACK_PREFIX = "/v1/confenge/inbound/";
export const OPERATOR_ACK_SUFFIX = "/acknowledge";

const OPERATOR_POST_EXACT = new Set<string>([OPERATOR_PAUSE_PATH, OPERATOR_RESUME_PATH]);

const ACK_SEGMENT = /^[A-Za-z0-9_~%-]{1,160}$/;

export type AllowedOperatorRequest = {
  allowed: true;
  method: "POST";
  path: string;
};

function isAcknowledgePath(pathname: string): boolean {
  if (!pathname.startsWith(OPERATOR_ACK_PREFIX) || !pathname.endsWith(OPERATOR_ACK_SUFFIX)) {
    return false;
  }
  const parts = pathname.split("/").filter((p) => p.length > 0);
  // v1 / confenge / inbound / <leadId> / acknowledge
  if (parts.length !== 5) {
    return false;
  }
  if (parts[0] !== "v1" || parts[1] !== "confenge" || parts[2] !== "inbound") {
    return false;
  }
  if (parts[4] !== "acknowledge") {
    return false;
  }
  const segment = parts[3] ?? "";
  if (!ACK_SEGMENT.test(segment)) {
    return false;
  }
  // A percent-encoded separator must not smuggle another route in.
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return false;
  }
  return !decoded.includes("/") && !decoded.includes("\\") && decoded !== ".." && decoded !== ".";
}

export function classifyOperatorRequest(
  method: string,
  urlOrPath: string,
): AllowedOperatorRequest | DeniedRequest {
  const path = pathnameOf(urlOrPath);
  const m = method.toUpperCase();
  if (m !== "POST") {
    return {
      allowed: false,
      method: m,
      path,
      reason: `${m} is forbidden on the Warmbly operator channel (POST only)`,
    };
  }
  if (OPERATOR_POST_EXACT.has(path) || isAcknowledgePath(path)) {
    return { allowed: true, method: "POST", path };
  }
  return {
    allowed: false,
    method: m,
    path,
    reason: `path is not one of the three allowed Warmbly operator controls: ${path}`,
  };
}

export function isAllowedOperatorWrite(method: string, urlOrPath: string): boolean {
  return classifyOperatorRequest(method, urlOrPath).allowed;
}
