---
status: PROVISIONAL_AI_DRAFT
professional_legal_review: NOT_YET_PERFORMED
operational_use: HUMAN_DECISION_REQUIRED
supersedable: true
jurisdiction: Brazil
business_context: B2B_ENGINEERING_CONSULTING
document_id: CFG-LEGAL-HUMAN-DECISIONS-v1
package: provisional-v1
---

# Decisões humanas obrigatórias — não presumir

Nenhuma das decisões abaixo pode ser preenchida por este rascunho. Token publicado, CNPJ inventado, foro inventado ou teto numérico inventado **falha o gate**.

`CFG-TERMS-B2B-2026-08-17-v1` contém linhas de base comerciais (foro da sede; teto ligado a valores pagos). Elas **não** resolvem esta lista e **não** estão validadas por advogado.

---

## Decisões bloqueantes

| id | Decisão | Por que não presumir | Token | Bloqueia |
|---|---|---|---|---|
| `razao_social_cnpj_contratante` | Razão social e CNPJ da pessoa jurídica prestadora que assina o one-off | Identidade da parte não pode ser inventada; o nome comercial CONFENGE não substitui o polo contratual | `[[HUMAN_DECISION_REQUIRED: razao_social_cnpj_contratante]]` | publicação, NFS-e, OS assinável, checkout |
| `foro` | Foro de eleição | Competência e conveniência são decisão humana; publicar comarca é ato jurídico | `[[HUMAN_DECISION_REQUIRED: foro]]` | publicação, gate `legal_terms_forum` |
| `limite_responsabilidade` | Valor e validade do teto de responsabilidade | Teto ineficaz ou abusivo é risco; número copiado da linha de base comercial não está aprovado | `[[HUMAN_DECISION_REQUIRED: limite_responsabilidade]]` | publicação, gate `legal_terms_forum` |
| `politica_reembolso` | Tratamento exato de cancelamento/reembolso após cada marco | Afeta caixa e expectativa do cliente; este pacote só descreve linha conservadora | `[[HUMAN_DECISION_REQUIRED: politica_reembolso]]` | publicação, mutação financeira |
| `prazo_entrega` | Confirmação do prazo contratual de entrega | Catálogo indica 10–15 dias úteis; isso é referência comercial, não confirmação jurídica do prazo da OS | `[[HUMAN_DECISION_REQUIRED: prazo_entrega]]` | OS pública, promessa de prazo em checkout |
| `dados_pessoais_tratados` | Rol efetivo de dados pessoais | Sem inventário real não há aviso honesto | `[[HUMAN_DECISION_REQUIRED: dados_pessoais_tratados]]` | aviso público de privacidade |
| `retencao` | Prazos de retenção de lead e de dossiê do one-off | Retenção inventada vira promessa falsa | `[[HUMAN_DECISION_REQUIRED: retencao]]` | aviso público de privacidade |
| `responsavel_fiscal` | Quem responde pela classificação e pela NFS-e | Sem contador/responsável nomeado não há emissão | `[[HUMAN_DECISION_REQUIRED: responsavel_fiscal]]` | NFS-e, gate `tax_nfse` |
| `aceite_eletronico` | Mecanismo e evidência de aceite eletrônico | Pretendido, não validado; checkout/callback não prova aceite | `[[HUMAN_DECISION_REQUIRED: aceite_eletronico]]` | ativação pública, checkout |
| `canal_suporte` | Canal oficial de suporte e de solicitações de titular | E-mail pessoal ou canal não decidido não deve ir a produção | `[[HUMAN_DECISION_REQUIRED: canal_suporte]]` | publicação, aviso de privacidade |

---

## Preenchimento que falha o gate (exemplos — não usar)

- CNPJ com dígitos de exemplo no pacote
- comarca eleita no lugar do token de foro
- teto numérico no lugar do token de responsabilidade
- prazo de estorno automático no lugar do token de reembolso
- prazo de entrega afirmado como garantido
- lista inventada de subprocessadores
- clique em checkout apresentado como mecanismo de aceite já validado

Campos `[[PREENCHER_POR_OPERACAO:…]]` na OS são por negócio, no momento da contratação, e também não podem aparecer preenchidos com dados reais neste repositório.

---

## O que o fundador *já* pode usar sem resolver esta lista

Negociar o primeiro Diagnóstico com estes termos provisórios **em conversa privada**, deixando os tokens visíveis, sem checkout e sem cobrança. Fechar a OS exige ao menos: identidade do prestador, cliente real (fora deste repo), mecanismo de aceite e decisão de foro/teto/reembolso, ou aceite expresso de que esses pontos ficam em aditivo antes da execução.
