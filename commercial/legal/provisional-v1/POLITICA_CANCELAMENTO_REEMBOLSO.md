---
status: PROVISIONAL_AI_DRAFT
professional_legal_review: NOT_YET_PERFORMED
operational_use: HUMAN_DECISION_REQUIRED
supersedable: true
jurisdiction: Brazil
business_context: B2B_ENGINEERING_CONSULTING
document_id: CFG-LEGAL-CANCEL-DIAG-EXP-v1
package: provisional-v1
offer_code: CFG-DIAG-EXP-v1
---

# Política provisória de cancelamento e reembolso — one-off `CFG-DIAG-EXP-v1`

Rascunho operacional conservador. Não autoriza mutação financeira, estorno em provedor, checkout ou publicação. O tratamento exato permanece `[[HUMAN_DECISION_REQUIRED: politica_reembolso]]`.

Aplica-se somente ao Diagnóstico B2G one-off. Não regula planos recorrentes e não os ativa.

---

## 1. Princípios

1. One-off: um preço, um objeto, sem renovação automática.
2. Trabalho e relógio só existem depois das condições da OS (aceite, confirmação financeira, insumos).
3. Custos já incorridos e trabalho já executado entram no acerto após o início.
4. Pedido de reembolso integral depois de trabalho executado ou entregável disponibilizado **não** é o tratamento conservador.
5. Cobrança indevida ou em duplicidade comporta devolução após conciliação.
6. Nenhuma devolução real ocorre sem o gate financeiro de mutação (`real_money_mutation_approved` continua `false` neste pacote).

---

## 2. Marcos de trabalho

| Marco | Estado |
|---|---|
| A — OS/proposta ainda não aceita | sem contrato pontual |
| B — aceito, sem confirmação financeira | sem início de trabalho |
| C — confirmação financeira, sem insumos obrigatórios | trabalho pode preparar, relógio não corre |
| D — insumos recebidos, relógio iniciado (início) | trabalho em curso |
| E — entregáveis disponibilizados | execução substancial concluída |
| F — rodada consolidada encerrada / apresentação feita | encerramento operacional |

“Início” para esta política = marco D, salvo recusa do prestador em começar após o marco C.

---

## 3. Tratamento conservador proposto (ainda HUMAN_DECISION)

### 3.1 Antes do início (marcos A–C)

Se o cliente desistir antes do início, ou se o prestador recusar o serviço aceito antes de começar: valores eventualmente já recebidos tendem à **devolução integral** após conciliação, sem taxa inventada neste rascunho.

### 3.2 Após o início e antes da disponibilização (marco D)

Acerto contra:

- horas/etapas demonstravelmente executadas (kickoff, coleta, análise, redação);
- custos já incorridos e documentados (somente os necessários ao objeto).

Saldo positivo, se houver, pode ser devolvido. Não há promessa de reembolso integral automático.

### 3.3 Após disponibilização (marcos E–F)

Cancelamento por conveniência do cliente **não** gera reembolso integral. Desconformidade objetiva contra o escopo escrito segue a cláusula de aceite (correção factual), não estorno do preço.

### 3.4 Recusa ou falha imputável ao prestador após o início

Acerto proporcional do não executado, além da correção do executado quando cabível. Fórmula numérica exata: `[[HUMAN_DECISION_REQUIRED: politica_reembolso]]`.

### 3.5 Cobrança indevida, duplicidade e chargeback

- indevida/duplicidade: devolução após conciliação;
- chargeback: caso de exceção; trabalho não executado pode ser suspenso; o chargeback não apaga débito válido por si.

---

## 4. O que esta política não faz

- não autoriza estorno, reembolso ou cancelamento no provedor de pagamento;
- não publica prazo legal de arrependimento de consumo como se o cliente B2B fosse consumidor;
- não copia fórmula de saída de planos 180/365;
- não cria multa, juros ou honorários;
- não trata exceção comercial privada alheia a este one-off.

---

## 5. Registro mínimo de um pedido

1. `os_id` e hash aceito;
2. marco (A–F) na data do pedido;
3. quem pediu e por escrito;
4. valores recebidos vs. trabalho/custos documentados;
5. proposta de acerto;
6. decisão humana de finanças **antes** de qualquer mutação.

Enquanto `[[HUMAN_DECISION_REQUIRED: politica_reembolso]]` não for decidido, operadores não devem prometer percentual, prazo de depósito ou estorno automático.
