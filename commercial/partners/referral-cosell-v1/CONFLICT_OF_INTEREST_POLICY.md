---
status: FOUNDER_APPROVED_WITH_DEFERRED_COUNSEL_REVIEW
professional_legal_review: DEFERRED_UNTIL_FIRST_REVENUE
founder_risk_acceptance: APPROVED
operational_use: PRIVATE_NEGOTIATION_ONLY
supersedable: true
jurisdiction: Brazil
business_context: B2B_ENGINEERING_CONSULTING
package: referral-cosell-v1
document_id: CFG-PARTNER-CONFLICT-OF-INTEREST-v1
canonical_issue: https://github.com/tjsasakifln/Governance/issues/7
decision_token: FOUNDER_APPROVED_PARTNER_PROGRAM_DEFERRED_COUNSEL_2026_08_19
---

# Política de conflito de interesses

**clause_id:** `conflitos`

Conflito **real** ou **aparente** gera recusa ou suspensão. Este texto **não** é `LEGAL_APPROVED`.

---

## 1. Dever de comunicar

O parceiro comunica, antes do acordo e a cada lead material:

- vínculo com agente público, ocupante de cargo, ou familiar em posição de influência sobre o cliente ou o órgão comprador;
- atuação simultânea para concorrente direto do cliente indicado, no mesmo objeto;
- participação em licitação na qual a CONFENGE também assessore outro licitante no mesmo certame, se souber;
- interesse econômico no êxito do contrato público (além da comissão sobre honorários CONFENGE);
- profissão regulada (advocacia e correlatas).

A CONFENGE comunica conflito simétrico quando souber.

---

## 2. Tratamento

| Classificação | Efeito |
|---|---|
| `NONE` | Segue diligência ordinária |
| `APPARENT` | `LEGAL_REVIEW_REQUIRED` ou `APPROVED_WITH_LIMITATIONS` somente após mitigação escrita; nunca autoaprovação |
| `REAL` | `REJECTED` ou `SUSPENDED`; não há comissão |
| `UNKNOWN` | fail-closed: não aprova até evidência |

Mitigações possíveis (não automáticas): recusa do lead; recusa do parceiro; limitação de modalidade; recusa de marca; firewall de informação. Mitigação **não** legitima influência.

---

## 3. Gate do founder

Conflito ligado a cargo, órgão ou função pública do founder ou de pessoa ligada **não** pode ser autoaceito. Exige recusa ou revisão específica, fora do gatilho `FIRST_PAYMENT_RECEIVED`.
