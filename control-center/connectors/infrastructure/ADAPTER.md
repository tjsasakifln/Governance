# Local adapter (pre-convergence)

Canonical Control Center contracts live in sibling path `control-center/contracts/` and are **not** imported from this collector. This file is the local stand-in so later convergence can wire PostgreSQL ingest without guessing field names.

## SourceObservation

| Field | Type | Notes |
| --- | --- | --- |
| `observation_id` | string | Stable: `{source}:{target_id}:{check}` |
| `source` | string | Allowlist `source` (default `infrastructure`) |
| `observed_at` | string | ISO-8601 UTC (`…Z`) |
| `freshness_status` | `FRESH` \| `STALE` \| `UNKNOWN` \| `ERROR` | Separate from confidence |
| `confidence` | number 0–1 | Present on every mapped observation |
| `scope` | `infrastructure` | Agents must query by scope later |
| `target_id` | string | Allowlisted target |
| `check` | `reachability` \| `host_metrics` \| `docker` \| `http` \| `tls` \| `backup` \| `uptime` | |
| `summary` | string | Human-readable outcome |
| `payload` | object | Probe evidence (no secrets) |

## ServiceHealth

| Field | Type | Notes |
| --- | --- | --- |
| `service_id` | string | Allowlisted target id |
| `display_name` | string | |
| `role` | string | What the service does. Catalog `role`, else derived from the checks it runs |
| `endpoint` | string | Logical address the checks address. Userinfo and query string stripped |
| `source` | string | |
| `observed_at` | string | UTC |
| `freshness_status` | same enum | Worst of member checks |
| `status` | `healthy` \| `degraded` \| `unhealthy` \| `unknown` | Never `healthy` unless freshness is `FRESH` |
| `checks` | array | Per-check status + freshness + summary |
| `uptime_seconds` | number? | When the uptime probe observed it |
| `restart_count` | number? | When the uptime probe observed it |
| `confidence` | number? | Min of member observations |
| `latency_ms` | number? | Round trip of the most end-to-end timing probe (`http`, else `reachability`) |
| `latency_check` | check kind? | Which check produced `latency_ms` |
| `last_error` | string? | Summary of the worst non-healthy check |
| `runbook_url` | string? | Catalog `runbook_url`: same-origin path or credential-free http(s) URL |

## ActionableException

| Field | Type | Notes |
| --- | --- | --- |
| `exception_id` | string | Stable: `exc:{source}:{target_id}:{check}[:qualifier]` |
| `source` | string | |
| `timestamp` | string | UTC; equals `observed_at` |
| `observed_at` | string | UTC |
| `target_id` | string | Allowlisted target |
| `check` | check kind | |
| `severity` | `critical` \| `warning` | |
| `title` | string | Names the service/check |
| `evidence` | string | Non-empty; includes check, target, summary, timestamps |
| `freshness_status` | enum | |

A service incident (failed/unreachable/unhealthy probe, expired TLS, missing/failed backup, timeout, stale metrics) **must** produce at least one exception with evidence and a timestamp.

## Allowlist

See `config/allowlist.example.json`. No secrets, SSH material, passwords, tokens, or PEM. Hosts/URLs only. Thresholds are operational, not credentials.

Two optional per-target fields make the cockpit readable instead of a wall of
identical cards:

| Field | Type | Notes |
| --- | --- | --- |
| `role` | string? | What the target does, ≤120 chars. Omitted, the collector derives one from the target's checks |
| `runbook_url` | string? | Same-origin absolute path, or an http(s) URL with no credentials. Protocol-relative and `javascript:` are refused at parse time |

## Read-only agent payload (`GET {AGENT}/v1/targets/{id}`)

```json
{
  "observed_at": "2026-08-20T15:00:00.000Z",
  "disk": { "used_pct": 41, "used_bytes": 0, "total_bytes": 0 },
  "memory": { "used_pct": 52, "available_bytes": 0, "total_bytes": 0 },
  "load": { "load_1": 0.2, "load_5": 0.2, "load_15": 0.2 },
  "docker": { "services": [{ "name": "extra-crawler", "health": "healthy", "restart_count": 0, "uptime_seconds": 86400 }] },
  "backup": { "status": "ok", "last_success_at": "2026-08-20T14:00:00.000Z" },
  "host": { "uptime_seconds": 604800, "restart_count": 1 }
}
```

Missing/unusable agent payload is fail-closed (`UNKNOWN` / exception), never silent green.

## Convergence wiring (later campaign)

- Replace this adapter with canonical `control-center/contracts` `SourceObservation` / `ServiceHealth`.
- Persist collector output into PostgreSQL `source_observations` + collector runs + exception/attention rows.
- Do not SSH as root from the web runtime; keep a minimal read-only agent (or HTTP/TLS/TCP probes) outside this app.
- extra-cli `scripts/health_check.py` remains the origin VPS checker — this collector aggregates/normalizes only.
