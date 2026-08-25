# Control Center persistence

Autonomous PostgreSQL package for Confenge Control Center: aggregated operational state, structured strategic memory, and an append-only audit trail.

This workstream does not chat, does not replace origin systems, and does not mutate Asaas, Warmbly, or any external provider. It stores what collectors and humans write, with provenance.

## Decisions

- Tables live in schema `control_center` so later convergence can attach this package without colliding with unrelated public tables.
- History is append-only. `directive_revisions` and `audit_events` reject `UPDATE`/`DELETE` via trigger. `directives` identities are never deleted; status and `current_revision_id` are the mutable current pointer.
- Current state is derived into `current_directives`, `current_attention_items`, `current_source_observations`, plus materialized view `mv_open_attention`.
- Soft supersession inserts a replacement directive (`supersedes = old id`), appends a new superseded revision on the old identity, and updates current pointers. The original revision row is left unchanged.
- Collectors are idempotent on `idempotency_key` (`UNIQUE` + `INSERT ... ON CONFLICT DO NOTHING`).
- Aggregated facts require structured `SourceRef` (`system`, `kind`, `locator`, optional `label`), `observed_at`, `freshness_status`, and `confidence` in `[0,1]`.
- Public identities are text `cc:<type>:<id>`. UUID columns exist only as non-exported internal surrogates.
- `freshness_status` is exactly `FRESH|STALE|UNKNOWN|ERROR`. `expired` is a directive status, not freshness. Lowercase tokens are rejected.
- Directive `status` is `draft|active|superseded|revoked|expired`. `withdrawn` is rejected.
- `supersedes` is a list of public `cc:*` ids stored on join tables.
- AgentActivity lives on `agent_activities` (+ append-only `agent_activity_revisions`), not on `agent_sessions`.
- Money is integer cents plus a 3-letter currency code. Internal timestamps are `timestamptz` (UTC). Presentation may use `America/Sao_Paulo` in consumers, not in this package.
- Agents and UI must query by `scope`. There is no public “list entire company memory” API.
- Database credentials come from `CONTROL_CENTER_DATABASE_URL`. No identity or password is hardcoded.

## Layout

- `sql/migrations/` — reversible migrations through `006_work_orders`; Work Order events/holds are append-only and their current projection is rebuildable
- `sql/queries/principal.sql` — principal scoped queries
- `seeds/synthetic.sql` — PII-free fixtures
- `src/` — migrator, transactional repositories, contracts for collectors / MCP / UI
- `tests/` — real PostgreSQL (embedded official binaries, or `CONTROL_CENTER_TEST_DATABASE_URL`)

## Run

```bash
cd control-center/persistence
npm install
npm test
npm run build
```

Apply migrations against a provisioned database:

```bash
export CONTROL_CENTER_DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/DB
npm run migrate:up
npm run seed          # synthetic data only
npm run migrate:down  # reverse, then up again is supported
```

Tests start a real PostgreSQL 16 process via `embedded-postgres` (official binaries). They do not use pg-mem, PGlite, or mocks of the unit under test. To point tests at an already-running cluster:

```bash
export CONTROL_CENTER_TEST_DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/DB
npm test
```

## Environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `CONTROL_CENTER_DATABASE_URL` | runtime CLI | Postgres connection string for migrate/seed |
| `CONTROL_CENTER_TEST_DATABASE_URL` | tests optional | Use an external real Postgres instead of embedded |
| `CC_TEST_PG_DIR` | tests optional | Directory for embedded cluster files |
| `CC_TEST_LAUNCH_ERR` | tests optional | Path to write launcher errors |

Do not put credentials in git, logs, URLs shown to the client, analytics, or the browser bundle. Structured logs from this package omit bodies, payloads, titles, and secret-like keys.

## Retention policy

This campaign does **not** implement destructive purge (audit is append-only). Documented intent for the later convergence job:

| Object | Hot retention | After that |
| --- | --- | --- |
| `directive_revisions`, `directives` | indefinite | canonical strategic memory; archive copies only |
| `audit_events` | 7 years | legal/ops archive, still append-only |
| `source_observations`, `collector_runs` | 2 years | cold archive by `observed_at` |
| `operational_snapshots` | 90 days hot | cold archive |
| `attention_items` | resolved/dismissed 1 year | archive |
| `agent_sessions` | 1 year | archive |
| `agent_activities`, `agent_activity_revisions` | 2 years | archive; never mixed with `agent_sessions` |
| current-state tables / `mv_open_attention` | derived | rebuilt from history, not a system of record |

No production or personal data is imported here. Seeds use opaque synthetic tokens (`synthetic-operator-01`, `synthetic-agent-mcp-01`).

## Principal queries

See `sql/queries/principal.sql`. All list queries take a `scope` parameter.

- Active current directives for a scope
- Revision history for one directive
- Open attention items for a scope (homepage “3 things now”)
- Latest observation per source for a scope
- Collector run by idempotency key
- Scoped audit trail for an entity
- Recent agent sessions for a scope
- Agent activity execution ledger for a scope (separate table)

## Convergence contracts

Other Control Center workstreams should consume this package rather than creating parallel tables.

| Workstream | Port | Entry points |
| --- | --- | --- |
| Collectors | `CollectorWritePort` | `startCollectorRun`, `recordObservation`, `recordSnapshot` — read-only against origin systems |
| MCP / agents | `AgentContextPort` | `listCurrentDirectivesByScope`, `listAttentionItemsByScope`, `listObservationsByScope` |
| Cockpit UI | `CockpitPort` | attention items first, then current directives; no KPI wall |
| Humans | `createDirective` / `supersedeDirective` / `appendAuditEvent` | kinds: `decision`, `directive`, `fact`, `constraint`, `priority`, `risk`, `hypothesis` |

Expected later integration: a dedicated Control Center database (or schema `control_center` on a shared cluster), MCP server in a sibling package, and collectors that pass `idempotency_key` of the form `<collectorName>:<observationKind>:<logicalEventId-or-observedAt>`.

Financial/provider mutations stay forbidden. This package will not grow checkout, refund, cancelamento, or Asaas write paths.

## Invariants

- `kind` ∈ `{decision, directive, fact, constraint, priority, risk, hypothesis}`
- Directives carry `scope`, `status`, `effective_from`, `expires_at`, `supersedes`, `created_by`
- `freshness_status` ∈ `{FRESH, STALE, UNKNOWN, ERROR}`
- Directive `status` ∈ `{draft, active, superseded, revoked, expired}`
- Unique collector/observation `idempotency_key`
- Unique `(directive_id, revision_no)`
- Append-only history; current pointers are the only derived overwrite
- Public ids match `cc:*`; UUID is never the public identity
