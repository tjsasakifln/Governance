import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { pathnameOf } from "./http/allowlist.ts";
import type { WarmblyPayload } from "./contracts/warmbly-payload.ts";

export type RecordedCall = {
  method: string;
  path: string;
  url: string;
};

export type StubOptions = {
  payload: WarmblyPayload;
  hide?: string[];
  delayMs?: number;
  failStatus?: number;
  failAfter?: number;
  token?: string;
};

export type FixtureStub = {
  server: Server;
  url: string;
  calls: RecordedCall[];
  close: () => Promise<void>;
};

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function wrapData(value: unknown): { data: unknown } {
  if (value && typeof value === "object" && !Array.isArray(value) && "data" in value) {
    return value as { data: unknown };
  }
  return { data: value };
}

function json(res: ServerResponse, status: number, body: unknown, apiVersion = "v1"): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("API-Version", apiVersion);
  res.end(JSON.stringify(body));
}

function routeBody(payload: WarmblyPayload, pathname: string): unknown | undefined {
  switch (pathname) {
    case "/health":
      return payload.health ?? { status: "ok" };
    case "/v1/crm/pipelines":
      return payload.pipelines ?? [];
    case "/v1/crm/deals":
      return payload.deals ?? { data: [], pagination: { has_more: false } };
    case "/v1/crm/deals/summary":
      return payload.deals_summary ?? { total: 0, open_count: 0, open_value: 0, currency: "BRL" };
    case "/v1/crm/deals/search":
      return payload.deals ?? { data: [], pagination: { has_more: false } };
    case "/v1/crm/tasks":
      return payload.tasks ?? { data: [], pagination: { has_more: false } };
    case "/v1/crm/tasks/search":
      return payload.tasks_search ?? payload.tasks ?? { data: [], pagination: { has_more: false } };
    case "/v1/crm/tasks/summary":
      return payload.tasks_summary ?? { total: 0, overdue_count: 0 };
    case "/v1/contacts/search":
      return payload.contacts ?? { data: [], pagination: { has_more: false } };
    case "/v1/campaigns":
      return payload.campaigns ?? { data: [], pagination: { has_more: false } };
    case "/v1/campaigns-overview":
      return payload.campaigns_overview ?? { total: 0, active: 0 };
    case "/v1/unibox/overview":
      return payload.unibox_overview ?? { unread: 0, awaiting_reply: 0 };
    case "/v1/confenge/status":
      return payload.confenge_status ?? { enabled: false };
    case "/v1/confenge/ops/health":
      return payload.confenge_ops_health ?? { data: { computed_at: new Date().toISOString() } };
    case "/v1/confenge/attention":
      return payload.confenge_attention ?? { data: [] };
    case "/v1/confenge/today":
      return payload.confenge_today ?? { data: { summary: { total: 0 }, actions: [] } };
    case "/v1/confenge/inbound":
      return payload.confenge_inbound ?? { data: [] };
    case "/v1/confenge/intel/scoreboard":
      return payload.confenge_intel_scoreboard === undefined
        ? undefined
        : wrapData(payload.confenge_intel_scoreboard);
    case "/v1/confenge/intel/executive":
      return payload.confenge_intel_executive === undefined
        ? undefined
        : wrapData(payload.confenge_intel_executive);
    case "/v1/confenge/intel/exceptions":
      return payload.confenge_intel_exceptions === undefined
        ? undefined
        : wrapData(payload.confenge_intel_exceptions);
    case "/v1/confenge/intel/organic-scoreboard":
      return payload.confenge_intel_organic_scoreboard === undefined
        ? undefined
        : wrapData(payload.confenge_intel_organic_scoreboard);
    default:
      return undefined;
  }
}

export async function startFixtureStub(opts: StubOptions): Promise<FixtureStub> {
  const calls: RecordedCall[] = [];
  const hide = new Set(opts.hide ?? []);
  let hits = 0;
  const stateChanged = { value: false };

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const method = (req.method ?? "GET").toUpperCase();
    const url = req.url ?? "/";
    const path = pathnameOf(url);
    calls.push({ method, path, url });
    hits += 1;

    const finish = (): void => {
      if (opts.token) {
        const auth = req.headers.authorization ?? "";
        if (auth !== `Bearer ${opts.token}`) {
          json(res, 401, { error: "unauthorized" });
          return;
        }
      }
      if (method === "PUT" || method === "PATCH" || method === "DELETE") {
        json(res, 405, { error: "mutated" });
        return;
      }
      if (method === "POST") {
        void readBody(req).then(() => {
          if (
            path === "/v1/contacts/search" ||
            path === "/v1/crm/deals/search" ||
            path === "/v1/crm/deals/summary" ||
            path === "/v1/crm/tasks/search" ||
            path === "/v1/crm/tasks/summary"
          ) {
            serveRead();
            return;
          }
          stateChanged.value = true;
          json(res, 201, { error: "stub-would-mutate", path });
        });
        return;
      }
      serveRead();
    };

    const serveRead = (): void => {
      if (typeof opts.failStatus === "number" && hits > (opts.failAfter ?? 0)) {
        json(res, opts.failStatus, { error: "injected" });
        return;
      }
      if (hide.has(path) || hide.has(`${method} ${path}`)) {
        json(res, 404, { error: "CONFENGE outreach is not enabled on this server" });
        return;
      }
      const body = routeBody(opts.payload, path);
      if (body === undefined) {
        json(res, 404, { error: "not found", path });
        return;
      }
      json(res, 200, body);
    };

    if (opts.delayMs && opts.delayMs > 0) {
      setTimeout(finish, opts.delayMs);
    } else {
      finish();
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("stub server failed to bind");
  }
  const url = `http://127.0.0.1:${addr.port}`;
  return {
    server,
    url,
    calls,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

export function stubMutated(calls: RecordedCall[]): boolean {
  return calls.some((c) => {
    if (c.method === "PUT" || c.method === "PATCH" || c.method === "DELETE") {
      return true;
    }
    if (c.method !== "POST") {
      return false;
    }
    return (
      c.path !== "/v1/contacts/search" &&
      c.path !== "/v1/crm/deals/search" &&
      c.path !== "/v1/crm/deals/summary" &&
      c.path !== "/v1/crm/tasks/search" &&
      c.path !== "/v1/crm/tasks/summary"
    );
  });
}
