import { readFileSync } from "node:fs";

import { invalid, ServiceError } from "../errors.ts";
import type { ActorRef } from "../types.ts";

const ID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
const REVIEW_DECISIONS = ["SAVE_ADJUSTMENT", "APPROVE", "REJECT"] as const;
type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

interface ReviewDecisionInput {
  action: ReviewDecision;
  expectedContentHash: string;
}

interface ObservedTouchpoint {
  id: string;
  contentHash: string;
  approvedContentHash?: string;
  state: string;
  dueAt?: string;
  approvedBy?: string;
  approvedAt?: string;
  updatedAt?: string;
}

export interface ReviewDecisionReceipt {
  schema_version: "control-center.review-decision-receipt.v1";
  outcome: "confirmed" | "not_confirmed";
  action: ReviewDecision;
  touchpoint_id: string;
  expected_content_hash: string;
  correlation_id: string;
  observed_at: string;
  message: string;
  readback: { status: "confirmed" | "not_confirmed" | "unavailable"; detail: string };
  receipt_id?: string;
  content_hash?: string;
  approved_content_hash?: string;
  state?: string;
  due_at?: string;
  scheduled_for?: string;
  approved_by?: string;
  approved_at?: string;
}

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

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function instant(value: unknown): string | undefined {
  const text = nonEmptyString(value);
  return text !== undefined && !Number.isNaN(Date.parse(text)) ? text : undefined;
}

function decisionInput(body: unknown): ReviewDecisionInput {
  const input = record(body);
  const action = nonEmptyString(input?.action);
  const expectedContentHash = nonEmptyString(input?.expected_content_hash);
  if (!(REVIEW_DECISIONS as readonly string[]).includes(action ?? "")) {
    throw invalid("action must be SAVE_ADJUSTMENT, APPROVE or REJECT");
  }
  if (!expectedContentHash) throw invalid("expected_content_hash is required");
  if (action !== "SAVE_ADJUSTMENT" && (input?.subject !== undefined || input?.body_text !== undefined)) {
    throw invalid("save the adjustment before APPROVE or REJECT");
  }
  return { action: action as ReviewDecision, expectedContentHash };
}

function touchpointFrom(payload: unknown, decisionResponse: boolean): ObservedTouchpoint | undefined {
  const root = record(payload);
  const data = record(root?.data) ?? root;
  const row = decisionResponse ? record(data?.touchpoint) : (record(data?.touchpoint) ?? data);
  const id = nonEmptyString(row?.id);
  const contentHash = nonEmptyString(row?.content_hash);
  const state = nonEmptyString(row?.state);
  if (!id || !contentHash || !state) return undefined;
  return {
    id,
    contentHash,
    state,
    ...(nonEmptyString(row?.approved_content_hash) !== undefined
      ? { approvedContentHash: nonEmptyString(row?.approved_content_hash)! }
      : {}),
    ...(instant(row?.due_at) !== undefined ? { dueAt: instant(row?.due_at)! } : {}),
    ...(nonEmptyString(row?.approved_by) !== undefined ? { approvedBy: nonEmptyString(row?.approved_by)! } : {}),
    ...(instant(row?.approved_at) !== undefined ? { approvedAt: instant(row?.approved_at)! } : {}),
    ...(instant(row?.updated_at) !== undefined ? { updatedAt: instant(row?.updated_at)! } : {}),
  };
}

function scheduledForFrom(payload: unknown): string | undefined {
  const root = record(payload);
  const data = record(root?.data) ?? root;
  return instant(data?.scheduled_for);
}

