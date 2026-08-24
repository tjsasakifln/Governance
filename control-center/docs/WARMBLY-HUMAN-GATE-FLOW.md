# Gate humano de outbound — mapa de autoridade

Status: contrato de implementação para `ops.confenge.com.br`
Fontes: Trello P0 `6jSvnRKV`/`gZ1MNcge`, Warmbly issues #39/#41/#43/#47,
`confenge.frozen_cohort.v1`, `bounded-cohort-policy.v1` e ADR-CC-001.

## Fluxo canônico

```text
account × trigger × offer × decision-unit × route
  -- Warmbly seleciona uma rota preferida e explica exclusões -->
cohort/version imutável
  -- leitura autenticada --> candidate + preview exato congelado
  -- escrita idempotente, disparada pela própria aprovação --> validation
  -- escrita humana, uma ação --> APPROVE | REJECT | HOLD por candidate
  -- escrita humana de maior privilégio --> GO | NO_GO da versão
  -- escrita humana de maior privilégio, separada do GO --> dispatch da cohort
  -- somente se GO e todos os gates ao vivo continuarem válidos --> queue
  -- worker do Warmbly, na janela comercial e sob o teto por hora --> send
```

| Etapa | Autoridade | Leitura no Control Center | Escrita permitida | Pode enviar? |
|---|---|---|---|---|
| Account/trigger/offer/decision-unit/route | Warmbly + feed canônico | origem, `as_of`, freshness, policy e motivos | nenhuma no frontend | não |
| Cohort/version | Warmbly | lista, denominadores e relatório de exclusões | criar/reproduzir uma versão imutável, com idempotency key | não |
| Candidate/preview | snapshot congelado Warmbly | destinatário, provenance, rota, assunto e corpo exatos | nenhuma mutação da mensagem | não |
| Validation | verificador do Warmbly | VALID/RISKY/INVALID/UNKNOWN/STALE, motivo e validade | solicitar/repetir validação — a aprovação a solicita sozinha quando não há uma vigente | não |
| Review decision | Warmbly | decisão atual, vínculo e invalidações | APPROVE/REJECT/HOLD com ator Authelia e motivo | não |
| Cohort decision | Warmbly | prontidão e todos os bloqueios | GO/NO_GO sobre uma versão exata | não |
| Queue | Warmbly | estado de autorização/preflight/queue | entregar a cohort com GO à fila, `admins` e confirmação digitada; Warmbly revalida todos os gates e limita o lote a 10 | não |
| Send | runtime Warmbly | métricas/read model | não existe ação de envio no Control Center | sim, pelo worker, com `auto_send=false` e fora deste gate |

## Invariantes de segurança

- O frontend exibe elegibilidade e motivos recebidos do contrato versionado; não
  calcula, completa ou corrige candidatos localmente.
- A aprovação é uma única ação humana e o Control Center paga o custo técnico
  dela: quando não há validation vigente, APPROVE dispara a validation, relê o
  estado no servidor e só registra a decisão se ele devolver VALID. A ordem é
  sempre validation → releitura → review; um estado que não é VALID interrompe a
  cadeia sem tentar o APPROVE. Nada disso afrouxa o gate — apenas retira do
  humano um passo que é determinístico.
- APPROVE é bloqueado na tela somente onde repetir a verificação não pode ajudar:
  ausência de destinatário, destinatário sintaticamente inválido, veredito já
  resolvido como INVALID ou RISKY, e bloqueios materiais que o próprio servidor
  declarou (`hard_bounce`, suppression, opt-out, duplicidade, copy QA,
  proveniência ausente). Toda essa classificação lê `validation.status` e
  `blocked_by` do payload; nenhuma vem de relógio ou heurística local.
- A ciência do revisor é o próprio clique em Aprovar, e continua viajando como
  `acknowledged=true`. O adaptador recusa antes do fio qualquer APPROVE sem esse
  campo, então a remoção da caixa de seleção não abriu caminho de bypass: mudou
  quem informa o campo, não se ele é exigido.
