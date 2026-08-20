import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AsaasMutationForbiddenError } from "./errors.js";
import type { HttpRequest, HttpResponse, HttpTransport } from "./types.js";

export type FixtureName =
  | "customers"
  | "payments"
  | "subscriptions"
  | "pix-transactions"
  | "balance"
  | "financial-transactions"
  | "webhooks";

export function defaultFixturesDir(): string {
  return fileURLToPath(new URL("../fixtures/", import.meta.url));
}

export function loadFixtureJson(name: FixtureName, fixturesDir = defaultFixturesDir()): unknown {
  const text = readFileSync(join(fixturesDir, `${name}.json`), "utf8");
  return JSON.parse(text) as unknown;
}

export function loadWebhookEvents(fixturesDir = defaultFixturesDir()): unknown[] {
  const raw = loadFixtureJson("webhooks", fixturesDir);
  return Array.isArray(raw) ? raw : [];
}

export interface FixtureTransportOptions {
  fixturesDir?: string;
  statusOverrides?: Partial<Record<string, number>>;
  bodyOverrides?: Partial<Record<string, unknown>>;
}

function pathnameOf(url: string): string {
  return new URL(url).pathname.replace(/\/+$/, "") || "/";
}

function jsonResponse(status: number, body: unknown): HttpResponse {
  return {
    status,
    headers: { "content-type": "application/json" },
    bodyText: body === undefined ? "" : JSON.stringify(body),
  };
}

/**
 * In-memory Asaas stand-in. Never opens a network socket. GET-only.
 */
export class FixtureTransport implements HttpTransport {
  constructor(private readonly options: FixtureTransportOptions = {}) {}

  async request(req: HttpRequest): Promise<HttpResponse> {
    if (req.method.toUpperCase() !== "GET") {
      throw new AsaasMutationForbiddenError(req.method, req.url);
    }
    if (req.body !== undefined && req.body !== "") {
      throw new AsaasMutationForbiddenError(req.method, req.url);
    }
    const path = pathnameOf(req.url);
    const dir = this.options.fixturesDir ?? defaultFixturesDir();
    const map: Record<string, FixtureName> = {
      "/v3/customers": "customers",
      "/v3/payments": "payments",
      "/v3/subscriptions": "subscriptions",
      "/v3/pix/transactions": "pix-transactions",
      "/v3/finance/balance": "balance",
      "/v3/financialTransactions": "financial-transactions",
    };
    const fixtureName = map[path];
    if (!fixtureName) {
      return jsonResponse(404, { errors: [{ code: "not_found", description: path }] });
    }
    const overrideStatus = this.options.statusOverrides?.[path];
    if (overrideStatus !== undefined && overrideStatus >= 400) {
      return jsonResponse(overrideStatus, {
        errors: [{ code: "forbidden", description: "fixture override" }],
      });
    }
    const body =
      this.options.bodyOverrides?.[path] ?? loadFixtureJson(fixtureName, dir);
    return jsonResponse(overrideStatus ?? 200, body);
  }
}

export function createFixtureTransport(
  options: FixtureTransportOptions = {},
): FixtureTransport {
  return new FixtureTransport(options);
}
