---
status: FOUNDER_APPROVED_LIMITED_PRODUCTION
professional_legal_review: DEFERRED_UNTIL_FIRST_REVENUE
founder_risk_acceptance: APPROVED
operational_use: LIMITED_PUBLIC_DIAGNOSIS_ONLY
supersedable: true
jurisdiction: Brazil
business_context: B2B_ENGINEERING_CONSULTING
document_id: CFG-LEGAL-CANCEL-DIAG-EXP-FOUNDER-v1
package: founder-approved-v1
offer_code: CFG-DIAG-EXP-v1
decision_token: FOUNDER_APPROVED_WITH_DEFERRED_COUNSEL_REVIEW_2026_08_18
---

# Política de cancelamento e reembolso — one-off `CFG-DIAG-EXP-v1`

Política determinística por marcos, baseada em trabalho comprovável. Não é multa disfarçada. Não autoriza mutação automática no Asaas. Direitos cogentes permanecem preservados. Este texto **não** declara renúncia a eventual direito de arrependimento legalmente aplicável.

Aplica-se somente ao Diagnóstico B2G one-off. Não regula e não ativa planos recorrentes.

---

## 1. Fórmula

```
refund_due = max(0, amount_received - earned_milestones - preapproved_nonrecoverable_third_party_costs)
```

`earned_milestones` = `amount_received * earned_percent` do marco comprovado mais alto atingido.

Custos de terceiro só podem ser descontados se forem, cumulativamente: necessários; previamente aprovados por escrito; documentados; não recuperáveis.

---

## 2. Marcos M0–M5

| Marco | Estado comprovável | Ganho acumulado | Reembolso típico sobre o recebido (sem custo de terceiro) |
|---|---|---|---|
| M0 | pagamento recebido, antes de kickoff e antes de trabalho material | 0% | 100% |
| M1 | kickoff realizado e escopo travado | 15% | 85% |
| M2 | coleta, saneamento e mapa inicial concluídos | 40% | 60% |
| M3 | análises e primeira versão dos entregáveis disponibilizadas | 75% | 25% |
| M4 | pacote final disponibilizado | 90% | 10% |
| M5 | apresentação final e rodada consolidada encerradas | 100% | 0% |

Exemplo em R$ 8.000 (`800000` centavos): M0 = 8000; M1 = 6800; M2 = 4800; M3 = 2000; M4 = 800; M5 = 0 — antes de custos de terceiro preaprovados.

---

## 3. Regras adicionais

1. Cobrança indevida ou duplicada: reembolso integral após conciliação.
2. Recusa da CONFENGE antes do início: reembolso integral.
3. Falha material imputável à CONFENGE: devolver a parcela não executada e corrigir o que for corrigível.
4. Após M4, conveniência do cliente não gera reembolso integral.
5. Desconformidade objetiva aciona correção, não negação automática.
6. Nenhum refund, cancelamento ou chargeback é mutado automaticamente no Asaas.
7. Cada mutação real exige decisão individual de finanças com evidência.
8. Prazo operacional de pagamento de refund aprovado: até 10 dias úteis após a decisão e obtenção dos dados necessários.
9. Chargeback abre exceção; não é auto-WON nem auto-LOST.

---

## 4. O que esta política não faz

- não autoriza estorno automático no provedor;
- não publica o Diagnóstico como relação de consumo já caracterizada, nem declara que o CDC é inaplicável;
- não copia fórmula de saída de planos 180/365;
- não cria multa, juros ou honorários automáticos;
- não trata exceção comercial privada alheia a este one-off;
- não declara `LEGAL_APPROVED`.

---

## 5. Registro mínimo de um pedido

1. `acceptance_id` / `order_id` e hash aceito;
2. marco M0–M5 na data do pedido, com evidência;
3. quem pediu e por escrito;
4. `amount_received`, `earned_milestones`, custos de terceiro (se houver);
5. `refund_due` calculado;
6. decisão humana de finanças **antes** de qualquer mutação no Asaas.
