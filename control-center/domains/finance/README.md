# Control Center — finance read-model

Executive finance view for Confenge Control Center. This package is **not**
an ERP, **not** a payment provider client, and **not** a chat surface. It
aggregates observed commercial/finance events into six money stages plus
windowed cash-in, AR aging, client concentration, gated MRR, and gated runway.

Ownership path: `control-center/domains/finance/`.

## Decisions

1. **Stages are not aliases.** Contratada, faturada, paga, efetivamente
   recebida, vencida, and a receber are computed separately. Caixa KPIs
   (`efetivamente_recebida`, `cash_in`) never include contracted-only,
   invoiced-only, unpaid, refunded, or charged-back amounts.
2. **Paga is not caixa.** `payment_confirmed` (provider CONFIRMED) is paga.
   Only `settlement_received` (provider RECEIVED / credit date / cash) is
   efetivamente recebida. If paid lacks settlement proof, the snapshot sets
   `incomplete_data` with `paid_without_settlement` and still reports 0 caixa
   for that amount.
3. **Chargeback and refund reduce caixa.** They subtract from efetivamente
   recebida and from cash-in in the window they occur. Chargeback reinstates
   AR; refund closes the invoice (no AR).
4. **Overdue is never received cash.** Vencida is the overdue subset of
   a receber.
5. **MRR is semantic.** Only `billing_mode=RECURRING` with `billing_cycle=MONTHLY`
   contributes. Diagnóstico-style `ONE_TIME` contributes 0. Non-monthly
   recurring is omitted from the MRR number and flagged incomplete — not
   invented via FX-style division.
6. **Runway is omitted unless reliable expenses exist.** A runway **number**
   is emitted only when both a `cash_balance` observation and expenses with
   `confidence >= 0.8` are present and burn is positive. Missing expenses
   never invent a burn rate from contracted revenue.
7. **Money is integer cents + ISO-4217 currency.** Mixed currencies fail
   closed. No floats.
8. **Every aggregated figure carries** `source`, `observed_at`,
   `freshness_status`, and `confidence`. Incomplete inputs set flags; they
   do not fill optimistic cash.
9. **Manual adjustments are append-only** with provenance and an audit
   record. `provider_mutation` is always `forbidden`. This package never
   calls Asaas or any provider.
10. **Collectors/adapters are idempotent** on `idempotency_key`.
11. **Read-only by default.** No checkout, charge, refund, cancel, or Asaas
    write APIs exist here.

## How to run

Requires Node ≥ 20.

```bash
cd control-center/domains/finance
npm install
npm test
npm run typecheck
npm run consumer
npm run cli -- --fixture fixtures/mixed-stages.json
```

`npm test` drives the shipped aggregator (`aggregateFinanceReadModel`) on
checked-in fixtures. `npm run consumer` imports the public API from a file
that is not the aggregator unit test.

## Env vars

None are required. This package holds **no provider credentials**.

| Variable | Default | Purpose |
| --- | --- | --- |
| `CC_FINANCE_FRESHNESS_WINDOW_SECONDS` | `86400` | FRESH vs STALE window for figure provenance |
| `CC_FINANCE_FIXTURE` | — | Optional default fixture path for the CLI |

Do not put API keys, tokens, or Asaas `$aact_` values in env files committed
here. Logs refuse secret-bearing field names.

## Public contract (local)

Schema: `control-center.finance.read-model.v1`.

This is **intentionally richer** than the sibling contracts-package stub
`FinanceSnapshot` (`receivables_open` / `receivables_overdue` only). This
workstream does not import or edit `control-center/contracts/`.

Local observation events (`FinanceEvent`) are the input. The aggregator is
a pure function over that list plus `{ as_of, cash_in_window }`.

Mapping for later convergence with the contracts stub:

| contracts-package | this read-model |
| --- | --- |
| `receivables_open` | `figures.a_receber` |
| `receivables_overdue` | `figures.vencida` |

Helper: `toContractsStub(snapshot)`.

## Expected later integration

Other Control Center workstreams (not this PR):

- **Asaas collector (`control-center/connectors/asaas`)** should emit
  `FinanceEvent` rows (or an isomorphic observation) with:
  - CONFIRMED → `payment_confirmed` (`settlement_proven=false`)
  - RECEIVED / RECEIVED_IN_CASH → `settlement_received` (`settlement_proven=true`)
  - OVERDUE → `invoice_overdue`
  - REFUNDED* → `refund`
  - CHARGEBACK* → `chargeback`
  - offer `CFG-DIAG-EXP-v1` → `ONE_TIME`
  - DIRB2G offers → `RECURRING` + `MONTHLY`
- **Persistence (`control-center/persistence`)** should store events and
  snapshots with integer cents, provenance, and append-only audit. This
  package currently uses an in-memory ledger + JSON fixtures.
- **MCP / context service** should expose the snapshot **by scope**
  (`finance`, `company`, `client:<slug>`), never dump the whole memory.
  Financial/provider actions remain forbidden.

Until those packages land, fixtures under `fixtures/` are the observation
port. Collectors must stay GET-only; this read-model never mutates them.

## Capacity / catalog alignment (read-only)

Governance capacity policy: created customer / checkout / subscription /
payment is **not** received revenue. Diagnóstico is `ONE_TIME`; DIRB2G
offers are `RECURRING`. Those rules are encoded in classification, not by
copying catalog files into this package.

## Non-goals

Live Asaas calls, cobrança, DRE, NFS-e, FX, multi-entity accounting,
absorbing Governance PR #8, and edits under `commercial/`, `decisions/`,
`scripts/`, or other `control-center/` workstreams.
