---
status: FOUNDER_APPROVED_WITH_DEFERRED_COUNSEL_REVIEW
professional_legal_review: DEFERRED_UNTIL_FIRST_REVENUE
founder_risk_acceptance: APPROVED
operational_use: PRIVATE_NEGOTIATION_ONLY
supersedable: true
jurisdiction: Brazil
business_context: B2B_ENGINEERING_CONSULTING
package: referral-cosell-v1
document_id: CFG-PARTNER-LGPD-LEAD-NOTICE-v1
canonical_issue: https://github.com/tjsasakifln/Governance/issues/7
decision_token: FOUNDER_APPROVED_PARTNER_PROGRAM_DEFERRED_COUNSEL_2026_08_19
---

# Aviso LGPD — fluxo de leads do parceiro

**clause_id:** `lgpd_minimizacao`

Aviso operacional para o compartilhamento de dados profissionais de contato B2B entre parceiro e CONFENGE. **Não** é `LEGAL_APPROVED`. **Não** inventa DPA universal. **Não** cria função adicional de privacidade além do canal já publicado no Diagnóstico.

---

## 1. Caminho mínimo

parceiro identifica possível necessidade
→ explica ao cliente a finalidade da apresentação
→ obtém consentimento/anuência documentável para compartilhar os dados mínimos
→ registra apenas dados profissionais necessários
→ CONFENGE recebe e decide
→ oposição/supressão é respeitada

`consent_evidence_ref` e `source` são obrigatórios. Sem eles, o lead é inadmissível (`lgpd_lead_admissible = false`).

---

## 2. Dados típicos (mínimos)

- razão social, CNPJ, site;
- nome, e-mail e telefone profissionais do contato;
- cargo/função no potencial cliente;
- contexto sucinto da demanda.

Não coletar: dado sensível (art. 5º, II, LGPD); dado de menor; histórico médico; documento de edital sigiloso sem autorização; CPF de sócio quando desnecessário; lista comprada.

---

## 3. Proibições

- dump de listas;
- dados pessoais irrelevantes;
- dados sensíveis;
- enriquecimento sem necessidade;
- venda de base;
- contato com pessoa que recusou;
- upload de documentos secretos sem autorização;
- PII em URL/analytics.

---

## 4. Papéis (premissa conservadora)

Premissa deste pacote: **controladores independentes** para o ato de indicar um contato B2B profissional (o parceiro decide indicar; a CONFENGE decide aceitar e tratar para sua própria prospecção/contratação).

Essa premissa **não** é relação jurídica universal. Se houver instrução vinculante, ferramenta compartilhada de tratamento, ou operação de escala (`DISTRIBUTION_INTEGRATION`), é necessário DPA/aditivo específico **antes** de operar. DPA lite **não** está neste pacote.

Canal de privacidade CONFENGE já publicado no pacote jurídico do Diagnóstico: tiago.sasaki@confenge.com.br. Oposição, correção e supressão são encaminhadas nesse canal; o parceiro deve cessar novo compartilhamento quando souber da oposição.

---

## 5. Retenção

Lead não convertido: reter o mínimo necessário à defesa de atribuição e à LGPD, alinhado à agenda já aprovada no Diagnóstico quando o dado migrar para cliente CONFENGE. Este pacote não cria base paralela secreta.

Fontes primárias: Lei 13.709/2018 — https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm
