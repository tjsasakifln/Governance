import type { IncomingMessage, ServerResponse } from "node:http";
import { parseActor } from "./actor.ts";
import { canonicalStringify } from "./canonical.ts";
import { invalid, isServiceError, payloadTooLarge } from "./errors.ts";
import type { Logger } from "./log.ts";
import { assertJsonSize } from "./sanitize.ts";
import { parseScope } from "./scope.ts";
import type { OperatorActionService } from "./operational/actions.ts";
import type { OperationalService } from "./operational/service.ts";
import type { ContextService } from "./service.ts";
import { LIMITS, type ActorRef, type Scope } from "./types.ts";

export interface HttpDeps {
  service: ContextService;
  logger: Logger;
  operational?: OperationalService;
  operatorActions?: OperatorActionService;
}

function header(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers[name];
  if (Array.isArray(raw)) {
    return raw[0];
  }
  return raw;
}

function actorFromRequest(req: IncomingMessage): ActorRef {
  return parseActor(header(req, "x-actor-id"), header(req, "x-actor-kind"));
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = canonicalStringify(body);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(payload);
}

function sendError(res: ServerResponse, err: unknown, logger: Logger): void {
  if (isServiceError(err)) {
    send(res, err.httpStatus, { error: err.code, message: err.message });
    return;
  }
  logger.error("unhandled", { kind: "internal" });
  send(res, 500, { error: "internal", message: "internal error" });
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > LIMITS.jsonBytes) {
      throw payloadTooLarge(`JSON payload exceeds ${LIMITS.jsonBytes} bytes`);
    }
    chunks.push(buf);
  }
  if (chunks.length === 0) {
    return {};
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.trim() === "") {
    return {};
  }
  assertJsonSize(raw);
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw invalid("body is not valid JSON");
  }
}

function rejectLegacyScopeParams(url: URL): void {
  if (url.searchParams.has("company") || url.searchParams.has("domain") || url.searchParams.has("resource")) {
    throw invalid("scope must be a single string parameter; company/domain/resource are not accepted");
  }
}

function queryScope(url: URL): Scope {
  rejectLegacyScopeParams(url);
  const scope = url.searchParams.get("scope");
  if (!scope) {
    throw invalid("scope query parameter is required");
  }
  return parseScope(scope);
}

function optionalQueryScope(url: URL): Scope | undefined {
  rejectLegacyScopeParams(url);
  const scope = url.searchParams.get("scope");
  if (!scope) {
    return undefined;
  }
  return parseScope(scope);
}

function queryHorizon(url: URL): "now" | "today" {
  const horizon = url.searchParams.get("horizon");
  if (horizon !== "now" && horizon !== "today") {
    throw invalid("horizon query parameter must be now or today");
  }
  return horizon;
}

function optionalQuerySource(url: URL): string | undefined {
  const source = url.searchParams.get("source");
  if (!source) {
    return undefined;
  }
  return source;
}

function mustOperational(deps: HttpDeps): OperationalService {
  if (!deps.operational) {
    throw invalid("operational read port is not configured");
  }
  return deps.operational;
}

export function createRequestListener(
  deps: HttpDeps,
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    void handle(deps, req, res);
  };
}

