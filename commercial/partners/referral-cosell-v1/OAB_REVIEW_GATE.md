---
status: FOUNDER_APPROVED_WITH_DEFERRED_COUNSEL_REVIEW
professional_legal_review: DEFERRED_UNTIL_FIRST_REVENUE
founder_risk_acceptance: APPROVED
operational_use: PRIVATE_NEGOTIATION_ONLY
supersedable: true
jurisdiction: Brazil
business_context: B2B_ENGINEERING_CONSULTING
package: referral-cosell-v1
document_id: CFG-PARTNER-OAB-REVIEW-GATE-v1
canonical_issue: https://github.com/tjsasakifln/Governance/issues/7
decision_token: FOUNDER_APPROVED_PARTNER_PROGRAM_DEFERRED_COUNSEL_2026_08_19
---

# Gate OAB / profissão regulada

Flag: `PROFESSIONAL_RULE_REVIEW_REQUIRED`.

Este gate é **próprio**. Não se confunde com o gatilho `FIRST_PAYMENT_RECEIVED` / 10 dias úteis do Diagnóstico. Risco OAB **não** pode ser autoaceito por aquele trigger geral. **Não** é `LEGAL_APPROVED`.

---

## Procedimento fail-closed

1. Candidato declara enquadramento profissional. Omissão = `NEEDS_INFO`.
2. Se advocacia ou profissão regulada aplicável → `PROFESSIONAL_RULE_REVIEW_REQUIRED`.
3. Diligência: `LEGAL_REVIEW_REQUIRED`. Comissão padrão de indicação **indisponível**.
4. Revisão específica (counsel + founder) avalia se alguma cooperação técnica/co-venda com contratos separados é lícita. Sem essa revisão, não há acordo de comissão.
5. Nenhuma peça sugere que a CONFENGE presta advocacia.
6. Nenhuma comissão sobre honorários advocatícios sem autoridade específica — e esta versão **não** concede essa autoridade.

A função enviada `standard_referral_commission_available` implementa o fail-closed. Testes devem chamá-la.
