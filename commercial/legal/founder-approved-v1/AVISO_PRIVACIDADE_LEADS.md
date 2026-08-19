---
status: FOUNDER_APPROVED_LIMITED_PRODUCTION
professional_legal_review: DEFERRED_UNTIL_FIRST_REVENUE
founder_risk_acceptance: APPROVED
operational_use: LIMITED_PUBLIC_DIAGNOSIS_ONLY
supersedable: true
jurisdiction: Brazil
business_context: B2B_ENGINEERING_CONSULTING
document_id: CFG-LEGAL-PRIVACY-LEADS-FOUNDER-v1
package: founder-approved-v1
offer_code: CFG-DIAG-EXP-v1
decision_token: FOUNDER_APPROVED_WITH_DEFERRED_COUNSEL_REVIEW_2026_08_18
---

# Aviso de privacidade — leads e contratação B2B do Diagnóstico

Aviso mínimo para coleta de interesse e contratação do Diagnóstico B2G. Não é política geral de sítio. Não cria relação de operador. Não cria cargo formal de privacidade além do canal abaixo.

Controlador: CONFENGE SERVICOS DE DESENHOS TECNICOS LTDA, CNPJ 52.407.089/0001-09, Avenida Prefeito Osmar Cunha, 416, Sala 1108, Centro, Florianópolis/SC, CEP 88015-100. Marca pública: CONFENGE.

Canal de privacidade: `tiago.sasaki@confenge.com.br`. WhatsApp comercial: `+55 48 98834-4559`.

---

## 1. Inventário mínimo permitido

### Lead / pré-contrato

- nome profissional;
- e-mail corporativo;
- telefone profissional voluntário;
- cargo;
- empresa;
- CNPJ;
- recorte de interesse;
- origem/asset/CTA sem conteúdo sensível.

### Aceite / contrato

- nome do representante;
- cargo;
- e-mail;
- declaração de poderes;
- razão social e CNPJ;
- `offer_version`, `scope_version`, `terms_version`;
- hashes;
- timestamp;
- IP e user-agent em armazenamento protegido;
- `correlation_id`;
- evidência de OTP ou magic link.

### Pagamento

- Asaas `customer_id`, `checkout_id`, `payment_id`;
- `externalReference`;
- status, valor, método, timestamps, `event_id`;
- `netValue` quando necessário para conciliação.

### Técnico

- insumos fornecidos pelo cliente;
- recorte;
- entregáveis;
- histórico de correções.

### Não armazenar

número completo de cartão; CVV; senha; certificado digital; dado de saúde; dado de menor; documento pessoal sem necessidade; informação sigilosa de terceiro fora do objeto.

---

## 2. Finalidade e base legal

Não se usa um checkbox genérico de “consentimento LGPD” como curinga. Bases distintas:

| Finalidade | Base (LGPD) |
|---|---|
| Responder a pedido de conversa ou proposta iniciado pelo titular | procedimentos preliminares solicitados pelo titular (art. 7º, V) |
| Avaliar elegibilidade B2B e conflitos evidentes | procedimentos preliminares / execução de contrato futuro (art. 7º, V) |
| Formar o contrato, gravar aceite e executar o Diagnóstico | execução contratual (art. 7º, V) |
| Conciliação, NFS-e, guarda de comprovantes | obrigação legal/regulatória (art. 7º, II) quando houver dever de guarda; execução contratual para a prestação |
| Segurança, prevenção a fraude de checkout e integridade do aceite | legítimo interesse B2B (art. 7º, IX), quando cabível, com minimização |
| Consentimento separado | somente se uma finalidade futura realmente exigir e for coletado de forma específica; não usado neste funil |

Papel: controlador independente do próprio funil comercial e da execução contratual. Não há tratamento de dado pessoal em nome e por instrução do cliente. Por isso **não se aplica DPA lite** e **não se listam subprocessadores**.

Texto oficial da LGPD consultado em 2026-08-18: https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm

---

## 3. Retenção

Agenda explícita em `RETENTION_SCHEDULE.json`. Resumo:

- lead não convertido: 24 meses após a última interação comercial significativa;
- elegibilidade rejeitada ou abandonada: 12 meses;
- aceite não convertido em pagamento: 24 meses;
- contrato, aceite, hashes, comprovantes, conciliação, NFS-e e evidência financeira: 10 anos após encerramento;
- payload bruto de webhook: 5 anos, acesso restrito, redaction em observabilidade;
- logs de segurança/IP/user-agent: 12 meses;
- insumos técnicos brutos do cliente: 180 dias após aceite final, salvo obrigação contratual, legal hold ou solicitação documentada;
- entregáveis finais e trilha de correção: 5 anos;
- incidentes: conforme playbook e legal hold.

Legal hold suspende descarte somente para o conjunto necessário.

---

## 4. Direitos do titular

O titular pode solicitar acesso, correção, eliminação quando cabível, informação sobre compartilhamento e oposição ao legítimo interesse, pelo canal de privacidade. Direitos cogentes da LGPD prevalecem. Não se inventa prazo legal específico além do que a lei e a ANPD exigirem no caso concreto.

---

## 5. Compartilhamento

Asaas recebe os dados mínimos necessários ao checkout hospedado. A CONFENGE não recebe dados completos de cartão. Sem transferência internacional afirmada neste aviso. Sem anúncio de ferramenta de marketing. Pessoas internas só acessam o necessário.

---

## 6. Incidentes

Indício de vazamento segue `INCIDENT_RESPONSE_MINIMUM.md`: registro, contenção, avaliação de risco aos titulares e comunicação à ANPD / titulares quando a regulamentação vigente exigir. Portal ANPD: https://www.gov.br/anpd/ — comunicação de incidente: https://www.gov.br/anpd/pt-br/assuntos/comunicacao-de-incidentes-de-seguranca-cis
