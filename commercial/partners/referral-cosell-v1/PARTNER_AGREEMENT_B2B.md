---
status: FOUNDER_APPROVED_WITH_DEFERRED_COUNSEL_REVIEW
professional_legal_review: DEFERRED_UNTIL_FIRST_REVENUE
founder_risk_acceptance: APPROVED
operational_use: PRIVATE_NEGOTIATION_ONLY
supersedable: true
jurisdiction: Brazil
business_context: B2B_ENGINEERING_CONSULTING
package: referral-cosell-v1
document_id: CFG-PARTNER-AGREEMENT-B2B-v1
canonical_issue: https://github.com/tjsasakifln/Governance/issues/7
decision_token: FOUNDER_APPROVED_PARTNER_PROGRAM_DEFERRED_COUNSEL_2026_08_19
---

# Acordo B2B de Parceiro CONFENGE — indicação e, com aditivo, co-venda

Versão: `referral-cosell-v1`  
Token: `FOUNDER_APPROVED_PARTNER_PROGRAM_DEFERRED_COUNSEL_2026_08_19`  
Issue: Governance #7

Instrumento para **negociação privada controlada**. **Não** é `LEGAL_APPROVED`. **Não** é parecer jurídico. Identidade do parceiro permanece em placeholder fail-closed até diligência individual. Preencher os placeholders neste arquivo canônico é defeito; preencher só em via particular da oportunidade, após `APPROVED` de diligência, com revisão founder.

---

## Partes e autoridade de assinatura

**clause_id:** `partes_autoridade_assinatura`

**CONFENGE:** CONFENGE SERVICOS DE DESENHOS TECNICOS LTDA, CNPJ 52.407.089/0001-09, com sede no município de Florianópolis, Estado de Santa Catarina, neste ato representada por quem comprovadamente detiver poderes.

**PARCEIRO:** [[FAIL_CLOSED:PARTNER_LEGAL_NAME]], CNPJ [[FAIL_CLOSED:PARTNER_CNPJ]], endereço [[FAIL_CLOSED:PARTNER_REGISTERED_ADDRESS]], neste ato por [[FAIL_CLOSED:PARTNER_SIGNATORY_NAME]] na qualidade [[FAIL_CLOSED:PARTNER_SIGNATORY_CAPACITY]], registro profissional [[FAIL_CLOSED:PARTNER_PROFESSIONAL_REGISTRY]] (informar `NAO_APLICAVEL` somente após confirmação de que a atividade não é profissão regulada).

Placeholders críticos **não** podem constar em registro com estado `APPROVED`. Foro de parceiro **não** é inventado neste instrumento.

---

## Definições

**clause_id:** `definicoes`

- **Honorários líquidos efetivamente recebidos:** ver `COMMISSION_POLICY.md` e `COMMISSION_SCHEDULE.json`.
- **Lead:** oportunidade identificada pelo parceiro, com consentimento para apresentação, submetida ao registro CONFENGE.
- **Proteção:** janela de 90 dias a partir da aceitação do lead, sem propriedade permanente da conta.
- **Preexisting:** cliente, lead ou oportunidade já existente na base CONFENGE no momento da submissão.
- **Modalidade:** um de `REFERRAL_QUALIFIED`, `COSELL_SPECIALIZED`, `DISTRIBUTION_INTEGRATION`, `NOT_ELIGIBLE`.
- **Recebimento efetivo:** crédito conciliado na CONFENGE; criação de checkout, assinatura de proposta ou objeto de provedor **não** é recebimento.

---

## Modalidade

**clause_id:** `modalidade`

Este acordo cobre `REFERRAL_QUALIFIED`. `COSELL_SPECIALIZED` somente com `COSELLING_ADDENDUM.md` pinado à oportunidade. `DISTRIBUTION_INTEGRATION` exige aditivo separado, fora deste acordo. `NOT_ELIGIBLE` não contrata.

Se o parceiro for sociedade de advocacia ou exercer profissão regulada, aplica-se `PROFESSIONAL_RULE_REVIEW_REQUIRED` e o acordo padrão de comissão por indicação **não** fica automaticamente disponível.

---

## Natureza independente da relação

**clause_id:** `natureza_independente`

As partes são contratantes independentes.

**clause_id:** `ausencia_sociedade_emprego_mandato`

Não há sociedade, emprego, mandato, representação, joint-venture, autoridade de agência ou poder para obrigar a outra parte perante terceiros. Este acordo **não** constitui procuração para atuar perante órgão, autarquia, agente público ou portal de compras.

