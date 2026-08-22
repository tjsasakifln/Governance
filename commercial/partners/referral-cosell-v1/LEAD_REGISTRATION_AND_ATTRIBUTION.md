---
status: FOUNDER_APPROVED_WITH_DEFERRED_COUNSEL_REVIEW
professional_legal_review: DEFERRED_UNTIL_FIRST_REVENUE
founder_risk_acceptance: APPROVED
operational_use: PRIVATE_NEGOTIATION_ONLY
supersedable: true
jurisdiction: Brazil
business_context: B2B_ENGINEERING_CONSULTING
package: referral-cosell-v1
document_id: CFG-PARTNER-LEAD-ATTRIBUTION-v1
canonical_issue: https://github.com/tjsasakifln/Governance/issues/7
decision_token: FOUNDER_APPROVED_PARTNER_PROGRAM_DEFERRED_COUNSEL_2026_08_19
---

# Registro de lead e atribuição

**clause_id:** `lead_registration`

Autoridade de atribuição do Programa de Parceiros v1. **Não** é ledger operacional. **Não** é `LEGAL_APPROVED`.

---

## 1. Caminho mínimo

1. Parceiro identifica possível necessidade profissional.
2. Explica ao cliente a finalidade da apresentação à CONFENGE.
3. Obtém consentimento/anuência documentável para compartilhar dados mínimos.
4. Registra apenas dados profissionais necessários.
5. CONFENGE recebe e decide em até **dois dias úteis**: aceitar, rejeitar ou pedir dados adicionais.
6. Oposição/supressão é respeitada.

Eventos: `partner_lead_submitted` → `partner_lead_more_info_requested` | `partner_lead_accepted` | `partner_lead_rejected`. Aceitação dispara `partner_protection_started`.

---

## 2. Campos mínimos do registro

- `partner_id` e versão/hash do acordo
- `lead_id` / `opportunity_id`
- `source` (origem da indicação)
- `modality`
- `consent_evidence_ref` (obrigatório)
- identificação profissional do potencial cliente (razão social/CNPJ quando B2B, contato profissional)
- contexto da demanda (texto curto, sem documento secreto)
- declaração de inexistência de preexisting conhecida
- data/hora de submissão

Proibido no registro: dump de listas; dados pessoais irrelevantes; dados sensíveis; PII em URL/analytics; documentos sigilosos sem autorização; enriquecimento sem necessidade.

---

## 3. Decisão CONFENGE

**clause_id:** `aceitacao_rejeicao`

Prazo: **dois dias úteis** após submissão completa (com consentimento). Silêncio **não** é aceite. `MORE_INFO` suspende o prazo até a resposta; nova omissão pode rejeitar.

Lead rejeitado **não** gera proteção, **não** gera comissão, **não** gera propriedade de conta.

---

## 4. Proteção de 90 dias

**clause_id:** `protecao_90_dias`

Inicia na aceitação. Dura 90 dias. Não é propriedade permanente da conta. Durante a proteção, a CONFENGE não atribui o mesmo lead a outro parceiro nem trata o mesmo CNPJ/oportunidade como inbound orgânico para fins de comissão, salvo evidência de preexisting ou fraude.

A proteção **expira**. Sem contrato do cliente dentro da janela, `partner_protection_expired` e a atribuição cessa.

Ausência de ação material do parceiro (não contextualizar, não facilitar o handoff combinado, desaparecer) pode encerrar a proteção antes dos 90 dias, com registro de reason code.

Nenhuma atribuição retroativa silenciosa.

---

## 5. Preexisting, duplicidade e conflito

**clause_id:** `preexisting_accounts`

São excluídos: cliente ativo; lead já aberto; oportunidade já registrada; conversa comercial material prévia da CONFENGE com o mesmo CNPJ/objeto, evidenciada por registro anterior à submissão.

**clause_id:** `duplicidades`

Dois parceiros sobre o mesmo alvo: prevalece evidência temporal **e** contextual (consentimento, especificidade da demanda). Lista genérica perde para lead consentido e contextualizado. Empate ou dúvida: fail-closed, não atribui, registra o conflito.

---

## 6. Conversão e comissão

Somente lead **aceito** cujo cliente **contrate durante a proteção** alimenta a janela de comissão de seis meses. Receipts posteriores à expiração da proteção ainda podem gerar comissão se o contrato ocorreu **dentro** da proteção. Receipts de cliente contratado **depois** da expiração não atribuem.

---

## 7. Função canônica

O validador `attribution_outcome` é a implementação fail-closed desta política. Testes devem chamar a função enviada, não reimplementá-la.
