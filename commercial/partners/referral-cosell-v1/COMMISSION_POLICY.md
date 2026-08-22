---
status: FOUNDER_APPROVED_WITH_DEFERRED_COUNSEL_REVIEW
professional_legal_review: DEFERRED_UNTIL_FIRST_REVENUE
founder_risk_acceptance: APPROVED
operational_use: PRIVATE_NEGOTIATION_ONLY
supersedable: true
jurisdiction: Brazil
business_context: B2B_ENGINEERING_CONSULTING
package: referral-cosell-v1
document_id: CFG-PARTNER-COMMISSION-POLICY-v1
canonical_issue: https://github.com/tjsasakifln/Governance/issues/7
decision_token: FOUNDER_APPROVED_PARTNER_PROGRAM_DEFERRED_COUNSEL_2026_08_19
---

# Política de comissão — Programa de Parceiros v1

**clause_id:** `comissao_base_periodo_teto`

Números canônicos em `COMMISSION_SCHEDULE.json`. Em conflito, o JSON versionado prevalece sobre a prosa, e o acordo assinado da oportunidade prevalece sobre ambos somente se for versão pinada com hash.

Este texto **não** é `LEGAL_APPROVED`.

---

## 1. Base elegível

A base é **honorários líquidos efetivamente recebidos** pela CONFENGE do cliente atribuído (`eligible_net_fees_actually_received`):

- valor bruto de honorários CONFENGE cobrados do cliente atribuído;
- menos taxas do provedor de pagamento destacadas;
- menos tributos retidos na fonte quando destacados no recebimento;
- menos estornos, reembolsos, chargebacks e cancelamentos já reconhecidos;
- somente dentro do período de seis meses contado do primeiro recebimento elegível após contratação do cliente atribuído;
- somente se a atribuição estiver aceita e o contrato com o cliente tiver ocorrido durante a proteção de 90 dias.

Não entram na base: valor de edital, valor de obra, valor de contrato público, economia estimada, pleito, vitória em licitação, success fee, honorários advocatícios, receita de terceiro, simples envio de lista, conta ou oportunidade preexistente na base CONFENGE.

---

## 2. Indicação qualificada (`REFERRAL_QUALIFIED`)

- Alíquota: **10%** (`rate_bps = 1000`).
- Período: **seis** primeiros meses de honorários do cliente indicado.
- Teto **total** por cliente indicado: R$ 10.000 (`cap_cents_total_per_referred_client = 1000000`). Unidade: TOTAL, nunca mensal. Este teto não é Extra, não é preço de catálogo, não é oferta pública.
- Sem exclusividade.
- Sem remuneração por lista.
- Sem comissão se a conta/oportunidade já existia na base CONFENGE.

---

## 3. Co-venda material (`COSELL_SPECIALIZED`)

- Alíquota: **até 15%** (`max_rate_bps = 1500`), percentual exato definido no registro da oportunidade conforme entregáveis comerciais concretos.
- Período: seis primeiros meses.
- Teto **total** por cliente: R$ 15.000 (`cap_cents_total_per_client = 1500000`). Unidade: TOTAL, nunca mensal.
- Sem aditivo de co-venda pinado, a alíquota de indicação (10%) é o máximo aplicável; 15% não se presume.

---

## 4. Evento de pagamento

**clause_id:** `evento_pagamento`

Comissão somente depois do efetivo recebimento pela CONFENGE. Nenhum adiantamento por expectativa. Nenhum mínimo garantido (`guaranteed_minimum_cents = 0`).

Pagamento ao parceiro exige:

1. receipt real de honorário líquido elegível;
2. snapshot de cálculo versionado;
3. documento fiscal válido do parceiro quando aplicável;
4. aprovação humana nominada;
5. evento `partner_commission_approved` e, após o pagamento, `partner_commission_paid`.

`partner_commission_accrual_candidate` **não** é receita e **não** é pagamento. Nenhum evento de parceiro é receita recebida da CONFENGE. Nenhuma mutação automática de provider financeiro (`automatic_financial_provider_mutation = false`; `real_money_mutation_approved = false`).

---

## 5. Documento fiscal

**clause_id:** `documento_fiscal`

Quando a legislação aplicável exigir, o parceiro emite documento fiscal válido (NFS-e ou equivalente) contra a CONFENGE, com descrição de intermediação/indicação ou de serviço de co-venda efetivamente prestado — nunca de “êxito em licitação”. Sem documento quando exigido, não há pagamento.

A CONFENGE **não** afirma enquadramento fiscal do parceiro. Contador do parceiro é responsável pelo documento do parceiro.

---

## 6. Estorno, reembolso, inadimplência e chargeback

**clause_id:** `estorno_reembolso_inadimplencia`

Cancelamento, inadimplência, chargeback, reembolso ou estorno do cliente **reduzem** a comissão proporcionalmente sobre a base líquida. Comissão já paga sobre valor posteriormente estornado gera ajuste (`partner_commission_adjusted`) e, se necessário, compensação ou devolução.

Fórmula canônica (centavos, divisão inteira):

```
net = max(0, eligible_net_fee_receipt_cents - refund_or_chargeback_cents)
raw = net * rate_bps // 10000
payable = max(0, min(raw, cap_cents - previously_paid_or_accrued_cents))
```

Se qualquer fail-closed disparar (sem receipt, base inelegível, preexisting, lead rejeitado, proteção expirada sem contrato, OAB sem autoridade, `NOT_ELIGIBLE`, diligência não aprovada), `payable = 0`.

---

## 7. Registro e imutabilidade

Cálculo, evidência de receipt, ator de aprovação, versão do acordo e hash da política são registrados. Acordo e schedule pinados são imutáveis; correção cria nova versão. Não há atribuição retroativa silenciosa de comissão.
