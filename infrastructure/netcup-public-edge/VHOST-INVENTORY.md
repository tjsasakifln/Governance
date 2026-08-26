# Coexistence inventory and protected surface

Inventory date: 2026-08-26. Sources read before implementation:

- `control-center/deploy/PRODUCTION-RUNBOOK.md`;
- `control-center/security/docs/production-edge/DNS-ACME-HANDOFF.md`;
- every tracked NGINX/Caddy/Compose listener in Governance main.

## Existing public edge

| Identity | Tracked/live authority | Host listener | Upstream | This pack |
| --- | --- | --- | --- | --- |
| `api.confenge.com.br` | existing host vhost; template intentionally not owned by Governance | host NGINX 80/443 | Warmbly inbound/application plane | never reads, writes, enables or restores it |
| `ops.confenge.com.br` | `control-center/deploy/nginx/conf.d/ops.confenge.com.br.conf` | host NGINX 443 | `127.0.0.1:18080` Caddy | protected, byte-unchanged |
| `auth.ops.confenge.com.br` | `control-center/deploy/nginx/conf.d/auth.ops.confenge.com.br.conf` | host NGINX 443 | `127.0.0.1:18080` Caddy/Authelia | protected, byte-unchanged |
| MCP | private Control Center contract | no public hostname/listener | private network/loopback + bearer | never published |

Caddy's only host publications are `127.0.0.1:18080` and optional
`127.0.0.1:18443`. It does not own public ACME and must never bind host 80/443.
The rehearsal ports `28080/28443` are non-production. Datastores have no host
publication.

## New, inert edge

| Identity | Listener when explicitly enabled | Upstream/content | Collision decision |
| --- | --- | --- | --- |
| `confenge.com.br` | existing host NGINX 80/443 | `/opt/confenge-web/current/_site`; explicit dynamic routes only to `127.0.0.1:18100` | exact `server_name`; no default/wildcard |
| `www.confenge.com.br` | existing host NGINX 80/443 | 301 to `https://confenge.com.br$request_uri` | exact `server_name`; single hop |

Port `18100` does not occur in tracked production/rehearsal listeners. The pack
does not bind it; it only declares it as a loopback upstream. No new container,
database, Docker network, Caddy site or systemd runtime is part of this PR.

## Isolation evidence

- New executable NGINX files contain only the apex and www exact names.
- The installer writes only new files under
  `/etc/nginx/confenge-public-edge/` and, during an explicit activation, one
  exact link named `confenge.com.br.conf` in the configured NGINX include dir.
- Before and after each install/switch, all NGINX files containing the protected
  api/ops/auth identities are hashed; drift aborts the operation.
- Normal rollback removes/restores only the new site and release symlinks. It
  never expands the whole NGINX backup over co-resident configuration.
- Tests reject wildcard/default servers, public MCP, Caddy/Compose 80/443,
  Control Center database/network changes and modifications to tracked
  ops/auth templates.

## Coexistence risks

1. **Shared NGINX process:** a syntax error can block every reload. Mitigation:
   full fixture configtest, host `nginx -t` before every reload, and automatic
   symlink restoration on failure.
2. **Shared certificates/renewal timer:** a global hook could disrupt peers.
   Mitigation: this pack requests only cert-name `confenge.com.br`; its hook
   performs only `nginx -t` then reload and never edits another lineage.
3. **Resource pressure:** static releases, logs and a private runtime share disk
   and memory with Control Center/Warmbly. Mitigation: disk thresholds,
   logrotate and no runtime unit in this PR.
4. **Port collision:** an untracked host process could already use `18100`.
   Mitigation: cutover preflight checks `ss`; runtime must bind loopback only.
5. **Header/redirect drift:** copying Netlify rules into Governance would create
   two truths. Mitigation: required release includes and activation validation;
   Governance contains no production application rule set.
6. **HSTS blast radius:** current `includeSubDomains; preload` affects sibling
   hosts. Mitigation: the exact current policy is a release gate; this PR neither
   broadens nor removes it. Any future scope change requires a separate ADR.
7. **DNS/TLS asymmetry:** apex and www may change at different times.
   Mitigation: same SAN lineage, same vhost activation, explicit TTL preflight
   and single-hop www checks before declaring live.
