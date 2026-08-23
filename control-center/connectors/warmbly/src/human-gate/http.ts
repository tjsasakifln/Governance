import { createHash, randomUUID } from "node:crypto";
import { parseForwardAuthIdentity, type TrustedHopPolicy } from "@confenge/control-center-security";
import { redactSecrets, type Logger } from "../http/redaction.ts";
import type { OperatorHttpRequest, OperatorHttpResponse } from "../operator/http.ts";

export const HUMAN_GATE_CONTRACT = "confenge.human-gate.v1";
export const HUMAN_GATE_PREFIX = "/v1/warmbly/operator/cohorts";

const UUID = "[0-9a-fA-F-]{36}";
const routes = [
  { method: "GET", local: new RegExp(`^${HUMAN_GATE_PREFIX}$`), upstream: () => "/v1/confenge/cohorts", role: "operators" },
  { method: "POST", local: new RegExp(`^${HUMAN_GATE_PREFIX}$`), upstream: () => "/v1/confenge/cohorts", role: "operators" },
  { method: "GET", local: new RegExp(`^${HUMAN_GATE_PREFIX}/(${UUID})$`), upstream: (m: RegExpMatchArray) => `/v1/confenge/cohorts/${m[1]}`, role: "operators" },
  { method: "POST", local: new RegExp(`^${HUMAN_GATE_PREFIX}/(${UUID})/reproduce$`), upstream: (m: RegExpMatchArray) => `/v1/confenge/cohorts/${m[1]}/reproduce`, role: "operators" },
  { method: "POST", local: new RegExp(`^${HUMAN_GATE_PREFIX}/(${UUID})/candidates/(${UUID})/validation$`), upstream: (m: RegExpMatchArray) => `/v1/confenge/cohorts/${m[1]}/candidates/${m[2]}/validation`, role: "operators" },
  { method: "POST", local: new RegExp(`^${HUMAN_GATE_PREFIX}/(${UUID})/candidates/(${UUID})/review$`), upstream: (m: RegExpMatchArray) => `/v1/confenge/cohorts/${m[1]}/candidates/${m[2]}/review`, role: "operators" },
  { method: "POST", local: new RegExp(`^${HUMAN_GATE_PREFIX}/(${UUID})/decision$`), upstream: (m: RegExpMatchArray) => `/v1/confenge/cohorts/${m[1]}/decision`, role: "admins" },
] as const;

function bodyRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function idempotency(value: unknown): string {
  const body = bodyRecord(value);
  const supplied = typeof body.idempotency_key === "string" ? body.idempotency_key.trim() : "";
  return /^[A-Za-z0-9._:~-]{8,128}$/.test(supplied) ? supplied : `cc-human-gate:${randomUUID()}`;
}

function opaqueActorId(actor: string): string {
  return `authelia:${createHash("sha256").update(actor).digest("hex").slice(0, 16)}`;
}

export interface HumanGateHttpOptions {
  baseUrl: string;
  token: string;
  identityPolicy: TrustedHopPolicy;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  logger?: Logger;
}

/** Fixed-route authenticated proxy. It has no dispatch/send route by construction. */
export function createHumanGateHttpHandler(options: HumanGateHttpOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 12_000;
  const base = options.baseUrl.replace(/\/+$/, "");
  const log = options.logger ?? (() => undefined);
  return async (req: OperatorHttpRequest): Promise<OperatorHttpResponse> => {
    const url = new URL(req.url ?? "/", "http://control-center.invalid");
    const method = (req.method ?? "GET").toUpperCase();
    const route = routes.find((r) => r.method === method && r.local.test(url.pathname));
    if (!route) return { status: 404, body: { ok: false, code: "human_gate_route_not_allowed" } };
    const identity = parseForwardAuthIdentity({
      remoteAddress: req.remoteAddress ?? "",
      headers: req.headers,
      ...(req.rawHeaders ? { rawHeaders: req.rawHeaders } : {}),
    }, options.identityPolicy);
    if (!identity.ok) return { status: 401, body: { ok: false, code: identity.code, reason: identity.reason } };
    if (!identity.identity.groups.includes(route.role)) {
      return { status: 403, body: { ok: false, code: "insufficient_human_gate_role", reason: `${route.role} role required` } };
    }
    const match = url.pathname.match(route.local)!;
    const upstreamPath = route.upstream(match) + (method === "GET" ? url.search : "");
    const correlation = `cc:human-gate:${randomUUID()}`;
    const actorId = opaqueActorId(identity.identity.user);
    const key = method === "POST" ? idempotency(req.body) : undefined;
    const submitted = bodyRecord(req.body);
    const body: Record<string, unknown> = {};
    for (const field of ["limit", "source_run_id", "decision", "reason"] as const) {
      if (submitted[field] !== undefined) body[field] = submitted[field];
    }
    log({ level: "info", msg: "warmbly.human_gate.before", schema_version: HUMAN_GATE_CONTRACT, correlation_id: correlation, actor_id: actorId, method, upstream_path: upstreamPath, before: "REQUESTED" });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${base}${upstreamPath}`, {
        method,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${options.token}`,
          "api-version": "v1",
          "x-correlation-id": correlation,
          ...(method === "POST" ? { "content-type": "application/json", "idempotency-key": key! } : {}),
        },
        ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
        redirect: "manual",
      });
      const text = await res.text();
      let payload: unknown = {};
      try { payload = text ? JSON.parse(text) : {}; } catch { payload = { code: "invalid_upstream_payload" }; }
      const safe = bodyRecord(payload);
      log({ level: res.ok ? "info" : "warn", msg: "warmbly.human_gate.after", schema_version: HUMAN_GATE_CONTRACT, correlation_id: correlation, actor_id: actorId, method, upstream_path: upstreamPath, after: res.ok ? "APPLIED" : "REFUSED", upstream_status: res.status, receipt: typeof safe.receipt === "string" ? safe.receipt : null });
      return { status: res.status, body: { ...safe, edge_actor: { id: identity.identity.user, groups: identity.identity.groups }, edge_correlation_id: correlation } };
    } catch (error) {
      log({ level: "error", msg: "warmbly.human_gate.after", schema_version: HUMAN_GATE_CONTRACT, correlation_id: correlation, actor_id: actorId, method, upstream_path: upstreamPath, after: "UNKNOWN", error: redactSecrets(error instanceof Error ? error.name : "transport_error") });
      return { status: 503, body: { ok: false, code: "human_gate_transport_unknown", reason: "write may have been applied; read the resource before retrying", edge_correlation_id: correlation } };
    } finally { clearTimeout(timer); }
  };
}
