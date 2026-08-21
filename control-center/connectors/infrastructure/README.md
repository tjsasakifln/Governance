# Control Center — infrastructure health collector

Read-only collector for Netcup / 24×7 service health. It turns allowlisted probes into `SourceObservation`, `ServiceHealth`, and **actionable exceptions**. It is not chat, not Prometheus/Grafana, and it does not replace extra-cli `scripts/health_check.py` or systemd units on the VPS.

Ownership path: `control-center/connectors/infrastructure/` only.

## Decisions

1. **Allowlist only.** Hosts, URLs, and check kinds are explicit. Unknown targets are not probed.
2. **No root SSH in the app runtime.** Live probes are TCP reachability, HTTP GET, and TLS certificate `notAfter`. Disk/memory/load, Docker health, backup last-success, and uptime come from a **minimal read-only agent** (HTTP JSON) or from recorded fixtures. Secrets and SSH material stay out of git, the database, logs, URLs, analytics, and the client bundle.
3. **Fail-closed.** Timeout, missing agent payload, unusable timestamps, and stale `observed_at` are never reported as `healthy` + `FRESH`. Sibling probes in the same run still emit.
4. **Provenance on every aggregate.** `source`, `observed_at` (UTC), `freshness_status` (`FRESH|STALE|UNKNOWN|ERROR`), plus `confidence`.
5. **Idempotency** is a stable observation identity (`source + target + check`), not deletion of prior runs.
6. **Local adapter.** Canonical `control-center/contracts/` is a sibling workstream. This tree ships a local field set documented in `ADAPTER.md` so convergence can ingest without this collector writing that path.
7. extra-cli remains the origin VPS checker (DB/disk/load/mem, systemd, backup mount). This collector normalizes those *kinds* of signals; it does not rewrite extra-cli.

## Run

```bash
cd control-center/connectors/infrastructure
npm install
npm test
npm run collect -- --fixture fixtures/incident.json
```

`npm test` typechecks with strict TypeScript and runs `node:test` against the compiled collector.

Replay a fixture through the shipped CLI (same entry the cockpit/agents will wrap later):

```bash
node dist/src/cli.js --fixture fixtures/incident.json
```

Live mode (TCP/HTTP/TLS only; no SSH):

```bash
export CONTROL_CENTER_INFRA_ALLOWLIST_PATH=./config/allowlist.example.json
# optional read-only agent; omit to fail-closed on host_metrics/docker/backup/uptime
# export CONTROL_CENTER_INFRA_AGENT_URL=http://127.0.0.1:9100/
npm run collect -- --live
```

## Environment

| Variable | Purpose |
| --- | --- |
| `CONTROL_CENTER_INFRA_ALLOWLIST_PATH` | Filesystem path to the allowlist JSON (live mode). Names only; file must not contain secrets. |
| `CONTROL_CENTER_INFRA_AGENT_URL` | Optional base URL of a **read-only** agent (`GET /v1/targets/{id}`). `http(s)` only, no userinfo. |

No SSH private keys, tokens, or database DSNs are read by this collector.

## Checks

| Check | How |
| --- | --- |
| Host reachability | TCP connect to allowlisted `host:port` |
| Disk / memory / load | Agent payload when exposed |
| Docker / service health | Agent payload `docker.services[].health` |
| HTTP health | GET allowlisted URL, expected status |
| TLS expiry | Peer certificate `notAfter` vs collector clock |
| Backup last-success | Agent `backup.status` + `last_success_at` |
| Restart count / uptime | Agent `host` fields when present |

## Fixtures

Under `fixtures/`: `healthy`, `incident`, `host-failure`, `tls-expired`, `backup-missing`, `timeout`, `partial-outage`, `stale`. Timeouts hang the injected port; the collector deadline still fires.

## Expected convergence

Later campaign (not this PR):

- Import canonical `SourceObservation` / `ServiceHealth` from `control-center/contracts/` and drop this local adapter.
- Persist runs into PostgreSQL `source_observations` / collector_runs / attention rows.
- Homepage consumes exceptions as “the 3 things that matter now”.
- MCP context by `scope=infrastructure` — never a whole-company dump.
- Wire a production allowlist of internal health URLs; keep secrets in the host environment, not in this tree.

See `ADAPTER.md` for the exact local field set.
