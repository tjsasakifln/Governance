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
| Delegated first-touch routing policy (published, historical) | `commercial/outbound/cfg-first-touch-routing.v1.json` |
| Delegated first-touch routing policy (published, historical) | `commercial/outbound/cfg-first-touch-routing.v2.json` |
| Delegated first-touch routing policy (current) | `commercial/outbound/cfg-first-touch-routing.v3.json` |
| First-touch routing JSON Schema (current) | `schemas/cfg-first-touch-routing.v3.schema.json` |
| First-touch consumer expectations (current) | `commercial/outbound/consumer-expectations.v3.json` |
| First-touch contract fixtures (current) | `commercial/fixtures/first-touch-routing-v3/matrix.v1.json` |

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
| `PAUSED` or `sold_out=true` | Static kill switch that blocks checkout. Capacity exhaustion pauses contracting; it does not change price. |
| `sold_out=false` | Means only “no static catalog block”. It is **not** dynamic availability and never yields `CAN_ACCEPT` without a fresh `confenge.capacity_admission.v2` decision for the exact deliverable/version/deadline. |
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

`sold_out` is retained only for v1 compatibility as a manual/static block. Consumers MUST NOT persist or derive `available`, staffed inventory, WIP, deadline feasibility or checkout eligibility from it. Dynamic admission comes only from Governance's versioned read-only decision; an absent, invalid or expired decision is `UNKNOWN` and fail-closed.

`catalog.public.v1.json` is the public-candidate machine file. It is still `NOT_PUBLISHED`. It must never contain Extra `1000000` cents/month.

## Upsell

Diagnóstico `funnel_role=ENTRY_ONE_OFF`. The documented R$ 2.000 credit is a next action if a recurring plan is contracted within 60 days after delivery. It is not a promised recurring conversion.

## Pending founder input (not a catalog offer)

A priced baixa-fricção SKU is `PENDING_FOUNDER_INPUT`. See `commercial/offers/pending-founder-inputs.v1.json`. Absence of that SKU does not block the documented v1 catalog.

## Outbound commercial qualification — COMMERCIAL_AUTHORITY/2.0

`CFG-FIRST-TOUCH-ROUTING-v3` is the current outbound routing policy. It consumes
`COMMERCIAL_AUTHORITY/2.0` / `COMMERCIAL_AUTHORITY_POLICY/2.0`. v1 and v2 stay
machine-readable with their original semantics and are not reinterpreted.

The canonical, non-negotiable business rule is:

> CONFENGE commercial qualification is based on qualifying public engineering contracting evidence within a rolling three-year window. PNCP/source freshness is acquisition health and MUST NOT by itself revoke, hold, dequeue or block transport for an otherwise valid commercially-qualified member.

### Qualification

| Question | Rule |
|---|---|
| Who qualifies | A company that figured as CONTRACTED SUPPLIER / FORNECEDORA on a public engineering work or service. `party_role` must be `SUPPLIER` (`FORNECEDORA` / `CONTRATADA` are accepted spellings of the same role). |
| Who never qualifies | The contracting body. `BUYER`, `CONTRACTING_AUTHORITY`, `CONTRATANTE` and `ORGAO` are refused with `commercial_qualification_party_role_invalid`, whatever else is true about the record. |
| Identity | CNPJ root (`cnpj_root8`). Qualification is per root, not per branch and not per contact. |
| Window | Rolling three years, evaluated against the CONTRACTING ACT date. There is no TTL and no grace period anywhere in the contract. |
| Qualifying date | Deterministic precedence over the canonical contracts view `v_contracts_canonical_v2`: `data_assinatura` -> `data_inicio` -> `data_publicacao` -> `data_publicacao_fonte`. `data_fim` is deliberately excluded: it is an execution-end estimate, frequently null, and would make the window non-deterministic. |
| `qualified_until` | Derived as contracting date + 3 years with forward calendar normalization (`2024-02-29` + 3y = `2027-03-01`). It is never declared by the producer; a producer-declared value that does not reconcile is `commercial_qualification_window_invalid`. |
| Several contracts | The company stays `QUALIFIED` while at least one contracting act is inside the window. The declared qualifying act must be the newest one counted. |
| States | `QUALIFIED` \| `EXPIRED` \| `REVOKED` \| `UNKNOWN`. The v1 age bands `CURRENT` / `DEGRADED` / `FROZEN_FOR_NEW_ADMISSION` / `EXPIRED` (24h / 72h / 168h) are abolished. |

Per-root evidence that must be persisted or derivable: `cnpj_root8`,
`target_fit_class`, `party_role`, `qualifying_contract_id`,
`qualifying_contract_date`, `qualifying_date_field`, `qualifying_contract_count`,
`qualified_until`, `qualification_evidence_hash`,
`qualification_evidence_reference`, `provenance`, `deactivated`,
`deactivation_reason`.

### What blocks, and what does not

| Condition | Effect |
|---|---|
| Explicit deactivation / revocation | Blocks immediately and beats everything, including a live qualifying contract. Reason `commercial_qualification_revoked`. Time alone restores nothing. |
| Qualification expiry | Contracting act older than the rolling window: `EXPIRED`, reason `commercial_qualification_expired`. |
| Missing qualification | `UNKNOWN`, reason `commercial_authority_missing`. Never inferred from a fresh source. |
| Evidence drift | Reason `commercial_qualification_evidence_drift` (hash, date field or counted acts do not reconcile). |
| Party-role invalid | Reason `commercial_qualification_party_role_invalid`. |
| Window invalid | Reason `commercial_qualification_window_invalid`. |
| Unrecognised authority policy | Reason `commercial_authority_policy_unsupported`. Unknown is never "probably v2". |
| DNC / opt-out | Blocks transport for that recipient. |
| Suppression | Blocks transport for that recipient. |
| Hard bounce | Blocks transport for that recipient. |
| Recipient expiry | Blocks that recipient; the company stays qualified. |
| Policy revocation / drift | Invalidates the delegated approval and routes to the human exception path. |
| Source health `FRESH` / `DEGRADED` / `STALE` / `MISSING` | Reported for observability only. It is never a blocker, never revokes a proven qualification, and never grants authority by fallback. |

The readiness blocker `source_health_not_fresh_strict_fallback` is retired and
replaced by `commercial_authority_missing`. First-window readiness may
legitimately report `source_health=STALE` together with
`commercial_authority=QUALIFIED` and a verdict of
`ARMED_FOR_NEXT_BUSINESS_WINDOW` or `TRANSPORT_ACTIVE_IN_WINDOW`.

### Transport-time conjunction

Every member must pass: commercial qualification (the three-year rule), supplier
party role, membership/evidence binding integrity, recognised policy version,
delegated decision integrity, recipient validity, recipient-belongs-to-company,
no hard bounce, no DNC, no suppression/opt-out, no party-role conflict, copy/QA,
message/context binding, idempotency, mailbox validity, rate limits, send window,
transport governor, kill switch, worker health.

Source health is **not** in this conjunction. Neither is feed age, crawler lag or
any other acquisition signal.

### Founder-facing presentation

A late acquisition source is an acquisition-plan condition, not an outbound
verdict. Present it as:

> Atualização de mercado atrasada; novos leads podem não estar refletidos.

Never as "Outbound bloqueado."
