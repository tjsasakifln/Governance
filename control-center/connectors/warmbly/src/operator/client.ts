/**
 * POST-only Warmbly client for the three allowed operator controls.
 *
 * Deliberately not `WarmblyClient`: that one stays read-only. This one accepts
 * no caller-supplied method, refuses any path that is not on
 * `classifyOperatorRequest`, and never retries — a retried acknowledge would
 * double-acknowledge, and a retried kill-switch call is not worth the ambiguity.
 */

import { CircuitBreaker, CircuitOpenError, type CircuitState } from "../http/circuit-breaker.ts";
import {
  createStderrLogger,
  redactHeaders,
  redactSecrets,
  type Logger,
} from "../http/redaction.ts";
import { classifyOperatorRequest } from "./allowlist.ts";

export class OperatorPathNotAllowedError extends Error {
  readonly code = "OPERATOR_PATH_NOT_ALLOWED" as const;
  readonly method: string;
  readonly path: string;
  constructor(method: string, path: string, reason: string) {
    super(reason);
    this.name = "OperatorPathNotAllowedError";
    this.method = method;
    this.path = path;
  }
}

export class OperatorTimeoutError extends Error {
  readonly code = "OPERATOR_TIMEOUT" as const;
  /**
   * The request was already written when the clock ran out, so Warmbly may have
   * applied it. A timeout is never evidence that the action did not happen.
   */
  readonly requestWritten = true as const;
  constructor(message: string) {
    super(message);
    this.name = "OperatorTimeoutError";
  }
}

/**
 * Errors that prove the request never left this process: name resolution and
 * connection establishment failed, so no byte of the POST reached Warmbly.
 * Anything not on this list is treated as "may have been written" — the
 * conservative direction for a channel that can start outbound email.
 */
const PRE_FLIGHT_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EACCES",
  "ERR_INVALID_URL",
  "UND_ERR_CONNECT_TIMEOUT",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "CERT_HAS_EXPIRED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

/**
 * URL-level rejections. `fetch` throws these before opening a socket and they
 * carry no `code`, so they are matched on the message the runtime uses.
 */
const PRE_FLIGHT_MESSAGES = [
  "bad port",
  "unsupported protocol",
  "invalid url",
  "failed to parse url",
];

function errorMessagesOf(err: unknown, depth = 0): string[] {
  if (depth > 4 || typeof err !== "object" || err === null) {
    return [];
  }
  const messages: string[] = [];
  const message = (err as { message?: unknown }).message;
  if (typeof message === "string") {
    messages.push(message.toLowerCase());
  }
  const cause = (err as { cause?: unknown }).cause;
  if (cause !== undefined) {
    messages.push(...errorMessagesOf(cause, depth + 1));
  }
  const aggregate = (err as { errors?: unknown }).errors;
  if (Array.isArray(aggregate)) {
    for (const inner of aggregate) {
      messages.push(...errorMessagesOf(inner, depth + 1));
    }
  }
  return messages;
}

function errorCodesOf(err: unknown, depth = 0): string[] {
  if (depth > 4 || typeof err !== "object" || err === null) {
    return [];
  }
  const codes: string[] = [];
  const code = (err as { code?: unknown }).code;
  if (typeof code === "string") {
    codes.push(code);
  }
  const cause = (err as { cause?: unknown }).cause;
  if (cause !== undefined) {
    codes.push(...errorCodesOf(cause, depth + 1));
  }
  const aggregate = (err as { errors?: unknown }).errors;
  if (Array.isArray(aggregate)) {
    for (const inner of aggregate) {
      codes.push(...errorCodesOf(inner, depth + 1));
    }
  }
  return codes;
}

/**
 * True only when the failure happened before anything was written to the
 * socket. Used by the channel to decide between `refused` (nothing happened
 * upstream) and `unknown` (it may have).
 */
export function isPreFlightTransportFailure(err: unknown): boolean {
  if (err instanceof OperatorPathNotAllowedError) {
    return true;
  }
  if (err instanceof OperatorTimeoutError) {
    return false;
  }
  if (errorCodesOf(err).some((code) => PRE_FLIGHT_ERROR_CODES.has(code))) {
    return true;
  }
  return errorMessagesOf(err).some((message) =>
    PRE_FLIGHT_MESSAGES.some((marker) => message.includes(marker)),
  );
}

export interface OperatorPostResult {
  ok: boolean;
  status: number;
  path: string;
  method: "POST";
  api_version?: string;
  json: unknown;
}

