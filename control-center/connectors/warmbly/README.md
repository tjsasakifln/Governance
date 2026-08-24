# Warmbly connector (Control Center)

Read adapter that turns Warmbly's commercial runtime into a `CommercialSnapshot` plus `observations` so the cockpit can answer **o que exige atenção comercial** without owning the CRM pipeline. It also defines one narrow **operator action channel** (`src/operator/`) for three operational controls and a separate trusted-edge human-review bridge in `control-center/services/context`.

Canonical CRM remains Warmbly. This workstream does not persist leads/deals/stages as Control Center source of truth.

## Decisions

- Governance is strategic/canonical; Warmbly is operational commercial/CRM authority.
- HTTP is fail-closed: timeouts, exponential backoff, circuit breaker, method allowlist.
- **Collect path (`src/http/`) stays read-only.** Allowed methods: `GET`/`HEAD` of discovered commercial reads; `POST` only for Warmbly's existing `/search` and `/summary` on contacts, deals, and tasks (read queries that must not change stub/upstream state). `classifyRequest` still denies every operator write path listed below, so the read client can never reach one.
- **Amended boundary (operator action channel).** The earlier blanket "no writes" decision is deliberately amended for exactly three named, individually typed operational controls, and for nothing else:

  | Action | Method + path | Confirmation | Effect |
  | --- | --- | --- | --- |
  | `pause_dispatch` | `POST /v1/confenge/dispatch/pause` | one step | engage the CONFENGE outbound kill switch |
  | `resume_dispatch` | `POST /v1/confenge/dispatch/resume` | **two step** | release the kill switch |
  | `acknowledge_inbound_alert` | `POST /v1/confenge/inbound/{lead_id}/acknowledge` | one step | mark one inbound alert as seen by a human |

  Terms of the amendment:
  - There is **no generic proxy**. A caller names an action; the action owns its method, its path template and its body. No caller-supplied method or path is ever forwarded (`src/operator/actions.ts`, `src/operator/allowlist.ts`).
  - Every action requires an authenticated founder from Authelia's `Remote-User` / `Remote-Groups` / `Remote-Name` / `Remote-Email`, resolved through the existing `control-center/security` ForwardAuth contract (`parseForwardAuthIdentity` + trusted-hop check). The `ops.confenge.com.br` nginx vhost blanks any client-supplied `Remote-*`, so Authelia is the only writer. A caller cannot hand in a pre-built actor.
  - Every path is fail-closed: unknown action, missing/spoofed/ungrouped actor, unsafe target id, missing audit reason, missing or invalid confirmation, open circuit breaker, non-2xx upstream, and a transport failure that never left this process all produce a **recorded refusal**. There is no branch that returns without writing a ledger entry.
  - **A written-but-unanswered call is `unknown`, never `refused`.** When the POST was already on the wire (timeout, or any failure not provably pre-flight) Warmbly may have applied it, so the outcome is recorded as `unknown` with `upstream.status: null` and `upstream.path` set, and the returned reason tells the operator to read `GET /v1/confenge/dispatch/status` before retrying. Calling that a refusal is how an operator ends up believing dispatch is paused while Warmbly is sending.
  - **A confirmation token spent on an `unknown` stays spent.** Re-arming it would turn one observed token into a replayable resume; the operator reads dispatch status and, if still paused, mints a fresh confirmation. The `unknown` reason says so.
  - **Redirects are never followed** (`redirect: "manual"`). A 3xx would re-issue the POST — Bearer token and body included — at a `Location` that `classifyOperatorRequest` never saw (e.g. `dispatch-now`), while the ledger recorded the allowlisted path. Any 3xx is an `upstream_error` refusal.
  - **The ledger key is minted here.** `correlation_id` (and therefore the entry `id` and the agent-activity session) is always server-minted; a caller's own string is carried as `client_reference` and keys nothing, so replaying it can never rewrite an executed entry. While `paused_by` is missing upstream (`gaps` in `required_upstream_contract.json`) this ledger is the sole non-repudiation record.
  - **A ledger failure is never silent.** `ledger.record` is wrapped: on failure the entry goes to a durable stderr WAL line (`cc.warmbly.operator-action.wal`) before the error is rethrown, and `createFanOutOperatorActionLedger` requires an `onSinkError` handler — `defaultOperatorSinkErrorHandler()` logs at error level with the full entry serialized.
  - **Duplicated identity headers fail closed.** `control-center/security` returns no value for a `Remote-*` header that arrives more than once, so a client-supplied copy can never beat the proxy's.
  - `resume_dispatch` is two step because it is the action that can let traffic flow: `requestResumeConfirmation` mints a single-use, 2-minute, actor-bound and target-bound token, and `execute` refuses without it. `pause_dispatch` is one step and is never confirmation-gated.
  - Operator writes are **never retried** (a retried acknowledge would double-acknowledge). 4xx from Warmbly does not trip the circuit breaker; 5xx/429/timeout does.
  - The channel may share the read client's `CircuitBreaker`, so a degraded Warmbly blocks operator writes too. When the breaker is open, the refusal names the out-of-band fallback: `deploy/confenge-vps/pause.sh` on the VPS.
