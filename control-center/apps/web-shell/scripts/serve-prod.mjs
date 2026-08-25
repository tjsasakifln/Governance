#!/usr/bin/env node
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(fileURLToPath(new URL("../dist", import.meta.url)));
const host = process.env.HOST ?? "0.0.0.0";
const port = Number.parseInt(process.env.PORT ?? "8080", 10);
const REQUIRED_RUNTIME_BASELINE_SHA = "64ece7d38abacd3adeaa02735b4f22af66caab0f";
const FULL_GIT_SHA = /^[0-9a-f]{40}$/;

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

export function runtimeIdentityFromEnv(env, service = "control-center-web") {
  const candidate = String(env.CC_RELEASE_SHA ?? "").trim();
  const releaseSha = FULL_GIT_SHA.test(candidate) ? candidate : null;
  const productionRequired = [env.CONTROL_CENTER_ENV, env.NODE_ENV]
    .some((value) => String(value ?? "").trim().toLowerCase() === "production");
  return {
    schema_version: "control-center.runtime-identity.v1",
    service,
    release_sha: releaseSha,
    required_baseline_sha: REQUIRED_RUNTIME_BASELINE_SHA,
    release_status: releaseSha === null ? "UNVERIFIED" : "PINNED",
    production_required: productionRequired,
  };
}

function configFromEnv(env) {
  return {
    contextUpstream: String(env.CC_CONTEXT_UPSTREAM ?? "").replace(/\/+$/, ""),
    actorId: String(env.CC_ACTOR_ID ?? "").trim(),
    actorKind: String(env.CC_ACTOR_KIND ?? "").trim(),
    runtimeIdentity: runtimeIdentityFromEnv(env),
  };
}

function copyActorHeaders(req, config) {
  const headers = { accept: "application/json" };
  const contentType = req.headers["content-type"];
  if (typeof contentType === "string" && contentType.trim()) {
    headers["content-type"] = contentType;
  }
  // Browser-supplied actor headers are never trusted. Production injects the
  // configured founder identity at this server-side hop.
  if (config.actorId) headers["x-actor-id"] = config.actorId;
  if (config.actorKind) headers["x-actor-kind"] = config.actorKind;
  return headers;
}

export function injectIdentity(html, config) {
  let next = html;
  if (config.actorId) {
    next = next.replace(/name="cc-actor-id" content="[^"]*"/, `name="cc-actor-id" content="${config.actorId}"`);
  }
  if (config.actorKind) {
    next = next.replace(/name="cc-actor-kind" content="[^"]*"/, `name="cc-actor-kind" content="${config.actorKind}"`);
  }
  const releaseSha = config.runtimeIdentity.release_sha;
  next = next.replace(/name="cc-release-sha" content="[^"]*"/, `name="cc-release-sha" content="${releaseSha ?? ""}"`);
  return next;
}

function readProxyBody(req, limit = 64 * 1024) {
  if (req.method === "GET" || req.method === "HEAD") return Promise.resolve(undefined);
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let rejected = false;
    req.on("data", (chunk) => {
      if (rejected) return;
      size += chunk.length;
      if (size > limit) {
        rejected = true;
        chunks.length = 0;
        reject(new Error("proxy_request_too_large"));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!rejected) resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });
}

export function createProductionServer(env = process.env) {
  const config = configFromEnv(env);
  return createServer((req, res) => {
    applySecurityHeaders(res);
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
    if (config.contextUpstream && url.pathname.startsWith("/v1/")) {
      void readProxyBody(req)
        .then((body) => fetch(`${config.contextUpstream}${url.pathname}${url.search}`, {
          method: req.method,
          headers: {
            ...copyActorHeaders(req, config),
            ...(typeof req.headers["idempotency-key"] === "string"
              ? { "idempotency-key": req.headers["idempotency-key"] }
              : {}),
          },
          ...(body === undefined ? {} : { body }),
        }))
        .then(async (upstream) => {
          const body = Buffer.from(await upstream.arrayBuffer());
          res.statusCode = upstream.status;
          res.setHeader("content-type", upstream.headers.get("content-type") ?? "application/json");
          res.end(body);
        })
        .catch((err) => {
          const tooLarge = err instanceof Error && err.message === "proxy_request_too_large";
          res.statusCode = tooLarge ? 413 : 502;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: tooLarge ? "request_too_large" : "context_upstream_unavailable" }));
        });
      return;
    }
    if (req.method === "GET" && url.pathname === "/healthz") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: true, service: "control-center-web" }));
      return;
    }
    if (req.method === "GET" && url.pathname === "/runtime-identity") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      res.end(JSON.stringify(config.runtimeIdentity));
      return;
    }
    if (req.method === "GET" && url.pathname === "/ready") {
      const ready = !config.runtimeIdentity.production_required
        || config.runtimeIdentity.release_status === "PINNED";
      res.statusCode = ready ? 200 : 503;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({
        ready,
        service: "control-center-web",
        release_sha: config.runtimeIdentity.release_sha,
        release_status: config.runtimeIdentity.release_status,
      }));
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
        body = Buffer.from(injectIdentity(body.toString("utf8"), config));
      }
      res.statusCode = 200;
      res.setHeader("content-type", type);
      res.end(body);
    } catch {
      res.statusCode = 404;
      res.end("not found");
    }
  });
}

export const server = createProductionServer();

const isMain =
  Boolean(process.argv[1]) && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  server.listen(port, host);
}
