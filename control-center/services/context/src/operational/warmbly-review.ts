import { readFileSync } from "node:fs";

import { assertFounder } from "../actor.ts";
import { invalid, ServiceError } from "../errors.ts";
import type { ActorRef } from "../types.ts";

const ID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;

export interface WarmblyReviewPort {
  list(actor: ActorRef, query: URLSearchParams): Promise<unknown>;
  get(actor: ActorRef, id: string): Promise<unknown>;
  decide(actor: ActorRef, id: string, body: unknown, idempotencyKey: string): Promise<unknown>;
  approveBatch(actor: ActorRef, body: unknown, idempotencyKey: string): Promise<unknown>;
}

function boundedInt(value: string | null, fallback: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isInteger(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, max);
}

export function createWarmblyReviewPortFromEnv(
  env: NodeJS.ProcessEnv,
  founderActorId: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): WarmblyReviewPort | undefined {
  const baseUrl = (env.WARMBLY_BASE_URL ?? env.CC_WARMBLY_BASE_URL ?? "")
    .trim()
    .replace(/\/+$/, "");
  let token = (env.WARMBLY_API_TOKEN ?? env.CC_WARMBLY_OPERATOR_TOKEN ?? "").trim();
  const credentialFile = (env.CC_WARMBLY_OPERATOR_TOKEN_FILE ?? "").trim();
  if (!token && credentialFile) {
    try {
      token = readFileSync(credentialFile, "utf8").trim();
    } catch {
      return undefined;
    }
  }
  if (!baseUrl || !token) return undefined;

  async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        signal: init.signal ?? AbortSignal.timeout(10_000),
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
          "api-version": "v1",
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...(init.headers ?? {}),
        },
      });
    } catch {
      throw new ServiceError("warmbly_review_failed", "Warmbly review is unavailable", 502);
    }
    const text = await response.text();
    let body: unknown = {};
    try {
      body = text ? (JSON.parse(text) as unknown) : {};
    } catch {
      throw invalid(`Warmbly returned invalid JSON (${response.status})`);
    }
    if (!response.ok) {
      const rec = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
      const status = response.status >= 400 && response.status <= 599 ? response.status : 502;
      const code = status === 409 ? "conflict" : "warmbly_review_failed";
      throw new ServiceError(code, String(rec.message ?? rec.error ?? `Warmbly review failed (${status})`), status);
    }
    return body;
  }

  function assertId(id: string): void {
    if (!ID.test(id)) throw invalid("review draft id must be a UUID");
  }

  return {
    async list(actor, query) {
      assertFounder(actor, founderActorId);
      const limit = boundedInt(query.get("limit"), 100, 200);
      const offset = boundedInt(query.get("offset"), 0, 100_000);
      return request(`/v1/confenge/review/drafts?limit=${limit}&offset=${offset}`);
    },
    async get(actor, id) {
      assertFounder(actor, founderActorId);
      assertId(id);
      return request(`/v1/confenge/review/drafts/${id}`);
    },
    async decide(actor, id, body, idempotencyKey) {
      assertFounder(actor, founderActorId);
      assertId(id);
      if (!idempotencyKey) throw invalid("Idempotency-Key is required");
      return request(`/v1/confenge/review/drafts/${id}/decision`, {
        method: "POST",
        headers: { "idempotency-key": idempotencyKey },
        body: JSON.stringify(body),
      });
    },
    async approveBatch(actor, body, idempotencyKey) {
      assertFounder(actor, founderActorId);
      if (!idempotencyKey) throw invalid("Idempotency-Key is required");
      return request("/v1/confenge/review/batches", {
        method: "POST",
        headers: { "idempotency-key": idempotencyKey },
        body: JSON.stringify(body),
      });
    },
  };
}
