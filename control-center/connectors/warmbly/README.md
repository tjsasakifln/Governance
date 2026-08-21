# Warmbly connector (Control Center)

Read-only adapter that turns Warmbly's commercial runtime into a `CommercialSnapshot` plus `observations` so the cockpit can answer **o que exige atenção comercial** without owning the CRM pipeline.

Canonical CRM remains Warmbly. This workstream does not persist leads/deals/stages as Control Center source of truth.

## Decisions

- Governance is strategic/canonical; Warmbly is operational commercial/CRM authority.
- HTTP is fail-closed: timeouts, exponential backoff, circuit breaker, method allowlist.
- Allowed methods: `GET`/`HEAD` of discovered commercial reads; `POST` only for Warmbly's existing `/search` and `/summary` on contacts, deals, and tasks (read queries that must not change stub/upstream state).
- Forbidden: `PATCH`/`PUT`/`DELETE`, creating contacts/deals/tasks, campaign start/stop/send, Confenge import/enroll/bootstrap/dispatch, unibox reply/compose, any Asaas/financial mutation.
- Every aggregated item carries `source`, `observed_at` (UTC), `freshness_status`, and `confidence` when the upstream payload supplies it.
- Deal money is integer **cents** + `currency`. Warmbly `value` is treated as major units (1500.50 BRL → 150050 cents).
- No `GET /leads` exists on Warmbly. Contacts search + Confenge inbound (when enabled) are the lead surface. The gap is documented in `required_upstream_contract.json`.
- `/v1/confenge/*` (except `GET /v1/confenge/status`) is feature-flagged. A 404 produces `freshness_status` UNKNOWN/ERROR and a `required_upstream_contract` row — never a Warmbly write.
- Local snapshot contract lives here until convergence with `control-center/contracts/`.

## Mapped Warmbly routes

See `required_upstream_contract.json` for the full table. Collect calls:

| Method | Path | Why |
| --- | --- | --- |
| GET | `/health` | liveness / version stamp (`API-Version` header) |
| GET | `/v1/crm/pipelines` | stage names for stalled-deal context; **not** stored as a board |
| GET | `/v1/crm/deals` | commercial states + timestamps + values |
| POST | `/v1/crm/deals/summary` | open-value aggregate (read) |
| GET | `/v1/crm/tasks` | next actions |
| POST | `/v1/crm/tasks/search` | overdue filter GET list lacks (read) |
| POST | `/v1/contacts/search` | contacts / lead surface (no GET list) |
| GET | `/v1/campaigns` | campaign exception signals |
| GET | `/v1/campaigns-overview` | active/paused counts |
| GET | `/v1/unibox/overview` | unread / awaiting-reply signals |
| GET | `/v1/confenge/status` | feature flag + readiness |
| GET | `/v1/confenge/ops/health` | health/version when Confenge is on |
| GET | `/v1/confenge/attention` | Warmbly-native needs-attention |
| GET | `/v1/confenge/today` | executable human work |
| GET | `/v1/confenge/inbound` | inbound leads needing a human |

Auth: `Authorization: Bearer <token>` and `API-Version: v1`. Tokens are prefixed `wmbly_`.

## Env vars (names only)

Copy `env.example`. Never commit values, put secrets in git, logs, URLs, analytics, or a client bundle.

| Name | Purpose |
| --- | --- |
| `WARMBLY_BASE_URL` | Warmbly API origin (no trailing slash) |
| `WARMBLY_API_TOKEN` | Bearer credential (preferred) |
| `WARMBLY_API_KEY` | Alias for the same credential |
| `WARMBLY_OBSERVED_AT` | Optional RFC3339 UTC clock for reproducible collect |

## How to run

```bash
cd control-center/connectors/warmbly
npm install
npm test
npm run typecheck
```

Collect entry (the function `collect` / CLI `npm run collect`):

```bash
# Fixture-only (no HTTP)
npm run collect -- --fixture fixtures/commercial-runtime.json --now 2026-08-20T15:00:00.000Z

# In-process Warmbly-shaped stub (no live Warmbly)
npm run collect -- --stub --now 2026-08-20T15:00:00.000Z

# Against a local stub/server you already started
WARMBLY_BASE_URL=http://127.0.0.1:PORT WARMBLY_API_TOKEN=wmbly_… npm run collect
```

JSON snapshot goes to stdout. Structured logs go to stderr and are redacted.

## Attention derivation (no pipeline replica)

The snapshot's `attention` list is the cockpit slice, not a kanban:

- overdue CRM tasks
- next actions (due in 24h or high/urgent open tasks)
- stalled open deals (no movement ≥ 14 days)
- campaign guardrail / exceptional status
- unibox unread / awaiting-reply / draft-review counts
- Confenge needs-attention, today actions, inbound-now (when those reads exist)

Completed tasks, recently-updated open deals, healthy active campaigns, and handled inbound leads are **not** attention. The snapshot has no `deals` / `pipelines` / `tasks` arrays.

## Expected later integration

This adapter is designed to land unchanged during the convergence campaign:

- **`control-center/contracts/`** — replace the local `CommercialSnapshot` / `SourceObservation` / `RequiredUpstreamContract` types with the canonical schemas (`schema: control-center.commercial-snapshot.v1`). Field names here (`source`, `observed_at`, `freshness_status`, `confidence`, `amount_cents`) are the intended join keys.
- **Persistence ingest** (`control-center` PostgreSQL) — consume `collect()` output as observations + attention facts. Do **not** upsert a replica pipeline from `GET /v1/crm/deals` or `/pipelines`.
- **Context service / MCP** — agents should query attention by scope, not dump this snapshot wholesale.
- **Cockpit homepage** — render `attention` (the few things that need a human now), not KPI walls.

Until those packages exist on the same branch, depend on this folder only.

## Tests

Synthetic Warmbly-shaped fixtures in `fixtures/`. Unit/contract tests drive `collectFromWarmblyPayload` and `collect()` (the shipped path) plus the HTTP client against a local stub. Live Warmbly and Asaas are never called.
