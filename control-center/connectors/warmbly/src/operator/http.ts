/**
 * Mountable HTTP surface for the operator action channel.
 *
 * Three fixed routes, POST only. The request's `Remote-*` headers and socket
 * address are handed straight to the channel, which resolves the founder via
 * `control-center/security`. There is no body field that can name a method, a
 * path, or an actor: identity comes from Authelia and nowhere else.
 *
 *   POST /v1/warmbly/operator/dispatch/pause
 *   POST /v1/warmbly/operator/dispatch/resume/confirm   (step 1, mints a token)
 *   POST /v1/warmbly/operator/dispatch/resume           (step 2, needs the token)
 *   POST /v1/warmbly/operator/inbound/acknowledge
 */

import type { OperatorActionResult, WarmblyOperatorChannel } from "./channel.ts";

export const OPERATOR_HTTP_ROUTES = {
  pause: "/v1/warmbly/operator/dispatch/pause",
  resumeConfirm: "/v1/warmbly/operator/dispatch/resume/confirm",
  resume: "/v1/warmbly/operator/dispatch/resume",
  acknowledge: "/v1/warmbly/operator/inbound/acknowledge",
} as const;

export type OperatorHttpRoute = (typeof OPERATOR_HTTP_ROUTES)[keyof typeof OPERATOR_HTTP_ROUTES];

export interface OperatorHttpRequest {
  method: string | undefined;
  url: string | undefined;
  headers: Readonly<Record<string, string | string[] | undefined>>;
  /** Socket peer address. The trusted-hop check is done against this. */
  remoteAddress: string | undefined;
  /** Already-parsed JSON body. The handler never parses a stream itself. */
  body: unknown;
}

export interface OperatorHttpResponse {
  status: number;
  body: Record<string, unknown>;
}

function pathOf(url: string | undefined): string {
  const raw = url ?? "/";
  const cut = raw.split("?")[0] ?? raw;
  return cut.length > 1 && cut.endsWith("/") ? cut.slice(0, -1) : cut;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/** Refusals are 4xx; a refusal is never rendered as a success. */
function statusFor(result: OperatorActionResult): number {
  if (result.ok) {
    return result.outcome === "challenged" ? 202 : 200;
  }
  switch (result.code) {
    case "missing_actor":
      return 401;
    case "unknown_action":
    case "forbidden_path":
    case "confirmation_not_applicable":
      return 403;
    case "invalid_target":
    case "invalid_reason":
      return 400;
    case "confirmation_required":
    case "confirmation_invalid":
      return 428;
    case "circuit_open":
    case "transport_error":
      return 503;
    case "upstream_error":
      return 502;
    default:
      return 403;
  }
}

function render(result: OperatorActionResult): OperatorHttpResponse {
  const base: Record<string, unknown> = {
    outcome: result.outcome,
    correlation_id: result.entry.correlation_id,
    ledger_id: result.entry.id,
    recorded_at: result.entry.recorded_at,
  };
  if (!result.ok) {
    return { status: statusFor(result), body: { ...base, ok: false, code: result.code, reason: result.reason } };
  }
  if (result.outcome === "challenged") {
    return {
      status: statusFor(result),
      body: {
        ...base,
        ok: true,
        action: result.action,
        confirmation_token: result.challenge.token,
        expires_at: result.challenge.expires_at,
      },
    };
  }
  return {
    status: statusFor(result),
    body: {
      ...base,
      ok: true,
      action: result.action,
      target: result.target,
      upstream_status: result.upstream_status,
    },
  };
}

export function createOperatorHttpHandler(
  channel: WarmblyOperatorChannel,
): (req: OperatorHttpRequest) => Promise<OperatorHttpResponse> {
  return async (req) => {
    const path = pathOf(req.url);
    const known = (Object.values(OPERATOR_HTTP_ROUTES) as string[]).includes(path);
    if (!known) {
      return { status: 404, body: { ok: false, code: "unknown_route", reason: `no operator route ${path}` } };
    }
    if ((req.method ?? "").toUpperCase() !== "POST") {
      return {
        status: 405,
        body: { ok: false, code: "method_not_allowed", reason: "operator routes are POST only" },
      };
    }
    const identity = { remoteAddress: req.remoteAddress ?? "", headers: req.headers };
    const body = asRecord(req.body);
    const input = {
      request: identity,
      ...(str(body.reason) ? { reason: str(body.reason)! } : {}),
      ...(str(body.correlation_id) ? { correlation_id: str(body.correlation_id)! } : {}),
    };

    if (path === OPERATOR_HTTP_ROUTES.pause) {
      return render(await channel.pauseDispatch(input));
    }
    if (path === OPERATOR_HTTP_ROUTES.resumeConfirm) {
      return render(await channel.requestResumeConfirmation(input));
    }
    if (path === OPERATOR_HTTP_ROUTES.resume) {
      return render(
        await channel.resumeDispatch({
          ...input,
          ...(str(body.confirmation_token)
            ? { confirmation_token: str(body.confirmation_token)! }
            : {}),
        }),
      );
    }
    return render(
      await channel.acknowledgeInboundAlert({
        ...input,
        ...(str(body.target_id) ? { target_id: str(body.target_id)! } : {}),
      }),
    );
  };
}
