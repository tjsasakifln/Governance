# Gate humano Warmbly — APPROVE agenda a mensagem

Status: contrato implantável de `ops.confenge.com.br`.

## Fluxo canônico

```text
cohort/version imutável
  → leitura autenticada do candidate + preview congelado
  → validation vigente e VALID no Warmbly
  → APPROVE por operators, com acknowledged=true
  → na mesma transação lógica: touchpoint + auto_send=true + QUEUED + due_at
  → worker Warmbly, quando todos os gates permitirem
  → envio em dia útil, 09:00–18:00 America/Sao_Paulo, ≤10/hora
```

APPROVE é a autoridade humana completa para uma mensagem. Não há GO, handoff,
“Entregar à fila” nem segunda tela. O clique não transporta e-mail: ele deixa a
mensagem agendada, e somente o worker pode transportá-la depois.

`NEXT_UNCLAIMED` usa claims transacionais por conta, fonte, fornecedor e
destinatário. Não existe offset controlável pelo navegador: cohorts sucessivas
ficam disjuntas mesmo com duas abas ou operadores concorrentes. Para versões
vencidas, `RECOVER_PRIOR` relê os mesmos fornecedores na fonte atual e gera
texto, evidência e hashes novos; decisões e agendamentos antigos não são
herdados.

| Etapa | Autoridade | Efeito |
|---|---|---|
| Cohort/version | Warmbly | congela seleção, denominadores, copy, hashes e policy |
| Validation | Warmbly | precisa estar vigente e `VALID`; a ação de aprovar pode obtê-la antes da escrita |
| APPROVE | `operators` | grava a revisão e converge a mensagem para `QUEUED`, `due_at`, `auto_send=true` |
| HOLD/REJECT | `operators` | exige motivo e cancela/desenfileira a mensagem ainda não enviada |
| Reconciliação | `admins` | reprocessa APPROVEs já gravados pelo mesmo agendador; é reparo global e idempotente |
| Transporte | worker Warmbly | revalida drift e gates operacionais; envia somente na janela e sob o teto |

## Auto-send: dois conceitos diferentes

- `scheduling.auto_send=true` é por mensagem aprovada. É o efeito esperado de
  APPROVE e permite que o worker a recolha na janela comercial.
- `CONFENGE_AUTO_SEND_ENABLED=true` e `GREEN_AUTORUN=true` continuam proibidos e
  derrubam o boot. As flags globais permanecem `false`.

Não existe job de dispatch de cohort. A única criação de trabalho outbound
controlado nasce de uma aprovação individual ou da reconciliação dessa mesma
aprovação preexistente.

## GO/NO-GO histórico

Os endpoints de decisão da cohort e de dispatch foram removidos do contrato
vivo. Registros antigos de GO/NO-GO continuam legíveis somente para auditoria:
não autorizam, bloqueiam, enfileiram nem desenfileiram.

O equivalente operacional de impedir uma mensagem ainda não enviada é
HOLD/REJECT no candidato. O Warmbly invalida o vínculo, cancela a fila e preserva
o histórico. Depois de `SENT`, o histórico é imutável.

## Reconciliação e backfill

`POST /v1/confenge/cohorts/reconcile-approved` percorre as decisões duráveis,
seleciona a decisão mais recente de cada `(cohort_version_id, candidate_id)` e
chama exatamente o agendador usado por APPROVE. Aprovações duplicadas da mesma
mensagem convergem em um touchpoint. A resposta distingue:

- `approval_records` — histórico bruto;
- `latest_approved_bindings` — vínculos cuja decisão mais recente é APPROVE;
- `unique_approved_candidates` — mensagens distintas após deduplicação;
- `scheduled`, `already_scheduled`, `failed` e falhas nomeadas.

Reexecutar é seguro: a chave persistida em
`confenge_cohort_candidate_dispatches` e os invariantes do touchpoint impedem
duplicação. No Control Center essa rota aparece como “Reprocessar aprovações já
registradas”, explicitamente como reparo de `admins`, nunca como próximo passo.

## Bloqueio visível antes da revisão

Toda carga de Warmbly lê `GET /v1/warmbly/operator/outbound-status`, que o
conector fixa em `GET /v1/confenge/status`. A Revisão renderiza o resultado logo
após o título, antes de preview, identidade ou botões. Kill switch, pausa ou
leitura incompleta nunca viram “liberado” por inferência.

Com kill switch acionado, a mensagem ainda fica `QUEUED` com `due_at` e
`auto_send=true`, mas a tela diz que nada sairá até o bloqueio ser removido fora
deste fluxo.

## Invariantes de segurança

- O frontend não calcula elegibilidade nem destinatários.
- APPROVE continua exigindo validation vigente e `VALID` no servidor.
- O clique continua produzindo `acknowledged=true`; o adaptador recusa antes do
  fio quando ele falta.
- HOLD/REJECT continuam exigindo motivo escrito.
- Drift de recipient, content, evidence, policy, validation ou suppression
  invalida/cancela antes do transporte.
- Janela, dias úteis, cap 10/hora, pausa e kill switch permanecem no Warmbly.
- Writes têm idempotency key e a borda descarta query string.
- O conector não possui proxy genérico. `send`, `dispatch`, `queue`, `resume`,
  `payment`, `charge`, `enroll` e `deliver` são segmentos proibidos e testados
  em todas as formas. A reconciliação é uma rota fixa, global e sem payload
  upstream.
- Ausência é ausência, nunca zero; `effective` ausente nunca é APPROVE efetivo.
- Uma marca otimista só sobrevive quando a releitura confirma APPROVE efetivo,
  `auto_send=true`, `QUEUED`/`SENT` e `due_at`.
- Timeout ou 5xx de write é `UNKNOWN`; retry reutiliza a mesma idempotency key.

## RBAC deliberado

- `operators`: listar, criar/reproduzir, validar, ajustar e registrar
  APPROVE/HOLD/REJECT. Portanto `operators` podem provocar saída futura de
  e-mail; o botão diz “Aprovar e enfileirar para envio”.
- `admins`: reparo global de aprovações já registradas. Na instalação atual a
  identidade administrativa também pertence a `operators`.
- Uma identidade sem o grupo da rota é recusada na borda antes do upstream.
- A identidade vem de ForwardAuth em hop confiável; o navegador nunca declara o
  ator e PII/copy não entra em logs.
