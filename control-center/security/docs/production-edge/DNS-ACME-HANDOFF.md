# DNS / ACME handoff (not executed in this campaign)

This file is a human gate. Do **not** create DNS records, run certbot, reload host nginx, or claim `DEPLOYED` from this campaign.

## Records

Create (later, human):

| Name | Type | Target |
| --- | --- | --- |
| `ops.confenge.com.br` | A | Netcup host public IPv4 |
| `auth.ops.confenge.com.br` | A | Netcup host public IPv4 |

Do **not** create:

- `mcp.confenge.com.br` (any type)
- any public record that points MCP at the internet

`mcp` stays on `ccnet` / loopback with its own bearer token.

## ACME / nginx order (controlled apply, later)

1. Install vhost templates from `control-center/deploy/nginx/` **without** replacing Warmbly or `api.confenge.com.br`.
2. `nginx -t` (configtest) on the host.
3. Publish DNS for `ops` and `auth` only.
4. Issue certificates with certbot (host nginx remains ACME owner). Caddy does not issue ACME.
5. Controlled `nginx` reload — not a blanket restart of unrelated vhosts.

Never invert this order. Never let Caddy bind host `80`/`443`.

## Status

This campaign stops at `READY_FOR_CONTROLLED_APPLY`. Secrets, DNS, and certificates remain explicit human gates.
