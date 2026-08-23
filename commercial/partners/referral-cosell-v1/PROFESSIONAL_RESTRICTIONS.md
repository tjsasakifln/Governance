---
status: FOUNDER_APPROVED_WITH_DEFERRED_COUNSEL_REVIEW
professional_legal_review: DEFERRED_UNTIL_FIRST_REVENUE
founder_risk_acceptance: APPROVED
operational_use: PRIVATE_NEGOTIATION_ONLY
supersedable: true
jurisdiction: Brazil
business_context: B2B_ENGINEERING_CONSULTING
package: referral-cosell-v1
document_id: CFG-PARTNER-PROFESSIONAL-RESTRICTIONS-v1
canonical_issue: https://github.com/tjsasakifln/Governance/issues/7
decision_token: FOUNDER_APPROVED_PARTNER_PROGRAM_DEFERRED_COUNSEL_2026_08_19
---

# Restrições profissionais (advocacia e correlatas)

A CONFENGE **não** presta advocacia. Este texto **não** é parecer jurídico. Nenhuma mensagem, acordo ou peça de parceiro pode sugerir o contrário, nem captar clientela, mercantilizar ou dividir honorários advocatícios.

Este texto **não** é `LEGAL_APPROVED`.

---

## 1. Quando o gate dispara

Flag `PROFESSIONAL_RULE_REVIEW_REQUIRED` quando o candidato for:

- escritório ou sociedade de advocacia;
- advogado pessoa jurídica ou correspondente;
- outra profissão regulada cuja ética restrinja captação, mercantilização ou partilha de honorários;
- operação mista em que a indicação seja, na prática, captação de clientela advocatícia.

O acordo padrão de **comissão por indicação não fica automaticamente disponível**. `standard_referral_commission_automatically_available = false`.

---

## 2. O que pode ser avaliado depois do gate

Cooperação técnica ou co-venda com **escopos e contratos separados**, sem comissão sobre honorários advocatícios, sem captação indevida, sem mercantilização incompatível, e somente após confirmação do enquadramento profissional e revisão específica.

Nenhuma comissão incide sobre honorários advocatícios sem autoridade específica posterior. Autoridade específica **não** existe neste pacote.

---

## 3. Fail-closed

Enquanto o flag estiver ativo e não houver revisão específica documentada:

- estado de diligência máximo: `LEGAL_REVIEW_REQUIRED`;
- `commission_amount_cents` da indicação padrão = 0;
- `partner_record_may_be_approved` = false para o acordo padrão;
- risco OAB **não** é autoaceito pelo gatilho geral de primeira receita.

Detalhe operacional: `OAB_REVIEW_GATE.md`.
