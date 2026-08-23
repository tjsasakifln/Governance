---
status: FOUNDER_APPROVED_WITH_DEFERRED_COUNSEL_REVIEW
professional_legal_review: DEFERRED_UNTIL_FIRST_REVENUE
founder_risk_acceptance: APPROVED
operational_use: PRIVATE_NEGOTIATION_ONLY
supersedable: true
jurisdiction: Brazil
business_context: B2B_ENGINEERING_CONSULTING
package: referral-cosell-v1
document_id: CFG-PARTNER-PUBLIC-SECTOR-INTEGRITY-v1
canonical_issue: https://github.com/tjsasakifln/Governance/issues/7
decision_token: FOUNDER_APPROVED_PARTNER_PROGRAM_DEFERRED_COUNSEL_2026_08_19
---

# Integridade no setor público e posição pública do founder

**clause_id:** `proibicao_influencia_exito_publico`

**clause_id:** `integridade_anticorrupcao`

Este documento materializa a posição pública do founder e as regras de integridade do programa. **Não** conclui que toda atividade privada é automaticamente proibida ou permitida. Modela **gate factual** e **registro de conflito**. **Não** é `LEGAL_APPROVED`.

Regras já aprovadas nos termos B2B (`CFG-TERMS-B2B-2026-08-17-v1`, cláusula 11) continuam: nenhum pagamento cobre influência de êxito, facilitação, vantagem indevida, informação pública confidencial ou representação perante agente público.

---

## 1. Proibições explícitas (todas as partes)

- Nunca usar cargo, órgão, repartição, portaria, acesso institucional ou relacionamento público como argumento comercial.
- Nunca atuar como procurador/intermediário perante repartição pública em nome do parceiro ou do cliente.
- Nunca utilizar informação não pública.
- Nunca abordar agente público por conta do cliente.
- Nunca receber remuneração associada a decisão, vitória, valor ou êxito de contrato público.
- Nunca prometer influência, facilitação ou acesso.
- Separar equipamentos, contas, horários, dados e registros públicos/privados.

Copy comercial que apresente cargo público, órgão, procurador-perante-órgão, influência ou facilitação como **benefício do programa** é bloqueada pelo validador.

---

## 2. Gate factual (não é parecer)

Perguntas objetivas, com evidência, antes de `APPROVED`:

1. Há cargo, função, mandato, contrato ou vínculo atual com ente público? (`yes` / `no` / `UNKNOWN`)
2. Há uso de informação não pública? (`yes` / `no` / `UNKNOWN`)
3. A remuneração proposta depende de êxito, valor de edital/obra/contrato público? (`yes` / `no`)
4. A narrativa comercial usa órgão, portaria ou acesso? (`yes` / `no`)
5. Há conflito real ou aparente com agente público identificável? (`REAL` / `APPARENT` / `NONE` / `UNKNOWN`)

Qualquer `yes`, `REAL`, `APPARENT` ou `UNKNOWN` material **não** autoaprova. Destino: `LEGAL_REVIEW_REQUIRED`, `REJECTED` ou `SUSPENDED`. Risco alto de integridade **não** é autoaceito pelo gatilho geral de primeira receita.

---

## 3. Posição pública do founder

O founder não coloca função, órgão ou relacionamento público a serviço de venda, indicação ou comissão. Atividade privada lícita de consultoria de engenharia/inteligência B2G permanece o objeto CONFENGE — obrigação de meio, catálogo aprovado, sem representação. Este pacote **não** amplia esse objeto.

---

## 4. Registro

Conflito, gate factual e decisão são registrados no dossiê do parceiro e, quando aplicável, no lead. Eventos: `partner_due_diligence_decided`, `partner_suspended`, `partner_terminated`.
