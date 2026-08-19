---
status: FOUNDER_DECIDED_DRAFT
professional_legal_review: NOT_YET_PERFORMED
operational_use: PRIVATE_NEGOTIATION_ONLY
supersedable: true
jurisdiction: Brazil
business_context: B2B_ENGINEERING_CONSULTING
document_id: CFG-LEGAL-ACCOUNTANT-HANDOFF-DIAG-v1.1
package: diagnostico-v1.1
prior_package: provisional-v1
offer_code: CFG-DIAG-EXP-v1
---

# Handoff ao contador — só o que falta classificar

Não classifica. Não autoriza NFS-e de produção. A premissa comercial de 6% do pacote de ofertas **não** é regime confirmado. Responsável a nomear: `[[HUMAN_DECISION_REQUIRED: responsavel_fiscal]]`.

Objeto: one-off `CFG-DIAG-EXP-v1`, `800000` centavos BRL, serviço consultivo/técnico B2B. Identidade da prestadora: `[[HUMAN_DECISION_REQUIRED: razao_social_cnpj_contratante]]` — devolver junto com o documento societário, não inventar.

Referências oficiais (consulta 2026-08-18, sem interpretação): LC 123/2006; LC 116/2003.

---

## Perguntas

1. **Identidade / CNPJ**
   Qual razão social e CNPJ devem constar da NFS-e deste one-off, a partir do documento societário (não a partir de site ou nome fantasia)?
   Resposta: `[[HUMAN_DECISION_REQUIRED: fiscal_identidade_cnpj]]`

2. **CNAE / Anexo / fator R / RBT12**
   Qual CNAE? Em que anexo este faturamento cai agora? O fator R e o RBT12 alteram o enquadramento?
   Resposta: `[[HUMAN_DECISION_REQUIRED: fiscal_cnae_anexo_fator_r]]`

3. **Item municipal / ISS / retenções**
   Qual item/subitem da lista de serviços, tratamento de ISS, município de incidência e retenções (ISS, IR, CSLL, PIS, COFINS ou outras) quando o tomador é PJ privada ou pública?
   Resposta: `[[HUMAN_DECISION_REQUIRED: fiscal_item_iss_retencoes]]`

4. **NFS-e teste**
   Qual município emissor, sistema e roteiro de **NFS-e de teste** (não produção)? Produção permanece bloqueada até o gate `tax_nfse`.
   Resposta: `[[HUMAN_DECISION_REQUIRED: fiscal_nfse_teste]]`

5. **Efeito na margem / preço**
   Qual alíquota efetiva usar? A premissa comercial de 6% deve ser abandonada, mantida só como preço, ou revista? O `amount_cents = 800000` precisa mudar?
   Resposta: `[[HUMAN_DECISION_REQUIRED: fiscal_margem_preco]]`

6. **Responsável e evidência**
   Nome do contador/responsável, identificação profissional, data e documentos de suporte. Sem nome não há emissão.
   Resposta: `[[HUMAN_DECISION_REQUIRED: responsavel_fiscal]]`

---

## Encaminhamento

Devolver respostas datadas. Até lá: não emitir NFS-e de produção, não afirmar carga tributária no checkout, não alterar `amount_cents`, não preencher CNPJ neste repositório.

Este handoff **não** pede opinião sobre limitação contratual, aceite eletrônico, foro ou cláusula de resultado — isso é do advogado.
