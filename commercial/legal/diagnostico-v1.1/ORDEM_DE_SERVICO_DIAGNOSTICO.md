---
status: FOUNDER_DECIDED_DRAFT
professional_legal_review: NOT_YET_PERFORMED
operational_use: PRIVATE_NEGOTIATION_ONLY
supersedable: true
jurisdiction: Brazil
business_context: B2B_ENGINEERING_CONSULTING
document_id: CFG-LEGAL-OS-DIAG-EXP-v1.1
package: diagnostico-v1.1
prior_package: provisional-v1
offer_code: CFG-DIAG-EXP-v1
---

# Ordem de Serviço — Diagnóstico B2G de Expansão (`CFG-DIAG-EXP-v1`)

Formulário operacional da versão `diagnostico-v1.1`. Não autoriza checkout, cobrança real ou publicação. Tokens `[[HUMAN_DECISION_REQUIRED:…]]` e campos `[[PREENCHER_POR_OPERACAO:…]]` bloqueiam publicação se vazarem para superfície pública. Tokens `[[FOUNDER_BASELINE:…]]` são linha empresarial, não aprovação jurídica.

Havendo conflito com os termos, esta OS aceita prevalece no que for específico da operação (partes, recorte, data, canal), nos termos da cláusula de prevalência.

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
| `terms_version` | `CFG-LEGAL-TERMS-DIAG-EXP-v1.1` |
| `scope_version` | `CFG-DIAG-EXP-v1` |
| `package_version` | `diagnostico-v1.1` |
| `package_hash` | pinar `FOUNDER_DECIDED_HASH` impresso por `scripts/validate_legal_provisional.py` |
| `prior_package` | `provisional-v1` (imutável; aceite antigo não é reescrito) |
| `catalog_terms_referenced` | `CFG-TERMS-B2B-2026-08-17-v1` (não reaprovado por esta OS) |
| Data da OS | `[[PREENCHER_POR_OPERACAO: os_date]]` |

---

## 1. Prestador

| Campo | Valor |
|---|---|
| Nome comercial | CONFENGE |
| Razão social / CNPJ | `[[HUMAN_DECISION_REQUIRED: razao_social_cnpj_contratante]]` |
| Representante do prestador | `[[PREENCHER_POR_OPERACAO: provider_representative]]` |
| Canal de suporte | `[[FOUNDER_BASELINE: canal_suporte]]` `tiago.sasaki@confenge.com.br` |
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
| Prazo `[[FOUNDER_BASELINE: prazo_entrega]]` | 10–15 dias úteis após alinhamento, dados/brief completos e aceite |
| Preço | R$ 8.000,00 (`800000` centavos), one-off |
| Início de trabalho | somente após aceite + confirmação financeira (primeira cobrança antes do kickoff) |
| Início do relógio | somente após insumos obrigatórios |
| Rodada de correção factual | uma, consolidada |
| Tributos / NFS-e | operação fiscal aplicável; produção de NFS-e não autorizada por esta OS |
| Foro | `[[HUMAN_DECISION_REQUIRED: foro]]` |
| Teto de responsabilidade `[[FOUNDER_BASELINE: limite_responsabilidade]]` | valor efetivamente pago na OS afetada; carve-outs de exceções não limitáveis, dolo/fraude, confidencialidade/LGPD, PI e integridade (sujeito a advogado) |
| Tratamento de reembolso `[[FOUNDER_BASELINE: politica_reembolso]]` | indevida/duplicada: devolver; recusa CONFENGE antes do início: integral; após início: liquidar executado e devolver saldo positivo; sem reembolso automático integral |
| Mecanismo de aceite `[[FOUNDER_BASELINE: aceite_eletronico]]` | OS/proposta + `terms_version` + `scope_version` + hashes + representante/CNPJ + timestamp + cópia durável. Checkout/callback sozinho não prova aceite. |

Checkout e cobrança real: **não autorizados** por este formulário.

---

## 6. Aceite e assinatura

Aceite eletrônico, linha de base do fundador: registro durável de CNPJ do cliente, representante, data/hora, `terms_version`, `scope_version`, hash destes termos e desta OS, e cópia baixável. Checkout/callback sozinho não prova aceite.

### Prestador

Nome: ________________________________

Assinatura / aceite: ________________________________

Data: ________

### Cliente

Nome / cargo: ________________________________

Declaro capacidade B2B, veracidade dos dados e que li os termos pinados, inclusive a ausência de garantia de resultado e a ausência de representação jurídica.

Assinatura / aceite: ________________________________

Data: ________

`accepted_terms_hash`: `[[PREENCHER_POR_OPERACAO: accepted_terms_hash]]`
`accepted_os_hash`: `[[PREENCHER_POR_OPERACAO: accepted_os_hash]]`
`acceptance_event_id`: `[[PREENCHER_POR_OPERACAO: acceptance_event_id]]`

Eventos mínimos a registrar: `terms_presented`, `terms_hash_pinned`, `os_presented`, `human_acceptance`, `financial_confirmation`, `mandatory_inputs_received`, `clock_started`, `deliverable_available`, `correction_round_closed`. Nenhum desses eventos autoriza checkout de produção. `customer_created`, `checkout_created` e `payment_created` não são aceite.
