# Decisions changelog — offer catalog authority convergence

Campaign: `CONFENGE-GOVERNANCE-OFFER-AUTHORITY-CONVERGENCE-01`
Date: 2026-08-20
Base: origin/main `4d4388ce7208ddac0f78576b69185bbaf2203d30`

## Incorporated (already documented; copied, not invented)

| Decision | Source | Where it lives now |
|---|---|---|
| Four v1 offers and integer BRL cents | Governance#1, `catalog.v1.json` | catalog (same amounts) |
| Diagnóstico `800000` ONE_TIME; Flex `2000000` null max_payments; 180 = `6 * 1500000`; 365 = `12 * 1250000` | Governance#1 / catalog v1 | catalog |
| Extra `1000000` cents/month × 6 private | Governance#1 / extra-historical | private exception only |
| Portfolio terms `CFG-TERMS-B2B-2026-08-17-v1` | Governance#1 2026-08-17 | terms + every offer `terms_version` |
| No silent renewal; first payment before kickoff; capacity before recurring checkout | Governance#1 / terms | catalog + capacity + gates |
| Early-exit formula 180/365 | Governance#1 / terms | recomposition on those offers |
| Diagnóstico limited production overlay | founder-approved-v1, #1 comment 2026-08-19 | `diagnostico-limited-production.v1.json` |
| Recurring production checkout remains false | same overlay + portfolio gates | gates + overlay `recurring_checkout_approved=false` |
| Named registry fields (offer_id, internal_code, checkout_mode, capacity, mapping status, effective dates, approval_state, change_reason) | Governance#1 registry section; web-cfg#88 freeze for names/codes only | catalog v1 field-complete |
| `internal_code` values `CFG-DIAG-EXP` / `CFG-DIRB2G-FLEX` / `CFG-DIRB2G-180` / `CFG-DIRB2G-365` | web-cfg `registry.cjs` freeze of Governance#1 | catalog |
| `checkout_mode` DETACHED vs SUBSCRIPTION | Governance#1 “detached checkout/link”; web-cfg freeze | catalog |
| `externalReference` `cfg:{offer_id}:{correlation_id}` | web-cfg Asaas sandbox fixtures | mapping table policy |
| Upsell is next action, not promise | Governance#1 Diagnóstico credit window | `upsell_policy` |

## Explicitly not incorporated

| Item | Why |
|---|---|
| Priced baixa-fricção / low-friction SKU | Not in origin/main, #1, or last-72h evidence. `PENDING_FOUNDER_INPUT` on name, amount, billing, scope. |
| web-cfg one-off `max_payments=1` / `commitment_months=0` / `notice_days=0` | Contradicts Governance one-off nulls and schema. Governance remains canonical. |
| Partner program (Governance#7 / PR#8) | Out of this catalog. |
| Extra as public offer or coupon | Forbidden. |
| SmartLic billing | Forbidden. |
| Portfolio `LEGAL_APPROVED` / recurring go-live / automated NFS-e or refund | Overlay does not flip those gates. |
| Silent replacement of `CFG-TERMS-B2B-2026-08-17-v1` by Diagnóstico founder terms | Overlay only. |

## Still founder-owned (not catalog invention)

| Field | Owner | Blocks v1 catalog verdict? |
|---|---|---|
| Asaas `asaas_product_id` / `checkout_id` / subscription mapping | Founder manual cadastro, then copy-back | No |
| Production API key / webhook token | Founder secret store (never this repo) | No (operational) |
| Low-friction SKU name/amount/billing/scope | Founder, if they want a new offer version | No |
| Staffed capacity inventory numbers beyond the 50-slot policy | Delivery owner | Recurring checkout stays blocked |
| Accountant NFS-e classification | Accountant | NFS-e stays blocked |
| Counsel review after first `PAYMENT_RECEIVED` | Founder hire, 10 business days | Not a kill switch |

## Verdict

`OFFER_CATALOG_AUTHORITY_READY_FOR_ASAAS_REGISTRATION`

Pending Asaas IDs after manual cadastro do not justify `OFFER_CATALOG_BLOCKED_ON_NAMED_FOUNDER_FIELDS`. Every required v1 commercial value (name, amount, billing, scope) is present in current evidence.
