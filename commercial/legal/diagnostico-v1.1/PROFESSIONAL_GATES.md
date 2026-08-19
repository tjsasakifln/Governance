---
status: FOUNDER_DECIDED_DRAFT
professional_legal_review: NOT_YET_PERFORMED
operational_use: PRIVATE_NEGOTIATION_ONLY
supersedable: true
jurisdiction: Brazil
business_context: B2B_ENGINEERING_CONSULTING
document_id: CFG-LEGAL-PROFESSIONAL-GATES-DIAG-v1.1
package: diagnostico-v1.1
prior_package: provisional-v1
offer_code: CFG-DIAG-EXP-v1
---

# Gates profissionais restantes — um pedido por owner

Enquanto qualquer linha abaixo estiver `PENDING_*`, checkout, publicação pública, cobrança real, NFS-e de produção e Asaas produção **permanecem bloqueados**. Founder baseline não fecha estes gates.

---

## Pendências com owner e evidência

| id | status | owner | evidência requerida | bloqueia |
|---|---|---|---|---|
| `razao_social_cnpj_contratante` | `PENDING_ENTITY_DOCUMENT` | fundador → depois advogado | contrato social / cartão CNPJ / documento societário ou conta oficial Asaas com razão social e CNPJ exatos | publicação, OS assinável, NFS-e, checkout |
| `foro` | `PENDING_ENTITY_DOCUMENT` | fundador (sede) + advogado (eficácia) | endereço de sede no mesmo documento; foro proposto a partir da sede; confirmação profissional de eficácia | `legal_terms_forum`, publicação |
| `retencao` | `PENDING_NAMED_COUNSEL` | advogado nomeado | prazos escritos de retenção do lead e do dossiê do one-off; alinhamento fiscal com o contador | aviso público de privacidade |
| `responsavel_fiscal` | `PENDING_NAMED_ACCOUNTANT` | contador nomeado | nome, identificação profissional e respostas datadas de `ACCOUNTANT_HANDOFF.md` | `tax_nfse`, NFS-e |
| `limite_responsabilidade` | `RESOLVED_BY_FOUNDER_BASELINE` | advogado nomeado (eficácia) | confirmação ou reformulação do teto e carve-outs | `legal_terms_forum` |
| `politica_reembolso` | `RESOLVED_BY_FOUNDER_BASELINE` | advogado nomeado (eficácia) | confirmação da política de reembolso/cancelamento | mutação financeira |
| `aceite_eletronico` | `RESOLVED_BY_FOUNDER_BASELINE` | advogado nomeado (eficácia) | confirmação de que a tupla de aceite é oponível | checkout, publicação |
| `dados_pessoais_tratados` | `RESOLVED_BY_FOUNDER_BASELINE` | advogado nomeado (LGPD) | conferência do inventário vs. coleta real | publicação |
| `prazo_entrega` | `RESOLVED_BY_FOUNDER_BASELINE` | — | já alinhado ao catálogo; sem gate novo | — |
| `canal_suporte` | `RESOLVED_BY_FOUNDER_BASELINE` | — | `tiago.sasaki@confenge.com.br` | — |

CNAE / anexo / fator R / RBT12 / item municipal / ISS / retenções / NFS-e teste / taxa efetiva **não** são uma das dez decisões originais; seguem com o contador em `ACCOUNTANT_HANDOFF.md`. Subprocessadores: nenhum inventariado; não criar `DPA_LITE_B2B.md`.

---

## Única solicitação humana / profissional

### 1. Ao fundador (documento de entidade)

Enviar, para o dossiê interno **fora deste repositório**, um destes (o primeiro disponível):

1. contrato social consolidado ou última alteração contratual;
2. cartão CNPJ / comprovante de inscrição e de situação cadastral;
3. extrato oficial da conta Asaas da pessoa jurídica prestadora, se já existir.

Campos a extrair e devolver por escrito: razão social exata, CNPJ, sede registrada. Sem esses campos o token `[[HUMAN_DECISION_REQUIRED: razao_social_cnpj_contratante]]` e o token `[[HUMAN_DECISION_REQUIRED: foro]]` permanecem. Não colar CNPJ neste repositório até o scanner de autoridade comercial e o advogado autorizarem o instrumento público.

Fonte **não** usada: nome fantasia CONFENGE; README pessoal; `web-cfg` brand/marketing; perfil público.

### 2. Ao advogado nomeado

Usar somente `LEGAL_COUNSEL_HANDOFF.md`. Não reenviar o catálogo inteiro nem este repositório.

### 3. Ao contador nomeado

Usar somente `ACCOUNTANT_HANDOFF.md`. Nomear o responsável. Não emitir NFS-e de produção.

---

## Flags que estes gates **não** viram

```
production_checkout_enabled    = false
public_activation_approved     = false
real_money_mutation_approved   = false
checkout_authorized            = false
publication_authorized         = false
cobranca_authorized            = false
legal_terms_forum              = UNKNOWN
tax_nfse                       = UNKNOWN
LEGAL_APPROVED                 = false
TAX_APPROVED                   = false
PRODUCTION_AUTHORIZED          = false
CHECKOUT_AUTHORIZED            = false
```
