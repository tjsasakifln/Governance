import { createHash, randomUUID } from "node:crypto";
import { parseForwardAuthIdentity, type TrustedHopPolicy } from "@confenge/control-center-security";
import { redactSecrets, type Logger } from "../http/redaction.ts";
import type { OperatorHttpRequest, OperatorHttpResponse } from "../operator/http.ts";
import {
  HUMAN_GATE_CONTRACT,
  UUID_PATTERN_SOURCE,
  WARMBLY_COHORTS_PREFIX,
  isCanonicalUuid,
  validateAdjustRequest,
  type AdjustValidation,
  type HumanGateOperation,
  type HumanGateOutcome,
} from "./contract.ts";

export { HUMAN_GATE_CONTRACT };
export const HUMAN_GATE_PREFIX = "/v1/warmbly/operator/cohorts";
export const HUMAN_GATE_STATUS_PATH = "/v1/warmbly/operator/outbound-status";

const UUID = UUID_PATTERN_SOURCE;

/**
 * The fixed allowlist. Adding a row here is the only way to reach Warmbly
 * through this handler: there is no generic proxy row, no wildcard, and no
 * caller-supplied upstream path. Every `upstream` builder composes from
 * `WARMBLY_COHORTS_PREFIX` and from capture groups that have already matched a
 * canonical UUID, so no caller string is ever concatenated raw into a URL.
 */
interface HumanGateRoute {
  method: "GET" | "POST";
  operation: HumanGateOperation;
  local: RegExp;
  upstream: (m: RegExpMatchArray) => string;
  role: "operators" | "admins";
  /** Strict, closed-world body validation. Absent means the legacy field filter. */
  validate?: (body: unknown) => AdjustValidation;
}

const routes: readonly HumanGateRoute[] = [
  { method: "GET", operation: "read_status", local: new RegExp(`^${HUMAN_GATE_STATUS_PATH}$`), upstream: () => "/v1/confenge/status", role: "operators" },
  { method: "GET", operation: "list_cohorts", local: new RegExp(`^${HUMAN_GATE_PREFIX}$`), upstream: () => WARMBLY_COHORTS_PREFIX, role: "operators" },
  { method: "POST", operation: "create", local: new RegExp(`^${HUMAN_GATE_PREFIX}$`), upstream: () => WARMBLY_COHORTS_PREFIX, role: "operators" },
  { method: "GET", operation: "read_cohort", local: new RegExp(`^${HUMAN_GATE_PREFIX}/(${UUID})$`), upstream: (m) => `${WARMBLY_COHORTS_PREFIX}/${m[1]}`, role: "operators" },
  { method: "GET", operation: "read_candidate", local: new RegExp(`^${HUMAN_GATE_PREFIX}/(${UUID})/candidates/(${UUID})$`), upstream: (m) => `${WARMBLY_COHORTS_PREFIX}/${m[1]}/candidates/${m[2]}`, role: "operators" },
  { method: "POST", operation: "reproduce", local: new RegExp(`^${HUMAN_GATE_PREFIX}/(${UUID})/reproduce$`), upstream: (m) => `${WARMBLY_COHORTS_PREFIX}/${m[1]}/reproduce`, role: "operators" },
  { method: "POST", operation: "validation", local: new RegExp(`^${HUMAN_GATE_PREFIX}/(${UUID})/candidates/(${UUID})/validation$`), upstream: (m) => `${WARMBLY_COHORTS_PREFIX}/${m[1]}/candidates/${m[2]}/validation`, role: "operators" },
  { method: "POST", operation: "review", local: new RegExp(`^${HUMAN_GATE_PREFIX}/(${UUID})/candidates/(${UUID})/review$`), upstream: (m) => `${WARMBLY_COHORTS_PREFIX}/${m[1]}/candidates/${m[2]}/review`, role: "operators" },
  // Same operators-equivalent permission as review. Adjusting frozen copy mints
  // a new immutable version and revokes the authorization bound to the old one;
  // it is not a GO, so it is deliberately NOT behind the admins gate.
  { method: "POST", operation: "adjust", local: new RegExp(`^${HUMAN_GATE_PREFIX}/(${UUID})/candidates/(${UUID})/adjust$`), upstream: (m) => `${WARMBLY_COHORTS_PREFIX}/${m[1]}/candidates/${m[2]}/adjust`, role: "operators", validate: validateAdjustRequest },
  // Repair-only replay of the same scheduling path an APPROVE already runs.
  // It is global, payload-free and naturally idempotent upstream; admins own
  // repair while operators own the ordinary approve-and-queue decision.
  { method: "POST", operation: "reconcile", local: new RegExp(`^${HUMAN_GATE_PREFIX}/reconcile-approved$`), upstream: () => `${WARMBLY_COHORTS_PREFIX}/reconcile-approved`, role: "admins" },
];