---

## Serviços e fronteiras

**clause_id:** `servicos_fronteiras`

O parceiro, na modalidade de indicação, identifica demanda, obtém consentimento para apresentação e registra o lead. A CONFENGE diagnostica, propõe, contrata com o cliente e entrega os serviços do catálogo aprovado.

A CONFENGE **não** presta advocacia, **não** substitui advogado, **não** substitui contador, **não** exerce representação jurídica, **não** promete resultado de licitação e **não** autoriza o parceiro a fazê-lo em seu nome.

Fronteiras do catálogo (Diagnóstico e Diretoria B2G) permanecem as já aprovadas; este acordo **não** reabre preços, escopo ou termos de checkout.

---

## Registro de lead, consentimento, aceitação e proteção

**clause_id:** `lead_registration`

Lead somente com registro versionado, fonte, modalidade, evidência de consentimento e dados profissionais mínimos. Dump de listas não gera crédito nem proteção.

**clause_id:** `consentimento_apresentacao`

O parceiro explica ao potencial cliente a finalidade da apresentação e obtém anuência documentável antes de compartilhar dados. Sem `consent_evidence_ref`, o lead é inadmissível.

**clause_id:** `aceitacao_rejeicao`

A CONFENGE aceita, rejeita ou pede dados adicionais em até **dois dias úteis**. Silêncio **não** é aceitação. Lead rejeitado **não** gera proteção nem comissão.

**clause_id:** `protecao_90_dias`

Proteção de **90 dias** a partir da aceitação. Não é propriedade permanente da conta. Ausência de ação material do parceiro pode encerrar a proteção. Proteção expirada sem contrato do cliente **não** atribui.

**clause_id:** `preexisting_accounts`

Clientes, leads e oportunidades preexistentes na base CONFENGE são excluídos. Não há atribuição retroativa silenciosa.

**clause_id:** `duplicidades`

Duplicidade ou conflito resolve-se por evidência temporal e contextual. Na dúvida, fail-closed: não atribui.

---

## Colaboração e co-venda

**clause_id:** `colaboracao_cosell`

Co-venda material exige aditivo por oportunidade, com escopo, autoria, responsabilidade, preço e owner da conta.

**clause_id:** `propriedade_conta_comunicacao`

A conta do cliente da CONFENGE permanece da CONFENGE. Comunicação ao cliente sobre co-venda é transparente. Vedada apropriação oculta e white-label invisível.

---

## Comissão

**clause_id:** `comissao_base_periodo_teto`

Indicação: 10% dos honorários líquidos efetivamente recebidos, seis primeiros meses, teto total de R$ 10.000 por cliente indicado (`1000000` centavos no total, nunca por mês). Co-venda: até 15%, seis meses, teto total de R$ 15.000 (`1500000` centavos no total), percentual no registro da oportunidade. Comissão **nunca** incide sobre valor de edital, obra, contrato público, economia, pleito, vitória ou honorários advocatícios sem autoridade específica.

**clause_id:** `evento_pagamento`

Somente após recebimento efetivo pela CONFENGE. Sem adiantamento. Sem mínimo garantido. Snapshot de cálculo e aprovação humana obrigatórios. Sem mutação automática de provider financeiro.

**clause_id:** `documento_fiscal`

Pagamento mediante documento fiscal válido quando aplicável.

**clause_id:** `estorno_reembolso_inadimplencia`

Cancelamento, inadimplência, chargeback, reembolso ou estorno ajustam a comissão proporcionalmente.

---

## Não exclusividade e marca

**clause_id:** `nao_exclusividade`

Não há exclusividade, salvo a proteção temporária de lead aceito.

**clause_id:** `uso_marca`

Uso de marca CONFENGE somente com aprovação escrita prévia, por peça.

---

## Confidencialidade, dados, segurança e IP

**clause_id:** `confidencialidade`

Cada parte protege informação não pública da outra e do cliente, usando-a só para executar este acordo.

**clause_id:** `lgpd_minimizacao`

Tratamento de dados pessoais segundo a LGPD, com minimização, base adequada, consentimento/anuência para apresentação, sem dados sensíveis, sem dump, sem PII em URL/analytics. Premissa conservadora: controladores independentes para o lead B2B, até DPA/aditivo específico. DPA **não** é inventado como relação universal.

**clause_id:** `seguranca`

Acesso mínimo, sem upload de documento secreto sem autorização, sem enriquecimento desnecessário, sem venda de base.

**clause_id:** `propriedade_intelectual`

