---
status: FOUNDER_DECIDED_DRAFT
professional_legal_review: NOT_YET_PERFORMED
operational_use: PRIVATE_NEGOTIATION_ONLY
supersedable: true
jurisdiction: Brazil
business_context: B2B_ENGINEERING_CONSULTING
document_id: CFG-LEGAL-CANCEL-DIAG-EXP-v1.1
package: diagnostico-v1.1
prior_package: provisional-v1
offer_code: CFG-DIAG-EXP-v1
---

# Política founder-decided de cancelamento e reembolso — one-off `CFG-DIAG-EXP-v1`

Linha de base comercial do fundador `[[FOUNDER_BASELINE: politica_reembolso]]`. Não autoriza mutação financeira, estorno em provedor, checkout ou publicação. Eficácia jurídica sujeita a advogado.

Aplica-se somente ao Diagnóstico B2G one-off. Não regula planos recorrentes e não os ativa.

---

## 1. Princípios

1. One-off: um preço, um objeto, sem renovação automática.
2. Trabalho e relógio só existem depois das condições da OS (aceite, confirmação financeira, insumos).
3. Custos já incorridos e trabalho já executado entram no acerto após o início.
4. Não há reembolso automático integral depois do início.
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

## 3. Tratamento founder-decided

### 3.1 Cobrança indevida ou duplicada

Reconciliar e devolver o valor indevido após conciliação.

### 3.2 Recusa da CONFENGE antes do início (marcos A–C)

Se CONFENGE recusar o serviço aceito antes de começar: devolução integral após conciliação.

### 3.3 Desistência do cliente antes do início

Valores eventualmente já recebidos tendem à devolução integral após conciliação, sem taxa inventada neste texto.

### 3.4 Após o início (marco D em diante)

Liquidar o trabalho demonstravelmente executado (kickoff, coleta, análise, redação e custos necessários já incorridos). Devolver eventual saldo positivo. Sem reembolso automático integral.

### 3.5 Após disponibilização (marcos E–F)

Cancelamento por conveniência do cliente **não** gera reembolso automático integral. Desconformidade objetiva contra o escopo escrito segue a cláusula de aceite (correção factual), não estorno do preço.

### 3.6 Chargeback

Caso de exceção; trabalho não executado pode ser suspenso; o chargeback não apaga débito válido por si.

---

## 4. O que esta política não faz

- não autoriza estorno, reembolso ou cancelamento no provedor de pagamento;
- não publica prazo legal de arrependimento de consumo como se o cliente B2B fosse consumidor;
- não copia fórmula de saída de planos 180/365;
- não cria multa, juros ou honorários;
- não trata exceção comercial privada alheia a este one-off;
- não declara `LEGAL_APPROVED`.

---

## 5. Registro mínimo de um pedido

1. `os_id` e hash aceito;
2. marco (A–F) na data do pedido;
3. quem pediu e por escrito;
4. valores recebidos vs. trabalho/custos documentados;
5. proposta de acerto;
6. decisão humana de finanças **antes** de qualquer mutação.
