---
status: FOUNDER_DECIDED_DRAFT
professional_legal_review: NOT_YET_PERFORMED
operational_use: PRIVATE_NEGOTIATION_ONLY
supersedable: true
jurisdiction: Brazil
business_context: B2B_ENGINEERING_CONSULTING
document_id: CFG-LEGAL-HUMAN-DECISIONS-v1.1
package: diagnostico-v1.1
prior_package: provisional-v1
---

# Classificação das dez decisões originais

Fonte máquina: `DECISION_CLASSIFICATION.json`. Cada id tem **exatamente um** status permitido. Decisão empresarial do fundador **não** é `LEGAL_APPROVED`.

`CFG-TERMS-B2B-2026-08-17-v1` contém linhas de base comerciais de portfólio. Elas **não** reaprovam este one-off e **não** estão validadas por advogado.

---

## Tabela

| id | status | token | owner / evidência |
|---|---|---|---|
| `razao_social_cnpj_contratante` | `PENDING_ENTITY_DOCUMENT` | `[[HUMAN_DECISION_REQUIRED: razao_social_cnpj_contratante]]` | documento societário / Asaas oficial; nome fantasia não serve |
| `foro` | `PENDING_ENTITY_DOCUMENT` | `[[HUMAN_DECISION_REQUIRED: foro]]` | sede no mesmo documento; advogado valida eficácia |
| `limite_responsabilidade` | `RESOLVED_BY_FOUNDER_BASELINE` | `[[FOUNDER_BASELINE: limite_responsabilidade]]` | valor efetivamente pago na OS; carve-outs; eficácia com advogado |
| `politica_reembolso` | `RESOLVED_BY_FOUNDER_BASELINE` | `[[FOUNDER_BASELINE: politica_reembolso]]` | indevida/duplicada; recusa antes do início; liquidar após início; sem automático integral |
| `prazo_entrega` | `RESOLVED_BY_FOUNDER_BASELINE` | `[[FOUNDER_BASELINE: prazo_entrega]]` | 10–15 dias úteis após alinhamento, brief completo e aceite |
| `dados_pessoais_tratados` | `RESOLVED_BY_FOUNDER_BASELINE` | `[[FOUNDER_BASELINE: dados_pessoais_tratados]]` | contato corporativo, função, empresa/CNPJ, dados contratuais/fiscais, brief, comunicações, metadados; sem sensível por padrão |
| `retencao` | `PENDING_NAMED_COUNSEL` | `[[HUMAN_DECISION_REQUIRED: retencao]]` | prazos escritos do advogado nomeado |
| `responsavel_fiscal` | `PENDING_NAMED_ACCOUNTANT` | `[[HUMAN_DECISION_REQUIRED: responsavel_fiscal]]` | contador nomeado + evidência |
| `aceite_eletronico` | `RESOLVED_BY_FOUNDER_BASELINE` | `[[FOUNDER_BASELINE: aceite_eletronico]]` | OS + versões + hashes + representante/CNPJ + timestamp + cópia durável; checkout/callback sozinho não prova aceite |
| `canal_suporte` | `RESOLVED_BY_FOUNDER_BASELINE` | `[[FOUNDER_BASELINE: canal_suporte]]` | `tiago.sasaki@confenge.com.br` |

---

## Preenchimento que falha o gate

- CNPJ com dígitos no pacote
- comarca eleita no lugar do token de foro
- teto numérico inventado (`responsabilidade limitada a R$ …`) no lugar do valor efetivamente pago
- prazo de estorno automático (`reembolso de 100% em N dias`)
- prazo de entrega afirmado como garantido
- lista inventada de subprocessadores
- clique em checkout apresentado como aceite já validado
- classificar decisão empresarial como `LEGAL_APPROVED`

Campos `[[PREENCHER_POR_OPERACAO:…]]` na OS são por negócio, no momento da contratação, e também não podem aparecer preenchidos com dados reais neste repositório.

---

## O que o fundador já pode usar

Negociar o primeiro Diagnóstico **em conversa privada** com as linhas de base acima, deixando visíveis os tokens ainda `PENDING_*`, sem checkout e sem cobrança. Fechar OS pública ou produção exige documento de entidade, retenção do advogado e responsável fiscal nomeado — ou aceite expresso de aditivo antes da execução.
