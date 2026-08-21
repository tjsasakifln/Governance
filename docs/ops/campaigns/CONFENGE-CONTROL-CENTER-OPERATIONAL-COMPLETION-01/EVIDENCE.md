# EVIDENCE — CONFENGE-CONTROL-CENTER-OPERATIONAL-COMPLETION-01

Production was not mutated. `DEPLOYED_SHA` remains `3d5e21c344be95549cca1e9f0b5073a8efb9ff08`.

## Data plane

Collectors now persist **canonical domain snapshots** (`commercial`, `finance`, `clients`, `engineering`, `infrastructure`, `pncp`) via versioned projectors (`control-center.projector.v1`).

Proven path:

```
collector envelope
  -> persist observation (PII-stripped)
  -> projectCollector()
  -> operational_snapshots.snapshot_kind = domain
  -> v_latest_operational_snapshots
  -> Context /v1/domains/{domain}
  -> cockpit
```

Test: `control-center/connectors/runner/tests/persist-project.test.ts`
(`collector envelope projects to commercial snapshot_kind consumed by latest view`) — PASS.

Assembler also maps leftover `{collector}-snapshot` kinds so already-persisted rows are not silently dropped.

Availability is preserved as a distinct payload dimension: `NO_DATA | NOT_CONFIGURED | BLOCKED_BY_SECRET | UPSTREAM_ERROR | STALE | UNKNOWN | FRESH`. Envelope freshness remains `FRESH|STALE|UNKNOWN|ERROR` and is never promoted.

Missing Warmbly/Asaas/GitHub credentials emit `BLOCKED_BY_SECRET` / `UNKNOWN`, never `FRESH`.

## Warmbly / cohorts

Warmbly collector now GETs (read-only, 404 = gap, never mock):

- `/v1/confenge/intel/scoreboard?include_synthetic=0`
- `/v1/confenge/intel/executive?include_synthetic=0`
- `/v1/confenge/intel/exceptions`
- `/v1/confenge/intel/organic-scoreboard`

Intel bodies are `{data: payload}` on current Warmbly main. Collector unwraps them via `normalizeIntelEnvelope`; malformed success is CONTRACT_DRIFT; 404 is a gap.

Operations payload is a capped read model (not a CRM replica). Acquisition cohorts (anchor = `contact.created_at`) convert only via durable contact/account/lead ids; otherwise `JOIN_UNPROVEN` / null ratio. Inbound-truth scoreboard is labeled separately. Tiny denominators (`n < 10`) are labeled as non-statistical. Intel exceptions feed Commercial Exceptions; organic scoreboard feeds Crescimento.

Auto-send is observed, never enabled. Forbidden send mutations are not on the connector allowlist.

## Operator actions

Migration `004_operator_actions`: append-only, founder-only (`actor_kind = human`), allowed types closed set, `SEND_*` / billing refused at DB check.

HTTP: `POST /v1/operator-actions`, `GET /v1/operator-actions?scope=`.

Tests:

- `services/context/test/operator-actions.test.ts` — founder accept + idempotent duplicate; agent impersonation fail-closed; `SEND_EMAIL` refused; missing actor fail-closed; conflicting payload 409.
- `services/context/test/operator-actions-pg.test.ts` — DB failure then retry persists one row; concurrent duplicate = one row; restart still knows the key; conflicting payload fails closed; agent/stranger denied.
- `persistence/tests/operator-actions.test.ts` — append-only + DB reject of `SEND_EMAIL` + conflicting payload.

PostgreSQL unique `idempotency_key` is the durable authority. Memory is not consulted before the write. Actions are Control Center audit records. Warmbly is not mutated.

## UI

Destinations now include **Crescimento**. Comercial has surfaces: visão, coortes, atividade, pipeline, exceções. Engenharia is company-scoped multi-repo. Client hash `#/clientes/<slug>` filters the 360 card stack.

Honesty (skeptic panel, retested on shipped HTTP mapper):

- `commercialFrom` / `financeFrom` do not coerce omitted counts or money to zero; cockpit facts use `data-absent="true"` + `ausente`.
- Crescimento requests `/v1/domains/commercial?scope=commercial` (not `inbound`) and always renders the nine growth hops (`search_visibility`…`client_revenue`). Missing hops stay UNKNOWN/BLOCKED, never invented joins.
- Client view always paints Warmbly / Asaas / Governance; omitted sources are UNKNOWN + `data-absent`. `client_360=partial_warmbly_only`; not a full multi-source 360.
- `operatorAction` stores `lastOperatorResult` on the HTTP adapter; the shell paints ok/error banners.

Web-shell tests: 76 passed including `honesty-http.test.ts` (mapper + HTTP paint path). Projector: `reply_rate denominator is contacted count and is never substituted with population` — PASS.

## Companion PRs

None required.

- Warmbly PR #104 is merged; production SHA `13e7a08` already exposes intel GETs. Current Warmbly main `c8128f1` is PR #105 (compose SHA env) and is not required for this contract.
- extra-cli `PNCP_CONTRACT_FRESHNESS/1.0` is already the Control Center producer contract.
- web-cfg `/intranet` 302 is already merged (PR #218).

Governance PR #8 was not opened, edited, merged, or absorbed.

## Tests run in this campaign (local)

| Suite | Result |
| --- | --- |
| runner projectors + persist-project (Postgres) | pass (`data-plane.test.log`) |
| Warmbly connector + operator-actions HTTP | pass (`commercial.test.log`) |
| MCP protocol/abuse/aliases + convergence mcp-context | pass (`mcp.test.log`, 28 + 1) |
| domain-gates (finance stages, PNCP map, infra partial, Hoje) | pass (`domains-hoje.test.log`) |
| QA package tests | 55 pass |
| QA adversarial CLI (`npm run qa`) | fail-closed as designed (14/14 attacks fail; READY_FOR_INTERNAL_PRODUCTION=false) |
| web-shell unit including overflow CSS | pass |
| envelope + projector + PG operator-action tests | pass (`warmbly-envelope-tests.log`, `intel-projector-tests.log`, `cohort-adversarial-tests.log`, `operator-idempotency-tests.log`) |
| e2e CI Playwright 360/390/430/desktop | pass on EXECUTED_CODE_SHA `80e75e6`; overflow=0; screenshots artifact 9465703704 |

Local Chromium still lacks `libnspr4.so`. CI Playwright is the execution evidence. Adversarial screenshot review: commercial subnav first and distinct per surface at 360.

See `OPERATIONAL-MATRIX.md`, `WARMBLY-MATRIX.md`, `MOBILE-MATRIX.md`.