/** Exposed for tests and for the cockpit: the complete reachable surface. */
export const HUMAN_GATE_ROUTES = routes.map((r) => ({
  method: r.method,
  operation: r.operation,
  role: r.role,
  local: r.local.source,
})) as readonly { method: string; operation: HumanGateOperation; role: string; local: string }[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function bodyRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function idempotency(value: unknown): string | undefined {
  const body = bodyRecord(value);
  const supplied = typeof body.idempotency_key === "string" ? body.idempotency_key.trim() : "";
  return /^[A-Za-z0-9._:~-]{8,128}$/.test(supplied) ? supplied : undefined;
}

function opaqueActorId(actor: string): string {
  return `authelia:${createHash("sha256").update(actor).digest("hex").slice(0, 16)}`;
}

/**
 * The identity of whatever the write produced, read only out of what the server
 * actually sent. Nothing here is synthesised: an absent field stays absent, so
 * the cockpit can tell "the server did not say" from "the server said none".
 */
function resourceIdentity(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const container of [payload.cohort, payload.data, payload]) {
    if (!isRecord(container)) continue;
    if (typeof container.id === "string" && out.id === undefined) out.id = container.id;
    const version = container.version;
    if ((typeof version === "string" || typeof version === "number") && out.version === undefined) {
      out.version = version;
    }
    if (out.id !== undefined && out.version !== undefined) break;
  }
  const adjustment = payload.adjustment;
  if (isRecord(adjustment)) {
    if (typeof adjustment.id === "string") out.adjustment_id = adjustment.id;
    if (adjustment.from_version !== undefined) out.from_version = adjustment.from_version;
    if (adjustment.to_version !== undefined) out.to_version = adjustment.to_version;
  }
  if (Object.keys(out).length === 0) return undefined;
  return { kind: "cohort", ...out };
}

/** Upstream receipt, wherever the server put it. Never minted from thin air. */
function upstreamReceipt(payload: Record<string, unknown>): string | undefined {
  if (typeof payload.receipt === "string") return payload.receipt;
  const adjustment = payload.adjustment;
  if (isRecord(adjustment) && typeof adjustment.receipt === "string") return adjustment.receipt;
  return undefined;
}

interface EnvelopeContext {
  correlation: string;
  operation: HumanGateOperation;
  outcome: HumanGateOutcome;
  /** Echoed back on writes so a retry after UNKNOWN reuses the same key. */
  idempotencyKey?: string | undefined;
}

function edgeEnvelope(
  ctx: EnvelopeContext,
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
  const resource = resourceIdentity(payload);
  return {
    ...payload,
    contract_version: typeof meta.contract_version === "string" ? meta.contract_version : HUMAN_GATE_CONTRACT,
    source: typeof meta.source === "string" ? meta.source : "warmbly.controlled-outbound",
    as_of: typeof meta.as_of === "string" ? meta.as_of : new Date().toISOString(),
    freshness: typeof meta.freshness === "string" ? meta.freshness : "UNKNOWN",
    policy_version: typeof meta.policy_version === "string" ? meta.policy_version : "bounded-cohort-policy.v1",
    reason,
    correlation_id: typeof meta.correlation_id === "string" ? meta.correlation_id : ctx.correlation,
    receipt: upstreamReceipt(payload) ?? `edge:${ctx.correlation}`,
    // Human-gate envelopes retain their canonical global-off assertion. The
    // dedicated status read is different: it is server telemetry, so preserve
    // a real boolean and let absence remain absence instead of stamping false.
    ...(ctx.operation === "read_status"
      ? {
          auto_send_enabled:
            typeof payload.auto_send_enabled === "boolean"
              ? payload.auto_send_enabled
              : undefined,
        }
      : { auto_send_enabled: false }),
    edge_correlation_id: ctx.correlation,
    // Distinct write results used to arrive as one indistinguishable body. These
    // three say which call this was, how it ended, and what it produced.
    operation: ctx.operation,
    outcome: ctx.outcome,
    ...(resource ? { resource } : {}),
    ...(ctx.idempotencyKey ? { idempotency_key: ctx.idempotencyKey } : {}),
  };
}