async function handle(
  deps: HttpDeps,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const host = req.headers.host ?? "127.0.0.1";
    const url = new URL(req.url ?? "/", `http://${host}`);
    const method = req.method ?? "GET";
    if (method === "GET" && url.pathname === "/healthz") {
      send(res, 200, { ok: true, service: "control-center-context" });
      return;
    }
    if (method === "GET" && url.pathname === "/ready") {
      const ready = await deps.service.ready();
      send(res, ready ? 200 : 503, { ready, service: "control-center-context" });
      return;
    }
    const actor = actorFromRequest(req);
    const parts = url.pathname.split("/").filter(Boolean);

    if (method === "GET" && url.pathname === "/v1/context") {
      send(res, 200, deps.service.getContext(actor, queryScope(url)));
      return;
    }
    if (method === "GET" && url.pathname === "/v1/operational-snapshots") {
      send(res, 200, await mustOperational(deps).getEnvelope(actor, queryScope(url)));
      return;
    }
    if (method === "GET" && url.pathname === "/v1/attention") {
      send(
        res,
        200,
        await mustOperational(deps).getAttention(actor, queryScope(url), queryHorizon(url)),
      );
      return;
    }
    if (method === "GET" && url.pathname === "/v1/today") {
      send(res, 200, await mustOperational(deps).getToday(actor, queryScope(url)));
      return;
    }
    if (method === "GET" && url.pathname === "/v1/source-observations") {
      send(
        res,
        200,
        await mustOperational(deps).getSourceObservations(actor, queryScope(url), optionalQuerySource(url)),
      );
      return;
    }
    if (method === "GET" && parts[0] === "v1" && parts[1] === "domains" && parts[2] && !parts[3]) {
      send(res, 200, await mustOperational(deps).getDomain(actor, parts[2], queryScope(url)));
      return;
    }
    if (method === "GET" && url.pathname === "/v1/active-directives") {
      send(res, 200, { items: deps.service.getActiveDirectives(actor, queryScope(url)) });
      return;
    }
    if (method === "GET" && url.pathname === "/v1/priorities") {
      send(res, 200, { items: deps.service.getPriorities(actor, optionalQueryScope(url)) });
      return;
    }
    if (method === "GET" && url.pathname === "/v1/decisions") {
      send(res, 200, { items: deps.service.getDecisions(actor, optionalQueryScope(url)) });
      return;
    }
    if (method === "GET" && url.pathname === "/v1/audit") {
      send(res, 200, { items: deps.service.listAudit(actor) });
      return;
    }
    if (method === "POST" && url.pathname === "/v1/operator-actions") {
      if (!deps.operatorActions) {
        throw invalid("operator action port is not configured");
      }
      send(res, 201, await deps.operatorActions.submit(actor, await readBody(req)));
      return;
    }
    if (method === "GET" && url.pathname === "/v1/operator-actions") {
      if (!deps.operatorActions) {
        throw invalid("operator action port is not configured");
      }
      send(res, 200, { items: await deps.operatorActions.list(actor, queryScope(url)) });
      return;
    }
    if (method === "POST" && url.pathname === "/v1/directives") {
      const body = await readBody(req);
      const created = deps.service.createDirective(actor, body);
      await deps.service.flush();
      send(res, 201, created);
      return;
    }
    if (method === "POST" && url.pathname === "/v1/agent-activities") {
      const body = await readBody(req);
      const recorded = deps.service.recordAgentActivity(actor, body);
      await deps.service.flush();
      send(res, 201, recorded);
      return;
    }
    if (method === "GET" && url.pathname === "/v1/agent-activities") {
      send(res, 200, { items: deps.service.listAgentActivities(actor, optionalQueryScope(url)) });
      return;
    }
    if (method === "POST" && url.pathname === "/v1/proposals") {
      const body = await readBody(req);
      const created = deps.service.submitProposal(actor, body);
      await deps.service.flush();
      send(res, 201, created);
      return;
    }
    if (method === "GET" && url.pathname === "/v1/proposals") {
      send(res, 200, { items: deps.service.listProposals(actor) });
      return;
    }

    if (parts[0] === "v1" && parts[1] === "directives" && parts[2] && !parts[3]) {
      if (method === "GET") {
        send(res, 200, deps.service.getDirective(actor, parts[2]));
        return;
      }
    }
    if (parts[0] === "v1" && parts[1] === "directives" && parts[2] && parts[3] === "revisions" && !parts[4]) {
      if (method === "GET") {
        send(res, 200, { items: deps.service.listRevisions(actor, parts[2]) });
        return;
      }
    }
    if (parts[0] === "v1" && parts[1] === "directives" && parts[2] && parts[3] && !parts[4] && method === "POST") {
      const id = parts[2];
      const action = parts[3];
      if (action === "versions") {
        const created = deps.service.createVersion(actor, id, await readBody(req));
        await deps.service.flush();
        send(res, 201, created);
        return;
      }
      if (action === "supersede") {
        const created = deps.service.supersede(actor, id, await readBody(req));
        await deps.service.flush();
        send(res, 201, created);
        return;
      }
      if (action === "expire") {
        const updated = deps.service.expire(actor, id, await readBody(req));
        await deps.service.flush();
        send(res, 200, updated);
        return;
      }
      if (action === "activate") {
        const updated = deps.service.activate(actor, id);
        await deps.service.flush();
        send(res, 200, updated);
        return;
      }
      if (action === "revoke") {
        const updated = deps.service.revoke(actor, id);
        await deps.service.flush();
        send(res, 200, updated);
        return;
      }
    }
    if (parts[0] === "v1" && parts[1] === "proposals" && parts[2] && parts[3] === "reject" && method === "POST") {
      const updated = deps.service.rejectProposal(actor, parts[2]);
      await deps.service.flush();
      send(res, 200, updated);
      return;
    }

    send(res, 404, { error: "not_found", message: "route not found" });
  } catch (err) {
    sendError(res, err, deps.logger);
  }
}
