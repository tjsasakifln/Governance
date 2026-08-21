# Production-edge pack (local overlay)

Frozen hop:

```
Internet -> host nginx TLS :443 -> 127.0.0.1:18080 Caddy
  -> Authelia forward_auth /api/authz/forward-auth
  -> web:8080 and context:8080
```

Auth portal: `auth.ops.confenge.com.br` through the same nginx -> loopback Caddy hop, then `authelia:9091`.

MCP is internal (ccnet/loopback), bearer token only, no Authelia cookie, no public DNS, no internet port.

The open reference `control-center/deploy/Caddyfile` (no `forward_auth`) is **not** the production pack.

This campaign does not apply DNS, certbot, nginx reload, or `compose up` of project `confenge-control-center`. Isolated rehearsal uses `--project-name cc-edge-rehearsal` and high ports only.
