---
status: FOUNDER_APPROVED_LIMITED_PRODUCTION
professional_legal_review: DEFERRED_UNTIL_FIRST_REVENUE
founder_risk_acceptance: APPROVED
operational_use: LIMITED_PUBLIC_DIAGNOSIS_ONLY
supersedable: true
jurisdiction: Brazil
business_context: B2B_ENGINEERING_CONSULTING
document_id: CFG-LEGAL-INCIDENT-MIN-FOUNDER-v1
package: founder-approved-v1
decision_token: FOUNDER_APPROVED_WITH_DEFERRED_COUNSEL_REVIEW_2026_08_18
---

# Resposta mínima a incidente de segurança — Diagnóstico B2G

Playbook mínimo. Não admite incidente inexistente. Não cria cargo formal de privacidade além do canal abaixo.

Canal de privacidade: `tiago.sasaki@confenge.com.br`.

Fontes primárias revalidadas em 2026-08-18:

- LGPD (Lei 13.709/2018): https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm
- Portal ANPD: https://www.gov.br/anpd/
- Comunicação de incidente ANPD: https://www.gov.br/anpd/pt-br/assuntos/comunicacao-de-incidentes-de-seguranca-cis

---

## 1. Detecção e registro

Qualquer indício de acesso indevido, vazamento, perda, alteração ou indisponibilidade de dado pessoal do funil, aceite, webhook ou entregável gera:

1. registro interno com data/hora UTC, `correlation_id` se houver, superfície afetada e hipótese;
2. preservação de evidência (legal hold no conjunto necessário);
3. contenção (revogar token, pausar webhook apply, rotacionar segredo, desativar API key, sem apagar trilha).

---

## 2. Avaliação

Avaliar, sem minimizar:

- categorias de dados (inventário do aviso de privacidade);
- titulares potencialmente afetados (quantidade aproximada, natureza B2B);
- probabilidade de dano e gravidade;
- se cartão completo, CVV, senha ou certificado foram envolvidos (não deveriam existir; se existirem, é defeito grave);
- se o incidente é de segurança com risco relevante aos titulares.

---

## 3. Comunicação

Se a avaliação indicar dever de comunicação sob a LGPD e o regulamento vigente da ANPD:

1. comunicar à ANPD pelo canal oficial então vigente (página de comunicação de incidentes acima);
2. comunicar aos titulares afetados, quando exigido, pelo e-mail profissional registrado, em linguagem clara;
3. registrar número/protocolo e data.

Se a avaliação concluir que a comunicação não é devida, registrar a conclusão e a evidência. Não silenciar risco relevante para “não assustar o mercado”.

---

## 4. Kill switches úteis

- ocultar CTA e página de contratação;
- impedir novos checkouts;
- manter webhook recebendo eventos já existentes;
- pausar apply sem perder receipts;
- revogar/rotacionar token e API key.

Nenhum desses passos cancela checkout ou executa refund automático.

---

## 5. Pós-incidente

Legal hold permanece até decisão documentada. Descarte só do conjunto não necessário. A primeira receita real continua disparando o residual de contratação de advogado; um incidente antecipa essa contratação se o risco residual deixar de ser aceitável.
