import { assertGetAllowed, isMutationMethod } from "./allowlist.js";
import {
  AsaasHttpError,
  AsaasMutationForbiddenError,
  AsaasSecretInUrlError,
} from "./errors.js";
import type { Logger } from "./log.js";
import type {
  AsaasConfig,
  HttpRequest,
  HttpResponse,
  HttpTransport,
  QueryValue,
} from "./types.js";

export class RecordingTransport implements HttpTransport {
  readonly log: Array<{ method: string; url: string; body: string | null }> = [];

  constructor(private readonly inner: HttpTransport) {}

  async request(req: HttpRequest): Promise<HttpResponse> {
    this.log.push({
      method: req.method,
      url: req.url,
      body: req.body === undefined ? null : req.body,
    });
    return this.inner.request(req);
  }
}

export class DefaultFetchTransport implements HttpTransport {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async request(req: HttpRequest): Promise<HttpResponse> {
    if (req.method.toUpperCase() !== "GET" || isMutationMethod(req.method)) {
      throw new AsaasMutationForbiddenError(req.method, req.url);
    }
    if (req.body !== undefined && req.body !== "") {
      throw new AsaasMutationForbiddenError(req.method, req.url);
    }
    assertNoSecretInUrl(req.url);
    const res = await this.fetchImpl(req.url, {
      method: "GET",
      headers: req.headers,
      redirect: "error",
    });
    const bodyText = await res.text();
    const headers: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    return { status: res.status, headers, bodyText };
  }
}

export function assertNoSecretInUrl(url: string): void {
  if (/access_token|api[_-]?key|authorization=/i.test(url) || /\$aact_/i.test(url)) {
    throw new AsaasSecretInUrlError();
  }
}

function encodeQuery(query: Record<string, QueryValue> | undefined): string {
  if (!query) {
    return "";
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) {
      continue;
    }
    params.set(key, String(value));
  }
  const encoded = params.toString();
  return encoded === "" ? "" : `?${encoded}`;
}

export class GetOnlyAsaasClient {
  constructor(
    private readonly config: AsaasConfig,
    private readonly transport: HttpTransport,
    private readonly logger?: Logger,
  ) {}

  async request(
    method: string,
    path: string,
    options?: { query?: Record<string, QueryValue>; body?: string },
  ): Promise<HttpResponse> {
    const upper = method.toUpperCase();
    assertGetAllowed(upper, path);
    if (options?.body !== undefined && options.body !== "") {
      throw new AsaasMutationForbiddenError(upper, path);
    }
    const url = `${this.config.baseUrl}${path.startsWith("/") ? path : `/${path}`}${encodeQuery(options?.query)}`;
    assertNoSecretInUrl(url);
    const headers: Record<string, string> = {
      access_token: this.config.apiKey,
      Accept: "application/json",
      "User-Agent": this.config.userAgent,
    };
    this.logger?.info("asaas.http.get", {
      path,
      environment: this.config.environment,
      host: this.config.baseUrl,
    });
    return this.transport.request({
      method: "GET",
      url,
      headers,
      body: undefined,
    });
  }

  post(path: string): never {
    throw new AsaasMutationForbiddenError("POST", path);
  }

  put(path: string): never {
    throw new AsaasMutationForbiddenError("PUT", path);
  }

  patch(path: string): never {
    throw new AsaasMutationForbiddenError("PATCH", path);
  }

  delete(path: string): never {
    throw new AsaasMutationForbiddenError("DELETE", path);
  }

  async getJson(
    path: string,
    query?: Record<string, QueryValue>,
  ): Promise<unknown> {
    const res = await this.request("GET", path, { query });
    if (res.status >= 400) {
      throw new AsaasHttpError(res.status, path, summarizeErrorBody(res.bodyText));
    }
    if (res.bodyText.trim() === "") {
      return null;
    }
    try {
      return JSON.parse(res.bodyText) as unknown;
    } catch {
      throw new AsaasHttpError(res.status, path, "response is not JSON");
    }
  }
}

function summarizeErrorBody(bodyText: string): string | undefined {
  const trimmed = bodyText.trim();
  if (trimmed === "") {
    return undefined;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object" && "errors" in parsed) {
      return "asaas_error_object";
    }
  } catch {
    return "non_json_error_body";
  }
  return "error_body";
}
