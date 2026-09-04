# CONSUMER-HANDOFF — CONFENGE commercial authority v1

This directory is the only commercial-offer truth plane for CONFENGE v1.  
Do not copy these files into web-cfg or Warmbly as a second catalog. Pin them.

The stable consumer contract is `commercial/CONSUMER-CONTRACT.md`. The compatibility contract (`commercial/compatibility/consumer-compatibility.v1.json`, rule `GOVERNANCE_WINS`) records canonical representation vs accepted consumer aliases. Do not copy aliases back into Governance.

## Who consumes what

| Consumer | Role | What to read |
|---|---|---|
| `web-cfg#88` | delivery parent — catalog, contracting, capacity, terms | `catalog.public.v1.json` for any public surface; `catalog.v1.json` for the internal registry; `production-gates.v1.json` before any checkout flag; `diagnostico-limited-production.v1.json` for the Diagnóstico overlay; `asaas-mapping.v1.json` for provider IDs; consume `confenge.capacity_admission.v2` without recalculating WIP |
| `Warmbly#47` | reconciliation / learning consumer | `authority-manifest.v1.json` plus gates, overlay and mapping; consume decision/correlation/expiry from `confenge.capacity_admission.v2`, never own Work Order/WIP and never treat provider `customer`/`checkout`/`subscription`/`payment` **created** as received revenue |
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
- commercial policy ceiling of 50 recurring slots; staffed capacity remains independently declared and may be lower or `UNKNOWN`; one standard contract = one slot; 72-hour hold policy does not authorize a real hold in this repository
- Flex: 30-day billable notice; 180/365: no silent renewal after `max_payments`
- 6% tax premise ≠ confirmed regime; NFS-e blocked

## Outbound first touch — CFG-FIRST-TOUCH-ROUTING-v3

The current outbound routing policy is `CFG-FIRST-TOUCH-ROUTING-v3`
(`commercial/outbound/cfg-first-touch-routing.v3.json`, schema
`schemas/cfg-first-touch-routing.v3.schema.json`). It consumes
`COMMERCIAL_AUTHORITY/2.0` / `COMMERCIAL_AUTHORITY_POLICY/2.0`. v1 and v2 remain
published and machine-readable as `SUPERSEDED` history; consumers must pin v3
exactly. A v1, v2, missing or unknown version fails closed. v3 does not rewrite
v1/v2 bytes and does not authorize SMTP or provider dispatch. Governance #129
closed as policy history is not transport authorization. Warmbly #43 owns
`CURRENT_VERDICT`. Warmbly #204 and #47 completed do not equal GO.

The canonical, non-negotiable business rule is:

> CONFENGE commercial qualification is based on qualifying public engineering contracting evidence within a rolling three-year window. PNCP/source freshness is acquisition health and MUST NOT by itself revoke, hold, dequeue or block transport for an otherwise valid commercially-qualified member.

Consume it as follows:

- qualification is per **CNPJ root** (`cnpj_root8`), for a company that figured as
  **contracted supplier / fornecedora** on a public engineering work or service.
  The **contracting body never qualifies**;
- the window is a **rolling three years** measured from the CONTRACTING ACT date,
  taken by the deterministic precedence `data_assinatura` -> `data_inicio` ->
  `data_publicacao` -> `data_publicacao_fonte` over `v_contracts_canonical_v2`;
  `data_fim` is excluded on purpose;
- `qualified_until` is **derived** (contracting date + 3 years, forward calendar
  normalization). A producer-declared value that does not reconcile fails closed;
- states are `QUALIFIED` / `EXPIRED` / `REVOKED` / `UNKNOWN`. There is **no TTL and
  no grace period**; the v1 age bands are abolished;
- **explicit deactivation blocks immediately** and beats everything else;
- **DNC, suppression, hard bounce, recipient expiry and policy revocation** block
  the affected message or recipient. They are separate from qualification;
- **source health is never a blocker**. `source_health_not_fresh_strict_fallback`
  is retired in favour of `commercial_authority_missing`, and freshness never
  grants authority by fallback either.

Fail-closed reason codes a consumer must be able to render:
`commercial_authority_missing`, `commercial_qualification_expired`,
`commercial_qualification_revoked`, `commercial_qualification_evidence_drift`,
`commercial_qualification_party_role_invalid`,
`commercial_qualification_window_invalid`,
`commercial_authority_policy_unsupported`.

A stale acquisition source is presented to the founder as an acquisition-plan
condition ("Atualização de mercado atrasada; novos leads podem não estar
refletidos."), never as "Outbound bloqueado."

## Inbound admission — NET_NEW_INBOUND_HANDRAISER-v1

Governance owns the versioned admission policy
(`commercial/inbound/net-new-inbound-handraiser.v1.json`). Missing, old or
unknown policy versions fail closed. web-cfg produces `CONFENGE_WEB` /
`confenge_web` intent; extra-cli produces `intel_watch` / `intel_seed` intent.
Warmbly is the only record/queue/outcome owner. MeetCFG is view-only.

Accepted net-new is inbound-only. It is never outbound-eligible by default and
never authorizes SMTP or follow-up. Absence of a prior account is not a silent
discard. Replay is `EXACTLY_ONCE_LOGICAL`. Metrics are PII-free.

Pin: `python -c "from commercial.inbound import policy_hash; print(policy_hash())"`.

## Schema contracts

- `schemas/offer-catalog.v1.schema.json`
- `schemas/production-gates.v1.schema.json`
- `schemas/authority-manifest.v1.schema.json`
- `schemas/provider-mapping.v1.schema.json`
- `schemas/diagnostico-limited-production.v1.schema.json`
- `schemas/consumer-compatibility.v1.schema.json`
- `schemas/cfg-first-touch-routing.v3.schema.json`
- `schemas/net-new-inbound-handraiser.v1.schema.json`
- `schemas/mapping-copyback.v1.schema.json`

Read-only CI fixture: `commercial/fixtures/consumer-compatibility.ci.v1.json`. Founder mapping copy-back: `python scripts/validate_commercial_authority.py --check-mapping <payload.json>` (no Asaas call).

Validate local fixtures with the shipped validator functions. Do not re-implement totals or hashing.
