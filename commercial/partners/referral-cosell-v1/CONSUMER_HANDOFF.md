---
status: FOUNDER_APPROVED_WITH_DEFERRED_COUNSEL_REVIEW
professional_legal_review: DEFERRED_UNTIL_FIRST_REVENUE
founder_risk_acceptance: APPROVED
operational_use: PRIVATE_NEGOTIATION_ONLY
supersedable: true
jurisdiction: Brazil
business_context: B2B_ENGINEERING_CONSULTING
package: referral-cosell-v1
document_id: CFG-PARTNER-CONSUMER-HANDOFF-v1
canonical_issue: https://github.com/tjsasakifln/Governance/issues/7
decision_token: FOUNDER_APPROVED_PARTNER_PROGRAM_DEFERRED_COUNSEL_2026_08_19
---

# Consumer handoff — Warmbly #47 (e não um segundo ledger)

Governance define autoridade. **Warmbly #47** permanece o consumidor comercial futuro. Este pacote **não** cria ledger operacional, **não** edita Warmbly, **não** edita web-cfg.

Pin: `AUTHORITY_HASH` impresso por `scripts/validate_partner_program.py`.

---

## O que o consumidor pode pinar

- `package_id`: `CFG-PARTNER-REFERRAL-COSELL-v1`
- `status`: `FOUNDER_APPROVED_WITH_DEFERRED_COUNSEL_REVIEW`
- schedule: `COMMISSION_SCHEDULE.json`
- eventos: `PARTNER_EVENT_CONTRACT.json`
- acordo: `PARTNER_AGREEMENT_B2B.md` + hash
- **não** pinar este pacote em `CONFENGE_LEGAL_AUTHORITY_HASH` do Diagnóstico
- **não** adicionar estes arquivos ao `authority-manifest.v1.json` de ofertas

---

## Eventos (autoridade, não receita)

Ver lista em `PARTNER_EVENT_CONTRACT.json`. Campos a preservar: partner id/version; agreement version/hash; lead/opportunity id; attribution evidence; source; modality; consent evidence ref; protection dates; commission policy/version; eligible receipts; calculation snapshot; approval actor; outcome/`UNKNOWN`.

Regras:

- nenhum evento de parceiro é receita recebida da CONFENGE;
- `partner_commission_accrual_candidate` não é pagamento;
- `partner_commission_paid` exige receipt + aprovação humana;
- sem PII em métricas agregadas;
- `outcome = UNKNOWN` não autoriza pagamento.

---

## O que o consumidor **não** deve fazer

- ligar checkout, cobrança ou NFS-e a partir deste pacote;
- criar parceiro real sem revisão founder;
- publicar termos no site;
- contar objeto de provedor como receita;
- mutar provider financeiro automaticamente;
- vazar Extra ou preços privados;
- tratar o status como `LEGAL_APPROVED`.

web-cfg #88 não é consumidor deste pacote nesta versão (`publication_enabled = false`).
