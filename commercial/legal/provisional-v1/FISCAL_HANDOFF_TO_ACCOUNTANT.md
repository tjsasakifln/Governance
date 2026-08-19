---
status: PROVISIONAL_AI_DRAFT
professional_legal_review: NOT_YET_PERFORMED
operational_use: HUMAN_DECISION_REQUIRED
supersedable: true
jurisdiction: Brazil
business_context: B2B_ENGINEERING_CONSULTING
document_id: CFG-LEGAL-FISCAL-HANDOFF-v1
package: provisional-v1
offer_code: CFG-DIAG-EXP-v1
---

# Handoff fiscal — perguntas objetivas ao contador

Não responde. Não classifica. Não autoriza NFS-e. A premissa comercial de 6% do pacote de ofertas **não** é regime confirmado. Responsável a nomear: `[[HUMAN_DECISION_REQUIRED: responsavel_fiscal]]`.

Objeto consultado: one-off `CFG-DIAG-EXP-v1`, `800000` centavos BRL, serviço consultivo/técnico B2B, sem recorrência ativada.

Referências oficiais (consulta 2026-08-18, sem interpretação):

- LC 123/2006: https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm
- LC 116/2003: https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp116.htm

---

## Perguntas

1. **CNAE / atividade**  
   Qual CNAE e descrição de atividade devem constar para este Diagnóstico?  
   Resposta do contador: `[[HUMAN_DECISION_REQUIRED: fiscal_cnae]]`

2. **Item de serviço municipal**  
   Qual item/subitem da lista de serviços deve ser usado na NFS-e deste one-off?  
   Resposta: `[[HUMAN_DECISION_REQUIRED: fiscal_item_servico]]`

3. **Simples / anexo / fator R**  
   O faturamento deste serviço cai em que anexo? O fator R e o RBT12 alteram o enquadramento agora?  
   Resposta: `[[HUMAN_DECISION_REQUIRED: fiscal_anexo_fator_r]]`

4. **Alíquota efetiva**  
   Qual alíquota efetiva usar neste faturamento? A premissa comercial de 6% deve ser abandonada, mantida só como preço, ou revista?  
   Resposta: `[[HUMAN_DECISION_REQUIRED: fiscal_aliquota_efetiva]]`

5. **Retenções**  
   Há retenção de ISS, IR, CSLL, PIS, COFINS ou outras quando o tomador é PJ pública ou privada? Quem retém?  
   Resposta: `[[HUMAN_DECISION_REQUIRED: fiscal_retencoes]]`

6. **ISS**  
   Qual tratamento de ISS para este item?  
   Resposta: `[[HUMAN_DECISION_REQUIRED: fiscal_iss]]`

7. **NFS-e**  
   Qual município emissor, sistema e momento de emissão? Produção permanece bloqueada até essa resposta e o gate `tax_nfse`.  
   Resposta: `[[HUMAN_DECISION_REQUIRED: fiscal_nfse]]`

8. **Descrição recomendada**  
   Qual texto de discriminação na nota, sem prometer resultado e sem se apresentar como serviço jurídico?  
   Resposta: `[[HUMAN_DECISION_REQUIRED: fiscal_descricao_nfse]]`

9. **Município de incidência**  
   Município de incidência do serviço (estabelecimento do prestador, do tomador, ou regra específica)?  
   Resposta: `[[HUMAN_DECISION_REQUIRED: fiscal_municipio_incidencia]]`

10. **Recorrência futura**  
    Se no futuro for ativada Diretoria B2G (não autorizada agora), o tratamento muda (item, retenção, local, recorrência de nota)?  
    Resposta: `[[HUMAN_DECISION_REQUIRED: fiscal_recorrencia_futura]]`

---

## Encaminhamento

Devolver respostas datadas, com nome do profissional e documentos de suporte. Até lá: não emitir NFS-e de produção, não afirmar carga tributária no checkout, não alterar `amount_cents`.
