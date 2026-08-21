import { classifyRequest } from "./allowlist.ts";
import { CircuitBreaker, CircuitOpenError } from "./circuit-breaker.ts";
import {
  createStderrLogger,
  redactHeaders,
  redactSecrets,
  type Logger,
} from "./redaction.ts";

export class MethodNotAllowedError extends Error {
  readonly code = "METHOD_NOT_ALLOWED" as const;
  readonly method: string;
  readonly path: string;
  constructor(method: string, path: string, reason: string) {
    super(reason);
    this.name = "MethodNotAllowedError";
    this.method = method;
    this.path = path;
  }
}

export class TimeoutError extends Error {
  readonly code = "TIMEOUT" as const;
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

export class UpstreamError extends Error {
  readonly code = "UPSTREAM" as const;
  readonly status: number;
  constructor(status: number, path: string) {
    super(`Warmbly upstream ${status} on ${path}`);
    this.name = "UpstreamError";
    this.status = status;
  }
}

export type WarmblyClientOptions = {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
  maxRetries?: number;
  backoffMs?: number;
  failureThreshold?: number;
  resetMs?: number;
  fetchImpl?: typeof fetch;
  logger?: Logger;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

export type WarmblyRequest = {
  method: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
};

export type WarmblyResponse = {
  ok: boolean;
  status: number;
  path: string;
  method: string;
  api_version?: string;
  json: unknown;
  fromCache: false;
};

function joinUrl(base: string, path: string): string {
  const trimmed = base.replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${trimmed}${p}`;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class WarmblyClient {
  readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly backoffMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly logger: Logger;
  private readonly sleep: (ms: number) => Promise<void>;
  readonly breaker: CircuitBreaker;
  hitCount = 0;

  constructor(opts: WarmblyClientOptions) {
    if (!opts.baseUrl) {
      throw new Error("WARMBLY_BASE_URL is required");
    }
    if (!opts.token) {
      throw new Error("WARMBLY_API_TOKEN is required");
    }
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.token = opts.token;
    this.timeoutMs = opts.timeoutMs ?? 8_000;
    this.maxRetries = opts.maxRetries ?? 2;
    this.backoffMs = opts.backoffMs ?? 100;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.logger = opts.logger ?? createStderrLogger();
    this.sleep = opts.sleep ?? defaultSleep;
    this.breaker = new CircuitBreaker({
      failureThreshold: opts.failureThreshold ?? 3,
      resetMs: opts.resetMs ?? 30_000,
      now: opts.now,
    });
  }

  async request(req: WarmblyRequest): Promise<WarmblyResponse> {
    const classified = classifyRequest(req.method, req.path);
    if (!classified.allowed) {
      this.logger({
        level: "error",
        msg: "warmbly.request.denied",
        method: req.method,
        path: classified.path,
        reason: classified.reason,
      });
      throw new MethodNotAllowedError(req.method, classified.path, classified.reason);
    }

    this.breaker.assertClosed();

    const url = joinUrl(this.baseUrl, req.path);
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${this.token}`,
      "API-Version": "v1",
      ...req.headers,
    };
    if (classified.method === "POST") {
      headers["Content-Type"] = "application/json";
    }

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        this.breaker.assertClosed();
        const response = await this.once(classified.method, url, headers, req.body);
        if (response.status >= 500 || response.status === 429) {
          throw new UpstreamError(response.status, classified.path);
        }
        this.breaker.recordSuccess();
        this.logger({
          level: "info",
          msg: "warmbly.request.ok",
          method: classified.method,
          path: classified.path,
          status: response.status,
          attempt,
        });
        return response;
      } catch (err) {
        lastError = err;
        if (err instanceof CircuitOpenError || err instanceof MethodNotAllowedError) {
          throw err;
        }
        const retryable = isRetryable(err);
        this.logger({
          level: "warn",
          msg: "warmbly.request.fail",
          method: classified.method,
          path: classified.path,
          attempt,
          retryable,
          error: err instanceof Error ? err.name : "error",
        });
        if (!retryable || attempt === this.maxRetries) {
          this.breaker.recordFailure();
          throw err;
        }
        const delay = this.backoffMs * 2 ** attempt;
        await this.sleep(delay);
      }
    }
    this.breaker.recordFailure();
    throw lastError instanceof Error ? lastError : new Error("warmbly request failed");
  }

  private async once(
    method: "GET" | "HEAD" | "POST",
    url: string,
    headers: Record<string, string>,
    body: unknown,
  ): Promise<WarmblyResponse> {
    this.hitCount += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const init: RequestInit = {
        method,
        headers,
        signal: controller.signal,
      };
      if (method === "POST") {
        init.body = JSON.stringify(body ?? {});
      }
      const res = await this.fetchImpl(url, init);
      const apiVersion = res.headers.get("API-Version") ?? undefined;
      let json: unknown = null;
      if (method !== "HEAD") {
        const text = await res.text();
        if (text.length > 0) {
          try {
            json = JSON.parse(text) as unknown;
          } catch {
            json = { raw: redactSecrets(text.slice(0, 200)) };
          }
        }
      }
      return {
        ok: res.ok,
        status: res.status,
        path: pathnameFromUrl(url),
        method,
        api_version: apiVersion,
        json,
        fromCache: false,
      };
    } catch (err) {
      if (isAbortError(err)) {
        throw new TimeoutError(
          `Warmbly request timed out after ${this.timeoutMs}ms: ${redactSecrets(url)}`,
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  describeAuthForLogs(): Record<string, string> {
    return redactHeaders({ Authorization: `Bearer ${this.token}` });
  }
}

function pathnameFromUrl(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof Error && err.name === "AbortError") ||
    (typeof err === "object" && err !== null && "name" in err && (err as { name: string }).name === "AbortError")
  );
}

function isRetryable(err: unknown): boolean {
  if (err instanceof TimeoutError) {
    return false;
  }
  if (err instanceof CircuitOpenError) {
    return false;
  }
  if (err instanceof UpstreamError) {
    return err.status >= 500 || err.status === 429;
  }
  return true;
}

export { CircuitOpenError };
