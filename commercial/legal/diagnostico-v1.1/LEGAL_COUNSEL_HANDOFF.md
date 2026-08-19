---
status: FOUNDER_DECIDED_DRAFT
professional_legal_review: NOT_YET_PERFORMED
operational_use: PRIVATE_NEGOTIATION_ONLY
supersedable: true
jurisdiction: Brazil
business_context: B2B_ENGINEERING_CONSULTING
document_id: CFG-LEGAL-COUNSEL-HANDOFF-DIAG-v1.1
package: diagnostico-v1.1
prior_package: provisional-v1
offer_code: CFG-DIAG-EXP-v1
---

# Handoff ao advogado — só o que falta decidir

Não é revisão jurídica profissional. Não pede revisão do catálogo, da capacidade nem da exceção comercial privada. Checkout continua desligado. Responda por escrito, com nome, número de inscrição e data.

Oferta: `CFG-DIAG-EXP-v1`, R$ 8.000 one-off, obrigação de meio, Brasil, B2B. Pacote `diagnostico-v1.1`, sucessor de `provisional-v1` (imutável).

Identidade da prestadora e foro ainda são `[[HUMAN_DECISION_REQUIRED: razao_social_cnpj_contratante]]` e `[[HUMAN_DECISION_REQUIRED: foro]]` — sem documento societário neste repositório.

---

## 1. Identidade e foro

Quando o fundador entregar contrato social / cartão CNPJ / documento Asaas autorizado:

1. Confirmar razão social e CNPJ que devem assinar o one-off.
2. Confirmar a sede registrada.
3. Propor foro de eleição a partir dessa sede, ou recusar eleição e indicar o foro legal.
4. Dizer se a eleição é oponível em relação B2B e o que prevalece se houver regra de competência absoluta.

Não publicar comarca enquanto o documento de entidade não existir.

---

## 2. Eficácia do teto e carve-outs

Linha de base comercial `[[FOUNDER_BASELINE: limite_responsabilidade]]`: teto do one-off limitado ao valor efetivamente pago na OS afetada; fora do teto, na medida permitida, exceções não limitáveis, dolo/fraude, confidencialidade/LGPD, PI e integridade.

Perguntas:

1. Esse teto é oponível neste B2B, ou deve ser reformulado?
2. Os carve-outs estão completos, excessivos ou insuficientes?
3. Há risco de abusividade se a relação for reclassificada como consumo?

Não tratar a linha de base como aprovação jurídica.

---

## 3. Reembolso e cancelamento

Linha de base `[[FOUNDER_BASELINE: politica_reembolso]]`:

- cobrança indevida/duplicada → reconciliar e devolver;
- recusa da CONFENGE antes do início → devolução integral;
- após o início → liquidar trabalho demonstravelmente executado e devolver saldo positivo;
- sem reembolso automático integral.

Confirmar, ajustar ou recusar essa política. Não autorizar estorno em provedor.

---

## 4. Aceite eletrônico

Linha de base `[[FOUNDER_BASELINE: aceite_eletronico]]`: OS/proposta + `terms_version` + `scope_version` + hashes + representante/CNPJ + timestamp + cópia durável. Checkout/callback sozinho não prova aceite.

1. Essa tupla é suficiente para formação do contrato pontual?
2. Falta IP/dispositivo, assinatura eletrônica específica ou outro requisito?
3. Há risco em negociar em conversa privada com estes termos visíveis antes da OS assinada?

---

## 5. LGPD e retenção

Inventário comercial `[[FOUNDER_BASELINE: dados_pessoais_tratados]]`: nome e contato corporativo, função, empresa/CNPJ, dados contratuais/fiscais, brief/arquivos, comunicações e metadados de aceite; sem dado sensível por padrão.

Retenção final: `[[HUMAN_DECISION_REQUIRED: retencao]]`.

1. O inventário é adequado ao one-off e ao funil de lead B2B?
2. Quais prazos de retenção do lead e do dossiê devem constar do aviso?
3. Concorda que este one-off é controlador independente, sem DPA lite e sem lista inventada de subprocessadores, até existir inventário operacional real?

---

## 6. Mora e solução de controvérsia (somente se aplicável)

Este pacote **não institui** percentual de multa, juros ou honorários e **não institui** arbitragem. A linha de base comercial geral `CFG-TERMS-B2B-2026-08-17-v1` registra 2% + 1% simples/mês + IPCA para o portfólio; **este one-off não a reaprova**.

1. Este Diagnóstico deve permanecer silente em mora, adotar a linha de base do portfólio, ou usar outra fórmula?
2. Tentativa direta registrada + foro (quando houver sede) é suficiente, sem arbitragem?

---

## O que não enviar de volta

Não classificar enquadramento fiscal nem emissão de nota. Isso é do contador. Não ligar checkout. Não declarar `LEGAL_APPROVED` neste repositório — devolver a resposta profissional fora da árvore pública ou em instrumento próprio depois desta campanha.
