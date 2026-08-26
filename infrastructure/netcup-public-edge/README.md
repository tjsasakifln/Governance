# Netcup public edge — prepared, not live

State: `NETCUP_PUBLIC_EDGE_PREPARED / DNS_UNCHANGED / CERT_NOT_ASSUMED`

This pack prepares the existing Netcup VPS to receive `confenge.com.br` and
`www.confenge.com.br`. Installation is deliberately inert: it creates the
release layout, renders disabled NGINX configs, installs readiness/rollback
tools and runs the current `nginx -t`; it does not enable a site, reload NGINX,
request a certificate or touch DNS.

## Ownership boundary

Governance owns:

- NGINX server structure, static paths and the loopback upstream;
- TLS paths and ACME operational hooks;
- host hardening, installation, readiness and rollback;
- the reserved runtime endpoint `127.0.0.1:18100` (no service is created here).

The deployed web-cfg release owns the versioned
`confenge.http-host-contract-manifest/v1` and these generated outputs under its
`nginx/` directory:

| File | NGINX context | Application truth |
| --- | --- | --- |
| `manifest.json` | deployment validator | output SHA-256/byte bindings, state and architecture version |
| `contract.normalized.json` + `contract.sha256` | audit/validator | model derived by web-cfg from `_headers`, `_redirects` and `netlify.toml` |
| `headers.generated.conf` | NGINX `http` | request-URI maps for web-cfg-owned response headers |
| `redirects.generated.conf` | apex TLS `server` | ordered 301, 302, rewrite and 410 behavior |
| `locations.generated.conf` | apex TLS `server` | static resolution, errors, content types, cache and security headers |

`/etc/confenge/web/current` is a fixed symlink to
`/opt/confenge-web/current/nginx`. Switching the release therefore switches
both `_site` and the generated contract as one unit. Before a switch,
`validate-web-cfg-contract.py` verifies the manifest schema, architecture,
every output hash/size, normalized-contract hash, immutable file modes and the
Governance ownership boundary. NGINX parses the generated files only after a
successful configtest/reload. Governance references the generated HSTS map for
the `www` redirect; it does not duplicate the value.

The contemporary static host contract deliberately emits no dynamic proxy.
Any `proxy_pass` in this v1 generated pack is rejected. The loopback upstream
remains reserved for a separately reviewed portable-runtime release and route
contract; its absence keeps dynamic traffic fail-closed.

There is no generic proxy and no SPA fallback. Static resolution is
`$uri`, `$uri/`, `$uri.html`, then a real 404. Application 410 rules use the
custom 404 body while retaining status 410.

## Host preparation

Run from a certified Governance checkout as root:

```bash
infrastructure/netcup-public-edge/bin/install.sh
```

The default runtime port is `18100`. A different port requires an explicit
`--runtime-port` and is refused if this site is already enabled. The installer:

1. backs up `/etc/nginx`;
2. creates the least-privilege `confenge-deploy:confenge-web` account/group,
   with the login shell required by the web-cfg SSH release transport;
3. creates the web-cfg-compatible immutable layout under `/opt/confenge-web/`,
   including `incoming`, `releases`, `locks`, `evidence`, `state` and `shared`;
4. creates `/etc/confenge/web/` and the fixed snippet symlink;
5. installs disabled vhosts, proxy hardening, logrotate, Certbot deploy hook and
   host commands;
6. verifies protected vhost hashes and runs `nginx -t`;
7. exits without enabling or reloading NGINX.

Run it twice to verify idempotency. It does not invent a placeholder `current`
SHA; an existing deployed `current` symlink is preserved.

## Readiness

Before cutover, missing release/runtime/certificate signals are expected and
reported as pending rather than incidents:

```bash
/usr/local/sbin/confenge-web-readiness --state prepared
```

After controlled cutover, all signals are mandatory:

```bash
/usr/local/sbin/confenge-web-readiness --state live
```

Checks cover disk, active NGINX config, release/root symlink, the generated
contract manifest/hashes, loopback runtime, certificate presence/SAN/expiry and the origin web-cfg SHA in
`_site/.well-known/build-info.json`.

## No systemd runtime in this pack

No runtime or scheduler unit is created because Governance does not own the
web-cfg application process. A later runtime PR may add a disabled unit only
after its command, user, loopback bind, health contract and rollback are
versioned by web-cfg. Caddy is not involved and must remain off host 80/443.

See [VHOST-INVENTORY.md](VHOST-INVENTORY.md) and
[CUTOVER-RUNBOOK.md](CUTOVER-RUNBOOK.md) before any host action beyond inert
installation.
