---
status: FOUNDER_DECIDED_DRAFT
professional_legal_review: NOT_YET_PERFORMED
operational_use: PRIVATE_NEGOTIATION_ONLY
supersedable: true
jurisdiction: Brazil
business_context: B2B_ENGINEERING_CONSULTING
document_id: CFG-LEGAL-FOUNDER-DECISIONS-DIAG-v1.1
package: diagnostico-v1.1
prior_package: provisional-v1
offer_code: CFG-DIAG-EXP-v1
decided_by: founder
decided_at: 2026-08-18
---

# Decisões do fundador — Diagnóstico `CFG-DIAG-EXP-v1`

Estas são decisões **empresariais**. Não são revisão jurídica, não são enquadramento fiscal e não autorizam checkout. Cada linha de base abaixo carrega o token `[[FOUNDER_BASELINE: …]]` e permanece sujeita a advogado ou contador nomeado.

Pacote anterior (imutável): `commercial/legal/provisional-v1/` (`CFG-LEGAL-PROVISIONAL-DIAG-v1`).
Regra de invalidação: edição material deste pacote gera nova versão e novo hash; contrato já aceito no hash anterior **não** é reescrito.

---

## O que mudou em relação a `provisional-v1`

| id | v1 | v1.1 |
|---|---|---|
| `razao_social_cnpj_contratante` | token aberto | continua `PENDING_ENTITY_DOCUMENT` |
| `foro` | token aberto | continua `PENDING_ENTITY_DOCUMENT` (depende da sede) |
| `limite_responsabilidade` | token aberto | `RESOLVED_BY_FOUNDER_BASELINE` |
| `politica_reembolso` | token aberto | `RESOLVED_BY_FOUNDER_BASELINE` |
| `prazo_entrega` | token aberto | `RESOLVED_BY_FOUNDER_BASELINE` |
| `dados_pessoais_tratados` | token aberto | `RESOLVED_BY_FOUNDER_BASELINE` |
| `retencao` | token aberto | `PENDING_NAMED_COUNSEL` |
| `responsavel_fiscal` | token aberto | `PENDING_NAMED_ACCOUNTANT` |
| `aceite_eletronico` | token aberto | `RESOLVED_BY_FOUNDER_BASELINE` |
| `canal_suporte` | token aberto | `RESOLVED_BY_FOUNDER_BASELINE` |

Quem decidiu: fundador. Data: 2026-08-18. Hash de autoridade: pinar o `FOUNDER_DECIDED_HASH` impresso por `scripts/validate_legal_provisional.py`.

---

## Linhas de base comerciais (não são aprovação jurídica)

### Oferta e preço

- `offer_id` / `offer_code`: `CFG-DIAG-EXP-v1`
- preço: R$ 8.000 (`800000` centavos), one-time, BRL
- crédito comercial de catálogo: R$ 2.000 (`200000` centavos), não cumulativo, no primeiro mês recorrente se a contratação ocorrer em até 60 dias após a entrega
- o crédito **não** ativa Diretoria B2G e **não** é cobrado neste one-off

### Prazo — `[[FOUNDER_BASELINE: prazo_entrega]]`

10 a 15 dias úteis após alinhamento, dados/brief completos e aceite. O relógio não corre sem insumos obrigatórios. Obrigação de **meio**. Sem promessa de vitória, contrato, economia ou resultado.

### Condição de início

Primeira cobrança/pagamento confirmado **antes** do kickoff. Objeto de provedor criado não é receita e não inicia trabalho.

### Reembolso — `[[FOUNDER_BASELINE: politica_reembolso]]`

1. Cobrança indevida ou duplicada: reconciliar e devolver.
2. Se CONFENGE recusar o serviço aceito antes do início: devolução integral após conciliação.
3. Após o início: liquidar o trabalho demonstravelmente executado e devolver eventual saldo positivo.
4. Não há reembolso automático integral após o início.
5. Nenhuma mutação financeira real ocorre enquanto `real_money_mutation_approved = false`.

### Responsabilidade — `[[FOUNDER_BASELINE: limite_responsabilidade]]`

Teto do one-off limitado ao valor efetivamente pago na OS afetada, na medida permitida pelo direito brasileiro. Permanecem fora do teto, como linha de base comercial sujeita a advogado: exceções não limitáveis, dolo/fraude, confidencialidade/LGPD, propriedade intelectual e integridade. Não se afirma eficácia jurídica deste teto. Não se publica teto numérico inventado no lugar do valor pago.

### Aceite eletrônico — `[[FOUNDER_BASELINE: aceite_eletronico]]`

Aceite = conjunto de OS/proposta + `terms_version` + `scope_version` + hashes + representante autorizado / CNPJ do cliente + timestamp + cópia durável. Checkout, callback ou objeto de provedor **sozinho não prova aceite**.

### Dados normalmente tratados — `[[FOUNDER_BASELINE: dados_pessoais_tratados]]`

Nome e contato corporativo, função, empresa/CNPJ, dados contratuais/fiscais, brief/arquivos fornecidos, comunicações e metadados de aceite. Não solicitar dado sensível por padrão.

### Canal oficial — `[[FOUNDER_BASELINE: canal_suporte]]`

`tiago.sasaki@confenge.com.br`, salvo autoridade canônica diferente já existente. Nenhuma autoridade canônica conflitante foi encontrada neste repositório.

---

## O que o fundador deliberadamente **não** decidiu

- razão social e CNPJ exatos da pessoa jurídica prestadora — `[[HUMAN_DECISION_REQUIRED: razao_social_cnpj_contratante]]`
- endereço/sede registrada e foro proposto — `[[HUMAN_DECISION_REQUIRED: foro]]`
- prazo final de retenção jurídica/fiscal — `[[HUMAN_DECISION_REQUIRED: retencao]]`
- contador/responsável fiscal nomeado — `[[HUMAN_DECISION_REQUIRED: responsavel_fiscal]]`
- CNAE, anexo, fator R, RBT12, item municipal, ISS, retenções, NFS-e, taxa efetiva
- lista real de subprocessadores (nenhum inventariado; DPA lite continua não aplicável)

Busca de fonte autorizada (2026-08-18): este repositório não contém contrato social, cartão CNPJ, certidão ou configuração oficial Asaas da prestadora. Nome fantasia, README pessoal e perfil público **não** foram usados como substituto. Uma única solicitação humana está em `PROFESSIONAL_GATES.md`.
