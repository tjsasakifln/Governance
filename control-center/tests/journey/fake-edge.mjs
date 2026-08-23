/**
 * Stands in for Caddy AFTER Authelia has authenticated. It injects exactly the
 * Remote-* forward-auth headers the production edge injects, and nothing else.
 * This does not bypass Authelia: production still enforces two_factor. It
 * reproduces the contract downstream of it so the journey can be driven.
 */
import { createServer } from "node:http";
import { request as httpRequest } from "node:http";

const PORT = Number(process.env.PORT || 8096);
const UPSTREAM_HOST = "127.0.0.1";
const UPSTREAM_PORT = Number(process.env.UPSTREAM_PORT || 8098);
const GROUPS = process.env.EDGE_GROUPS || "operators";

createServer((req, res) => {
  const headers = { ...req.headers };
  // Strip anything a client might have tried to send, then set our own.
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase().startsWith("remote-")) delete headers[k];
  }
  headers["remote-user"] = "founder";
  headers["remote-groups"] = GROUPS;
  headers["remote-name"] = "Founder";
  headers["remote-email"] = "founder@confenge.invalid";
  headers.host = `${UPSTREAM_HOST}:${UPSTREAM_PORT}`;
  const up = httpRequest(
    { host: UPSTREAM_HOST, port: UPSTREAM_PORT, method: req.method, path: req.url, headers },
    (r) => { res.writeHead(r.statusCode || 502, r.headers); r.pipe(res); },
  );
  up.on("error", (e) => { res.writeHead(502, { "content-type": "application/json" }); res.end(JSON.stringify({ code: "edge_upstream_error", message: e.message })); });
  req.pipe(up);
}).listen(PORT, "127.0.0.1", () => console.log(`fake-edge on ${PORT} -> ${UPSTREAM_PORT} groups=${GROUPS}`));
