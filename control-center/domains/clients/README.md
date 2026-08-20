# Control Center — clients domain

Read model for **account health / delivery commitments**, not a CRM.

Warmbly remains the commercial/CRM authority (contacts, leads, pipeline,
email). Governance remains the strategic/canonical authority. This package
aggregates delivery state so a homepage can answer:

> Qual cliente precisa de mim agora e por quê?

It does not own client master data, does not send commercial messages, and
does not charge, refund, checkout, or mutate Asaas/providers.

## Decisions

- Not a parallel CRM. Identity is a stable `client_slug` plus a
  non-sensitive `display_name`. No extra PII, government IDs, secrets, or
  payment instruments.
- Every aggregated fact carries `source`, `observed_at` (UTC),
  `freshness_status`, and `confidence` when applicable. Missing provenance
  is rejected at ingest.
- Sources this wave: `manual`, `governance`, `adapter:<port>` (future
  connector). Derived fields use `derived:<algorithm>` and are never
  accepted as ingest input.
- Commitments require `owner`, `due_at`, `evidence_ref`, `status`.
- Health is a deterministic, explainable, rule-based score. No ML.
- Queries are scoped. `client:<slug>` never dumps other clients.
- Persistence this wave is an in-process store with the same operations a
  later Postgres adapter must match. This package does not import
  `control-center/persistence` or `control-center/contracts` (siblings are
  absent on `main`).
- Money, if ever attached by a future adapter, is integer `amount_cents` +
  ISO-4217 `currency`. This domain does not store receivables.

## Run

Requires Node >= 20.

```bash
cd control-center/domains/clients
npm install
npm test
npm run consumer
npm run typecheck
```

`npm test` drives the shipped ingest, health-score, and query operations
with PII-free fixtures. `npm run consumer` is a separate process that loads
the same fixtures through the public API and prints the homepage payload.

## Env vars

See `.env.example`. None are required for tests or the consumer.

| Variable | Purpose |
| --- | --- |
| `CONTROL_CENTER_CLIENTS_STORE` | `memory` (only supported value this wave) |
| `CONTROL_CENTER_DISPLAY_TZ` | presentation timezone; internal timestamps stay UTC |
| `DATABASE_URL` | reserved for convergence; unused here; never commit |

No identity, password, or API token is read by this package.

## Local contract / adapter

While sibling workstreams are not on `main`, this package owns a local copy:

- `src/contract.ts` — ClientStatus, Provenance, Commitment, Blocker,
  Deliverable, Risk, AttentionItem
- `src/store.ts` — `ClientStatusRepository` + `InMemoryClientStore`
- `src/ops.ts` — `createClientOps()` facade

`ClientFactsPort` is the future adapter interface (`adapter:<port>` source).
Do not implement Warmbly/Asaas/GitHub pulls here.

### Convergence mapping

Canonical `control-center/contracts` (not imported) uses a `SourceRef`
object and uppercase freshness. Mapping at the later convergence campaign:

| This package | Contracts (expected) |
| --- | --- |
| `source: "manual"` | `{ system: "manual", kind: "human-entry", locator: "manual" }` |
| `source: "governance"` | `{ system: "governance", kind: "canonical", locator: "governance" }` |
| `source: "adapter:<port>"` | `{ system: "<port>", kind: "adapter", locator: "adapter:<port>" }` |
| `fresh` / `stale` / `unknown` / `error` | `FRESH` / `STALE` / `UNKNOWN` / `ERROR` |
| `client_slug`, `display_name`, `scope`, `id`, `schema_version` | same names |
| health, commitments, next_action, due_dates, blockers, deliverables, risk | extend the thin contracts `ClientStatus` stub |

## Query contract for later consumers

Homepage (exceptions + “the 3 things that matter now”) should call
`queryAttention()` / `toHomepageAttention()` — not own client rows.

```ts
createClientOps({ now }).queryAttention({ scope?: "client:<slug>" | "clients" })
// → { client_slug, display_name, why, next_action, health_score, reasons, urgency }[]
```

MCP `confenge.get_client_context` should call `getClient(slug)` or
`queryAttention({ scope: "client:<slug>" })`. A scoped read must not
return another client.

Persistence should implement `ClientStatusRepository` (`upsert`,
`getBySlug`, `list`) on PostgreSQL with the same provenance columns.

## Out of scope this wave

Homepage UI, MCP server, Context API, Postgres migrations, Warmbly
connector, Asaas, commercial send, and any write outside
`control-center/domains/clients/`.
