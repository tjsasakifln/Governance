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
  { method: "GET", local: new RegExp(`^${HUMAN_GATE_PREFIX}/(${UUID})/candidates/(${UUID})$`), upstream: (m: RegExpMatchArray) => `/v1/confenge/cohorts/${m[1]}/candidates/${m[2]}`, role: "operators" },
  { method: "POST", local: new RegExp(`^${HUMAN_GATE_PREFIX}/(${UUID})/reproduce$`), upstream: (m: RegExpMatchArray) => `/v1/confenge/cohorts/${m[1]}/reproduce`, role: "operators" },
  { method: "POST", local: new RegExp(`^${HUMAN_GATE_PREFIX}/(${UUID})/candidates/(${UUID})/validation$`), upstream: (m: RegExpMatchArray) => `/v1/confenge/cohorts/${m[1]}/candidates/${m[2]}/validation`, role: "operators" },
  { method: "POST", local: new RegExp(`^${HUMAN_GATE_PREFIX}/(${UUID})/candidates/(${UUID})/review$`), upstream: (m: RegExpMatchArray) => `/v1/confenge/cohorts/${m[1]}/candidates/${m[2]}/review`, role: "operators" },
  { method: "POST", local: new RegExp(`^${HUMAN_GATE_PREFIX}/(${UUID})/decision$`), upstream: (m: RegExpMatchArray) => `/v1/confenge/cohorts/${m[1]}/decision`, role: "admins" },
] as const;

function bodyRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function idempotency(value: unknown): string | undefined {
  const body = bodyRecord(value);
  const supplied = typeof body.idempotency_key === "string" ? body.idempotency_key.trim() : "";
  return /^[A-Za-z0-9._:~-]{8,128}$/.test(supplied) ? supplied : undefined;
}

function opaqueActorId(actor: string): string {
  return `authelia:${createHash("sha256").update(actor).digest("hex").slice(0, 16)}`;
}

function edgeEnvelope(
  correlation: string,
  payload: Record<string, unknown>,
  fallbackReason: string,
): Record<string, unknown> {
  const meta = bodyRecord(payload.meta);
  const rawReason = payload.reason ?? meta.reason;
  const reason = Array.isArray(rawReason)
    ? rawReason.map(String)
    : typeof rawReason === "string" && rawReason.trim() !== ""
      ? [rawReason]
      : [fallbackReason];
  return {
    ...payload,
    contract_version: typeof meta.contract_version === "string" ? meta.contract_version : HUMAN_GATE_CONTRACT,
    source: typeof meta.source === "string" ? meta.source : "warmbly.controlled-outbound",
    as_of: typeof meta.as_of === "string" ? meta.as_of : new Date().toISOString(),
    freshness: typeof meta.freshness === "string" ? meta.freshness : "UNKNOWN",
    policy_version: typeof meta.policy_version === "string" ? meta.policy_version : "bounded-cohort-policy.v1",
    reason,
    correlation_id: typeof meta.correlation_id === "string" ? meta.correlation_id : correlation,
    receipt: typeof payload.receipt === "string" ? payload.receipt : `edge:${correlation}`,
    auto_send_enabled: false,
    edge_correlation_id: correlation,
  };
}

function edgeRefusal(correlation: string, code: string, message: string): Record<string, unknown> {
  return edgeEnvelope(correlation, { ok: false, code, message }, code);
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
    const correlation = `cc:human-gate:${randomUUID()}`;
    const route = routes.find((r) => r.method === method && r.local.test(url.pathname));
    if (!route) return { status: 404, body: edgeRefusal(correlation, "human_gate_route_not_allowed", "route is outside the fixed human-gate allowlist") };
    const identity = parseForwardAuthIdentity({
      remoteAddress: req.remoteAddress ?? "",
      headers: req.headers,
      ...(req.rawHeaders ? { rawHeaders: req.rawHeaders } : {}),
    }, options.identityPolicy);
    if (!identity.ok) {
      log({ level: "warn", msg: "warmbly.human_gate.after", schema_version: HUMAN_GATE_CONTRACT, correlation_id: correlation, actor_id: "anonymous", method, upstream_path: url.pathname, after: "REFUSED", upstream_status: 401, reason_code: identity.code });
      return { status: 401, body: edgeRefusal(correlation, identity.code, identity.reason) };
    }
    if (!identity.identity.groups.includes(route.role)) {
      log({ level: "warn", msg: "warmbly.human_gate.after", schema_version: HUMAN_GATE_CONTRACT, correlation_id: correlation, actor_id: opaqueActorId(identity.identity.user), method, upstream_path: url.pathname, after: "REFUSED", upstream_status: 403, reason_code: "insufficient_human_gate_role" });
      return { status: 403, body: edgeRefusal(correlation, "insufficient_human_gate_role", `${route.role} role required`) };
    }
    const match = url.pathname.match(route.local)!;
    const upstreamPath = route.upstream(match) + (method === "GET" ? url.search : "");
    const actorId = opaqueActorId(identity.identity.user);
    const key = method === "POST" ? idempotency(req.body) : undefined;
    if (method === "POST" && !key) {
      log({ level: "warn", msg: "warmbly.human_gate.after", schema_version: HUMAN_GATE_CONTRACT, correlation_id: correlation, actor_id: actorId, method, upstream_path: upstreamPath, after: "REFUSED", upstream_status: 400, reason_code: "idempotency_key_required" });
      return {
        status: 400,
        body: edgeRefusal(correlation, "idempotency_key_required", "a valid idempotency_key is required for every human-gate write"),
      };
    }
    const submitted = bodyRecord(req.body);
    const body: Record<string, unknown> = {};
    for (const field of ["limit", "source_run_id", "decision", "reason", "acknowledged", "confirmation"] as const) {
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
          ...(method === "POST" ? { "content-type": "application/json", "idempotency-key": key } : {}),
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
      return { status: res.status, body: edgeEnvelope(correlation, { ...safe, edge_actor: { id: identity.identity.user, groups: identity.identity.groups } }, res.ok ? "ok" : "upstream_refused") };
    } catch (error) {
      log({ level: "error", msg: "warmbly.human_gate.after", schema_version: HUMAN_GATE_CONTRACT, correlation_id: correlation, actor_id: actorId, method, upstream_path: upstreamPath, after: "UNKNOWN", error: redactSecrets(error instanceof Error ? error.name : "transport_error") });
      const code = method === "POST" ? "human_gate_transport_unknown" : "human_gate_read_unavailable";
      const message = method === "POST" ? "write may have been applied; read the resource before retrying" : "read did not complete; no write was attempted";
      return { status: 503, body: edgeRefusal(correlation, code, message) };
    } finally { clearTimeout(timer); }
  };
}
