# ADR-CFG-OFFER-CATALOG-001

**Status:** Accepted (catalog, ownership and commercial architecture). Production go-live remains gated.  
**Date:** 2026-08-17  
**Campaign:** `CONFENGE-GOV-OFFER-AUTHORITY-V1-01`  
**Source:** Governance #1  
**Mirrors:** web-cfg #88 (delivery parent), Warmbly #47 (reconciliation consumer)

## Context

Commercial decision for CONFENGE offers, terms, capacity and production gates lived as mutable issue prose. Consumers (web-cfg, Warmbly) cannot pin, hash or reject invalid fixtures against free text. A public R$ 10.000/month annual plan is rejected. The Extra historical condition must not leak into any public catalog.

This repository's root README remains a personal portfolio. This ADR and `commercial/` are the CONFENGE commercial-offer authority plane. They do not make this repository an application, billing engine or second checkout host.

## Decision

1. Encode the v1 catalog, terms, capacity policy and production gates as versioned JSON plus JSON Schema.
2. Money is integer centavos in BRL. Floats are invalid.
3. Closed offer states: `DRAFT`, `APPROVED`, `ACTIVE`, `PAUSED`, `RETIRED`. Catalog presence is not `ACTIVE`. This version ships every public offer as `APPROVED`.
4. Authority flags for this campaign:
   - `catalog_authority = APPROVED`
   - `production_checkout_enabled = false`
   - `production_webhook_enabled = false`
   - `real_money_mutation_approved = false`
   - `public_activation_approved = false`
   - `sandbox_preparation_approved = true`
   - `manual_preparation_approved = true`
5. `UNKNOWN` stays `UNKNOWN`. Absence of a rejection is not approval.
6. Extra historical condition lives only in `commercial/exceptions/extra-historical.v1.json` and cannot serialize into `catalog.public.v1.json`.
7. A price change requires a new `offer_version`. `RETIRED` remains historical.
8. Consumers pin `authority-manifest.v1.json` by SHA-256 of its canonical JSON. They do not copy secrets and do not create a second truth plane.
9. Asaas hosts payment later. This package contains no provider product/customer/subscription IDs, no API keys and no checkout URLs.

## Immutable v1 offers

| offer_code | billing | amount_cents | commitment |
|---|---|---|---|
| CFG-DIAG-EXP-v1 | ONE_TIME | 800000 | 10–15 business days; credit 200000; no recurring slot |
| CFG-DIRB2G-FLEX-v1 | RECURRING MONTHLY | 2000000 | no min; notice 30 days; no max_payments/endDate |
| CFG-DIRB2G-180-v1 | RECURRING MONTHLY | 1500000 | 6 × parcela = 9000000; recommended |
| CFG-DIRB2G-365-v1 | RECURRING MONTHLY | 1250000 | 12 × parcela = 15000000 |

## Consequences

- web-cfg and Warmbly validate fixtures against these artifacts and the printed authority hash.
- Publication, production checkout, production webhook, NFS-e and real money stay blocked until named gates leave `UNKNOWN` with evidence.
- Governance #1 remains open until go-live gates are actually approved.
- Changing Extra, prices or terms is a new version plus explicit authority — not an edit-in-place of v1.

## Addendum 2026-08-20 — field-complete consumer contract

Campaign `CONFENGE-GOVERNANCE-OFFER-AUTHORITY-CONVERGENCE-01` adds the named registry fields (`offer_id`, `internal_code`, descriptions, capacity, `checkout_mode`, mapping status, effective dates, `approval_state`, `change_reason`) without changing v1 prices, names or scopes. Asaas IDs live only in the mapping table and may be null. The Diagnóstico founder-approved overlay is recorded separately and does not flip portfolio gates or replace `CFG-TERMS-B2B-2026-08-17-v1`. See `commercial/CONSUMER-CONTRACT.md` and `commercial/DECISIONS-CHANGELOG.md`.
