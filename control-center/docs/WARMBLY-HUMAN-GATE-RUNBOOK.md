# Runbook — gate humano Warmbly

## Operação segura

1. Autentique em `ops.confenge.com.br` pelo Authelia. `operators` revisam;
   `admins` registram GO/NO-GO.
2. Abra **Warmbly → Cohorts**. Confirme source/as_of/freshness e os quatro
   denominadores (considerados, elegíveis, excluídos, finais). Crie no máximo 10.
3. Abra a versão em **Revisão**. A tela abre no recorte **Pendentes** e diz
   quanto falta (`N pendentes · N aprovadas · N em ajuste · N no total`). Leia o
   destinatário, o fato observado e a proveniência, e leia o assunto e o corpo
   exatos — eles ficam abertos por padrão.
4. Se nada estiver bloqueado, **Aprovar é uma ação só**. Não digite motivo e não
   marque caixa nenhuma: o clique é a ciência, e a trilha grava ator do Authelia,
   instante, versão, hash congelado, destinatário e decisão. Sem comentário
   escrito, o motivo registrado é `approved_by_human_reviewer`; o campo de
   comentário continua disponível e vence o padrão quando preenchido.
   - **Verificação do destinatário**: quando não há validação vigente, aprovar
     pede a verificação ao Warmbly, relê o estado e só então registra o APPROVE.
     Não acione "Verificar o destinatário agora" antes de aprovar — esse controle
     existe como escape, e só aparece onde a validação não é VALID.
   - Se a verificação não voltar VALID, **nada é decidido**: a tela diz o estado
     observado e que o APPROVE não foi enviado.
   - A mensagem aprovada sai da fila na hora e a próxima assume a posição, com o
     foco no botão dela. `A` (com o foco no card) e `Ctrl/Cmd+Enter` aprovam pelo
     teclado; dentro de qualquer campo de texto o atalho não dispara.
   - Se a API recusar, falhar, responder desfecho desconhecido ou a releitura não
     confirmar o efeito, a mensagem **volta para Pendentes** com o motivo no card.
     Repetir usa a mesma idempotency key.
5. **APPROVE continua bloqueado** onde verificar de novo não resolve: sem
   destinatário, destinatário que não é endereço, validação já resolvida como
   RISKY ou INVALID, hard bounce, suppression, opt-out, duplicidade, reprovação
   de copy QA ou proveniência ausente marcada pelo servidor. Nesses casos a tela
   nomeia o bloqueio e o próximo movimento; registre HOLD ou REJECT **com motivo
   escrito**, que continua obrigatório. Se recipient, copy, policy, evidence ou
   suppression mudar depois, a aprovação aparece inválida (`effective=false`),
   volta para Pendentes e deve ser refeita.
6. GO exige todos aprovados, source fresh e a confirmação digitada da versão.
   O Warmbly compara o valor (por exemplo `v3`) à versão imutável; o proxy não
   consegue remover ou fabricar essa confirmação.
   Use NO_GO para interromper/revogar. GO cria a autoridade bounded exata em
   `READY_FOR_LIVE_PREFLIGHT`; não enfileira, não envia e não liga auto-send.
7. Em timeout, não repita às cegas. Recarregue a mesma versão e compare receipt
   e correlation id. O frontend preserva a idempotency key da intenção incerta;
   só depois repita a mesma intenção.

### O que mudou no gate humano (e o que não mudou)

A fila deixou de ser um formulário e virou uma fila de decisões. O que saiu foi
custo humano; nenhuma salvaguarda material foi removida.

| Antes | Agora | Por quê |
|---|---|---|
| Clicar em "verificar destinatário agora" antes de aprovar | Aprovar obtém a verificação sozinho | Obter validation é chamada determinística, sem julgamento humano |
| Digitar um motivo para APPROVE | `approved_by_human_reviewer` automático, comentário opcional | O motivo digitado era sempre a mesma palavra; a trilha já tinha ator, instante, versão e hash |
| Marcar "revisei destinatário" | O clique em Aprovar é a ciência | Um segundo clique declarando o primeiro não acrescenta nada à auditoria |
| Lista com aprovadas no topo | Recorte **Pendentes** por padrão, com contador | Rolar a própria produção para achar o próximo trabalho não escala |

O que **não** mudou: `acknowledged=true` continua viajando no corpo do APPROVE e
o adaptador recusa antes do fio um APPROVE sem ele; o Warmbly continua recusando
APPROVE fora de uma validação VALID vigente; GO continua exigindo `admins` e a
confirmação digitada da versão; HOLD/REJECT continuam exigindo motivo escrito; e
o Control Center continua sem qualquer rota de send, dispatch ou queue.

## Métricas e alertas

Use os denominadores do próprio snapshot, nunca contagem de linhas da tela:
`accounts_considered`, `accounts_eligible`, `accounts_excluded`,
`recipients_final`, exclusões por reason, validations por estado, reviews
efetivos/invalidados e decisões GO/NO_GO. A trilha estruturada
`warmbly.human_gate.before/after` mede tentativas, recusas, 401/403, 409,
timeouts e latência por upstream status sem recipient, subject ou body.

Alertar e manter NO_GO quando: freshness STALE, validação UNKNOWN por timeout,
qualquer late suppression/opt-out, conflito repetido, 5xx, divergência de
denominadores, ou qualquer indício de auto-send/green autorun habilitado.

## Smoke e rollback

- Produção: somente GET de lista/detalhe com conta autorizada; não execute POST.
- Escritas: sandbox/fixtures, mailbox `.invalid`/Mailpit e kill switch ativo.
- Nunca use o endpoint de dispatch para validar esta entrega e nunca envie mail.
- Rollback app: reverta primeiro Governance, depois Warmbly; versões persistidas
  continuam inertes e legíveis.
- Rollback schema: somente após rollback dos dois apps, execute a migration
  `000116...down.sql`. Ela remove apenas dados do gate novo; não toca grants,
  touchpoints, suppression ou outcome existentes. Exporte receipts antes se a
  trilha precisar ser retida.

## Ordem de PR/deploy

1. Warmbly `feat/confenge-human-gate-api`: migration 000116, contrato e APIs.
   É aditivo e compatível com clientes/CLI existentes; deploya sem exposição no
   Control Center.
2. Governance `feat/cc-warmbly-human-gate`: proxy autenticado, RBAC, rotas e UI.
   Depende do contrato Warmbly já implantado; até lá o canal falha fechado.
   Preserve o hash existente e acrescente `admins` ao operador autorizado em
   `users.yml`, com backup e validação; jamais rode `generate-local.sh` para isso.
   `operators` sozinho continua podendo revisar, mas recebe 403 em GO/NO-GO.
3. Crie pelo endpoint auditado `/v1/api-keys` uma credencial separada com máscara
   decimal exata `196` (`read_contacts|write_contacts|write_campaigns`), prazo de
   rotação e sem `send_campaigns`. Instale-a atomicamente com
   `install-warmbly-operator-token.sh SOURCE CC_SECRET_DIR 1000:1000`; o owner
   numérico corresponde ao usuário `node` do Context e mantém o bind mount
   legível com modo `0600`. Não altere a chave do collector.
4. Aplique `docker-compose.warmbly-human-gate.override.yml` e faça apenas smoke
   GET em produção.
   Valide POST exclusivamente no sandbox. Auto-send e GREEN autorun permanecem
   OFF durante e depois do rollout.
