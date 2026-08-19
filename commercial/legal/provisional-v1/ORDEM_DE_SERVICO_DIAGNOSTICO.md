---
status: PROVISIONAL_AI_DRAFT
professional_legal_review: NOT_YET_PERFORMED
operational_use: HUMAN_DECISION_REQUIRED
supersedable: true
jurisdiction: Brazil
business_context: B2B_ENGINEERING_CONSULTING
document_id: CFG-LEGAL-OS-DIAG-EXP-v1
package: provisional-v1
offer_code: CFG-DIAG-EXP-v1
---

# Ordem de Serviço — Diagnóstico B2G de Expansão (`CFG-DIAG-EXP-v1`)

Formulário operacional provisório para um único one-off. Não autoriza checkout, cobrança real ou publicação. Tokens `[[HUMAN_DECISION_REQUIRED:…]]` e campos `[[PREENCHER_POR_OPERACAO:…]]` bloqueiam publicação se vazarem para superfície pública.

Havendo conflito com os termos provisórios, esta OS aceita prevalece no que for específico da operação (partes, recorte, data, canal), nos termos da cláusula de prevalência.

---

## 0. Identidade do instrumento

| Campo | Valor |
|---|---|
| `os_id` | `[[PREENCHER_POR_OPERACAO: os_id]]` |
| `offer_code` | `CFG-DIAG-EXP-v1` |
| `offer_version` | `v1` |
| `billing_mode` | `ONE_TIME` |
| `amount_cents` | `800000` |
| `currency` | `BRL` |
| `terms_document` | `TERMOS_B2B_DIAGNOSTICO.md` |
| `terms_version` | `CFG-LEGAL-TERMS-DIAG-EXP-v1` |
| `package_version` | `provisional-v1` |
| `package_hash` | pinar `AUTHORITY_HASH` impresso por `scripts/validate_legal_provisional.py` |
| `catalog_terms_referenced` | `CFG-TERMS-B2B-2026-08-17-v1` (não reaprovado por esta OS) |
| Data da OS | `[[PREENCHER_POR_OPERACAO: os_date]]` |

---

## 1. Prestador

| Campo | Valor |
|---|---|
| Nome comercial | CONFENGE |
| Razão social / CNPJ | `[[HUMAN_DECISION_REQUIRED: razao_social_cnpj_contratante]]` |
| Representante do prestador | `[[PREENCHER_POR_OPERACAO: provider_representative]]` |
| Canal de suporte | `[[HUMAN_DECISION_REQUIRED: canal_suporte]]` |
| Responsável fiscal | `[[HUMAN_DECISION_REQUIRED: responsavel_fiscal]]` |

---

## 2. Cliente (somente PJ / empresário B2B)

| Campo | Valor |
|---|---|
| Razão social | `[[PREENCHER_POR_OPERACAO: client_legal_name]]` |
| CNPJ | `[[PREENCHER_POR_OPERACAO: client_cnpj]]` |
| Representante autorizado | `[[PREENCHER_POR_OPERACAO: client_representative]]` |
| E-mail operacional | `[[PREENCHER_POR_OPERACAO: client_email]]` |
| Telefone operacional | `[[PREENCHER_POR_OPERACAO: client_phone]]` |
| Recorte geográfico / CNAEs / tese | `[[PREENCHER_POR_OPERACAO: client_scope_cut]]` |

Não usar esta OS para pessoa física consumidora.

---

## 3. Objeto e entregáveis

Objeto: Diagnóstico B2G de Expansão, obrigação de meio, sem garantia de resultado, sem representação jurídica e sem substituição de advogado ou contador.

Entregáveis (catálogo):

- [ ] mapa de compradores
- [ ] até 15 concorrentes
- [ ] painel de preços
- [ ] contratos com indício de expiração
- [ ] avisos/editais triados
- [ ] PDF executivo
- [ ] planilhas
- [ ] kickoff
- [ ] apresentação final

Crédito comercial de catálogo (200000 centavos / 60 dias) não ativa recorrência e não é cobrado nesta OS.

---

## 4. Insumos obrigatórios do cliente

- [ ] identificação societária e representante
- [ ] recorte de expansão
- [ ] resumo do portfólio público
- [ ] autorização de uso dos dados enviados
- [ ] canal de esclarecimento

O relógio de entrega **não inicia** enquanto este bloco estiver incompleto.

---

## 5. Prazo, preço e início

| Campo | Valor |
|---|---|
| Prazo de catálogo (referência) | 10–15 dias úteis após insumos obrigatórios |
| Confirmação humana do prazo | `[[HUMAN_DECISION_REQUIRED: prazo_entrega]]` |
| Preço | R$ 8.000,00 (`800000` centavos), one-off |
| Início de trabalho | somente após aceite + confirmação financeira |
| Início do relógio | somente após insumos obrigatórios |
| Rodada de correção factual | uma, consolidada |
| Tributos / NFS-e | operação fiscal aplicável; produção de NFS-e não autorizada por esta OS |
| Foro | `[[HUMAN_DECISION_REQUIRED: foro]]` |
| Teto de responsabilidade | `[[HUMAN_DECISION_REQUIRED: limite_responsabilidade]]` |
| Tratamento de reembolso | `[[HUMAN_DECISION_REQUIRED: politica_reembolso]]` |
| Mecanismo de aceite eletrônico | `[[HUMAN_DECISION_REQUIRED: aceite_eletronico]]` |

Checkout e cobrança real: **não autorizados** por este formulário.

---

## 6. Aceite e assinatura

Mecanismo pretendido (ainda não validado para superfície pública): registro durável de CNPJ, representante, data/hora, versão/hash dos termos e desta OS, e cópia baixável. Validação do mecanismo: `[[HUMAN_DECISION_REQUIRED: aceite_eletronico]]`.

### Prestador

Nome: ________________________________

Assinatura / aceite: ________________________________

Data: ________

### Cliente

Nome / cargo: ________________________________

Declaro capacidade B2B, veracidade dos dados e que li os termos provisórios pinados, inclusive a ausência de garantia de resultado e a ausência de representação jurídica.

Assinatura / aceite: ________________________________

Data: ________

`accepted_terms_hash`: `[[PREENCHER_POR_OPERACAO: accepted_terms_hash]]`  
`accepted_os_hash`: `[[PREENCHER_POR_OPERACAO: accepted_os_hash]]`  
`acceptance_event_id`: `[[PREENCHER_POR_OPERACAO: acceptance_event_id]]`

Eventos mínimos a registrar (quando o mecanismo for decidido): `terms_presented`, `terms_hash_pinned`, `os_presented`, `human_acceptance`, `financial_confirmation`, `mandatory_inputs_received`, `clock_started`, `deliverable_available`, `correction_round_closed`. Nenhum desses eventos autoriza checkout de produção.
