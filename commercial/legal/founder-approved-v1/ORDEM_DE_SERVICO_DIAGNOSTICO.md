---
status: FOUNDER_APPROVED_LIMITED_PRODUCTION
professional_legal_review: DEFERRED_UNTIL_FIRST_REVENUE
founder_risk_acceptance: APPROVED
operational_use: LIMITED_PUBLIC_DIAGNOSIS_ONLY
supersedable: true
jurisdiction: Brazil
business_context: B2B_ENGINEERING_CONSULTING
document_id: CFG-LEGAL-OS-DIAG-EXP-FOUNDER-v1
package: founder-approved-v1
offer_code: CFG-DIAG-EXP-v1
decision_token: FOUNDER_APPROVED_WITH_DEFERRED_COUNSEL_REVIEW_2026_08_18
---

# Ordem de Serviço — Diagnóstico B2G de Expansão (`CFG-DIAG-EXP-v1`)

Formulário operacional da versão `founder-approved-v1`. Campos `[[PREENCHER_POR_OPERACAO:…]]` são preenchidos por negócio, no momento da contratação, e não podem aparecer com dados reais de cliente neste repositório.

Havendo conflito com os termos, esta OS aceita prevalece no que for específico da operação (partes do cliente, recorte, data, canal), nos termos da cláusula de prevalência.

Uma OS que exija assinatura do prestador deve ser assinada por representante com poderes comprováveis. A publicação automatizada destes termos não prova, por si, poderes internos específicos.

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
| `terms_version` | `CFG-LEGAL-TERMS-DIAG-EXP-FOUNDER-v1` |
| `scope_version` | `CFG-DIAG-EXP-v1` |
| `package_version` | `founder-approved-v1` |
| `decision_token` | `FOUNDER_APPROVED_WITH_DEFERRED_COUNSEL_REVIEW_2026_08_18` |
| `package_hash` | pinar `AUTHORITY_HASH` impresso por `scripts/validate_legal_founder_approved.py` |
| `prior_packages` | `provisional-v1`, `diagnostico-v1.1` (imutáveis; aceite antigo não é reescrito) |
| Data da OS | `[[PREENCHER_POR_OPERACAO: os_date]]` |

---

## 1. Prestador

| Campo | Valor |
|---|---|
| Nome comercial | CONFENGE |
| Razão social | CONFENGE SERVICOS DE DESENHOS TECNICOS LTDA |
| CNPJ | 52.407.089/0001-09 |
| Endereço | Avenida Prefeito Osmar Cunha, 416, Sala 1108, Centro, Florianópolis/SC, CEP 88015-100 |
| Representante do prestador (quando a OS exigir assinatura) | pessoa com poderes comprováveis; não inventar cargo societário neste repositório |
| Canal comercial / suporte / privacidade | tiago.sasaki@confenge.com.br |
| WhatsApp comercial | +55 48 98834-4559 |
| Responsável operacional fiscal | Tiago Jun Sasaki (operador interno; `professional_accounting_review = NOT_CLAIMED`) |
| NFS-e | fila manual; automação OFF |

---

## 2. Cliente (somente PJ / empresário B2B)

| Campo | Valor |
|---|---|
| Razão social | `[[PREENCHER_POR_OPERACAO: client_legal_name]]` |
| CNPJ | `[[PREENCHER_POR_OPERACAO: client_cnpj]]` |
| Representante (nome) | `[[PREENCHER_POR_OPERACAO: client_representative]]` |
| Cargo | `[[PREENCHER_POR_OPERACAO: client_role]]` |
| E-mail profissional | `[[PREENCHER_POR_OPERACAO: client_email]]` |
| Telefone operacional | `[[PREENCHER_POR_OPERACAO: client_phone]]` |
| Recorte geográfico / CNAEs / tese | `[[PREENCHER_POR_OPERACAO: client_scope_cut]]` |
| Declaração de poderes | obrigatória, não pré-marcada |

Não usar esta OS para pessoa física, menor, contratação pessoal ou objeto fora de atividade econômica.

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

## 5. Prazo, preço, foro e início

| Campo | Valor |
|---|---|
| Referência comercial | normalmente 10 a 15 dias úteis |
| Compromisso contratual | até 15 dias úteis |
| Início do relógio | aceite válido + confirmação financeira + insumos obrigatórios completos + kickoff ou dispensa escrita |
| Preço | R$ 8.000,00 (`800000` centavos), one-off, sem parcelamento e sem recorrência |
| Meios de checkout hospedado | PIX e CREDIT_CARD (sem BOLETO neste endpoint) |
| Foro | Foro da Comarca de Florianópolis, Estado de Santa Catarina, com preservação de competência cogente e de regra consumerista se aplicável |
| Teto de responsabilidade | valor efetivamente pago no pedido afetado, limitado a R$ 8.000,00, com as exceções dos termos |
| Reembolso | fórmula M0–M5 em `POLITICA_CANCELAMENTO_REEMBOLSO.md` |
| Aceite | antes do checkout; ver `ELECTRONIC_ACCEPTANCE_SPEC.json` |

---

## 6. Aceite

Aceite eletrônico ocorre **antes** da criação do checkout. Checkout, callback ou pagamento não substituem o aceite.

Declarações obrigatórias, não pré-marcadas:

- [ ] li e aceito os termos
- [ ] declaro possuir poderes para contratar
- [ ] reconheço que o serviço é obrigação de meio
- [ ] confirmo contratação B2B para atividade econômica

Confirmação de e-mail: OTP ou magic link.

`acceptance_id`: `[[PREENCHER_POR_OPERACAO: acceptance_id]]`  
`accepted_terms_hash`: `[[PREENCHER_POR_OPERACAO: accepted_terms_hash]]`  
`accepted_os_hash`: `[[PREENCHER_POR_OPERACAO: accepted_os_hash]]`

Eventos mínimos: `terms_presented`, `terms_hash_pinned`, `os_presented`, `human_acceptance`, `email_confirmed`, `financial_confirmation`, `mandatory_inputs_received`, `kickoff_or_waiver`, `clock_started`, `deliverable_available`, `correction_round_closed`. `customer_created`, `checkout_created` e `payment_created` não são aceite. `PAYMENT_CONFIRMED` não é receita. `PAYMENT_RECEIVED` é receita recebida.
