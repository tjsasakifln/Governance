# Gate humano de outbound — mapa de autoridade

Status: contrato de implementação para `ops.confenge.com.br`
Fontes: `confenge.human-gate.v1`, `confenge.frozen_cohort.v1`,
`bounded-cohort-policy.v1` e ADR-CC-001.

## Fluxo canônico

```text
fonte canônica de contratos públicos
  -- somente fornecedor/contratada; órgão contratante é excluído -->
fornecedor_cnpj_raiz × destinatário único
  -- claims transacionais, sem repetição entre cohorts -->
cohort/version imutável (máximo 10)
  -- leitura autenticada --> candidate + preview exato congelado
  -- escrita idempotente, disparada pela própria aprovação --> validation
  -- escrita humana, uma ação --> APPROVE | REJECT | HOLD por candidate
  -- APPROVE efetivo cria/confirma o touchpoint --> queue
  -- worker do Warmbly, quando a pausa permitir, na janela e sob o teto --> send
```

| Etapa | Autoridade | Leitura no Control Center | Escrita permitida | Pode enviar? |
|---|---|---|---|---|
| Fonte/seleção | Warmbly + feed canônico | origem, `as_of`, freshness, progresso e exclusões | nenhuma seleção no frontend | não |
| Cohort/version | Warmbly | lista, denominadores e relatório de exclusões | criar a próxima cohort sem repetição ou recuperar fornecedores de versões vencidas | não |
| Candidate/preview | snapshot congelado Warmbly | fornecedor, destinatário, provenance, rota, assunto e corpo exatos | ajustar texto dentro do contrato tipado | não |
| Validation | verificador do Warmbly | VALID/RISKY/INVALID/UNKNOWN/STALE, motivo e validade | solicitar/repetir; APPROVE a solicita sozinho quando necessário | não |
| Review decision | Warmbly | decisão atual, vínculo, invalidações e agendamento | APPROVE/REJECT/HOLD com ator Authelia e motivo | APPROVE agenda; não entrega imediatamente |
| Reconciliação | Warmbly | denominadores e falhas do relatório | `admins` conciliam APPROVEs duráveis anteriores ao agendamento | não |
| Queue/send | runtime Warmbly | estado do touchpoint e métricas | não existe ação de send no gate | sim, somente pelo worker, com pausa liberada, janela e teto válidos |

## Invariantes de segurança

- Leads são empresas fornecedoras/contratadas. A identidade canônica usa
  `fornecedor_cnpj`/`ni_fornecedor`, reduzida ao CNPJ-raiz; `orgao_cnpj` e demais
  entidades contratantes nunca são leads.
- O frontend exibe elegibilidade e motivos recebidos do contrato versionado; não
  calcula, completa ou corrige candidatos localmente.
- `NEXT_UNCLAIMED` usa claims transacionais por conta, fonte, fornecedor e
  destinatário. Dez requisições de dez formam até 100 leads disjuntos, sem
  offset controlável pelo navegador. Replay da mesma idempotency key devolve a
  mesma cohort.
- `RECOVER_PRIOR` relê os mesmos fornecedores na fonte atual e gera texto,
  evidência e hashes novos. Aprovação e agendamento antigos não são herdados.
- Quando não há validation vigente, APPROVE dispara validation, relê o estado e
  só registra a decisão se o Warmbly devolver VALID. Um estado não VALID encerra
  a cadeia sem tentar o APPROVE.
- APPROVE é bloqueado onde verificar de novo não ajuda: destinatário ausente ou
  inválido, INVALID/RISKY resolvido, hard bounce, suppression, opt-out,
  duplicidade, copy QA reprovada ou proveniência ausente declarada pelo servidor.
- A ciência do revisor é o clique em Aprovar e viaja como `acknowledged=true`.
  O adaptador recusa antes do fio qualquer APPROVE sem esse campo.
- Cada APPROVE fica ligado aos hashes de recipient, content, policy e evidence e
  à validation vigente. Drift, expiração, HOLD ou REJECT invalidam o agendamento
  correspondente sem apagar a decisão humana original.
- Um APPROVE efetivo cria ou confirma, na mesma operação, um touchpoint com
  `auto_send=true` para a próxima janela elegível. Esse valor é por mensagem e
  não habilita o auto-send global nem o green autorun.
- Não existe GO nem entrega manual da cohort no contrato vigente. As rotas
  legadas podem permanecer pinadas durante rollout, mas a interface atual não
  apresenta seus controles.
- A reconciliação chama somente `POST {prefix}/reconcile-approved`, sem cohort,
  destinatário ou conteúdo escolhidos pelo navegador. Ela é `admins`,
  idempotente, atende primeiro aprovações duráveis antigas e não envia nem
  retoma o disparo.
- Pausa, kill switch, dias úteis, janela comercial, teto por hora, suppression,
  opt-out e bounce continuam sendo reavaliados pelo Warmbly. Agendado não
  significa enviado.
- A identidade humana nasce somente dos headers ForwardAuth entregues por hop
  confiável. O navegador não declara ator. Auditoria registra ids opacos,
  hashes, estados e reason codes; recipient, subject e body não entram em logs.
- O Control Center não expõe `send`, `queue`, `resume`, `payment` nem proxy
  genérico no human gate. O controle operacional de pausa/retomada continua uma
  superfície separada e mais restrita.

## Fronteiras de RBAC

- `operators`: listar, detalhar, criar/reproduzir cohort pequena, solicitar
  validation, ajustar texto e registrar APPROVE/REJECT/HOLD.
- `admins`: tudo acima e reconciliar aprovações duráveis antigas com a fila.
- Serviço Control Center → Warmbly usa credencial própria de menor escopo, sem
  permissão de send. O ator humano e seus grupos vêm da borda autenticada, nunca
  de headers controláveis pelo browser.

## Falhas e concorrência

- POSTs exigem `Idempotency-Key`; acknowledgement e motivo fazem parte da
  intenção. Retry, duas abas e restart devolvem o mesmo receipt, ou 409 se a
  chave for reutilizada com payload diferente.
- Um clique repetido durante validation → review não vira segunda intenção: o
  formulário fica reservado até o fim da cadeia.
- Timeout depois de write é desfecho desconhecido. A tela relê o recurso antes
  de permitir repetição e preserva a idempotency key da intenção incerta.
- A reconciliação relata registros APPROVE, bindings vigentes, candidatos
  únicos, agendados agora, já agendados e falhas. Qualquer falha interrompe a
  ampliação do backlog até classificação do motivo.
- Payload parcial é 400, ausência de sessão é 401, grupo insuficiente é 403,
  conflito/version drift é 409 e indisponibilidade upstream é 502/503. Nenhum
  desses casos promove candidato, fila ou envio.
