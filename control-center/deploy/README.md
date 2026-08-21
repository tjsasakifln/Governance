# Control Center deploy pack

Reproducible reference pack for running Confenge Control Center on a Linux VPS (Netcup) with Docker Compose, Caddy hooks, PostgreSQL, encrypted backups, retention, and a fail-closed disk guard.

This workstream is **not** chat, **not** an ERP, and **not** a replacement for Warmbly or origin systems. The **stub pack in this directory** does **not** apply itself to production. Canonical production apply is `PRODUCTION-RUNBOOK.md` using the **production-edge** overlay (nginx `:443` → loopback Caddy → Authelia `forward_auth` → web/context). It does **not** bind host ports 80/443. Warmbly keeps the existing host nginx.

Write path: `control-center/deploy/` only.

## Decisions

1. Governance remains the strategic/canonical authority; Warmbly remains the operational commercial/CRM authority. This pack only hosts the Control Center aggregate.
2. Persistence of aggregated state is PostgreSQL 16, schema `control_center`. This pack provisions the cluster and schema; tables come from `control-center/persistence` in a later convergence campaign.
3. Sibling images (context, MCP, web-shell) are not in this tree yet. Compose runs **stubs** that expose `/healthz` (liveness) and `/ready` (readiness). Convergence replaces build contexts; it does not require rewriting backup, Caddy hooks, or the runbook.
4. Caddy is an **integration hook**: `reverse_proxy` to `context`, `mcp`, and `web-shell`, JSON logs, cert volume `/data`. Automatic HTTPS (ACME on 80/443) is documented for later. This wave uses `tls internal` on loopback high ports (`127.0.0.1:18080` / `18443`) so nginx is not stolen.
5. Aggregated artifacts (backup meta, stub health bodies) carry `source`, `observed_at` (UTC `Z`), `freshness_status`, and `confidence` when applicable.
6. Backup is AES-256-GCM with a 32-byte key from `CONTROL_CENTER_BACKUP_KEY` (64 hex chars). Missing, placeholder, or short keys **fail closed**. Ciphertext is not a dump. Restore verifies the SHA-256 of plaintext against the sidecar meta.
7. Retention keeps copies for `CONTROL_CENTER_BACKUP_RETAIN_DAYS` **and** at least `CONTROL_CENTER_BACKUP_RETAIN_MIN` newest files. Unknown files without meta are not deleted blindly — prune **fails closed** if a `.dump.enc` lacks sidecar meta.
8. Disk guard fails closed when the path is missing or free bytes are below `CONTROL_CENTER_DISK_MIN_BYTES`.
9. Restart policy is `unless-stopped`. Resource limits and json-file log rotation (`max-size: 10m`, `max-file: 5`) are declared on every always-on service. Host logrotate snippet lives at `docker/logrotate.control-center.conf` (not applied this wave).
10. Single-user human initially. No identity or password is hardcoded. Secrets are injected from a secret store into a gitignored `.env`.
11. Fail-closed security. No secrets in git, logs, URLs, analytics, or a client bundle. Structured logs are JSON with UTC timestamps and refuse secret-bearing field names.
12. No Kubernetes, Swarm, or cluster orchestrator. No cobranca, checkout, refund, cancelamento, Asaas writes, or commercial send.
13. `CONTROL_CENTER_APPLY_PRODUCTION` must stay false **on this stub pack**. Production apply is the production-edge overlay documented in `PRODUCTION-RUNBOOK.md`. Applying the stub pack to the live VPS is a violation.

## Layout

| Path | Role |
| --- | --- |
| `docker-compose.yml` | Project `confenge-control-center`, stubs, Postgres volume `confenge-control-center-postgres`, Caddy hook |
| `Caddyfile` | reverse_proxy + automatic HTTPS notes + `tls internal` |
| `docker/*.Dockerfile` | stub, postgres, caddy, ops (backup CLI + `pg_dump` client) |
| `src/` | validate, backup/restore/verify, retention, disk guard, stub server, CLI |
| `fixtures/postgres.dump.sql` | PII-free dump for the restore drill |
| `PRODUCTION-RUNBOOK.md` | **canonical** production apply / migration / DNS / TLS / MFA / backup / restore / rollback |
| `RUNBOOK.md` | stub-pack procedures (superseded for production apply) |
| `.env.example` | variable **names** and placeholders only |

## Run (local, no production)

Requires Node.js ≥ 20. Docker is optional for file/CLI verification.

```bash
cd control-center/deploy
npm install
npm test
npm run typecheck
npm run validate
```

Encrypted backup + restore drill (throwaway key, never a production secret):

```bash
export CONTROL_CENTER_BACKUP_KEY="$(openssl rand -hex 32)"
npm run restore-drill -- --out /tmp/cc-restore-drill
```

Stub liveness/readiness (distinguishes ready vs not-ready):

```bash
HOST=127.0.0.1 PORT=18081 CONTROL_CENTER_STUB_SERVICE=context STUB_READY=true npm run stub
# GET /healthz  → 200  live=true
# GET /ready    → 200  ready=true

STUB_READY=false npm run stub
# GET /healthz  → 200  live=true
# GET /ready    → 503  ready=false
```

Compose config (does **not** start production, does **not** SSH):

