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
  -- escrita idempotente --> validation vinculada à evidência
  -- escrita humana --> APPROVE | REJECT | HOLD por candidate
  -- escrita humana de maior privilégio --> GO | NO_GO da versão
  -- somente se GO e todos os gates ao vivo continuarem válidos --> queue
  -- fora do Control Center e desabilitado por padrão --> send
```

| Etapa | Autoridade | Leitura no Control Center | Escrita permitida | Pode enviar? |
|---|---|---|---|---|
| Account/trigger/offer/decision-unit/route | Warmbly + feed canônico | origem, `as_of`, freshness, policy e motivos | nenhuma no frontend | não |
| Cohort/version | Warmbly | lista, denominadores e relatório de exclusões | criar/reproduzir uma versão imutável, com idempotency key | não |
| Candidate/preview | snapshot congelado Warmbly | destinatário, provenance, rota, assunto e corpo exatos | nenhuma mutação da mensagem | não |
| Validation | verificador do Warmbly | VALID/RISKY/INVALID/UNKNOWN/STALE, motivo e validade | solicitar/repetir validação | não |
| Review decision | Warmbly | decisão atual, vínculo e invalidações | APPROVE/REJECT/HOLD com ator Authelia e motivo | não |
| Cohort decision | Warmbly | prontidão e todos os bloqueios | GO/NO_GO sobre uma versão exata | não |
| Queue | Warmbly | estado de autorização/preflight/queue | GO materializa somente a autorização exata; Warmbly ainda revalida todos os gates antes da queue | não |
| Send | runtime Warmbly | métricas/read model | não existe ação de envio no Control Center | sim, mas `auto_send=false` e fora deste gate |

## Invariantes de segurança

- O frontend exibe elegibilidade e motivos recebidos do contrato versionado; não
  calcula, completa ou corrige candidatos localmente.
- Cada APPROVE fica ligado aos hashes de recipient, content, policy e evidence e
  à expiração da validation. Qualquer drift ou expiração torna a aprovação
  inválida sem apagar a decisão humana original.
- GO referencia exatamente `cohort_id + version + cohort_hash + policy_version`.
  Cohort vazia ou candidato sem APPROVE efetivo e VALID vigente falha fechado.
- Retomar dispatch não cria approval e não ignora suppression, opt-out, bounce,
  cap, janela, kill switch, validation ou TTL. O scheduler não adota cohort
  controlada automaticamente.
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

- POSTs exigem `Idempotency-Key`; acknowledgement e confirmação de versão fazem
  parte da intenção; retry, duas abas e restart devolvem o mesmo
  receipt, ou 409 se a chave for reutilizada com payload diferente.
- Timeout depois de write é mostrado como desfecho desconhecido; a tela relê o
  recurso pelo correlation id/receipt antes de permitir repetição.
- Payload parcial é 400, ausência de sessão é 401, grupo insuficiente é 403,
  conflito/version drift é 409 e indisponibilidade upstream é 502/503. Nenhum
  desses casos promove candidato, cohort, fila ou envio.
