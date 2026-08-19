---
status: FOUNDER_APPROVED_LIMITED_PRODUCTION
professional_legal_review: DEFERRED_UNTIL_FIRST_REVENUE
founder_risk_acceptance: APPROVED
operational_use: LIMITED_PUBLIC_DIAGNOSIS_ONLY
supersedable: true
jurisdiction: Brazil
business_context: B2B_ENGINEERING_CONSULTING
document_id: CFG-LEGAL-CONSUMER-HANDOFF-FOUNDER-v1
package: founder-approved-v1
decision_token: FOUNDER_APPROVED_WITH_DEFERRED_COUNSEL_REVIEW_2026_08_18
---

# CONSUMER_HANDOFF — founder-approved-v1

Pin this package. Do not copy terms by hand into web-cfg or Warmbly.

## Who consumes what

| Consumer | Role | What to pin |
|---|---|---|
| `web-cfg#88` | delivery parent — eligibility, acceptance, hosted checkout | `AUTHORITY_HASH` from `python scripts/validate_legal_founder_approved.py` as `CONFENGE_LEGAL_AUTHORITY_HASH` |
| `Warmbly#47` | reconciliation consumer | same hash + `confenge.commercial_event.v1`; confirmation ≠ revenue |
| Governance #1 | residual | stays OPEN; first `PAYMENT_RECEIVED` opens counsel-hire reminder (10 business days), not a kill switch |

## How to pin

```bash
python scripts/validate_legal_founder_approved.py
```

Persist the printed `AUTHORITY_HASH sha256:<hex>`. If the hash changes, invalidate pending acceptances and do not create new production checkouts.

Do **not**:

- treat `diagnostico-v1.1` or `provisional-v1` as this production authority;
- flip global `production-gates.v1.json` to approve recurring;
- claim `LEGAL_APPROVED`;
- copy the private historical exception into any public surface;
- create a second billing ledger.

## Flags this package authorizes (diagnosis only)

```
public_activation_approved             = true
production_checkout_approved           = true
approved_offer_scope                   = ["CFG-DIAG-EXP-v1"]
recurring_offers_production_checkout_approved = false
automated_refund_or_cancellation_approved     = false
automated_nfse_approved                = false
```

Global catalog gates remain fail-closed for the portfolio. Limited production is this package + env flags, not a portfolio-wide `LEGAL_APPROVED`.

## Semantics the consumer must preserve

- aceite antes do checkout;
- `CHECKOUT_*` e `PAYMENT_CREATED` não são pagamento/receita;
- callback não é verdade financeira;
- `PAYMENT_CONFIRMED` pode abrir onboarding + fila manual de NFS-e;
- `PAYMENT_RECEIVED` é a única base de receita recebida e o gatilho de advogado;
- refund/chargeback = exception; sem auto-WON/auto-LOST; sem mutação automática no Asaas.
