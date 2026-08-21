import { createServer } from "node:http";
import { runCollectors } from "./run.ts";

function listenPort(env: NodeJS.ProcessEnv): number {
  const raw = env.PORT ?? "8080";
  const port = Number.parseInt(raw, 10);
  return Number.isInteger(port) ? port : 8080;
}

export function startCollectorServer(env: NodeJS.ProcessEnv = process.env) {
  const host = (env.HOST ?? "127.0.0.1").trim() || "127.0.0.1";
  const port = listenPort(env);
  let lastRun: unknown = null;
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
    if (req.method === "GET" && url.pathname === "/healthz") {
      json(res, 200, { ok: true, service: "control-center-collector" });
      return;
    }
    if (req.method === "GET" && url.pathname === "/ready") {
      json(res, 200, { ready: true, service: "control-center-collector" });
      return;
    }
    if (req.method === "POST" && url.pathname === "/run") {
      void runCollectors({ env, log: () => undefined }).then((result) => {
        lastRun = result;
        json(res, 200, result);
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/last") {
      json(res, 200, lastRun ?? { collectors: [] });
      return;
    }
    json(res, 404, { error: "not_found" });
  });
  server.listen(port, host);
  return server;
}

function json(res: import("node:http").ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

if (import.meta.url.endsWith("server.ts") || import.meta.url.endsWith("server.js")) {
  startCollectorServer();
}
