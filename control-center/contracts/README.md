# Control Center contracts (v1)

Canonical machine contract for the Confenge Control Center. Other workstreams (persistence, context service, MCP server, collectors, UI) MUST implement against this tree and MUST NOT guess field names, enums, or authority.

This package is **schemas, types, HTTP/MCP documentation, fixtures, and a validator**. It is not a service, not a UI, not a database, and not an MCP runtime.

## Decisions (frozen)

1. Governance is strategic/canonical authority (catalog, terms, directives).
2. Warmbly is commercial/CRM operational runtime. `CommercialSnapshot` is a read model, not a second catalog.
3. Collectors and snapshots are read-only aggregates with `provenance`.
4. Aggregated information carries `source`, `observed_at`, `freshness_status`, and `confidence`.
5. Freshness ∈ `FRESH | STALE | UNKNOWN | ERROR` and is **not** confidence. Confidence is `[0, 1]`.
6. Directive kinds: `decision`, `directive`, `fact`, `constraint`, `priority`, `risk`, `hypothesis`. Required: `scope`, `status`, `effective_from`, `expires_at`, `supersedes`, `created_by`, plus `audit`.
7. Agents query **by scope**. Empty scope lists are invalid. There is no whole-company dump.
8. MCP is the principal agent interface (`docs/mcp.v1.json`). HTTP is the internal companion (`docs/http.openapi.json`).
9. Financial/provider mutations are forbidden: cobrança, checkout, refund, cancelamento, Asaas writes, commercial send.
10. Homepage consumes exceptions (`AttentionItem`) and at most three `PriorityRecommendation`s — not a KPI wall.
11. Money is integer cents + ISO-4217 currency. Timestamps are UTC with a `Z` suffix. Presentation MAY use `America/Sao_Paulo`.
12. IDs: `cc:<type-kebab>:<ulid-or-slug>` as listed in `catalog.json`.
13. Fail-closed: no secrets in git, logs, URLs, or payloads. `ActorRef.id` is an opaque handle, not a password.

See `docs/ADR-CC-001-ARCHITECTURE-BOUNDARIES.md`.

## Scope taxonomy

Exact v1 literals:

- `company`
- `commercial`
- `finance`
- `clients`
- `infrastructure`
- `inbound`

Parameterized:

- `repo:<name>` — short name or `owner/name`
- `client:<slug>` — kebab-case; `ClientStatus.scope` MUST equal `client:<client_slug>`

### Minimum client identity

A `ClientStatus` is an operational entity. A record that cannot be identified is
**not** a client — it is a data-quality exception that belongs in the join queue.
The validator therefore rejects (keyword `client_identity` / `client_id_slug`):

- a `client_slug` shorter than two characters;
- a `client_slug` or `scope` built from a reserved placeholder token
  (`unknown`, `cliente`, `none`, `tbd`, … — the frozen list is
  `RESERVED_CLIENT_SLUGS` in `src/taxonomy.ts`, mirrored by the
  `reserved_client_slug` / `reserved_client_scope` schema `$defs`);
- a placeholder `display_name` such as `Cliente` or `unknown`;
- an `id` whose slug is not the `client_slug`.

Producers derive slugs with `clientSlugFrom()`, which returns `null` rather than
coercing an unusable identifier into a plausible-looking slug. A `null` means
"emit a data-quality exception with origin, reason code and required action",
never "publish `client:unknown`".

Non-breaking extension: additional `<prefix>:<id>` namespaces (lowercase prefix) that are **not** the reserved literals or `repo`/`client`. `company:foo` and `client:Acme` are invalid. Consumers MUST treat unknown namespaced scopes as opaque and MUST NOT grant them by default. New **bare** literals require an additive schema revision.

## Public resource types

The catalog (`catalog.json`) is the index. Do not freeze a type count in consumers; additively cataloged types are listed there.

