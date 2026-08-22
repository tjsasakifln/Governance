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

/**
 * Read-back of this channel's own audit record. GET, never a Warmbly call: it
 * answers "who last touched the kill switch, and what came of it" — which
 * nothing upstream can answer, because Warmbly's dispatch status carries no
 * `paused_by`.
 *
 * Same identity gate as the writes. The stored token never leaves this process;
 * only the token *id* is disclosed.
 */
export const OPERATOR_LEDGER_ROUTE = "/v1/warmbly/operator/ledger/recent" as const;

/** Never more than this, whatever a caller asks for. */
export const OPERATOR_LEDGER_MAX = 20;

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

/** Ledger projection. Deliberately not the stored entry: no token, no raw headers. */
export interface OperatorLedgerView {
  action: string;
  outcome: string;
  actor_id: string | null;
  target: string;
  reason: string | null;
  refusal_code: string | null;
  upstream_status: number | null;
  recorded_at: string;
  correlation_id: string;
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
    // The write may have been applied upstream. 503 tells the caller the
    // connector could not resolve it — the body says to read dispatch status.
    case "transport_unknown":
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
    // Minted by the channel. `client_reference` is the caller's own string and
    // keys nothing.
    correlation_id: result.entry.correlation_id,
    client_reference: result.entry.client_reference,
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

/** Newest first, capped, and projected down to what an operator needs to read. */
function recentLedgerView(channel: WarmblyOperatorChannel): OperatorLedgerView[] {
  let entries;
  try {
    entries = channel.ledger.list();
  } catch {
    // A ledger that cannot be read is not an empty ledger. Say nothing rather
    // than claim nobody acted.
    return [];
  }
  return entries
    .slice(-OPERATOR_LEDGER_MAX)
    .reverse()
    .map((entry) => ({
      action: entry.requested_action,
      outcome: entry.outcome,
      actor_id: entry.actor?.id ?? null,
      target: `${entry.target.kind}:${entry.target.id}`,
      reason: entry.reason,
      refusal_code: entry.refusal_code,
      upstream_status: entry.upstream.status,
      recorded_at: entry.recorded_at,
      correlation_id: entry.correlation_id,
    }));
}

export function createOperatorHttpHandler(
  channel: WarmblyOperatorChannel,
): (req: OperatorHttpRequest) => Promise<OperatorHttpResponse> {
  return async (req) => {
    const path = pathOf(req.url);
    if (path === OPERATOR_LEDGER_ROUTE) {
      if ((req.method ?? "").toUpperCase() !== "GET") {
        return {
          status: 405,
          body: { ok: false, code: "method_not_allowed", reason: "the operator ledger is read-only" },
        };
      }
      // Same founder gate as a write: the audit trail names the operator, so it
      // is not public just because it does not mutate anything.
      const identity = channel.resolveActor({
        remoteAddress: req.remoteAddress ?? "",
        headers: req.headers,
      });
      if (!identity.ok) {
        return {
          status: 401,
          body: { ok: false, code: identity.code, reason: identity.reason },
        };
      }
      return { status: 200, body: { ok: true, entries: recentLedgerView(channel) } };
    }
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
    // A caller-supplied correlation id is never accepted as one: it is carried
    // as `client_reference`, which keys nothing. `correlation_id` in the body is
    // still read, for compatibility, into the same non-key field.
    const clientReference = str(body.client_reference) ?? str(body.correlation_id);
    const input = {
      request: identity,
      ...(str(body.reason) ? { reason: str(body.reason)! } : {}),
      ...(clientReference ? { client_reference: clientReference } : {}),
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
