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
  constructor(message: string) {
    super(message);
    this.name = "OperatorTimeoutError";
  }
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