Métodos, software, templates e know-how preexistentes permanecem do titular. Entregáveis CONFENGE ao cliente seguem os termos de oferta já aprovados. O parceiro não adquire IP da CONFENGE por indicar um lead.

---

## Conflitos, integridade e sanções

**clause_id:** `conflitos`

Conflito real ou aparente gera recusa ou suspensão. O parceiro comunica conexão relevante com agente público.

**clause_id:** `integridade_anticorrupcao`

Cumprimento da legislação anticorrupção e de integridade em contratações públicas. Nenhuma parte promete influência, facilitação ou acesso.

**clause_id:** `sancoes_due_diligence`

A CONFENGE pode recusar, limitar ou suspender parceiro com base em diligência versionada. Estados: `APPROVED`, `APPROVED_WITH_LIMITATIONS`, `NEEDS_INFO`, `LEGAL_REVIEW_REQUIRED`, `REJECTED`, `SUSPENDED`.

**clause_id:** `proibicao_influencia_exito_publico`

É proibido: usar cargo, órgão, repartição, portaria, acesso institucional ou relacionamento público como argumento comercial; atuar como procurador/intermediário perante repartição pública; utilizar informação não pública; abordar agente público por conta do cliente; receber remuneração associada a decisão, vitória, valor ou êxito de contrato público.

---

## Registros, suspensão e término

**clause_id:** `registros_auditoria`

Registros de lead, consentimento, decisão, proteção, cálculo e pagamento são auditáveis. A CONFENGE pode solicitar evidências razoáveis.

**clause_id:** `suspensao_preventiva`

Preocupação crível de integridade, conflito, LGPD, OAB ou fraude autoriza suspensão preventiva imediata e preservação de evidências.

**clause_id:** `terminacao`

Qualquer parte pode denunciar o acordo sem justa causa com 30 dias de aviso escrito. Rescisão por justa causa é imediata em caso de violação material de integridade, dados, marca, circunvenção ou profissional.

**clause_id:** `efeito_terminacao_leads`

Leads já aceitos e ainda dentro da proteção de 90 dias sobrevivem ao término sem justa causa do parceiro até o vencimento da proteção, se o cliente contratar nesse prazo. Após o término por justa causa do parceiro, novas comissões cessam; valores já devidos sobre receipts anteriores permanecem, sujeitos a ajuste por estorno. Proteção não se renova pelo término.

---

## Responsabilidade, notificações, foro e precedência

**clause_id:** `responsabilidade_indenizacao`

Cada parte responde por dano direto e comprovado causado por seu descumprimento. Salvo dolo, fraude, violação de confidencialidade/LGPD, propriedade intelectual, corrupção e deveres que a lei não permita limitar, a responsabilidade contratual agregada de cada parte fica limitada, na máxima extensão permitida, aos valores de comissão efetivamente pagos ou devidos sob este acordo nos seis meses anteriores ao evento. Não há indenização por lucro cessante, oportunidade ou expectativa, na máxima extensão permitida. Direitos cogentes prevalecem.

**clause_id:** `notificacoes`

Avisos operacionais: e-mail registrado. Término, mora e avisos jurídicos: registro escrito durável. Canal CONFENGE: tiago.sasaki@confenge.com.br.

**clause_id:** `foro_lei`

Aplica-se a lei brasileira. O foro eleito é o da sede registrada da CONFENGE: Foro da Comarca de Florianópolis, Estado de Santa Catarina, salvo onde regra cogente estabelecer outro foro competente. Não se inventa foro do parceiro.

**clause_id:** `ordem_precedencia`

Em conflito: (1) aditivo assinado da oportunidade; (2) este acordo na versão e hash aceitos; (3) `COMMISSION_SCHEDULE.json` da mesma versão; (4) demais documentos do pacote. Termos de oferta/cliente já aprovados prevalecem na relação CONFENGE–cliente. Este acordo não altera catálogo nem Diagnóstico.

**clause_id:** `assinatura_eletronica_versionamento`

Aceite eletrônico deve preservar CNPJ, signatário, capacidade, carimbo de tempo, hash/versão do acordo e cópia baixável. Checkout, callback ou objeto de provedor **não** provam aceite. Versão e hash pinados são imutáveis; alteração material exige nova versão. Aceite pode usar OTP, magic link ou assinatura eletrônica equivalente; não se afirma validade incontestável por certificado ICP-Brasil.

Este instrumento permanece `FOUNDER_APPROVED_WITH_DEFERRED_COUNSEL_REVIEW` até revisão profissional documentada.