| Type | `schema_version` | ID type |
|---|---|---|
| Directive | `control-center.directive.v1` | `directive` |
| OperationalSnapshot | `control-center.operational-snapshot.v1` | `operational-snapshot` |
| SourceObservation | `control-center.source-observation.v1` | `source-observation` |
| AttentionItem | `control-center.attention-item.v1` | `attention-item` |
| PriorityRecommendation | `control-center.priority-recommendation.v1` | `priority-recommendation` |
| AgentSession | `control-center.agent-session.v1` | `agent-session` |
| AgentActivity | `control-center.agent-activity.v1` | `agent-activity` |
| ClientStatus | `control-center.client-status.v1` | `client-status` |
| CommercialSnapshot | `control-center.commercial-snapshot.v1` | `commercial-snapshot` |
| FinanceSnapshot | `control-center.finance-snapshot.v1` | `finance-snapshot` |
| EngineeringSnapshot | `control-center.engineering-snapshot.v1` | `engineering-snapshot` |
| ServiceHealth | `control-center.service-health.v1` | `service-health` |
| CollectorRun | `control-center.collector-run.v1` | `collector-run` |
| AuditEvent | `control-center.audit-event.v1` | `audit-event` |

`AgentContext` (`control-center.agent-context.v1`) is the HTTP/MCP envelope, not a stored core resource. Directive `draft` plus OperationalSnapshot / AgentContext compose proposal and today envelopes; those are not separate cataloged types.

`AgentActivity` is the execution ledger (what an agent ran). `AgentSession` is the scoped context-consult grant (`open\|closed\|denied`). They are not aliases.

FinanceSnapshot is a read-only aggregate (`provider_mutations: "forbidden"`) with integer-cents money: contracted, billed, paid, effectively_received, overdue, receivable, refunds, chargebacks. `cash_in`, `mrr`, and `runway` are omitted unless evidenced / applicable / cash+expense reliable.

CommercialSnapshot is a Warmbly read model that pins Governance catalog identity (`offer_pin`) and MUST NOT copy names, prices, terms, or offer copy. Funnel: new_leads, qualified, opportunities, proposals, clients. `pipeline_weighted` is omitted unless probability is reliable. Attention refs cover aging / stalled / missing-next-action.

## Layout

```
catalog.json                 # machine index of public types
schemas/                     # JSON Schema 2020-12
src/types.ts                 # TypeScript types in lockstep
src/validate.ts              # shipped validator (Ajv + semantic checks)
src/compatibility.ts         # compatibility table classifier
src/fingerprint.ts           # deterministic CONTRACT_FINGERPRINT
src/cli.ts                   # shipped CLI entry
fixtures/valid|invalid/      # at least one each per type
docs/http.openapi.json
docs/mcp.v1.json
docs/compatibility.v1.json
docs/ADR-CC-001-ARCHITECTURE-BOUNDARIES.md
tests/
```

## Run validation and tests

Requires Node.js ≥ 20. No other services.

```bash
cd control-center/contracts
npm install
npm test
npm run typecheck
npx tsx src/cli.ts --list-types
npx tsx src/cli.ts --fingerprint
npx tsx src/cli.ts --type Directive fixtures/valid/directive.json
npx tsx src/cli.ts --type Directive fixtures/invalid/directive.json
npx tsx src/cli.ts --type AgentActivity fixtures/valid/agent-activity.json
```

The CLI prints JSON with `"ok": true` or `"ok": false` plus `errors`. Exit 0 only when valid.

A non-test consumer of the same shipped `validate` function:

```bash
npx tsx scripts/consume-validate.ts fixtures/valid/directive.json
```

## Environment variables

This package has **no required environment variables** and ships no `.env`.

Later workstreams (not implemented here) are expected to introduce their own, for example:

| Variable | Later owner | Notes |
|---|---|---|
| `DATABASE_URL` | persistence | PostgreSQL for snapshots and memory |
| `CC_ACTOR_ID` | auth | Opaque `ActorRef.id`; never a password in git |
| `WARMBLY_READ_BASE_URL` | collectors | Read-only |
| `GITHUB_TOKEN` | github collector | Server-side only; never in client bundle or URLs |

Absence of a variable is fail-closed in those services. Do not invent defaults that open writes.

## Expected convergence (later campaign)

Do **not** implement these from this package:

- Wire `control-center/` into the Governance root README, `commercial/`, `decisions/`, or `scripts/`.
- Absorb PR Governance #8 (partner program).
- Edit Warmbly, web-cfg, or extra-cli.
- Boot HTTP/MCP servers or migrate PostgreSQL.

Convergence should pin `catalog.json` + schema `$id`s, consume `AgentContext` by scope, and keep origin systems authoritative. Collectors remain idempotent and read-only.

## Versioning

Breaking change → `v2` file and new `schema_version` const; keep `v1`. Additive optional fields → `v1.1`. v1 schemas set `additionalProperties: false`.
