# Runbook — stub pack deploy, rollback, restore

**Superseded for production apply.** Canonical production operations: [`PRODUCTION-RUNBOOK.md`](./PRODUCTION-RUNBOOK.md) (production-edge overlay, Authelia, loopback Caddy).

This file remains the stub-pack CLI procedures (validate, encrypted backup, restore drill, disk-guard). The stub pack does **not** change the live Netcup VPS. Production-edge apply is authorized separately.

Internal clocks are UTC. Display times below also show `America/Sao_Paulo`.

## Never with this stub pack

- Bind host 80/443 (Warmbly nginx).
- `kubectl apply`, Helm, Swarm.
- Cobranca, checkout, refund, cancelamento, Asaas writes, commercial send.
- Set `CONTROL_CENTER_APPLY_PRODUCTION=true` (this pack's validate fails closed).
- Use this pack's Caddyfile (no `forward_auth`) as the production edge.

## Prerequisites (after convergence)

- Docker Compose v2 on the Linux VPS.
- Secrets in a file **not** in git: `POSTGRES_PASSWORD`, `CONTROL_CENTER_BACKUP_KEY` (64 hex chars), later `CONFENGE_MCP_AUTH_TOKEN` and `CONTROL_CENTER_FOUNDER_ACTOR_ID`.
- Disk guard path exists (Postgres volume and/or backup dir).
- Copy `.env.example` → `.env` and inject secrets.

Check the pack before any change:

```bash
cd control-center/deploy
npm run validate
```

Expected primary line:

```
Control Center deploy pack: project=confenge-control-center postgres_volume=confenge-control-center-postgres caddy_hook=reverse_proxy backup=encrypted-aes-256-gcm restore=fixture-drill retention=age-and-min-count disk_guard=fail-closed kubernetes=absent production_apply=refused
```

## Deploy (reference, not executed here)

1. `npm run validate` must succeed.
2. `npx tsx src/cli.ts disk-guard --path "$CONTROL_CENTER_DISK_PATH"`.
3. Record the current image tags (`docker compose images`) as the rollback point.
4. `docker compose build`.
5. `docker compose up -d postgres` and wait until `pg_isready` (Compose healthcheck).
6. Later convergence: run `control-center/persistence` migrations against `CONTROL_CENTER_DATABASE_URL` (schema `control_center`).
7. `docker compose up -d context mcp web-shell caddy`.
8. Probe twice:
   - `curl -sS http://127.0.0.1:18080/healthz`
   - `curl -sS http://127.0.0.1:18080/ready`
   Ready body must be non-empty JSON with `"ready": true`. Not-ready is `"ready": false` and HTTP 503.
9. Confirm Caddy does **not** listen on host 80/443 (`ss -lntp` / existing nginx still owns those ports).

## Rollback

1. `docker compose images` / the notes from step 3 of deploy identify the previous tags (`confenge-control-center-stub`, `confenge-control-center-postgres:16`, `confenge-control-center-caddy`).
2. `docker compose down` (volumes **stay**; `confenge-control-center-postgres` is the data).
3. Set image tags back (or `git checkout` the previous compose/Dockerfiles on this path only).
4. `docker compose up -d`.
5. Probe `/healthz` and `/ready` twice again.
6. If the schema migration in a later campaign is the failure, roll the persistence package forward/back with its own `migrate:down` / `migrate:up`. This pack does not own SQL tables.

Rolling back does **not** delete `confenge-control-center-postgres` or `confenge-control-center-backups`.

## Backup (encrypted)

Preferred window: 03:00 America/Sao_Paulo (06:00 UTC).

1. Disk guard.
2. Dump (after convergence; fixture dump in this wave):

```bash
docker compose exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --schema=control_center \
  > /tmp/cc-pg.dump.sql
```

3. Encrypt + verify + retain (shipped CLI):

```bash
npx tsx src/cli.ts backup --in /tmp/cc-pg.dump.sql --out "$CONTROL_CENTER_BACKUP_DIR"
npx tsx src/cli.ts verify --in "$CONTROL_CENTER_BACKUP_DIR"/cc-pg-*.dump.enc
npx tsx src/cli.ts retain --dir "$CONTROL_CENTER_BACKUP_DIR"
shred -u /tmp/cc-pg.dump.sql
```

4. Confirm ciphertext is not the SQL text (`grep CC_FIXTURE_SENTINEL` on the `.enc` file must miss; on a live dump, `grep CREATE` must miss).
5. Sidecar `*.dump.enc.meta.json` records `source`, `observed_at`, `freshness_status`, `sha256_plaintext`.

Fail closed if the key is missing. Do not log the key.

## Restore drill (this wave — no Netcup)

Uses `fixtures/postgres.dump.sql`. Run **twice**. Both restored files must match the fixture byte-for-byte.

```bash
export CONTROL_CENTER_BACKUP_KEY="$(openssl rand -hex 32)"
npx tsx src/cli.ts restore-drill --out ./backups/drill
cmp fixtures/postgres.dump.sql ./backups/drill/run-1/restored.dump.sql
cmp fixtures/postgres.dump.sql ./backups/drill/run-2/restored.dump.sql
```

## Restore (after convergence, still not a live apply from this wave)

1. Disk guard on the data directory.
2. `docker compose stop context mcp web-shell caddy`.
3. Decrypt:

```bash
npx tsx src/cli.ts restore --in "$CONTROL_CENTER_BACKUP_DIR"/cc-pg-WHEN.dump.enc --out /tmp/cc-pg.restore.sql
```

4. Recreate or apply into Postgres (operator choice; prefer a new database then swap):

```bash
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" < /tmp/cc-pg.restore.sql
```

5. Start dependents, probe `/healthz` and `/ready` twice.
6. Shred the plaintext restore file.

If restore produces empty or unencrypted output, treat it as a **pack defect**, not an environment skip.

## Retention

Default: 14 days **and** at least 3 newest copies. Prune is `npx tsx src/cli.ts retain --dir "$CONTROL_CENTER_BACKUP_DIR"`. A `.dump.enc` without `.meta.json` fails closed (nothing is deleted blindly).

## Disk guard

Default 1 GiB (`1073741824` bytes) on `CONTROL_CENTER_DISK_PATH`. Backup, restore, and validate-time ops refuse to proceed when space is insufficient.

## Log rotation

- Docker `json-file`: `max-size: 10m`, `max-file: 5` (compose).
- Optional host hook: `docker/logrotate.control-center.conf` — **not** installed by this wave.

Logs are JSON. Do not attach secrets, tokens, `DATABASE_URL`, or dump contents to log fields.

## Caddy / nginx coexistence

| Port | Owner this wave |
| --- | --- |
| host 80/443 | Warmbly nginx — do not steal |
| 127.0.0.1:18080 | Caddy HTTP hook → reverse_proxy |
| 127.0.0.1:18443 | Caddy HTTPS hook, `tls internal`, certs in `confenge-control-center-caddy-data` |

Automatic HTTPS (ACME) is the later campaign, after a dedicated hostname exists.

## Health vs ready

| Path | Meaning | Stub not-ready |
| --- | --- | --- |
| `GET /healthz` | process live | 200, `live: true` |
| `GET /ready` | safe to receive traffic | 503, `ready: false`, non-empty JSON |

## Contacts for later wiring

- Postgres volume: `confenge-control-center-postgres`
- Schema: `control_center`
- URL env: `CONTROL_CENTER_DATABASE_URL`
- MCP: Caddy `/mcp*` → `mcp:8080`
- Cockpit: Caddy default → `web-shell:8080`
- Context HTTP: Caddy `/v1/*`, `/healthz`, `/ready` → `context:8080`
