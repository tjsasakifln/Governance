#!/usr/bin/env node
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(fileURLToPath(new URL("../dist", import.meta.url)));
const host = process.env.HOST ?? "0.0.0.0";
const port = Number.parseInt(process.env.PORT ?? "8080", 10);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};

export const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin",
};

export function applySecurityHeaders(res) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    res.setHeader(name, value);
  }
}

const contextUpstream = (process.env.CC_CONTEXT_UPSTREAM ?? "").replace(/\/+$/, "");
const actorId = (process.env.CC_ACTOR_ID ?? "").trim();
const actorKind = (process.env.CC_ACTOR_KIND ?? "").trim();

function copyActorHeaders(req) {
  const headers = { accept: "application/json" };
  for (const name of ["x-actor-id", "x-actor-kind", "content-type"]) {
    const value = req.headers[name];
    if (typeof value === "string" && value.trim()) {
      headers[name] = value;
    }
  }
  if (!headers["x-actor-id"] && actorId) headers["x-actor-id"] = actorId;
  if (!headers["x-actor-kind"] && actorKind) headers["x-actor-kind"] = actorKind;
  return headers;
}

function injectIdentity(html) {
  let next = html;
  if (actorId) {
    next = next.replace(/name="cc-actor-id" content="[^"]*"/, `name="cc-actor-id" content="${actorId}"`);
  }
  if (actorKind) {
    next = next.replace(/name="cc-actor-kind" content="[^"]*"/, `name="cc-actor-kind" content="${actorKind}"`);
  }
  return next;
}

export const server = createServer((req, res) => {
  applySecurityHeaders(res);
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
    let body = readFileSync(file);
    const type = TYPES[extname(file)] ?? "application/octet-stream";
    if (extname(file) === ".html" || file.endsWith("index.html")) {
      body = Buffer.from(injectIdentity(body.toString("utf8")));
    }
    res.statusCode = 200;
    res.setHeader("content-type", type);
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end("not found");
  }
});

const isMain =
  Boolean(process.argv[1]) && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  server.listen(port, host);
}
