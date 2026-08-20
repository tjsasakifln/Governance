# Agent activity ledger

Private Confenge Control Center workstream: an **execution ledger** so the founder can answer *o que os agentes fizeram hoje, com qual evidência e o que sobrou?*

This is **not** chat, **not** an ERP, **not** a CRM, and **not** the contracts `AgentSession` context-consult object (`control-center.agent-session.v1` with status `open|closed|denied`). Persistence `agent_sessions` is a context query log; this package does not read or write it.

Sibling trees (`control-center/contracts`, `control-center/persistence`, `control-center/services/mcp`) are **absent on this branch**. This package copies a local contract and an in-process store. Convergence will map fields; it must not treat the two session concepts as the same table.

## Decisions

- **Authority:** Governance is canonical/strategic. This ledger records agent *executions* (what ran) with provenance. It does not mutate Warmbly, Asaas, GitHub, or commercial send paths.
- **Statuses:** exactly `RUNNING | DONE | PARTIAL | BLOCKED | FAILED | UNKNOWN`.
- **Provenance:** every aggregated record carries `source` (`{ system, kind, locator }`), `observed_at` (UTC RFC3339 with `Z`), `freshness_status` (`FRESH|STALE|UNKNOWN|ERROR`), and `confidence` when set. Ingest without the first three is rejected.
- **Append/revision:** writes against an existing `correlation_id` append a revision. Prior snapshots stay readable. No silent overwrite.
- **Founder approval:** agents may report a result. An agent-attributed `founder_approval` is **dropped** (audit note recorded); the rest of the report persists as agent-reported. A founder-attributed write may stamp approval and is distinguishable via `actor.kind`. Agents cannot overwrite an existing founder stamp. This package does not authenticate; the caller (future MCP/context layer) must set `actor`. No identity or password is hardcoded.
- **Stale RUNNING:** if `last_heartbeat_at ?? started_at` is older than the idle threshold, reconciliation sets `UNKNOWN` + `needs_reconciliation`. It **never** auto-`DONE` and does not invent `finished_at`.
- **Idle threshold:** `7200` seconds (2 hours) by default. Override with `AGENT_ACTIVITY_IDLE_THRESHOLD_SECONDS`. Queries reconcile lazily with a frozen or system clock.
- **"Hoje"** is an explicit UTC `[from, to)` or `date=YYYY-MM-DD`. Storage is UTC. Presentation MAY use `America/Sao_Paulo` (`CONTROL_CENTER_DISPLAY_TZ`).
- **Fail-closed:** unknown input fails validation. Secrets/PII keys are rejected. Logs are structured JSON and never dump payloads, secrets, or URLs with credentials.
- **Single-user human** initially, via opaque actor handles such as `human:founder` supplied by the caller — not a baked-in password.

## Model

Each head snapshot includes:

| Field | Role |
| --- | --- |
| `agent` / `provider` | Who ran |
| `repo`, `goal`, `campaign` | Where / why |
| `started_at`, `finished_at`, `last_heartbeat_at` | UTC |
| `status` | execution state |
| `refs.branch`, `commit`, `pr`, `issues` | VCS pointers (no secret-bearing URLs required) |
| `summary`, `evidence[]`, `blockers[]`, `residual_work[]` | founder-facing; arrays are always present (empty = explicit none) |
| `context_consulted.context_version`, `directive_ids` | what was consulted (scoped; not a company dump) |
| `correlation_id` | session id; stable across revisions |
| `source`, `observed_at`, `freshness_status`, `confidence?` | provenance |

## Run

Node >= 20. No Docker/Postgres required this wave.

```bash
cd control-center/domains/agent-activity
npm install
npm test
npm run consumer
npm run cli -- timeline --date 2026-08-20
npm run cli -- last --date 2026-08-20
npm run typecheck
```

`npm test` drives the shipped `startSession` / `reportResult` / `reconcileStale` / `timeline` / `lastActivity` API with a frozen clock.

`npm run consumer` is a **fresh consumer** (not the test file): it loads the shipped package, queries the same fixture UTC day, and checks that the returned value names an agent/session, includes evidence, and includes leftover `residual_work`.

## Env vars

See `.env.example`. None are secrets. Never commit `.env`, `DATABASE_URL`, tokens, or passwords.

| Variable | Meaning |
| --- | --- |
| `CONTROL_CENTER_AGENT_ACTIVITY_STORE` | `memory` this wave |
| `AGENT_ACTIVITY_IDLE_THRESHOLD_SECONDS` | stale RUNNING window; default `7200` |
| `CONTROL_CENTER_DISPLAY_TZ` | presentation only; default `America/Sao_Paulo` |
| `AGENT_ACTIVITY_LOG` | `1` to emit structured JSON lines on stderr |
| `DATABASE_URL` | reserved for convergence; unused here; never log it |

## Local adapter

`InMemoryAgentActivityStore` implements `AgentActivityRepository` (`get` / `put` / `list`). Each `LedgerRecord` already holds an append-only `revisions[]` array. A later Postgres adapter in `control-center/persistence` must match those operations **on a new activity-ledger table**, not by overloading `agent_sessions`.

## MCP / homepage / persistence (expected at convergence)

Do not edit those workstreams from this PR.

**MCP `confenge.report_session_result`** today accepts `completed\|partial\|failed\|blocked`. Local mapping:

| MCP outcome | Ledger status |
| --- | --- |
| `completed` | `DONE` |
| `partial` | `PARTIAL` |
| `failed` | `FAILED` |
| `blocked` | `BLOCKED` |

`RUNNING` and `UNKNOWN` are ledger-only (heartbeat / stale). MCP should call `reportResult` (and a future `startSession`/`heartbeat`) with `actor.kind = "agent"`. It must not set `founder_approval`.

**Homepage** should call `timeline({ date })` and `lastActivity({ date })` for the cockpit “what agents did / what is leftover”, not a KPI wall. PARTIAL/BLOCKED/FAILED/UNKNOWN with `residual_work` or `needs_reconciliation` are exception-shaped.

**Context API** should pass `context_consulted` (version + directive ids actually granted for the requested scopes). Agents still consult by scope; this ledger does not dump company memory.

## Out of scope

Financial/provider mutations (cobrança, checkout, refund, Asaas writes, commercial send). PR Governance #8. Edits to `commercial/`, `decisions/`, `scripts/`, root README, Warmbly, web-cfg, extra-cli.
