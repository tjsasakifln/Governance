---
status: FOUNDER_APPROVED_LIMITED_PRODUCTION
professional_legal_review: DEFERRED_UNTIL_FIRST_REVENUE
founder_risk_acceptance: APPROVED
operational_use: LIMITED_PUBLIC_DIAGNOSIS_ONLY
supersedable: true
jurisdiction: Brazil
business_context: B2B_ENGINEERING_CONSULTING
document_id: CFG-LEGAL-FOUNDER-RISK-ACCEPTANCE-v1
package: founder-approved-v1
offer_code: CFG-DIAG-EXP-v1
decision_token: FOUNDER_APPROVED_WITH_DEFERRED_COUNSEL_REVIEW_2026_08_18
---

# Aceitação de risco jurídico residual — Diagnóstico B2G

Decisor: **Tiago Jun Sasaki**  
Data: **2026-08-18**  
Timezone: **America/Sao_Paulo**  
Token: `FOUNDER_APPROVED_WITH_DEFERRED_COUNSEL_REVIEW_2026_08_18`

---

## Risco compreendido

Eu, Tiago Jun Sasaki, decido operar o Diagnóstico B2G one-off (`CFG-DIAG-EXP-v1`, R$ 8.000) com termos públicos, aceite eletrônico e checkout Asaas hospedado, **sem** revisão profissional de advogado inscrito.

Compreendo que cláusulas de foro, teto de responsabilidade, reembolso por marcos, aceite eletrônico sem ICP-Brasil, inventário LGPD e eleição de foro podem ser questionadas. Compreendo que CNPJ não elimina, por si, incidência de norma consumerista. Compreendo que a consulta pública de CNPJ confirma identidade da pessoa jurídica e **não** prova poderes societários específicos meus. Compreendo que a publicação automatizada destes termos carrega risco residual de autoridade interna.

---

## Revisão profissional ainda inexistente

`professional_legal_review = DEFERRED_UNTIL_FIRST_REVENUE`.  
Não houve advogado. Não há `LEGAL_APPROVED`, `COUNSEL_REVIEWED` nem `LAWYER_APPROVED`. Este pacote não é um texto de profissional do direito e não afirma conformidade jurídica garantida, ausência de risco ou validade incontestável de qualquer cláusula.

---

## Decisão de operar

Autorizo:

1. uso comercial e publicação destes termos finais;
2. integração Asaas em produção para o Diagnóstico B2G one-off;
3. ativação pública limitada da oferta `CFG-DIAG-EXP-v1`;
4. assumir, até a revisão profissional, o risco jurídico residual após as mitigações deste pacote.

Não autorizo, nesta campanha: checkout público dos planos recorrentes; estorno/cancelamento automático; NFS-e automática; captura de cartão pela CONFENGE.

---

## Escopo limitado

- oferta: somente `CFG-DIAG-EXP-v1`
- preço: `800000` centavos, `ONE_TIME`
- meios de Checkout hospedado: PIX e CREDIT_CARD (sem BOLETO neste endpoint)
- recorrência: OFF
- refund/cancel automático: OFF
- NFS-e automática: OFF

---

## Riscos residuais relevantes (aceitos)

| Residual | Por que permanece | Decisão |
|---|---|---|
| Sem advogado até a primeira receita | escolha consciente de timing | ACCEPT |
| CDC pode incidir apesar do CNPJ | a lei não é afastada por declaração | ACCEPT (texto preserva direitos cogentes) |
| Foro de Florianópolis pode ser questionado | eleição é cláusula, não competência absoluta | ACCEPT (preserva cogência e tutela urgente) |
| Teto de R$ 8.000 pode ser ineficaz em parte | limites legais de responsabilidade | ACCEPT (carve-outs e “máxima extensão permitida”) |
| Aceite sem ICP-Brasil | prova é de conjunto, não de certificado | ACCEPT |
| Poderes internos da publicação automatizada | consulta de CNPJ ≠ procuração | ACCEPT (OS manual exige poderes comprováveis) |
| Enquadramento fiscal não validado por contador | `NOT_CLAIMED`; NFS-e manual | ACCEPT |
| Checkout oficial sem boleto | documentação Asaas 2026-08-18 | ACCEPT (omitir boleto é o correto) |

Nenhum risco P0 permanece sem mitigação ou sem este aceite nominal.

---

## Gatilho de revisão futura

A primeira ocorrência real de `PAYMENT_RECEIVED` abre ou atualiza o residual de Governance #1 para contratar advogado, prazo-alvo de **10 dias úteis**. Isso é lembrete de governança, **não** kill switch do Diagnóstico já vendido. Nenhum plano recorrente poderá ser ativado antes dessa revisão profissional ou de nova decisão executiva versionada.

---

## Rollback

Posso ocultar CTA e página de contratação, impedir novos checkouts, manter webhook recebendo eventos já existentes, pausar apply, rotacionar segredo e reverter deploy, sem cancelar ou estornar automaticamente.

---

## Hash do pacote aprovado

O hash canônico é o `AUTHORITY_HASH` impresso por `scripts/validate_legal_founder_approved.py` sobre `manifest.json`. Qualquer edição material exige nova versão e novo hash. Este arquivo declara a decisão; o hash concreto é o do manifesto validado.