function consistencyFailure(
  input: ReviewDecisionInput,
  id: string,
  write: ObservedTouchpoint | undefined,
  readback: ObservedTouchpoint | undefined,
  scheduledFor: string | undefined,
): string | undefined {
  if (!write) return "a resposta da escrita não contém um touchpoint válido";
  if (!readback) return "o readback não contém um touchpoint válido";
  if (write.id !== id || readback.id !== id) return "o ID observado diverge do rascunho decidido";
  if (write.id !== readback.id) return "write e readback apontam para touchpoints diferentes";
  if (write.contentHash !== readback.contentHash) return "o content_hash mudou entre write e readback";
  if (write.state !== readback.state) return "o estado mudou entre write e readback";
  if (!write.updatedAt || !readback.updatedAt || write.updatedAt !== readback.updatedAt) {
    return "write e readback não provam a mesma versão atualizada";
  }

  if (input.action === "APPROVE") {
    if (write.contentHash !== input.expectedContentHash || readback.contentHash !== input.expectedContentHash) {
      return "o content_hash aprovado diverge do hash exato revisado";
    }
    if (
      write.approvedContentHash !== input.expectedContentHash ||
      readback.approvedContentHash !== input.expectedContentHash
    ) {
      return "approved_content_hash não confirma o hash exato revisado";
    }
    if (readback.state !== "QUEUED" && readback.state !== "SENT") {
      return "APPROVE não foi observado em QUEUED ou SENT";
    }
    if (!write.approvedBy || !readback.approvedBy || write.approvedBy !== readback.approvedBy) {
      return "o operador que aprovou não foi confirmado";
    }
    if (!write.approvedAt || !readback.approvedAt || write.approvedAt !== readback.approvedAt) {
      return "o instante da aprovação não foi confirmado";
    }
    if (readback.state === "QUEUED") {
      if (!write.dueAt || !readback.dueAt || write.dueAt !== readback.dueAt) {
        return "QUEUED sem due_at estável entre write e readback";
      }
      if (!scheduledFor || scheduledFor !== readback.dueAt) {
        return "scheduled_for não confirma o due_at observado";
      }
    }
    return undefined;
  }

  if (input.action === "REJECT") {
    if (write.contentHash !== input.expectedContentHash) return "REJECT não preservou o hash revisado";
    if (readback.state !== "REJECTED_REWRITE_PENDING") {
      return "REJECT não foi observado em REJECTED_REWRITE_PENDING";
    }
    if (write.approvedContentHash || readback.approvedContentHash) {
      return "REJECT manteve um approved_content_hash inesperado";
    }
    return undefined;
  }

  if (readback.state !== "NEEDS_REVIEW" && readback.state !== "DRAFTED") {
    return "SAVE_ADJUSTMENT não permaneceu em revisão";
  }
  if (write.approvedContentHash || readback.approvedContentHash) {
    return "SAVE_ADJUSTMENT manteve um approved_content_hash inesperado";
  }
  return undefined;
}

function receipt(
  input: ReviewDecisionInput,
  id: string,
  idempotencyKey: string,
  outcome: ReviewDecisionReceipt["outcome"],
  readbackStatus: ReviewDecisionReceipt["readback"]["status"],
  detail: string,
  observed: ObservedTouchpoint | undefined,
  scheduledFor: string | undefined,
): ReviewDecisionReceipt {
  const observedAt = new Date().toISOString();
  const confirmed = outcome === "confirmed";
  const message = confirmed
    ? input.action === "APPROVE"
      ? `Aprovação confirmada no servidor em ${observed?.state}${observed?.dueAt ? ` para ${observed.dueAt}` : ""}.`
      : input.action === "REJECT"
        ? "Rejeição confirmada no servidor e encaminhada para reescrita."
        : "Ajuste confirmado no servidor; a aprovação continua pendente."
    : `Resultado não confirmado. Não repita ainda: ${detail}.`;
  return {
    schema_version: "control-center.review-decision-receipt.v1",
    outcome,
    action: input.action,
    touchpoint_id: id,
    expected_content_hash: input.expectedContentHash,
    correlation_id: idempotencyKey,
    observed_at: observedAt,
    message,
    readback: { status: readbackStatus, detail },
    ...(confirmed && observed?.updatedAt
      ? { receipt_id: `review:${observed.id}:${observed.updatedAt}` }
      : {}),
    ...(observed?.contentHash ? { content_hash: observed.contentHash } : {}),
    ...(observed?.approvedContentHash ? { approved_content_hash: observed.approvedContentHash } : {}),
    ...(observed?.state ? { state: observed.state } : {}),
    ...(observed?.dueAt ? { due_at: observed.dueAt } : {}),
    ...(scheduledFor ? { scheduled_for: scheduledFor } : {}),
    ...(observed?.approvedBy ? { approved_by: observed.approvedBy } : {}),
    ...(observed?.approvedAt ? { approved_at: observed.approvedAt } : {}),
  };
}

