# CONSUMER-HANDOFF — CONFENGE commercial authority v1

This directory is the only commercial-offer truth plane for CONFENGE v1.  
Do not copy these files into web-cfg or Warmbly as a second catalog. Pin them.

The stable consumer contract is `commercial/CONSUMER-CONTRACT.md`.

## Who consumes what

| Consumer | Role | What to read |
|---|---|---|
| `web-cfg#88` | delivery parent — catalog, contracting, capacity, terms | `catalog.public.v1.json` for any public surface; `catalog.v1.json` for the internal registry; `production-gates.v1.json` before any checkout flag; `diagnostico-limited-production.v1.json` for the Diagnóstico overlay; `asaas-mapping.v1.json` for provider IDs; `capacity-policy.v1.json` before a recurring hold |
| `Warmbly#47` | reconciliation / learning consumer | `authority-manifest.v1.json` plus gates, overlay, mapping and capacity; never treat provider `customer`/`checkout`/`subscription`/`payment` **created** as received revenue |
| Governance #1 | residual human issue | stays open; not a machine source after this package exists |

## How to pin (no second truth plane)

1. Record the git SHA of `tjsasakifln/Governance` that you consume.
2. Run, from that SHA:

   ```bash
   python scripts/validate_commercial_authority.py
   ```

3. Persist the printed `AUTHORITY_HASH sha256:<hex>` next to your fixture pin. That hash is SHA-256 of the canonical authority manifest (sorted keys, UTF-8, compact JSON). Build timestamps are not part of any `content_hash`.
4. Re-run the validator in CI. If the hash changes, the pin is stale — do not silently accept a new catalog.
5. Optionally verify each artifact's `content_hash` listed in `commercial/authority/authority-manifest.v1.json`.

Do **not**:

- duplicate offer prices into application config as a writable source;
- copy `commercial/exceptions/extra-historical.v1.json` into a public bundle;
- invent `max_payments` / `endDate` for Flex;
- treat `PUBLIC_CANDIDATE` + `NOT_PUBLISHED` as a live storefront;
- store Asaas API keys, webhook secrets, customer/product/subscription IDs or checkout URLs in this repository or in a fork of these files.

## Fail-closed flags (this campaign)

```
catalog_authority              = APPROVED
production_checkout_enabled    = false
production_webhook_enabled     = false
real_money_mutation_approved   = false
public_activation_approved     = false
sandbox_preparation_approved   = true
manual_preparation_approved    = true
```

`ACTIVE` is illegal while required gates are `UNKNOWN` or `PENDING`.  
`UNKNOWN` is not approval.

Diagnóstico limited production is a **scoped overlay** (`commercial/gates/diagnostico-limited-production.v1.json`) for `CFG-DIAG-EXP-v1` / `800000` / `ONE_TIME` only. It does not flip the portfolio flags above, does not authorize recurring checkout, and does not replace `CFG-TERMS-B2B-2026-08-17-v1`. `PAUSED`, `sold_out` and `RETIRED` still block checkout.

## Public vs private

- Public surface: `commercial/offers/catalog.public.v1.json` only.
- Private Extra exception: `commercial/exceptions/extra-historical.v1.json` only.
- The public exporter refuses any exception with `public_serialization_allowed: false`.
- There is no public offer of `1000000` cents/month.

## Terms and capacity that must be preserved

- `terms_version = CFG-TERMS-B2B-2026-08-17-v1`
- Obligation of means; first confirmed payment before kickoff
- 50 recurring slots; one standard contract = one slot; 72-hour hold; reservation after confirmed payment
- Flex: 30-day billable notice; 180/365: no silent renewal after `max_payments`
- 6% tax premise ≠ confirmed regime; NFS-e blocked

## Schema contracts

- `schemas/offer-catalog.v1.schema.json`
- `schemas/production-gates.v1.schema.json`
- `schemas/authority-manifest.v1.schema.json`
- `schemas/provider-mapping.v1.schema.json`
- `schemas/diagnostico-limited-production.v1.schema.json`

Validate local fixtures with the shipped validator functions. Do not re-implement totals or hashing.
