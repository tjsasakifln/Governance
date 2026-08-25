# Production runbook — Confenge Control Center (internal)

Canonical operational source for **internal production** of the Control Center on Netcup.

This file supersedes apply/refuse language in `RUNBOOK.md`, `README.md`, and `overlays/production-edge/README.md` from earlier waves. Those files remain useful for the stub pack CLI (backup encrypt/verify/retain, disk-guard) and isolated rehearsal.

Internal clocks are UTC. Display times also use `America/Sao_Paulo`.

## Frozen hop

```
Internet
  → host nginx :443 (ACME/certbot owner of 80/443)
    → 127.0.0.1:18080 Caddy (loopback only)
      → Authelia forward_auth /api/authz/forward-auth
        → web:8080 (cockpit) and context:8080 (/v1/*)
```

Auth portal: `https://auth.ops.confenge.com.br/` through the same nginx → loopback Caddy hop, then `authelia:9091`. Operators require 2FA (TOTP or WebAuthn). Password-reset bypass is disabled.

MCP is **private + bearer**, fail-closed, unpublished. Do not create `mcp.confenge.com.br`.

Datastores (Postgres, Redis, NATS) and Authelia internals stay on `cc_internal` (`internal: true`). Postgres is reachable as hostname **`cc-postgres`**. Collector `CONTROL_CENTER_DATABASE_URL` must use `cc-postgres`, never `postgres` (Warmbly's hostname on the optional Warmbly network).

Caddy never binds host `:80`/`:443` and never issues public ACME.

## Project and files

- Compose project: `confenge-control-center`
- Canonical overlay: `control-center/deploy/overlays/production-edge/docker-compose.production-edge.yml`
- Caddyfile: `overlays/production-edge/Caddyfile` (must contain `forward_auth`; the open `deploy/Caddyfile` is not this pack)
- Optional read-only collector join: `docker-compose.warmbly-collector.override.yml`
- Warmbly human-gate and draft-review join: `docker-compose.warmbly-human-gate.override.yml`
- Nginx vhost templates: `control-center/deploy/nginx/`
- Secrets contract: `control-center/security/production/secrets/manifest.json` + `generate-local.sh`
- Host secrets directory: `/etc/confenge/control-center/secrets` (dir `0700`, files `0600`)
- Bootstrap operator password path (if generated on host): `/root/.confenge/control-center/bootstrap-operator-password` (mode `0600`)

The stub pack in `control-center/deploy/docker-compose.yml` still refuses `CONTROL_CENTER_APPLY_PRODUCTION=true`. Do not apply the stub pack.

## DNS

Cloudflare, DNS-only (not proxied):

| Type | Hostname | Value | Proxy | TTL |
| --- | --- | --- | --- | --- |
| A | `ops.confenge.com.br` | `159.195.18.88` | DNS-only | 300 |
| A | `auth.ops.confenge.com.br` | `159.195.18.88` | DNS-only | 300 |

Do not create `mcp.confenge.com.br`. Do not invent AAAA.

## TLS

Host nginx/certbot remains ACME owner. Certificate live paths:

- `/etc/letsencrypt/live/ops.confenge.com.br/`
- `/etc/letsencrypt/live/auth.ops.confenge.com.br/`

Caddy uses `tls internal` on optional `127.0.0.1:18443` only.

## Secrets

For a first installation only, generate on the host from the shipped manifest
(never git, never logs, never URLs):

```bash
# If CC_OPERATOR_PASSWORD is unset, generate-local.sh may read:
#   /root/.confenge/control-center/bootstrap-operator-password
umask 077
/opt/confenge-control-center/control-center/security/production/secrets/generate-local.sh \
  /etc/confenge/control-center/secrets
```

Do **not** rerun `generate-local.sh` on an existing installation: it rotates the
database, Authelia session/storage, MCP and backup material. Names must match
`manifest.json`. Recover the operator password **only** from the bootstrap path
above.

The Warmbly gate uses a separate API key. Create it through Warmbly's audited
`POST /v1/api-keys` as the configured loopback operator after the Warmbly release
is healthy. Its exact permissions are decimal `196`:

```
READ_CONTACTS (4) | WRITE_CAMPAIGNS (64) | WRITE_CONTACTS (128)
```

It must not contain `SEND_CAMPAIGNS` (`16384`), API-key management, bulk, inbox,
CRM, or email-account permissions. Use name `control-center-human-gate`, a finite
expiry/rotation date, and keep the one-time `secret` response in a mode-0600
temporary file. Install only that file, without passing the secret in argv or
environment:

```bash
/opt/confenge-control-center/control-center/security/production/secrets/install-warmbly-operator-token.sh \
  /root/.confenge/control-center/warmbly-human-gate.one-time \
  /etc/confenge/control-center/secrets \
  1000:1000
```

The numeric owner is the `node` runtime UID/GID declared by the Context image;
without it a local Compose secret remains a root-owned bind mount and the service
must fail closed. The installer is atomic, keeps mode `0600`, does not print the
value and does not touch any other secret. Remove the one-time source after
the Context container can read the mount and `/v1/me` proves `permissions=196` and
the absence of `send_campaigns`. Never reuse the collector's broader read key.

On an upgraded installation, preserve the current password hash and group
membership. The boundary is deliberate: `operators` may APPROVE and therefore
queue a message; `admins` may run the explicit reconciliation repair. If a
future release changes either group, back up `users.yml`, validate YAML and
restart only Authelia. Never regenerate the secret pack to make a group change.

## Ordered Warmbly prerequisite

Merge and deploy the Warmbly approval-scheduling API before the Control Center
release. Apply migrations through `000122_confenge_cohort_selection` (including
`000121_confenge_human_gate_scheduling`) with the normal Warmbly deploy path;
verify schema is `122`, `/ready` is ready,
`POST /v1/confenge/cohorts/{cohort}/candidates/{candidate}/review`
schedules an APPROVE, and `POST /v1/confenge/cohorts/reconcile-approved` exists.
Verify all of
these remain false/true as shown:

```
CONFENGE_AUTO_SEND_ENABLED=false
CONFENGE_GREEN_AUTORUN_ENABLED=false
CONFENGE_REQUIRE_HUMAN_APPROVAL=true
```

Keep the dispatch kill switch engaged for deployment and sandbox verification.
The migration is additive. Do not expose the Control Center contract until this
prerequisite passes. The same least-privilege human-gate credential and private
Context-to-Warmbly network path serve review: mask `196` already contains the
required contact read/write permissions and still contains no send permission.
Do not create a browser token or expose the credential to `web`.

## Deploy (production-edge)

Before every release, record the current Git SHA and image IDs for `context`,
`web` and `mcp`; those are the rollback point. Then fast-forward the certified
release at `/opt/confenge-control-center`. The Warmbly connector is compiled
inside the Context image, so every connector change must rebuild `context`.

```bash
git -C /opt/confenge-control-center pull --ff-only
cd /opt/confenge-control-center/control-center/deploy/overlays/production-edge
set -a
source /etc/confenge/control-center/secrets/.env
set +a
export CC_SECRET_DIR=/etc/confenge/control-center/secrets
export CC_RELEASE_SHA=<certified-git-sha>

# Build and replace both artifacts touched by the release. The connector travels
# in Context; updating only web leaves the old server contract in production.
docker compose -p confenge-control-center \
  -f docker-compose.production-edge.yml \
  -f docker-compose.warmbly-human-gate.override.yml \
  build context web
docker compose -p confenge-control-center \
  -f docker-compose.production-edge.yml \
  -f docker-compose.warmbly-human-gate.override.yml \
  up -d context web

# Mandatory identity gate: proves baseline ancestry and reconciles repository
# SHA -> image label/ID -> container env -> each live HTTP response. Save this
# output beside the release record; health alone is not release evidence.
set -o pipefail
./verify-release.sh "$CC_RELEASE_SHA" context web | tee \
  "release-attestation-${CC_RELEASE_SHA}.log"
```

For a first installation only, use the full bootstrap sequence instead of the
two-service replacement above:

```bash
# 1. datastores
docker compose -f docker-compose.production-edge.yml up -d postgres redis nats
# confirm alias cc-postgres on cc_internal
# 2. migrations (schema control_center): 001_init, 002_current_state, 003_durable_operational_data_plane, 004_operator_actions
# 3. Authelia (own DB/role, Redis sessions, default deny, operators require 2FA)
docker compose -f docker-compose.production-edge.yml up -d authelia
# 4. context, MCP, collector, web, Caddy
docker compose \
  -f docker-compose.production-edge.yml \
  -f docker-compose.warmbly-human-gate.override.yml \
  up -d context mcp collector web caddy
# optional additional -f docker-compose.warmbly-collector.override.yml only for
# the collector's existing read-only observations.
```

After Caddy is up, `ss -lntp` must show nginx on `:80`/`:443` and Caddy on `127.0.0.1:18080` only.

Reserved `cc_edge` IPs: Caddy `10.89.0.2`, context `10.89.0.4`, MCP `10.89.0.6`, collector `10.89.0.7`. MCP and collector must not occupy `10.89.0.2`.

## Health and readiness

Probe **twice**. Ready body must be non-empty JSON with `"ready": true`.

```bash
curl -sS -H 'Host: ops.confenge.com.br' http://127.0.0.1:18080/healthz
# public /ready and /mcp on the ops Host must 404
curl -sS -o /dev/null -w '%{http_code}\n' -H 'Host: ops.confenge.com.br' http://127.0.0.1:18080/ready
# internal:
# context /healthz /ready, collector /healthz /ready, mcp /healthz /ready
# authenticated cockpit footer: exact full release SHA
# internal context: GET /v1/runtime-identity
# internal web: GET /runtime-identity
```

Public cockpit: `https://ops.confenge.com.br/` → Authelia 302 until authenticated + 2FA.

Do not treat `/healthz` 200 as authenticated cockpit access.

## Approval reconciliation after this release

Take the database counts below before the write. With the kill switch still
engaged, an authenticated `admins` identity runs **Reprocessar aprovações já
registradas** once. This is the only production POST in this rollout. It calls
the same Warmbly scheduling function used synchronously by APPROVE; it is not a
cohort dispatch and it cannot transport mail. Run it a second time to prove
idempotency, then repeat the SELECTs and record every `due_at`.

```sql
SELECT decision, count(*)
FROM confenge_cohort_candidate_reviews
GROUP BY decision ORDER BY decision;

SELECT count(*) AS dispatch_bindings
FROM confenge_cohort_candidate_dispatches;

SELECT t.state, d.auto_send, count(*)
FROM confenge_cohort_candidate_dispatches d
JOIN outreach_touchpoints t ON t.id = d.touchpoint_id
GROUP BY t.state, d.auto_send ORDER BY t.state, d.auto_send;

SELECT t.id, t.state, t.due_at, d.auto_send, d.cohort_version_id,
       d.candidate_id, d.invalidated_at
FROM confenge_cohort_candidate_dispatches d
JOIN outreach_touchpoints t ON t.id = d.touchpoint_id
ORDER BY t.due_at, t.id;
```

An absent row is reported as absent, never as zero inferred by the UI. Repeating
reconciliation must create neither a second dispatch binding for the same
`(cohort_id, candidate_id)` nor a second live touchpoint for duplicate frozen
content. Do not remove `/data/confenge-ops/kill-switch`; do not POST a separate
smoke; do not change global auto-send or autorun.

## Governance bootstrap

```bash
cc-governance-bootstrap --dry-run --root /opt/confenge-control-center
# inspect candidate count, kinds, PR #8 exclusion, secret/PII exclusions
cc-governance-bootstrap --apply --allow-control-center-db-write --root /opt/confenge-control-center
# second apply: inserted delta 0
```

Writes only the Control Center database. Never Git, Warmbly, Asaas, or extra-cli.

## Collector canaries

GitHub/infra/PNCP/Warmbly/Asaas persist honestly. `UNKNOWN`/`STALE`/`ERROR`/`BLOCKED_BY_SECRET` must not be displayed as `FRESH`.

- PNCP consumes only `PNCP_CONTRACT_FRESHNESS/1.0`. Never `--live`/ingest/recrawl/backfill as a Control Center side effect.
- Asaas is read-only (zero POST/PUT/PATCH/DELETE/refund/checkout).
- The generic Warmbly collector remains read-only. The explicit human-gate control
  plane may write only immutable gate records through its fixed endpoint allowlist;
  it has no send endpoint and no send permission. The trusted operator review bridge
  may read drafts and submit typed `SAVE_ADJUSTMENT`, `APPROVE`, `REJECT`, or
  bounded batch decisions. Approval queues the exact reviewed content for the
  next eligible business window; it never sends immediately. Never flip auto-send
  or autorun during a deploy.
- Collector DB URL host is `cc-postgres`.

## Backup

Preferred window: 03:00 America/Sao_Paulo (06:00 UTC).

```bash
docker exec -T confenge-control-center-postgres-1 \
  pg_dump -U control_center -d control_center --schema=control_center \
  > /var/backups/confenge-control-center/cc-pg.dump.sql
# encrypt + verify with shipped CLI (CONTROL_CENTER_BACKUP_KEY from secret file, never argv)
node dist/cli.js backup --in /var/backups/confenge-control-center/cc-pg.dump.sql \
  --out /var/backups/confenge-control-center/encrypted
node dist/cli.js verify --in /var/backups/confenge-control-center/encrypted/cc-pg-*.dump.enc
shred -u /var/backups/confenge-control-center/cc-pg.dump.sql
```

Ciphertext must not equal plaintext. Keep encrypted backups. Sidecar `*.dump.enc.meta.json` is required for restore.

## Restore

Restore onto a **new** volume/database. Never restore over production as a drill.

```bash
node dist/cli.js restore --in <enc> --out /tmp/restored.dump.sql
# psql into a throwaway postgres, compare essential counts, destroy only the temp env
```

Mechanical requirement: `same_content=true` (SHA-256 of restored dump equals plaintext dump).

## Rollback

1. Preserve evidence and volumes (`confenge-cc-postgres-edge`).
2. Take ops/auth vhosts out of traffic if the edge is the cause (restore nginx backup; `nginx -t` before reload).
3. Remove `docker-compose.warmbly-human-gate.override.yml` and roll back the
   Control Center compose/images first. Keep persisted gate and review records inert.
4. Revoke the `control-center-human-gate` API key. Do not alter the collector key,
   host PostgreSQL, or extra-cli.
5. Roll back Warmbly only after Control Center no longer calls the new contract.
   Keep migration 121/122 data for evidence; run down migrations only after export and
   only if schema rollback is explicitly required.
6. Prove `https://api.confenge.com.br/api/v1/webhooks/confenge/inbound/health`
   remains READY and `auto_send_enabled=false`.

## Nginx vhost activation

Backup `/etc/nginx` first. Install only `ops.confenge.com.br` and `auth.ops.confenge.com.br` templates. Never overwrite `api.confenge.com.br`. `nginx -t` before reload. If test fails, restore backup and do not reload.

## MFA enrollment (human)

1. Open `https://auth.ops.confenge.com.br/`
2. Authenticate with the bootstrap operator user/password (recover from `/root/.confenge/control-center/bootstrap-operator-password`).
3. Register TOTP or WebAuthn/passkey.
4. Validate login to `https://ops.confenge.com.br/`.
5. Do not disable 2FA to make deploy pass.

## Canaries after apply

- `ss -lntp`: nginx 80/443, Caddy loopback 18080
- context/web/collector/MCP healthy
- `api.confenge.com.br` inbound READY
- Warmbly `/ready` live=true ready=true, `CONFENGE_AUTO_SEND_ENABLED=false`
- Human-gate credential `/v1/me`: exact mask `196`, no `SEND_CAMPAIGNS`; do not log its value
- authenticated `operators` can GET/list/review and APPROVE; the button says that
  APPROVE enqueues. A group without `operators` receives 403 at the edge before upstream.
- only `admins` can run reconciliation; a group without `admins` receives 403 at
  the edge before upstream. There is no live GO/NO-GO or cohort-dispatch route.
- production smoke is GET-only except for the planned reconciliation above; all
  other POST verification uses fixtures/sandbox and `.invalid` recipients
- review list and outbound status are reachable from `context`; the kill switch
  warning renders before review work and remains engaged throughout rollout
- GitHub collector FRESH when token+allowlist are set; otherwise honest ERROR/UNKNOWN

## `/intranet`

Activate `https://confenge.com.br/intranet` → `https://ops.confenge.com.br/` **302** only after `OPS_HOST_AUTHENTICATED_AND_HEALTHY=true` (Authelia + MFA proven). Never 301. Never proxy 200. noindex/nofollow, robots disallow, out of sitemap/nav/JSON-LD.

## Restart

For an ordinary Control Center restart, restart **only** Control Center services,
not Warmbly, host PostgreSQL, or extra-cli. A coordinated human-gate release is
the explicit exception described in the ordered prerequisite above.

After restart, prove `/healthz` `/ready` twice and that directives, Governance context, AgentActivity, collector history, and latest observations persist.
