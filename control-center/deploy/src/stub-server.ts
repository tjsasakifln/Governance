import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { failClosed } from "./fail-closed.ts";
import { createLogger, type Logger } from "./log.ts";

export interface StubConfig {
  service: string;
  ready: boolean;
  host: string;
  port: number;
  now?: () => string;
  logger?: Logger;
}

export interface HealthBody {
  ok: boolean;
  live: boolean;
  service: string;
  source: string;
  observed_at: string;
  freshness_status: "fresh" | "stale";
}

export interface ReadyBody {
  ok: boolean;
  ready: boolean;
  service: string;
  source: string;
  observed_at: string;
  freshness_status: "fresh" | "stale";
  reason?: string;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.setHeader("content-length", Buffer.byteLength(payload).toString());
  res.end(payload);
}

export function parseReadyFlag(raw: string | undefined): boolean {
  if (raw === undefined || raw.trim() === "") {
    return true;
  }
  const v = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(v)) {
    return false;
  }
  failClosed("STUB_READY must be a boolean-like value");
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): StubConfig {
  const portRaw = env.PORT ?? "8080";
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    failClosed("PORT is invalid");
  }
  return {
    service: env.CONTROL_CENTER_STUB_SERVICE ?? "control-center-stub",
    ready: parseReadyFlag(env.STUB_READY),
    host: env.HOST ?? "127.0.0.1",
    port,
  };
}

export function createStubListener(config: StubConfig): (req: IncomingMessage, res: ServerResponse) => void {
  const now = config.now ?? (() => new Date().toISOString());
  const source = `control-center.deploy.stub.${config.service}`;
  return (req, res) => {
    const host = req.headers.host ?? "127.0.0.1";
    const url = new URL(req.url ?? "/", `http://${host}`);
    const method = req.method ?? "GET";
    const observed_at = now();
    if (method === "GET" && url.pathname === "/healthz") {
      const body: HealthBody = {
        ok: true,
        live: true,
        service: config.service,
        source,
        observed_at,
        freshness_status: "fresh",
      };
      json(res, 200, body);
      return;
    }
    if (method === "GET" && url.pathname === "/ready") {
      if (config.ready) {
        const body: ReadyBody = {
          ok: true,
          ready: true,
          service: config.service,
          source,
          observed_at,
          freshness_status: "fresh",
        };
        json(res, 200, body);
        return;
      }
      const body: ReadyBody = {
        ok: false,
        ready: false,
        service: config.service,
        source,
        observed_at,
        freshness_status: "stale",
        reason: "stub_not_ready",
      };
      json(res, 503, body);
      return;
    }
    json(res, 404, { error: "not_found", service: config.service });
  };
}

export function startStubServer(config: StubConfig): Server {
  const logger = config.logger ?? createLogger(`control-center-stub-${config.service}`);
  const server = createServer(createStubListener(config));
  server.listen(config.port, config.host, () => {
    logger.info("stub.listen", {
      service: config.service,
      host: config.host,
      port: config.port,
      ready: config.ready,
    });
  });
  return server;
}