export function createWarmblyReviewPortFromEnv(
  env: NodeJS.ProcessEnv,
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

  async function requestResult(
    path: string,
    init: RequestInit = {},
  ): Promise<{ body: unknown; validJson: boolean; status: number }> {
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
    let body: unknown;
    let validJson = false;
    try {
      if (text.trim() !== "") {
        body = JSON.parse(text) as unknown;
        validJson = true;
      }
    } catch {
      // A successful write with a broken body is still ambiguous. The decision
      // path performs readback and returns not_confirmed instead of pretending
      // the write did not happen.
    }
    if (!response.ok) {
      const rec = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
      const status = response.status >= 400 && response.status <= 599 ? response.status : 502;
      const code = status === 409 ? "conflict" : "warmbly_review_failed";
      throw new ServiceError(code, String(rec.message ?? rec.error ?? `Warmbly review failed (${status})`), status);
    }
    return { body, validJson, status: response.status };
  }

  async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await requestResult(path, init);
    if (!response.validJson) {
      throw new ServiceError(
        "warmbly_review_failed",
        `Warmbly returned an empty or invalid JSON body (${response.status})`,
        502,
      );
    }
    return response.body;
  }

  function assertId(id: string): void {
    if (!ID.test(id)) throw invalid("review draft id must be a UUID");
  }

  return {
    async list(_actor, query) {
      const limit = boundedInt(query.get("limit"), 100, 200);
      const offset = boundedInt(query.get("offset"), 0, 100_000);
      return request(`/v1/confenge/review/drafts?limit=${limit}&offset=${offset}`);
    },
    async get(_actor, id) {
      assertId(id);
      return request(`/v1/confenge/review/drafts/${id}`);
    },
    async decide(_actor, id, body, idempotencyKey) {
      assertId(id);
      if (!idempotencyKey) throw invalid("Idempotency-Key is required");
      const input = decisionInput(body);
      let writeResponse: { body: unknown; validJson: boolean; status: number };
      try {
        writeResponse = await requestResult(`/v1/confenge/review/drafts/${id}/decision`, {
          method: "POST",
          headers: { "idempotency-key": idempotencyKey },
          body: JSON.stringify(body),
        });
      } catch (err) {
        if (err instanceof ServiceError && err.code === "warmbly_review_failed" && err.httpStatus >= 500) {
          throw new ServiceError(
            "warmbly_review_failed",
            "Resultado não confirmado. Não repita ainda: o transporte falhou durante a escrita; releia com a mesma Idempotency-Key",
            502,
          );
        }
        throw err;
      }

      const write = writeResponse.validJson ? touchpointFrom(writeResponse.body, true) : undefined;
      const scheduledFor = writeResponse.validJson ? scheduledForFrom(writeResponse.body) : undefined;
      let readbackPayload: unknown;
      try {
        readbackPayload = await request(`/v1/confenge/review/drafts/${id}`);
      } catch {
        return receipt(
          input,
          id,
          idempotencyKey,
          "not_confirmed",
          "unavailable",
          "o readback canônico ficou indisponível depois da escrita",
          write,
          scheduledFor,
        );
      }
      const readback = touchpointFrom(readbackPayload, false);
      const failure = writeResponse.validJson
        ? consistencyFailure(input, id, write, readback, scheduledFor)
        : `a escrita respondeu HTTP ${writeResponse.status} sem JSON utilizável`;
      if (failure) {
        return receipt(
          input,
          id,
          idempotencyKey,
          "not_confirmed",
          "not_confirmed",
          failure,
          readback ?? write,
          scheduledFor,
        );
      }
      return receipt(
        input,
        id,
        idempotencyKey,
        "confirmed",
        "confirmed",
        "write e readback confirmam a mesma versão persistida",
        readback,
        scheduledFor,
      );
    },
    async approveBatch(_actor, body, idempotencyKey) {
      if (!idempotencyKey) throw invalid("Idempotency-Key is required");
      return request("/v1/confenge/review/batches", {
        method: "POST",
        headers: { "idempotency-key": idempotencyKey },
        body: JSON.stringify(body),
      });
    },
  };
}