- Uma aprovação registrada localmente sai da fila de pendências na hora, e
  volta para ela em qualquer desfecho que não seja aplicação confirmada —
  recusa, falha, desconhecido, ou releitura que não confirma o efeito. Nenhuma
  decisão local sobrevive a um reload: a fila é do servidor.
- Cada APPROVE fica ligado aos hashes de recipient, content, policy e evidence e
  à expiração da validation. Qualquer drift ou expiração torna a aprovação
  inválida sem apagar a decisão humana original.
- GO referencia exatamente `cohort_id + version + cohort_hash + policy_version`.
  Cohort vazia ou candidato sem APPROVE efetivo e VALID vigente falha fechado.
- Retomar dispatch não cria approval e não ignora suppression, opt-out, bounce,
  cap, janela, kill switch, validation ou TTL. O scheduler não adota cohort
  controlada automaticamente: **não existe disparo agendado**. Uma cohort só
  entra na fila quando um humano com `admins` pede, e nunca como efeito de
  aprovar ou de registrar GO.
- `dispatch` **enfileira, não envia**. Ele entrega ao Warmbly a cohort que já
  tem GO durável; o worker do Warmbly é quem entrega, dentro da janela comercial
  e sob o governador de taxa por hora. Os números que o Control Center mostra
  depois de um disparo são de enfileiramento.
- O Control Center não pode contornar nenhum portão do disparo, porque não os
  implementa: o próprio Warmbly recusa se o GO durável não existir, se a
  autoridade bounded tiver sido revogada ou vencida, se `auto_send` ou
  `green_autorun` estiverem ligados, se o disparo estiver pausado, se o kill
  switch de arquivo estiver acionado, e limita o lote a dez independentemente do
  que a borda pedir. A borda também descarta a query string em escritas, então
  nem o tamanho do lote é influenciável daqui.
- A rota de disparo é uma só — `POST {prefix}/{cohortId}/dispatch` — exigindo
  `admins`. Não existe disparo por candidato, e `send`, `queue`, `resume` e
  `payment` continuam impossíveis de construir neste conector, com teste
  negativo enumerando cada um.
- A identidade humana nasce somente dos headers ForwardAuth entregues por hop
  confiável. O navegador não declara ator. Auditoria registra ids opacos,
  hashes, estados e reason codes; recipient, subject e body não entram em logs.
- Leituras de produção são smoke read-only. Escritas e evidências usam somente
  fixtures/sandbox. Nenhum teste ou controle deste fluxo envia e-mail.

## Fronteiras de RBAC

- `operators`: listar, detalhar, criar/reproduzir cohort pequena, solicitar
  validation e registrar APPROVE/REJECT/HOLD.
- `admins`: tudo acima e GO/NO_GO. GO exige confirmação ligada à versão e ao
  resumo exibido; um operador sem `admins` recebe 403 antes do upstream.
- Serviço Control Center → Warmbly usa credencial própria de menor escopo. O
  ator humano e seus grupos seguem em campos autenticados pelo serviço, nunca
  em headers controláveis pelo browser.

## Falhas e concorrência

- POSTs exigem `Idempotency-Key`; acknowledgement, motivo e confirmação de versão
  fazem parte da intenção; retry, duas abas e restart devolvem o mesmo
  receipt, ou 409 se a chave for reutilizada com payload diferente. Uma
  aprovação sem comentário tem motivo `approved_by_human_reviewer`, que é
  estável e portanto mantém a chave estável entre tentativas.
- Um clique repetido durante a cadeia validation → review não vira segunda
  intenção: o formulário fica reservado do primeiro clique até o fim da cadeia,
  e a espera é dita na própria fila, não no card que já saiu dela.
- Timeout depois de write é mostrado como desfecho desconhecido; a tela relê o
  recurso pelo correlation id/receipt antes de permitir repetição.
- Payload parcial é 400, ausência de sessão é 401, grupo insuficiente é 403,
  conflito/version drift é 409 e indisponibilidade upstream é 502/503. Nenhum
  desses casos promove candidato, cohort, fila ou envio.
