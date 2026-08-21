# Internal production evidence — 2026-08-21

Campaign `CONFENGE-CONTROL-CENTER-INTERNAL-PRODUCTION-LAUNCH-01`.

**FINAL_VERDICT=INTERNAL_PRODUCTION_LIVE**

Control Center is deployed, edge-authenticated with founder MFA enrolled, persistent, and serving real cockpit HTTP. `/intranet` is a live 302 to ops. MFA was not disabled.

## SHA

- `PRE_RELEASE_SHA` / `RELEASE_SHA` / `DEPLOYED_SHA`: `3d5e21c344be95549cca1e9f0b5073a8efb9ff08`
- Host checkout remains that freeze SHA. Origin `main` advanced to `b57ff508f865375825c0e104a46f10c05dea719e` via PR #41 (founder actor compose wiring). Runtime web already has the equivalent host overlay `/etc/confenge/control-center/docker-compose.web-actor.yml`. This evidence commit does not change `DEPLOYED_SHA`.
- Governance PR #8 remains open and was not absorbed.

CI on the freeze SHA: control-center, control-center-image-scan, commercial-authority all **success**. PR #41 CI was green before merge.

## Topology

nginx `:443` → `127.0.0.1:18080` Caddy → Authelia `forward_auth` → web/context.

- Project `confenge-control-center` on host `v2202607385716487230` (`159.195.18.88`).
- Caddy loopback only (`18080`/`18443`). nginx still owns public 80/443.
- MCP private + bearer. No `mcp.confenge.com.br`.
- Postgres alias `cc-postgres`. Collector `CONTROL_CENTER_DATABASE_URL` host `cc-postgres`.
- Reserved IPs: Caddy `10.89.0.2`, MCP `10.89.0.6`, collector `10.89.0.7`.
- Collector starts without `Dynamic require of events`.

## Auth / MFA

- Unauthenticated `https://ops.confenge.com.br/` → 302 to Authelia.
- `https://auth.ops.confenge.com.br/` 200, TLS Let's Encrypt through 2026-11-19.
- Operators require 2FA. Enrolled: `totp_configurations=1`, `webauthn_credentials=1`.
- Authentication logs (counts only): `1FA/false=2`, `1FA/true=3`, `TOTP/true=3`. `totp_history=4`.
- Authelia session after 1FA+TOTP: cookie `authelia_session`. `GET https://ops.confenge.com.br/` HTTP **200** `text/html` with `cc-actor-*` meta (kind `human`, 32-hex founder id, not `human:operator`). Does not redirect to Authelia.
- Required `/v1/*` replayed **twice** on that hop (nginx → Caddy → Authelia cookie + cockpit actor headers). All HTTP 200, none 404. Freshness ERROR/UNKNOWN left honest.
- `GET /v1/context?scope=repo:Governance` returns separate `facts` / `decisions` / `hypotheses` arrays, `scope=repo:Governance`.
- `OPS_HOST_AUTHENTICATED_AND_HEALTHY=true`. MFA was not disabled.
- Recover bootstrap password only from `/root/.confenge/control-center/bootstrap-operator-password` (mode 0600). Never git/logs.

## Data plane

- Migrations: `001_init`, `002_current_state`, `003_durable_operational_data_plane`.
- Governance bootstrap: 74 candidates, 0 unclassifiable; apply-1 inserted 74; apply-2 inserted 0 / skipped 74.
- Required `/v1/*` endpoints 200 with `scope=company` (attention also needs `horizon=today`). None 404.
- Directive smoke ids created; agent POST decision → 403 `agent_mutation_forbidden`.
- MCP `get_context` scopes: `company`, `repo:Governance` (no web-cfg), `repo:web-cfg` (no Governance leakage). `report_session_result` / `report_blocker` → AgentActivity ids in the JSON companion.

Collectors (honest):

| Source | Status | Freshness |
| --- | --- | --- |
| github | DONE | FRESH |
| infra | UNKNOWN | UNKNOWN (`missing_credentials` / allowlist) |
| pncp | DONE | ERROR (extra-cli timers failed; not flipped to FRESH) |
| warmbly | FAILED | ERROR (`missing_credentials`) |
| asaas | FAILED | ERROR (`missing_credentials`) |

## Durability

- Encrypted backup + restore to a **new** postgres volume: `same_content=true`, ciphertext ≠ plaintext. Backup kept under `/var/backups/confenge-control-center/encrypted/`.
- Restart of Control Center services only: all healthy; directives, AgentActivity, observations persist. Warmbly not restarted.

## Warmbly / API

- Warmbly SHA `93dd039d7b9b310458beff8a6bd8819a61da6399`, backend `92e98e3217ad…`.
- `/ready` live=true ready=true. `CONFENGE_AUTO_SEND_ENABLED=false`.
- `https://api.confenge.com.br/api/v1/webhooks/confenge/inbound/health` READY, `auto_send_enabled=false`.
- `WARMBLY_REGRESSION=false`. `ASAAS_MUTATIONS=0`. `COMMERCIAL_SENDS=0`.

## Intranet

Activated after `OPS_HOST_AUTHENTICATED_AND_HEALTHY=true`. web-cfg PR #218 merged as `bfbd4e16`.

- `https://confenge.com.br/intranet` → **302** `https://ops.confenge.com.br/` (not 301, not 200 proxy; `content-type: text/plain`).
- `x-robots-tag: noindex, nofollow`. `robots.txt` disallows `/intranet`. Sitemap count for intranet = 0.
- Splat: `/intranet/hoje` → 302 `https://ops.confenge.com.br/hoje`.
- Follow: intranet 302 → ops 302 Authelia → auth.ops 200.

## Images / rollback

Image IDs (sha256) for web/context/mcp/collector/postgres/caddy/authelia/nats/redis are in the JSON companion. Rollback point: redeploy freeze SHA `3d5e21c` with the production-edge compose files listed there; keep volumes; do not restore the drill backup over production; do not touch Warmbly.

Loopback: `ss -lntp` twice shows nginx on `:80`/`:443` and Caddy `127.0.0.1:18080`. Caddy `/healthz` is the public stub `{"status":"ok"}` (twice). Context `/ready` is `{"ready":true,"service":"control-center-context"}` twice. Public `/ready` on ops is 404 (`deny_ready_mcp`).

## Residuals

- Asaas read / Warmbly collector read BLOCKED_BY_SECRET (shown as ERROR, not FRESH)
- Infra allowlist UNKNOWN
- PNCP ERROR honest
- Codex MCP client NOT_TESTED_CLIENT_MISSING