- **Amended boundary (human-review bridge).** `control-center/services/context` may call only the exact review routes listed in `required_upstream_contract.json → human_review_bridge`. The authenticated founder may save copy adjustments, approve an exact content hash for the next eligible business window, reject a draft back into editorial recovery, or apply those decisions in a bounded batch. Approval never transports a message immediately.
- **Still forbidden:** `PATCH`/`PUT`/`DELETE` on any path, creating contacts/deals/tasks, campaign start/stop/send, `dispatch-now` / cohort dispatch, enroll, draft send, review writes outside the typed review bridge, `POST /v1/confenge/inbound/:id/outcome` and `/resolve`, Confenge import/sync/bootstrap, unibox reply/compose/snooze, and **any Asaas / checkout / refund / financial mutation** (`commercial/authority/authority-manifest.v1.json` still carries `real_money_mutation_approved: false`).
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

## Human-review bridge (`control-center/services/context`)

The Control Center's `Comercial → Rascunhos` surface uses a dedicated, server-side proxy. The browser never receives the Warmbly token and cannot choose an upstream path.

| Control Center route | Warmbly route | Purpose |
| --- | --- | --- |
| `GET /v1/commercial/review-drafts` | `GET /v1/confenge/review/drafts` | list recoverable drafts awaiting review |
| `GET /v1/commercial/review-drafts/:id` | `GET /v1/confenge/review/drafts/:id` | inspect one exact draft |
| `POST /v1/commercial/review-drafts/:id` | `POST /v1/confenge/review/drafts/:id/decision` | save adjustment, approve, or reject |
| `POST /v1/commercial/review-batches` | `POST /v1/confenge/review/batches` | apply up to 500 independently reported decisions |

Every request requires the trusted founder identity. `APPROVE` carries `expected_content_hash` and only creates a durable queue entry for the next eligible business window. `REJECT` preserves the lead and routes the draft to AI-assisted editorial recovery. This bridge does not expose an immediate-send operation.

## Operator action channel (`src/operator/`)

The only write surface in this connector. Read `required_upstream_contract.json → operator_actions` for the upstream table.

```ts
import {
  WarmblyOperatorClient,
  createWarmblyOperatorChannel,
  createAgentActivityLedgerSink,
  createFanOutOperatorActionLedger,
  createMemoryOperatorActionLedger,
  createOperatorHttpHandler,
  defaultOperatorSinkErrorHandler,
} from "@confenge/control-center-warmbly-connector";

const client = new WarmblyOperatorClient({ baseUrl, token, breaker: readClient.breaker });
const memory = createMemoryOperatorActionLedger();
const channel = createWarmblyOperatorChannel({
  client,
  // onSinkError is required: a mirror that fails silently is an executed
  // action with no visible timeline row and no error.
  ledger: createFanOutOperatorActionLedger(
    memory,
    [createAgentActivityLedgerSink(agentLedger)],
    defaultOperatorSinkErrorHandler(),
  ),
});

await channel.pauseDispatch({ request, reason: "spike de bounce" });        // one step
const step1 = await channel.requestResumeConfirmation({ request, reason: "incidente resolvido" });
await channel.resumeDispatch({ request, reason: "incidente resolvido", confirmation_token });
await channel.acknowledgeInboundAlert({ request, target_id: "lead-2f7c" });
```

`request` is `{ remoteAddress, headers }` from the inbound HTTP request — nothing else. `createOperatorHttpHandler(channel)` mounts four POST-only routes (`/v1/warmbly/operator/dispatch/pause`, `.../resume/confirm`, `.../resume`, `/v1/warmbly/operator/inbound/acknowledge`) and maps refusals to 400/401/403/428/502/503; a refusal is never rendered as a success.

### Ledger record

One `control-center.warmbly-operator-action.v1` entry per call, on success and on refusal alike:

```json
{
  "schema_version": "control-center.warmbly-operator-action.v1",
  "id": "cc:warmbly-operator-action:<minted correlation_id>",
  "correlation_id": "cc:warmbly-op:<uuid>",
  "client_reference": "<the caller's own string, or null — keys nothing>",
  "requested_action": "pause_dispatch",
  "action": "pause_dispatch",
  "outcome": "executed | refused | challenged | unknown",
  "refusal_code": null,
  "refusal_reason": null,
  "actor": { "kind": "founder", "id": "<Remote-User>", "display_name": "<Remote-Name>" },
  "target": { "kind": "dispatch", "id": "confenge-dispatch" },
  "upstream": { "method": "POST", "path": "/v1/confenge/dispatch/pause", "status": 200 },
  "confirmation": { "required": false, "satisfied": false, "token_id": null },
  "circuit_state": "closed",
  "reason": "spike de bounce",
  "recorded_at": "2026-08-22T12:00:00.000Z",
  "source": { "system": "control-center", "kind": "warmbly-operator-action", "locator": "cc:warmbly-op:<uuid>" },
  "observed_at": "2026-08-22T12:00:00.000Z",
  "freshness_status": "FRESH",
  "confidence": 1
}
```

`confirmation.token_id` is `cnf:<action>:<target_id>:<uuid>` — unique per challenge, so the ledger shows which challenge was spent and how many were minted and abandoned. The audit reason is bound to the challenge by hash: a token confirmed under one reason cannot be executed under another.

`Remote-Email` never enters the record; the actor id is the `Remote-User` handle. `createAgentActivityLedgerSink` mirrors each entry into `control-center/domains/agent-activity` as a start + report pair (`executed → DONE`, `challenged → PARTIAL`, `refused → BLOCKED`, `unknown → UNKNOWN`; identity kind `human` → ledger kind `founder`), so operator actions appear on the same timeline as agent runs. The session is keyed by the minted `correlation_id`, so a replayed `client_reference` cannot revise an existing row.

An `unknown` outcome is answered over HTTP as `503 {"outcome":"unknown","code":"transport_unknown"}`; the reason names `GET /v1/confenge/dispatch/status` as the only thing that settles it.

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
