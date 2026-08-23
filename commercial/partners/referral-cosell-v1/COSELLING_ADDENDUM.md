---
status: FOUNDER_APPROVED_WITH_DEFERRED_COUNSEL_REVIEW
professional_legal_review: DEFERRED_UNTIL_FIRST_REVENUE
founder_risk_acceptance: APPROVED
operational_use: PRIVATE_NEGOTIATION_ONLY
supersedable: true
jurisdiction: Brazil
business_context: B2B_ENGINEERING_CONSULTING
package: referral-cosell-v1
document_id: CFG-PARTNER-COSELLING-ADDENDUM-v1
canonical_issue: https://github.com/tjsasakifln/Governance/issues/7
decision_token: FOUNDER_APPROVED_PARTNER_PROGRAM_DEFERRED_COUNSEL_2026_08_19
---

# Aditivo de co-venda material

**clause_id:** `colaboracao_cosell`

Este aditivo habilita `COSELL_SPECIALIZED` sobre o acordo padrão `PARTNER_AGREEMENT_B2B.md`. Sem este aditivo pinado à oportunidade, a modalidade permanece `REFERRAL_QUALIFIED` (10%, teto total de R$ 10.000). **Não** é `LEGAL_APPROVED`.

`DISTRIBUTION_INTEGRATION` **não** é coberto por este aditivo.

---

## 1. Oportunidade

Cada co-venda é uma oportunidade identificada. Campos obrigatórios (preenchidos só na via da oportunidade, nunca inventados neste arquivo canônico):

- `opportunity_id`
- `partner_id` / versão do acordo / hash
- `client_ref` (identificador interno, sem PII em métricas agregadas)
- `consent_evidence_ref`
- escopo CONFENGE / escopo parceiro / fronteira
- autoria de cada entregável
- responsabilidade técnica, comercial e contratual
- owner da conta (padrão: CONFENGE)
- preço ao cliente (catálogo CONFENGE, sem reabrir Extra)
- `rate_bps` ≤ 1500
- período: seis meses
- teto total por cliente: R$ 15.000 (`cap_cents_total_per_client = 1500000`)

Percentual exato **não** se presume. Ausência de `rate_bps` no registro → fail-closed, sem comissão de co-venda.

---

## 2. Transparência

O cliente deve poder identificar quem entrega o quê. Vedado white-label invisível, subcontratação oculta da conta CONFENGE, ou apresentação do parceiro como a própria CONFENGE (ou o inverso) sem autorização escrita.

A CONFENGE permanece contratante do cliente para os serviços CONFENGE. O parceiro, se prestar serviço próprio ao cliente, contrata o cliente **separadamente**, sem misturar honorários, NFS-e ou responsabilidade.

---

## 3. Autoria e responsabilidade

Cada parte responde pelo próprio escopo. Defeito no escopo do parceiro não gera comissão extra nem transfere responsabilidade à CONFENGE. Defeito no escopo CONFENGE não autoriza o parceiro a “corrigir” perante órgão público.

Nenhuma das partes presta advocacia por força deste aditivo.

---

## 4. Comissão de co-venda

Base, evento de pagamento, documento fiscal, estorno e fail-closed idênticos à `COMMISSION_POLICY.md`, com `max_rate_bps = 1500` e teto total `1500000` centavos por cliente. Comissão continua a exigir receipt real de honorários líquidos CONFENGE. Trabalho do parceiro faturado diretamente ao cliente **não** entra na base CONFENGE.

---

## 5. Encerramento do aditivo

O aditivo encerra com a oportunidade (entrega, recusa do cliente, expiração da proteção sem contrato, ou término do acordo-mãe). Não há renovação silenciosa. Nova oportunidade exige novo aditivo.
