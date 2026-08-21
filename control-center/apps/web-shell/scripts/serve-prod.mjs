#!/usr/bin/env node
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../dist", import.meta.url)));
const host = process.env.HOST ?? "0.0.0.0";
const port = Number.parseInt(process.env.PORT ?? "8080", 10);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
};

const contextUpstream = (process.env.CC_CONTEXT_UPSTREAM ?? "").replace(/\/+$/, "");

function copyActorHeaders(req) {
  const headers = { accept: "application/json" };
  for (const name of ["x-actor-id", "x-actor-kind", "content-type"]) {
    const value = req.headers[name];
    if (typeof value === "string" && value.trim()) {
      headers[name] = value;
    }
  }
  return headers;
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
  if (contextUpstream && url.pathname.startsWith("/v1/")) {
    void fetch(`${contextUpstream}${url.pathname}${url.search}`, {
      method: req.method,
      headers: copyActorHeaders(req),
    })
      .then(async (upstream) => {
        const body = Buffer.from(await upstream.arrayBuffer());
        res.statusCode = upstream.status;
        res.setHeader("content-type", upstream.headers.get("content-type") ?? "application/json");
        res.end(body);
      })
      .catch(() => {
        res.statusCode = 502;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: "context_upstream_unavailable" }));
      });
    return;
  }
  if (req.method === "GET" && (url.pathname === "/healthz" || url.pathname === "/ready")) {
    res.statusCode = 200;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: true, ready: true, service: "control-center-web" }));
    return;
  }
  const rel = url.pathname === "/" ? "/index.html" : url.pathname;
  const candidate = normalize(join(root, rel));
  if (!candidate.startsWith(root)) {
    res.statusCode = 403;
    res.end("forbidden");
    return;
  }
  const file = existsSync(candidate) && statSync(candidate).isFile() ? candidate : join(root, "index.html");
  try {
    const body = readFileSync(file);
    res.statusCode = 200;
    res.setHeader("content-type", TYPES[extname(file)] ?? "application/octet-stream");
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end("not found");
  }
});

server.listen(port, host);
