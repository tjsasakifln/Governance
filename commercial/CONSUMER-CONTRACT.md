# Consumer contract — Governance → web-cfg#88 → Warmbly#47

This is the stable contract for commercial-offer consumers. It does not authorize Asaas mutation.

## Canonical files

| Role | Path |
|---|---|
| Canonical machine catalog (internal registry) | `commercial/offers/catalog.v1.json` |
| Public-candidate catalog | `commercial/offers/catalog.public.v1.json` |
| Human-readable catalog (derived, must match renderer) | `commercial/offers/catalog.human.v1.md` |
| JSON Schema | `schemas/offer-catalog.v1.schema.json` |
| Provider mapping (Asaas IDs only; may be null) | `commercial/providers/asaas-mapping.v1.json` |
| Portfolio gates | `commercial/gates/production-gates.v1.json` |
| Diagnóstico limited-production overlay | `commercial/gates/diagnostico-limited-production.v1.json` |
| Capacity | `commercial/capacity/capacity-policy.v1.json` |
| Portfolio terms | `commercial/terms/CFG-TERMS-B2B-2026-08-17-v1.md` |
| Pin | `commercial/authority/authority-manifest.v1.json` |
| Example fixture (no real provider IDs) | `commercial/fixtures/consumer-catalog.example.v1.json` |
| Consumer compatibility contract | `commercial/compatibility/consumer-compatibility.v1.json` |
| Read-only CI compatibility fixture | `commercial/fixtures/consumer-compatibility.ci.v1.json` |

Governance is the only commercial truth plane. `web-cfg#88` is the delivery parent. `Warmbly#47` is the reconciliation/learning consumer. Do not copy these files into those repos as a writable second catalog.

## How consumers detect version drift

1. Record the git SHA of `tjsasakifln/Governance`.
2. Run `python scripts/validate_commercial_authority.py`.
3. Persist the printed `AUTHORITY_HASH sha256:<hex>` (SHA-256 of canonical authority-manifest JSON).
4. Re-run the validator in CI. A changed hash is a stale pin — do not silently accept a new catalog.
5. Optionally verify each artifact `content_hash` listed in the manifest.

A local freeze in web-cfg (for example `scripts/offers/registry.cjs`) is not authority. If it disagrees with this catalog, Governance wins.

Known freeze drift (do not copy back into Governance):

- web-cfg one-off uses `commitment_months=0`, `max_payments=1`, `total_commitment_cents=800000`, `notice_days=0`; Governance one-off uses `null`.
- web-cfg billing enums `one_time` / `subscription`; Governance enums `ONE_TIME` / `RECURRING`.
- web-cfg `scope_version` freeze `CFG-SCOPE-B2B-2026-08-17-v1`; Governance per-offer `CFG-SCOPE-DIAG-EXP-v1` / `CFG-SCOPE-DIRB2G-STD-v1`.

The versioned compatibility contract is `commercial/compatibility/consumer-compatibility.v1.json`. Rule: `GOVERNANCE_WINS`. Consumers may keep those values as **aliases only**. Silent coercions that would persist `0`/`1`, lowercase billing, or `CFG-SCOPE-B2B-2026-08-17-v1` as Governance truth are forbidden. Pin `COMPATIBILITY_HASH` from the shipped validator (also copied into the read-only CI fixture). Do not edit web-cfg or Warmbly from this package.

## Offer lifecycle

| Event | Rule |
|---|---|
| Price change | New `offer_version` (and a new `offer_id` / `offer_code` suffix). Same version + different cents is invalid. |
| `RETIRED` | Remains historical in the catalog. It must not vanish and must not return to `ACTIVE`. |
| `PAUSED` or `sold_out=true` | Blocks checkout. Capacity exhaustion pauses contracting; it does not change price. |
| `DRAFT` | Not checkoutable. |
| `APPROVED` | Catalog authority only. Not portfolio `ACTIVE`. |
| `ACTIVE` | Illegal while required portfolio gates are `UNKNOWN`/`PENDING`. |

## Checkout and overlay

Portfolio flags in `production-gates.v1.json` stay fail-closed:

```
production_checkout_enabled    = false
production_webhook_enabled     = false
real_money_mutation_approved   = false
public_activation_approved     = false
```

The Diagnóstico overlay (`diagnostico-limited-production.v1.json`) authorizes **only** `CFG-DIAG-EXP-v1` / `800000` / `ONE_TIME`. It does **not**:

- flip portfolio gates;
- authorize recurring checkout;
- replace `CFG-TERMS-B2B-2026-08-17-v1`;
- claim `LEGAL_APPROVED`.

Scoped Diagnóstico terms (`CFG-LEGAL-TERMS-DIAG-EXP-FOUNDER-v1`) are an overlay, not a portfolio rewrite.

Kickoff/onboarding requires confirmed payment + accepted terms (+ final capacity reservation when recurring). Created provider objects are not received revenue.

Provider mapping IDs may be null. Null mapping means the founder has not copied Asaas IDs back. That does **not** invent a product. It also does not by itself authorize creating a charge.

## Public vs internal fields

**May appear on a visitor-facing surface** (after publication is separately approved):

`offer_id`, `offer_version`, `public_name`, `description_short`, `amount_cents`, `currency`, `billing_mode`, `cycle`, `commitment_months`, `max_payments`, `total_commitment_cents`, `notice_days`, `checkout_mode`, `status`, `recommended`, `silent_renewal`, `scope_version`, `terms_version`, Diagnóstico deliverables/credit/SLA, 180/365 recomposition caps.

**Internal (consumers may read; do not render to visitors):**

`internal_code`, `description_asaas`, `provider_mapping_status`, `approval_state`, `change_reason`, `capacity_required`, `capacity_units`, `effective_from`, `effective_to`, `sold_out`, `funnel_role`, `upsell_policy`, `offer_code` (alias of `offer_id`), mapping table IDs, Extra exception, pending founder inputs.

`catalog.public.v1.json` is the public-candidate machine file. It is still `NOT_PUBLISHED`. It must never contain Extra `1000000` cents/month.

## Upsell

Diagnóstico `funnel_role=ENTRY_ONE_OFF`. The documented R$ 2.000 credit is a next action if a recurring plan is contracted within 60 days after delivery. It is not a promised recurring conversion.

## Pending founder input (not a catalog offer)

A priced baixa-fricção SKU is `PENDING_FOUNDER_INPUT`. See `commercial/offers/pending-founder-inputs.v1.json`. Absence of that SKU does not block the documented v1 catalog.