function edgeRefusal(ctx: EnvelopeContext, code: string, message: string): Record<string, unknown> {
  return edgeEnvelope(ctx, { ok: false, code, message }, code);
}

export interface HumanGateHttpOptions {
  baseUrl: string;
  token: string;
  identityPolicy: TrustedHopPolicy;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  logger?: Logger;
}

/**
 * Fixed-route authenticated proxy. It has no `send`, `dispatch`, `queue` or
 * `resume` route by construction. APPROVE and repair reconciliation are the
 * only ways this surface can cause durable scheduling.
 */
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
    const ctx = (
      operation: HumanGateOperation,
      outcome: HumanGateOutcome,
      idempotencyKey?: string | undefined,
    ): EnvelopeContext => ({ correlation, operation, outcome, idempotencyKey });
    if (!route) {
      return {
        status: 404,
        body: edgeRefusal(
          { correlation, operation: "list_cohorts", outcome: "REFUSED" },
          "human_gate_route_not_allowed",
          "route is outside the fixed human-gate allowlist",
        ),
      };
    }
    const identity = parseForwardAuthIdentity({
      remoteAddress: req.remoteAddress ?? "",
      headers: req.headers,
      ...(req.rawHeaders ? { rawHeaders: req.rawHeaders } : {}),
    }, options.identityPolicy);
    if (!identity.ok) {
      log({ level: "warn", msg: "warmbly.human_gate.after", schema_version: HUMAN_GATE_CONTRACT, correlation_id: correlation, actor_id: "anonymous", operation: route.operation, method, upstream_path: url.pathname, after: "REFUSED", upstream_status: 401, reason_code: identity.code });
      return { status: 401, body: edgeRefusal(ctx(route.operation, "REFUSED"), identity.code, identity.reason) };
    }
    if (!identity.identity.groups.includes(route.role)) {
      log({ level: "warn", msg: "warmbly.human_gate.after", schema_version: HUMAN_GATE_CONTRACT, correlation_id: correlation, actor_id: opaqueActorId(identity.identity.user), operation: route.operation, method, upstream_path: url.pathname, after: "REFUSED", upstream_status: 403, reason_code: "insufficient_human_gate_role" });
      return { status: 403, body: edgeRefusal(ctx(route.operation, "REFUSED"), "insufficient_human_gate_role", `${route.role} role required`) };
    }
    const match = url.pathname.match(route.local)!;
    // Belt and braces. The route regex already required canonical UUIDs, but the
    // guard is restated here so that no future edit to a pattern can let an
    // unvalidated segment reach URL construction: this is the last statement
    // before a caller-derived string becomes part of an upstream URL.
    const ids = match.slice(1);
    if (ids.some((id) => !isCanonicalUuid(id))) {
      log({ level: "warn", msg: "warmbly.human_gate.after", schema_version: HUMAN_GATE_CONTRACT, correlation_id: correlation, actor_id: opaqueActorId(identity.identity.user), operation: route.operation, method, upstream_path: url.pathname, after: "REFUSED", upstream_status: 400, reason_code: "invalid_identifier" });
      return { status: 400, body: edgeRefusal(ctx(route.operation, "REFUSED"), "invalid_identifier", "cohort and candidate identifiers must be canonical UUIDs") };
    }
    const upstreamPath = route.upstream(match) + (method === "GET" ? url.search : "");
    const actorId = opaqueActorId(identity.identity.user);
    const key = method === "POST" ? idempotency(req.body) : undefined;
    if (method === "POST" && !key) {
      log({ level: "warn", msg: "warmbly.human_gate.after", schema_version: HUMAN_GATE_CONTRACT, correlation_id: correlation, actor_id: actorId, operation: route.operation, method, upstream_path: upstreamPath, after: "REFUSED", upstream_status: 400, reason_code: "idempotency_key_required" });
      return {
        status: 400,
        body: edgeRefusal(ctx(route.operation, "REFUSED"), "idempotency_key_required", "a valid idempotency_key is required for every human-gate write"),
      };
    }
    const submitted = bodyRecord(req.body);
    let body: Record<string, unknown> = {};
    if (route.validate) {
      // Closed-world schema: an unknown field is a refusal, never a silent drop.
      const validated = route.validate(req.body);
      if (!validated.ok) {
        log({ level: "warn", msg: "warmbly.human_gate.after", schema_version: HUMAN_GATE_CONTRACT, correlation_id: correlation, actor_id: actorId, operation: route.operation, method, upstream_path: upstreamPath, after: "REFUSED", upstream_status: 422, reason_code: validated.code });
        return {
          status: 422,
          body: {
            ...edgeRefusal(ctx(route.operation, "REFUSED", key), validated.code, validated.message),
            rejected_fields: validated.fields,
          },
        };
      }
      body = { ...validated.value };
    } else if (route.operation !== "reconcile") {
      for (const field of ["limit", "source_run_id", "selection_mode", "recover_version_ids", "decision", "reason", "acknowledged", "confirmation"] as const) {
        if (submitted[field] !== undefined) body[field] = submitted[field];
      }
    }
    log({ level: "info", msg: "warmbly.human_gate.before", schema_version: HUMAN_GATE_CONTRACT, correlation_id: correlation, actor_id: actorId, operation: route.operation, method, upstream_path: upstreamPath, before: "REQUESTED" });
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
      // A 5xx on a write is indeterminate, not a failure: the request was
      // written, the backend may well have applied it, and only the answer was
      // lost. Calling that REFUSED would tell an operator nothing happened.
      const indeterminate = method === "POST" && res.status >= 500;
      const outcome: HumanGateOutcome = res.ok ? "APPLIED" : indeterminate ? "UNKNOWN" : "REFUSED";
      log({ level: res.ok ? "info" : "warn", msg: "warmbly.human_gate.after", schema_version: HUMAN_GATE_CONTRACT, correlation_id: correlation, actor_id: actorId, operation: route.operation, method, upstream_path: upstreamPath, after: outcome, upstream_status: res.status, receipt: upstreamReceipt(safe) ?? null });
      return {
        status: res.status,
        body: edgeEnvelope(
          ctx(route.operation, outcome, key),
          { ...safe, edge_actor: { id: identity.identity.user, groups: identity.identity.groups } },
          res.ok ? "ok" : indeterminate ? "human_gate_upstream_unknown" : "upstream_refused",
        ),
      };
    } catch (error) {
      log({ level: "error", msg: "warmbly.human_gate.after", schema_version: HUMAN_GATE_CONTRACT, correlation_id: correlation, actor_id: actorId, operation: route.operation, method, upstream_path: upstreamPath, after: "UNKNOWN", error: redactSecrets(error instanceof Error ? error.name : "transport_error") });
      const code = method === "POST" ? "human_gate_transport_unknown" : "human_gate_read_unavailable";
      const message = method === "POST" ? "write may have been applied; read the resource before retrying" : "read did not complete; no write was attempted";
      // A read that never reached Warmbly changed nothing; a write that timed out
      // may have. Only the write is UNKNOWN, and it keeps its idempotency key so
      // the retry is the same request rather than a second one.
      const outcome: HumanGateOutcome = method === "POST" ? "UNKNOWN" : "REFUSED";
      return { status: 503, body: edgeRefusal(ctx(route.operation, outcome, key), code, message) };
    } finally { clearTimeout(timer); }
  };
}
