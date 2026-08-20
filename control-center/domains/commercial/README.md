# Control Center — commercial executive read model

Ownership path: `control-center/domains/commercial/`.

This package projects **Warmbly-shaped commercial observations** plus a **read-only Governance offer pin** into a one-screen executive summary: funnel counts, pipeline money, exceptions, and at most three `now` attention items.

It is not chat, not an ERP, not a second catalog, and not a Warmbly or Asaas client. It never mutates Warmbly, Asaas, checkout, refund, cancel, or commercial send.

## Decisions

1. **Governance is catalog/terms authority. Warmbly is commercial runtime.** This document is a read model (`authority.this_document = read_model`).
2. **Offer pin is identity only.** The pin carries `authority_id`, `catalog_id`, `offer_id` + `offer_version` pairs, and the Extra historical marker (`1000000` cents / `CFG-EXC-EXTRA-HISTORICAL-v1`). It does **not** copy `commercial/offers/catalog.v1.json` (no names, prices, terms, copy). Extra is **not an offer**.
3. **Provenance on every aggregate.** `source`, `observed_at`, `freshness_status`, and `confidence` when applicable.
4. **Local freshness set:** `FRESH` | `STALE` | `UNKNOWN` | `ERROR` (contracts workstream). Persistence currently uses `fresh` | `stale` | `unknown` | `expired`. Map at the persistence boundary later; do not rewrite persistence from here.
5. **Money is integer cents + ISO currency.** Warmbly major-unit floats convert fail-closed (no silent rounding). `10.001` is not cents.
6. **Nominal pipeline** is the sum of known open-pipeline cents. **Weighted pipeline** is emitted only when every open item has a known amount **and** a `probability` in `[0, 1]` marked `probability_reliable: true`. Otherwise `insufficient_data`. Warmbly CRM deals have no win-probability field today — weighted `insufficient_data` is correct, not a gap to fill by invention.
7. **Funnel keys (fixed):** `novos_leads`, `qualificados`, `oportunidades`, `propostas`, `clientes`. Unclassifiable / `UNKNOWN` records do not inflate those counts.
8. **Attention is action, not a KPI wall.** Exceptions include aging, missing next action, stalled stages, conversion-window gaps, unknown `offer_id`, version drift, and Extra-as-offer. Homepage-shaped slice: horizon `now`, max 3, one item per record, highest-rank first.
9. **Fail closed.** Incomplete fixtures yield zeros, `UNKNOWN`, or `insufficient_data`. The projection does not throw into invented counts.
10. **Single-user later, no hardcoded identity/password.** No secrets in git, logs, URLs, or a client bundle. Logs are structured JSON on stderr with secret/PII keys redacted.
11. **Read-only.** No HTTP client. Convergence with the Warmbly connector is a later campaign.

## Layout

```
src/contracts.ts    local observation + summary types; sibling interfaces
src/normalize.ts    coerce incomplete input; classify funnel; money convert
src/project.ts      shipped projection (funnel, pipeline, exceptions, attention)
src/cli.ts          fixture → JSON summary
src/money.ts        fail-closed cents
fixtures/           complete, exceptions, incomplete, discrepancies, probabilities
tests/              drive projectCommercialSummary / runFixture / CLI
```

## Run

Requires Node ≥ 20.

```bash
cd control-center/domains/commercial
npm install
npm test
npm run typecheck
npm run summary -- --fixture fixtures/representative.json --now 2026-08-20T12:00:00Z
```

Two consecutive `summary` runs with the same fixture and `--now` (or the fixture's `observed_at`) print identical JSON.

## Env vars

See `env.example`. This package reads only:

| Variable | Role |
|---|---|
| `COMMERCIAL_READMODEL_NOW` | Optional RFC3339 UTC clock pin for the CLI |
| `COMMERCIAL_READMODEL_FIXTURE` | Optional default fixture path |

It does **not** read `WARMBLY_*` or Asaas credentials. Those belong to the connector workstream.

## Expected convergence

Do not import sibling trees from this package. Later:

| Workstream | Expected wiring |
|---|---|
| `control-center/connectors/warmbly` | Emit `CommercialObservationSet` (records + provenance) from read-only Warmbly fetches. This projection consumes that shape. |
| `control-center/contracts` | Today's `CommercialSnapshot` v1 is thin (`pipeline_open_count`, …). An additive revision should carry funnel + pipeline money + attention, or wrap this summary. |
| `control-center/persistence` | Store the summary as an operational snapshot scoped `commercial`. Translate freshness enums at the boundary. |
| `control-center/services/context` + MCP | Agents query by scope `commercial`. They do not receive whole-company memory. |
| Governance `commercial/` | Remain the writable catalog authority. This path only **pins** `offer_id` / `offer_version`. |

Financial/provider mutation stays forbidden.

## Thresholds (UTC)

| Signal | Window |
|---|---|
| Fresh vs stale | 24 hours from `observed_at` |
| Aging | 14 days without activity |
| Stalled stage | 14 days in the same stage |
| Conversion window | `expected_close_at` in the past, or 30 days in `oportunidades` / `propostas` |