```bash
cp .env.example .env   # then inject secrets locally
# Interpolation-only placeholders are fine for `config`; they must not be used to up a live host.
POSTGRES_PASSWORD=interpolation-only \
CONTROL_CENTER_BACKUP_KEY=0000000000000000000000000000000000000000000000000000000000000001 \
docker compose -f docker-compose.yml config
```

If a Docker daemon is available, stubs can be brought up on loopback. This is still not a Netcup apply:

```bash
docker compose up --build -d postgres context mcp web-shell caddy
curl -sS http://127.0.0.1:18080/healthz
curl -sS http://127.0.0.1:18080/ready
docker compose down
```

Do **not** run `docker compose up` against the live Netcup VPS from this wave.

## Environment

Names only; real values come from a secret store. See `.env.example`.

| Variable | Required at runtime | Purpose |
| --- | --- | --- |
| `POSTGRES_USER` / `POSTGRES_DB` | yes | Role and database (`control_center`) |
| `POSTGRES_PASSWORD` | yes | Inject; compose fails closed if empty |
| `CONTROL_CENTER_DATABASE_URL` | later convergence | `postgres://USER@postgres:5432/control_center` — persistence/context |
| `CONTROL_CENTER_BACKUP_KEY` | backup/restore | 64 hex chars; fail-closed if missing/placeholder |
| `CONTROL_CENTER_BACKUP_DIR` | ops | Where encrypted copies land |
| `CONTROL_CENTER_BACKUP_RETAIN_DAYS` | no (14) | Age window |
| `CONTROL_CENTER_BACKUP_RETAIN_MIN` | no (3) | Always keep this many newest |
| `CONTROL_CENTER_DISK_MIN_BYTES` | no (1 GiB) | Disk guard threshold |
| `CONTROL_CENTER_DISK_PATH` | disk guard | Path that must exist and have space |
| `CONTROL_CENTER_FOUNDER_ACTOR_ID` | later context | Opaque actor id, not a password |
| `CONFENGE_MCP_AUTH_TOKEN` | later MCP | Bearer token from a secret store |
| `CONTROL_CENTER_PUBLIC_HOST` | Caddy hook | Placeholder hostname |
| `CONTROL_CENTER_CADDY_HTTP_PORT` | no (18080) | Loopback HTTP |
| `CONTROL_CENTER_CADDY_HTTPS_PORT` | no (18443) | Loopback HTTPS (`tls internal`) |
| `STUB_READY` | no (true) | Stub readiness flip |
| `CONTROL_CENTER_APPLY_PRODUCTION` | must be false | Validate refuses to run if truthy |
| `COMPOSE_PROJECT_NAME` | no | `confenge-control-center` |

Dates inside the pack are UTC. Operators may display backup windows in `America/Sao_Paulo` (see runbook). Money in origin systems stays integer cents + currency; this pack does not store ledgers.

## Backup CLI

```bash
export CONTROL_CENTER_BACKUP_KEY="$(openssl rand -hex 32)"
npx tsx src/cli.ts backup --in fixtures/postgres.dump.sql --out ./backups
npx tsx src/cli.ts verify --in ./backups/cc-pg-....dump.enc
npx tsx src/cli.ts restore --in ./backups/cc-pg-....dump.enc --out ./restored.dump.sql
npx tsx src/cli.ts retain --dir ./backups --now 2026-08-20T06:00:00Z
npx tsx src/cli.ts disk-guard --path ./backups
```

After convergence, take a live dump without leaving the Compose network:

```bash
docker compose exec -T postgres pg_dump -U control_center -d control_center --schema=control_center \
  | npx tsx src/cli.ts backup --in /dev/stdin --out "$CONTROL_CENTER_BACKUP_DIR"
```

(`backup --in` needs a seekable file today; write the dump to a temp file first, then encrypt. The runbook spells the drill.)

## Expected later convergence

Do **not** edit sibling trees from this workstream. Wire later:

| Later workstream | Expected swap |
| --- | --- |
| `control-center/persistence` | Apply migrations into schema `control_center` using `CONTROL_CENTER_DATABASE_URL`. Volume `confenge-control-center-postgres` stays. |
| `control-center/services/context` | Replace stub build with that Dockerfile. Keep `/healthz`; add `/ready` if not already present. |
| `control-center/services/mcp` | Replace stub. Keep `CONFENGE_MCP_AUTH_TOKEN` injection. Caddy already `reverse_proxy`s `/mcp*` to `mcp:8080`. |
| `control-center/apps/web-shell` | Replace stub. Caddy default handler already `reverse_proxy`s to `web-shell:8080`. |
| Collectors / read models | Continue to write into Postgres; this pack does not mutate Warmbly, Asaas, or GitHub. |
| Host nginx | Add a dedicated vhost or hand 80/443 to Caddy automatic HTTPS **only** when Warmbly’s vhost is preserved. |

## Limits of this wave

- No production apply, no ACME against real DNS, no Netcup SSH.
- No Kubernetes manifests.
- Stubs only for HTTP live/ready. They do not implement context, MCP protocol, or the cockpit UI.
- Backup encryption is local-key GCM, not an offsite SaaS.
- MCP/UI stay on loopback. Not a public internet surface.
