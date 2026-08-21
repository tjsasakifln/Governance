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

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
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
