import { header, joinUrl } from "./http.js";
import { parseJson } from "./json.js";
import { inspectRateLimit, type RateLimitDecision } from "./rate-limit.js";
import { parseRepoFullName } from "./provenance.js";
import type {
  CollectionErrorCode,
  EtagStore,
  HttpRequest,
  HttpTransport,
  StructuredLogger,
} from "./types.js";

export type GithubGetOk = {
  kind: "ok";
  status: 200 | 304;
  freshness_status: "fresh" | "not_modified";
  data: unknown;
  url: string;
  headers: Record<string, string>;
  rateLimit: RateLimitDecision;
};

export type GithubGetErr = {
  kind: "error";
  status: number;
  url: string;
  code: CollectionErrorCode;
  message: string;
  rateLimit: RateLimitDecision;
};

export type GithubGetResult = GithubGetOk | GithubGetErr;

export type GithubReadClientOptions = {
  apiBase: string;
  token: string;
  transport: HttpTransport;
  etagStore: EtagStore;
  logger: StructuredLogger;
  now: () => Date;
  allowlist: readonly string[];
  userAgent?: string;
};

const GITHUB_ACCEPT = "application/vnd.github+json";
const GITHUB_API_VERSION = "2022-11-28";

export class GithubReadClient {
  private stopped = false;
  private lastBackoffMs: number | null = null;
  private readonly allowlist: Set<string>;

  constructor(private readonly options: GithubReadClientOptions) {
    this.allowlist = new Set(
      options.allowlist.map((repo) => repo.toLowerCase()),
    );
  }

  isStopped(): boolean {
    return this.stopped;
  }

  lastBackoffMsOrNull(): number | null {
    return this.lastBackoffMs;
  }

  async get(
    path: string,
    query?: Record<string, string>,
  ): Promise<GithubGetResult> {
    this.assertPathAllowlisted(path);

    if (this.stopped) {
      return {
        kind: "error",
        status: 0,
        url: joinUrl(this.options.apiBase, path, query),
        code: "rate_limit",
        message: "Request skipped because the collector already hit a GitHub rate limit.",
        rateLimit: {
          stop: true,
          rateLimited: true,
          backoffMs: this.lastBackoffMs,
          remaining: 0,
          resetEpochSeconds: null,
        },
      };
    }

    const url = joinUrl(this.options.apiBase, path, query);
    const headers: Record<string, string> = {
      accept: GITHUB_ACCEPT,
      authorization: `Bearer ${this.options.token}`,
      "x-github-api-version": GITHUB_API_VERSION,
      "user-agent": this.options.userAgent ?? "confenge-control-center-github-collector",
    };
    const cached = this.options.etagStore.get(url);
    if (cached?.etag) {
      headers["if-none-match"] = cached.etag;
    }

    const request: HttpRequest = { method: "GET", url, headers };
    this.options.logger("github_get", {
      method: "GET",
      url,
      has_if_none_match: Boolean(cached?.etag),
    });

    const response = await this.options.transport(request);
    const rateLimit = inspectRateLimit(
      response.status,
      response.headers,
      response.body,
      this.options.now().getTime(),
    );

    if (rateLimit.stop) {
      this.stopped = true;
      this.lastBackoffMs = rateLimit.backoffMs;
      this.options.logger("github_rate_limit_stop", {
        url,
        status: response.status,
        remaining: rateLimit.remaining,
        backoff_ms: rateLimit.backoffMs,
      });
    }

    if (response.status === 304) {
      if (!cached) {
        return {
          kind: "error",
          status: 304,
          url,
          code: "not_modified_without_cache",
          message: "GitHub returned 304 Not Modified but no prior body was stored.",
          rateLimit,
        };
      }
      this.options.logger("github_not_modified", { url, etag: cached.etag });
      return {
        kind: "ok",
        status: 304,
        freshness_status: "not_modified",
        data: parseJson(cached.body),
        url,
        headers: response.headers,
        rateLimit,
      };
    }

    if (response.status >= 200 && response.status < 300) {
      const etag = header(response.headers, "etag");
      if (etag) {
        this.options.etagStore.set(url, {
          etag,
          body: response.body,
          status: response.status,
        });
      }
      let data: unknown;
      try {
        data = response.body.length === 0 ? null : parseJson(response.body);
      } catch {
        return {
          kind: "error",
          status: response.status,
          url,
          code: "parse",
          message: "GitHub response body was not valid JSON.",
          rateLimit,
        };
      }
      return {
        kind: "ok",
        status: 200,
        freshness_status: "fresh",
        data,
        url,
        headers: response.headers,
        rateLimit,
      };
    }

    return {
      kind: "error",
      status: response.status,
      url,
      code: statusToCode(response.status, rateLimit.rateLimited),
      message: errorMessageFor(response.status, rateLimit.rateLimited),
      rateLimit,
    };
  }

  private assertPathAllowlisted(path: string): void {
    const match = /^\/repos\/([^/]+)\/([^/]+)(?:\/|$)/.exec(path);
    if (!match) {
      throw new Error(`GitHub client refused non-repo path: ${path}`);
    }
    const owner = match[1];
    const name = match[2];
    if (!owner || !name) {
      throw new Error(`GitHub client refused malformed repo path: ${path}`);
    }
    const parsed = parseRepoFullName(`${owner}/${name}`);
    if (!parsed || !this.allowlist.has(parsed.full_name.toLowerCase())) {
      throw new Error(`GitHub client refused non-allowlisted repo path: ${path}`);
    }
  }
}

export function encodeCompareRef(ref: string): string {
  return encodeURIComponent(ref);
}

export function comparePath(owner: string, repo: string, base: string, head: string): string {
  return `/repos/${owner}/${repo}/compare/${encodeCompareRef(base)}...${encodeCompareRef(head)}`;
}

function statusToCode(status: number, rateLimited: boolean): CollectionErrorCode {
  if (rateLimited) {
    return "rate_limit";
  }
  if (status === 401) return "http_401";
  if (status === 403) return "http_403";
  if (status === 404) return "http_404";
  if (status === 429) return "http_429";
  if (status >= 500) return "http_5xx";
  return "http_error";
}

function errorMessageFor(status: number, rateLimited: boolean): string {
  if (rateLimited) {
    return `GitHub rate limit reached (HTTP ${status}). Collector stopped further requests.`;
  }
  if (status === 401) {
    return "GitHub authentication failed.";
  }
  if (status === 403) {
    return "GitHub forbidden this resource.";
  }
  if (status === 404) {
    return "GitHub resource was not found.";
  }
  if (status >= 500) {
    return `GitHub server error (HTTP ${status}).`;
  }
  return `GitHub request failed (HTTP ${status}).`;
}
