# CAMPAIGN-REPORT — CONFENGE-LEGAL-RISK-ACCEPTANCE-ASAAS-PRODUCTION-01

Date: 2026-08-18 America/Sao_Paulo

## Final honest state

`BLOCKED_SINGLE_EXTERNAL_ACTION_ASAAS_CREDENTIAL`

Production Asaas API key and dedicated webhook token are not present. Integration, fail-closed flags, acceptance-before-checkout, hosted DETACHED checkout, webhook semantics and Warmbly confirmation≠revenue are implemented and tested. No production customer, acceptance, checkout or payment was created.

After the founder sets the named secrets and turns flags on in the documented order, the honest next state is `LIVE_READY_AWAITING_FIRST_REAL_B2B_ACCEPTANCE`.

Not claimed: `LEGAL_APPROVED`, `PRODUCTION_PROVEN`, `PAYMENT_PROVEN`, `REVENUE`.

## SHAs

| Repo | origin/main (base) | campaign head | merge | deploy |
|---|---|---|---|---|
| Governance | `b8644e1cf83987b5301d020be1ec79b2861859d5` | `ae28a4a` (+ founder-action file if amended) | pending PR | n/a |
| web-cfg | `c5c5492066a6f324c146326579ca1c3795ae1a42` | this branch | pending PR after Governance | flags OFF |
| warmbly | `dd4490825f01350add510f41746500947d83f850` | `44a32eca531c8be4a14bb3605485bd33a723b06f` | pending PR | consumer deployable as listener |

## Authority

- `authority_hash` (founder-approved-v1): `sha256:5fd69a314d6b6aab74ba2ab87ae5e90d12ade6360193a18275c9c3377e1fd778`
- `terms_version`: `CFG-LEGAL-TERMS-DIAG-EXP-FOUNDER-v1`
- `decision_token`: `FOUNDER_APPROVED_WITH_DEFERRED_COUNSEL_REVIEW_2026_08_18`
- provisional-v1 unchanged: `sha256:53cb908af9eeaaa1d7097c322394440cff329ff9bd7fb9522ab922801f0cd150`
- diagnostico-v1.1 preserved, not this authority

## Public URLs (after web-cfg deploy)

- https://confenge.com.br/diagnostico-b2g-expansao/
- https://confenge.com.br/comercial/termos-diagnostico-b2g/
- https://confenge.com.br/comercial/privacidade-leads/
- Callbacks (same-origin, not financial truth): `/diagnostico-b2g-expansao/obrigado/`, `/cancelado/`, `/expirado/`

## Endpoints

- `POST /.netlify/functions/offer-terms-accept`
- `POST /.netlify/functions/offer-checkout`
- `POST /.netlify/functions/asaas-webhook`
- Sandbox kept: `offer-checkout-sandbox`, `asaas-webhook-sandbox`

Asaas production host: `https://api.asaas.com/v3` · header `access_token`  
Checkout `billingTypes`: PIX, CREDIT_CARD (BOLETO omitted — official Checkout docs 2026-08-18)  
`chargeTypes`: DETACHED only

## Flag matrix (defaults OFF)

| Flag | Default | Production-on value |
|---|---|---|
| ASAAS_MODE | disabled | production |
| CONFENGE_PRODUCTION_CHECKOUT | false | true |
| CONFENGE_PRODUCTION_WEBHOOK | false | true |
| CONFENGE_REAL_MONEY | false | true |
| CONFENGE_DIAG_CHECKOUT_ENABLED | false | true |
| CONFENGE_OFFER_CATALOG_PUBLIC | false | true |
| CONFENGE_LEGAL_AUTHORITY_HASH | empty | exact pin above |
| CONFENGE_WEBHOOK_APPLY | false | true after webhook receive is live |
| CONFENGE_ONBOARDING_ENABLED | false | optional, after financial confirmation |
| recurring checkout | false | stays false |
| automated refund | false | stays false |
| automated NFS-e | false | stays false |

## Tests

- Governance: `pytest tests/test_legal_provisional.py tests/test_legal_founder_approved.py tests/test_commercial_authority.py` — 64 passed, twice. Hash identical.
- web-cfg production: `node tests/offers/asaas-production/test_asaas_production.mjs` — CONTRACT_PROVEN, twice.
- web-cfg sandbox suite still green.
- Warmbly: `go test ./internal/app/confenge/intel/` — PASS. Confirmed ≠ cash; first received opens counsel reminder; confirmed opens manual NFS-e exception.

## Residual risks (accepted)

See `FOUNDER_RISK_ACCEPTANCE.md`. P0 unmitigated = 0. Professional review deferred until first `PAYMENT_RECEIVED` (10 business days, reminder, not a kill switch). Recurring stays blocked.

## Rollback

1. `CONFENGE_DIAG_CHECKOUT_ENABLED=false` and/or hide catalog public.
2. Keep webhook receive; set `CONFENGE_WEBHOOK_APPLY=false` to pause apply.
3. Rotate `ASAAS_PRODUCTION_WEBHOOK_TOKEN` / disable API key in Asaas UI.
4. Revert deploy. Do not auto-cancel or refund.

## Secret names only

`ASAAS_PRODUCTION_API_KEY`, `ASAAS_PRODUCTION_WEBHOOK_TOKEN`, `CONFENGE_LEGAL_AUTHORITY_HASH`.

## Next real event

First real B2B acceptance of `CFG-DIAG-EXP-v1`. Then exactly one reconciled customer and one hosted checkout. Do not pay on the client's behalf.

## Counsel trigger

First real `PAYMENT_RECEIVED` updates Governance #1 to hire counsel within 10 business days.