export interface WarmblyOperatorClientOptions {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  logger?: Logger;
  /** Share the read client's breaker so a degraded upstream blocks writes too. */
  breaker?: CircuitBreaker;
  failureThreshold?: number;
  resetMs?: number;
  now?: () => number;
}

function joinUrl(base: string, path: string): string {
  const trimmed = base.replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${trimmed}${p}`;
}

export class WarmblyOperatorClient {
  readonly baseUrl: string;
  readonly breaker: CircuitBreaker;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly logger: Logger;
  hitCount = 0;

  constructor(opts: WarmblyOperatorClientOptions) {
    if (!opts.baseUrl) {
      throw new Error("WARMBLY_BASE_URL is required");
    }
    if (!opts.token) {
      throw new Error("WARMBLY_API_TOKEN is required");
    }
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.token = opts.token;
    this.timeoutMs = opts.timeoutMs ?? 8_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.logger = opts.logger ?? createStderrLogger();
    this.breaker =
      opts.breaker ??
      new CircuitBreaker({
        failureThreshold: opts.failureThreshold ?? 3,
        resetMs: opts.resetMs ?? 30_000,
        now: opts.now,
      });
  }

  circuitState(): CircuitState {
    return this.breaker.getState();
  }

  assertCircuitClosed(): void {
    this.breaker.assertClosed();
  }

  /**
   * Single POST. Throws `OperatorPathNotAllowedError` before any socket is
   * opened when the path is not one of the three allowed controls, and
   * `CircuitOpenError` when the breaker is open.
   */
  async post(path: string, body: unknown): Promise<OperatorPostResult> {
    const classified = classifyOperatorRequest("POST", path);
    if (!classified.allowed) {
      this.logger({
        level: "error",
        msg: "warmbly.operator.denied",
        method: "POST",
        path: classified.path,
        reason: classified.reason,
      });
      throw new OperatorPathNotAllowedError("POST", classified.path, classified.reason);
    }

    this.breaker.assertClosed();

    const url = joinUrl(this.baseUrl, classified.path);
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${this.token}`,
      "API-Version": "v1",
      "Content-Type": "application/json",
    };

    this.hitCount += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body ?? {}),
        signal: controller.signal,
        // Never follow a redirect. A 3xx would re-issue this POST — Bearer token,
        // original body and all — at a Location that was never classified by
        // `classifyOperatorRequest`, so `dispatch-now` could be executed while
        // the ledger recorded the allowlisted path.
        redirect: "manual",
      });
      let json: unknown = null;
      const text = await res.text();
      if (text.length > 0) {
        try {
          json = JSON.parse(text) as unknown;
        } catch {
          json = { raw: redactSecrets(text.slice(0, 200)) };
        }
      }
      if (res.status >= 300 && res.status <= 399) {
        this.logger({
          level: "error",
          msg: "warmbly.operator.redirect_refused",
          method: "POST",
          path: classified.path,
          status: res.status,
        });
      }
      // 4xx is an upstream refusal, not connector degradation: it must not trip
      // the breaker and lock the operator out of pausing.
      if (res.status >= 500 || res.status === 429) {
        this.breaker.recordFailure();
      } else {
        this.breaker.recordSuccess();
      }
      this.logger({
        level: res.ok ? "info" : "warn",
        msg: "warmbly.operator.response",
        method: "POST",
        path: classified.path,
        status: res.status,
      });
      return {
        ok: res.ok,
        status: res.status,
        path: classified.path,
        method: "POST",
        api_version: res.headers.get("API-Version") ?? undefined,
        json,
      };
    } catch (err) {
      this.breaker.recordFailure();
      if (isAbortError(err)) {
        const timeout = new OperatorTimeoutError(
          `Warmbly operator request timed out after ${this.timeoutMs}ms on ${classified.path}`,
        );
        this.logger({
          level: "error",
          msg: "warmbly.operator.timeout",
          method: "POST",
          path: classified.path,
        });
        throw timeout;
      }
      this.logger({
        level: "error",
        msg: "warmbly.operator.transport_error",
        method: "POST",
        path: classified.path,
        error: err instanceof Error ? err.name : "error",
      });
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  describeAuthForLogs(): Record<string, string> {
    return redactHeaders({ Authorization: `Bearer ${this.token}` });
  }
}

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof Error && err.name === "AbortError") ||
    (typeof err === "object" &&
      err !== null &&
      "name" in err &&
      (err as { name: string }).name === "AbortError")
  );
}

export { CircuitOpenError };
