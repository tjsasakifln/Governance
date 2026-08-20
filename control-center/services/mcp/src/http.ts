import http from "node:http";
import type { Logger } from "./logging.js";
import type { McpRuntime } from "./server.js";

export function serveHttp(
  runtime: McpRuntime,
  logger: Logger,
  options: { host: string; port: number },
): http.Server {
  const server = http.createServer((req, res) => {
    void handle(req, res);
  });

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (req.method === "GET" && req.url === "/healthz") {
      json(res, 200, { ok: true, service: "confenge-control-center-mcp" });
      return;
    }
    if (req.method !== "POST" || req.url !== "/mcp") {
      json(res, 404, { error: { code: "NOT_FOUND", message: "POST /mcp" } });
      return;
    }
    try {
      const body = await readBody(req);
      const authorization = header(req, "authorization");
      const reply = await runtime.handleRaw(body, { authorization });
      if (reply === null) {
        res.statusCode = 204;
        res.end();
        return;
      }
      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(reply);
    } catch (err) {
      const message = err instanceof Error ? err.message : "internal error";
      logger.error("mcp.http_error", { err: message });
      json(res, 500, { error: { code: "INTERNAL", message: "internal error" } });
    }
  }

  server.listen(options.port, options.host, () => {
    logger.info("mcp.listen", { transport: "http", host: options.host, port: options.port });
  });
  return server;
}

function header(req: http.IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  if (Array.isArray(value)) {
    const first = value[0];
    return first;
  }
  return value;
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer | string) => {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
