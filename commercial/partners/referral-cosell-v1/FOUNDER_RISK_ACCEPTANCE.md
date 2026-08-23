---
status: FOUNDER_APPROVED_WITH_DEFERRED_COUNSEL_REVIEW
professional_legal_review: DEFERRED_UNTIL_FIRST_REVENUE
founder_risk_acceptance: APPROVED
operational_use: PRIVATE_NEGOTIATION_ONLY
supersedable: true
jurisdiction: Brazil
business_context: B2B_ENGINEERING_CONSULTING
package: referral-cosell-v1
document_id: CFG-PARTNER-FOUNDER-RISK-ACCEPTANCE-v1
canonical_issue: https://github.com/tjsasakifln/Governance/issues/7
decision_token: FOUNDER_APPROVED_PARTNER_PROGRAM_DEFERRED_COUNSEL_2026_08_19
---

# Aceitação de risco residual — Programa de Parceiros v1

Decisor: **Tiago Jun Sasaki**  
Data: **2026-08-19**  
Timezone: **America/Sao_Paulo**  
Token: `FOUNDER_APPROVED_PARTNER_PROGRAM_DEFERRED_COUNSEL_2026_08_19`  
Issue: Governance #7

Alinhado ao precedente de revisão jurídica diferida até primeira receita do Diagnóstico (`FOUNDER_APPROVED_WITH_DEFERRED_COUNSEL_REVIEW_2026_08_18`). Este token de parceiro é **distinto** e **não** substitui a autoridade do Diagnóstico.

---

## Risco compreendido

Eu, Tiago Jun Sasaki, aceito este pacote como baseline executivo e operacional para **negociação privada controlada** do Programa de Parceiros, **sem** advogado contratado nesta data.

Compreendo que o pacote foi produzido por revisão técnica/adversarial interna, não por advogado inscrito. Compreendo que cláusulas de comissão, atribuição, integridade, OAB, LGPD, foro e responsabilidade podem ser questionadas. Compreendo que placeholders de identidade de parceiro existem de propósito e **não** autorizam parceiro real.

---

## Revisão profissional ainda inexistente

`professional_legal_review = DEFERRED_UNTIL_FIRST_REVENUE`.  
Não houve advogado. Não há `LEGAL_APPROVED`, `COUNSEL_REVIEWED` nem `LAWYER_APPROVED`. Este pacote não é texto de profissional do direito e não afirma conformidade jurídica garantida, ausência de risco ou validade incontestável.

Não há autorização para claims de `LEGAL_APPROVED`.

---

## Decisão de operar (escopo estreito)

Autorizo:

1. uso **privado e controlado** destes documentos para explicar o programa a um candidato, após revisão individual minha;
2. assumir, até a revisão profissional, o risco jurídico residual das mitigações deste pacote.

Não autorizo, nesta campanha: publicação no site; cobrança; criação de parceiro real; assinatura; contato outbound com consultorias; rascunhos no Outlook; mutação automática de provider financeiro; reabertura de catálogo, Extra ou Diagnóstico.

Qualquer parceria real exige revisão individual de identidade, modalidade, conflito e agreement final. Assinatura e pagamento permanecem humanos.

---

## Gatilho de revisão futura

A primeira receita **atribuída a parceiro** (e, por reuso do trigger canônico existente, a primeira `FIRST_PAYMENT_RECEIVED` global se ainda não disparada) abre lembrete de contratação de counsel em até **10 dias úteis**. Isso é lembrete de governança, **não** kill switch de Diagnóstico já vendido, e **não** aprova risco alto de integridade, OAB ou conflito — esses **não** podem ser autoaceitos pelo trigger geral.

Governance #7 permanece aberta enquanto houver residual profissional ou primeiro caso real.

---

## Residuais aceitos (nenhum P0 sem mitigação ou sem este aceite)

| Residual | Por que permanece | Decisão |
|---|---|---|
| Sem advogado até primeira receita atribuída / trigger canônico | timing consciente, mesmo precedente do Diagnóstico | ACCEPT |
| OAB / partilha de honorários | gate próprio fail-closed; sem autoaprovação | ACCEPT (não autoaceito) |
| Integridade / cargo / conflito aparente | gate factual; recusa/suspensão | ACCEPT (não autoaceito) |
| LGPD: controladores independentes é premissa, não universal | DPA exigido se a operação deixar de ser indicação pontual | ACCEPT |
| Foro Florianópolis pode ser questionado | reuso da autoridade já aprovada; cogência preservada | ACCEPT |
| Teto de responsabilidade conservador pode ser ineficaz em parte | carve-outs e máxima extensão permitida | ACCEPT |
| Placeholders de parceiro | fail-closed; parceiro real exige diligência | ACCEPT |
| Warmbly ainda não consome eventos | autoridade ≠ ledger | ACCEPT |

---

## Hash

O hash canônico é o `AUTHORITY_HASH` de `scripts/validate_partner_program.py` sobre `manifest.json`. Edição material exige nova versão.
