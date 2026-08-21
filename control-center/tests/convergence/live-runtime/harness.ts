import { createServer, type Server } from "node:http";
import { createPersistence, type Persistence } from "../../../persistence/src/index.js";
import { startIsolatedTestPostgres, type TestPostgres } from "../../../persistence/tests/helpers/postgres.js";
import {
  createContextService,
  createPostgresStoreFromPool,
  createRequestListener,
  cryptoIds,
  frozenClock,
  silentLogger,
  type ContextService,
} from "../../../services/context/src/index.ts";
import { createHttpContextApi } from "../../../services/mcp/src/context-http.ts";
import { createMcpRuntime, type McpRuntime } from "../../../services/mcp/src/server.ts";
import { serveHttp } from "../../../services/mcp/src/http.ts";
import { createLogger as createMcpLogger } from "../../../services/mcp/src/logging.ts";
import { AGENT, FOUNDER, LIVE_NOW, seedLiveCockpit, type SeededIds } from "./seed.ts";

export const MCP_TOKEN = "live-qa-mcp-token";
export const FOUNDER_ID = FOUNDER.id;

export interface LiveRuntime {
  pg: TestPostgres;
  persistence: Persistence;
  service: ContextService;
  seeded: SeededIds;
  contextBaseUrl: string;
  mcpBaseUrl: string;
  mcp: McpRuntime;
  founderHeaders: { "x-actor-id": string; "x-actor-kind": string };
  agentHeaders: { "x-actor-id": string; "x-actor-kind": string };
  stop: () => Promise<void>;
}

function listen(server: Server, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve(port);
    });
  });
}

export async function mcpRpc(
  runtime: McpRuntime,
  method: string,
  params: unknown,
  extras?: { authorization?: string },
): Promise<Record<string, unknown>> {
  const line = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  const raw = await runtime.handleRaw(line, extras);
  if (!raw) {
    return {};
  }
  return JSON.parse(raw) as Record<string, unknown>;
}

export async function mcpInitialize(runtime: McpRuntime): Promise<void> {
  await mcpRpc(runtime, "initialize", { protocolVersion: "2025-03-26" });
  await runtime.handleRaw(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
}

export async function mcpCall(
  runtime: McpRuntime,
  name: string,
  args: unknown,
  token = MCP_TOKEN,
): Promise<Record<string, unknown>> {
  return mcpRpc(
    runtime,
    "tools/call",
    { name, arguments: args },
    { authorization: `Bearer ${token}` },
  );
}

export async function bootLiveRuntime(): Promise<LiveRuntime> {
  const pg = await startIsolatedTestPostgres();
  const persistence = createPersistence(pg.pool);
  const store = await createPostgresStoreFromPool(pg.pool);
  const service = createContextService({
    store,
    clock: frozenClock(LIVE_NOW),
    ids: cryptoIds,
    founderActorId: FOUNDER_ID,
    logger: silentLogger,
    defaultScope: "company",
    repoDomains: { "tjsasakifln/Governance": "commercial", Governance: "commercial" },
  });
  const seeded = seedLiveCockpit(service);
  await service.flush();

  const contextServer = createServer(
    createRequestListener({ service, logger: silentLogger }),
  );
  const contextPort = await listen(contextServer, "127.0.0.1");
  const contextBaseUrl = `http://127.0.0.1:${contextPort}`;

  const api = createHttpContextApi({
    baseUrl: contextBaseUrl,
    actorId: AGENT.id,
    actorKind: AGENT.kind,
  });
  const mcpLogger = createMcpLogger({ write: () => undefined });
  const mcp = createMcpRuntime({
    context: api,
    authToken: MCP_TOKEN,
    logger: mcpLogger,
    secretsToRedact: [MCP_TOKEN],
  });
  const mcpServer = serveHttp(mcp, mcpLogger, { host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve) => {
    if (mcpServer.listening) {
      resolve();
      return;
    }
    mcpServer.once("listening", () => resolve());
  });
  const mcpAddr = mcpServer.address();
  const mcpPort = typeof mcpAddr === "object" && mcpAddr ? mcpAddr.port : 0;

  return {
    pg,
    persistence,
    service,
    seeded,
    contextBaseUrl,
    mcpBaseUrl: `http://127.0.0.1:${mcpPort}`,
    mcp,
    founderHeaders: { "x-actor-id": FOUNDER.id, "x-actor-kind": FOUNDER.kind },
    agentHeaders: { "x-actor-id": AGENT.id, "x-actor-kind": AGENT.kind },
    stop: async () => {
      await new Promise<void>((resolve) => contextServer.close(() => resolve()));
      await new Promise<void>((resolve) => mcpServer.close(() => resolve()));
      await pg.stop();
    },
  };
}

export async function httpJson(
  url: string,
  init: RequestInit = {},
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, init);
  const text = await response.text();
  let body: unknown = text;
  if (text.trim()) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = text;
    }
  }
  return { status: response.status, body };
}
