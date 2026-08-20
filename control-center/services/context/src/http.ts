import type { IncomingMessage, ServerResponse } from "node:http";
import { parseActor } from "./actor.ts";
import { canonicalStringify } from "./canonical.ts";
import { invalid, isServiceError, payloadTooLarge } from "./errors.ts";
import type { Logger } from "./log.ts";
import { assertJsonSize } from "./sanitize.ts";
import { parseScope } from "./scope.ts";
import type { ContextService } from "./service.ts";
import { LIMITS, type Actor, type Scope } from "./types.ts";

export interface HttpDeps {
  service: ContextService;
  logger: Logger;
}

function header(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers[name];
  if (Array.isArray(raw)) {
    return raw[0];
  }
  return raw;
}

function actorFromRequest(req: IncomingMessage): Actor {
  return parseActor(header(req, "x-actor-id"), header(req, "x-actor-role"));
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

function queryScope(url: URL, fallbackCompany: string): Scope {
  const company = url.searchParams.get("company") ?? fallbackCompany;
  const domain = url.searchParams.get("domain");
  const resource = url.searchParams.get("resource");
  const raw: Record<string, string> = { company };
  if (domain) {
    raw.domain = domain;
  }
  if (resource) {
    raw.resource = resource;
  }
  return parseScope(raw);
}

function optionalQueryScope(url: URL): Scope | undefined {
  const company = url.searchParams.get("company");
  const domain = url.searchParams.get("domain");
  const resource = url.searchParams.get("resource");
  if (!company && !domain && !resource) {
    return undefined;
  }
  if (!company) {
    throw invalid("company is required when domain or resource is present");
  }
  const raw: Record<string, string> = { company };
  if (domain) {
    raw.domain = domain;
  }
  if (resource) {
    raw.resource = resource;
  }
  return parseScope(raw);
}

export function createRequestListener(
  deps: HttpDeps,
  defaultCompany: string,
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    void handle(deps, defaultCompany, req, res);
  };
}

async function handle(
  deps: HttpDeps,
  defaultCompany: string,
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
    const actor = actorFromRequest(req);
    const parts = url.pathname.split("/").filter(Boolean);

    if (method === "GET" && url.pathname === "/v1/context") {
      send(res, 200, deps.service.getContext(actor, queryScope(url, defaultCompany)));
      return;
    }
    if (method === "GET" && url.pathname === "/v1/active-directives") {
      send(res, 200, { items: deps.service.getActiveDirectives(actor, queryScope(url, defaultCompany)) });
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
    if (method === "POST" && url.pathname === "/v1/directives") {
      const body = await readBody(req);
      send(res, 201, deps.service.createDirective(actor, body));
      return;
    }
    if (method === "POST" && url.pathname === "/v1/proposals") {
      const body = await readBody(req);
      send(res, 201, deps.service.submitProposal(actor, body));
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
        send(res, 201, deps.service.createVersion(actor, id, await readBody(req)));
        return;
      }
      if (action === "supersede") {
        send(res, 201, deps.service.supersede(actor, id, await readBody(req)));
        return;
      }
      if (action === "expire") {
        send(res, 200, deps.service.expire(actor, id, await readBody(req)));
        return;
      }
      if (action === "activate") {
        send(res, 200, deps.service.activate(actor, id));
        return;
      }
      if (action === "deactivate") {
        send(res, 200, deps.service.deactivate(actor, id));
        return;
      }
    }
    if (parts[0] === "v1" && parts[1] === "proposals" && parts[2] && parts[3] === "reject" && method === "POST") {
      send(res, 200, deps.service.rejectProposal(actor, parts[2]));
      return;
    }

    send(res, 404, { error: "not_found", message: "route not found" });
  } catch (err) {
    sendError(res, err, deps.logger);
  }
}
