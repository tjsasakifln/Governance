# Runbook — gate humano Warmbly

## Operação segura

1. Autentique em `ops.confenge.com.br` pelo Authelia. `operators` revisam e
   aprovam mensagens; `admins` podem reconciliar aprovações antigas em lote.
2. Abra **Warmbly → Cohorts**. Confirme source/as_of/freshness e os quatro
   denominadores (considerados, elegíveis, excluídos, finais). Crie no máximo 10.
   - Leads são empresas contratadas/fornecedoras. A identidade canônica vem de
     `fornecedor_cnpj`/`ni_fornecedor`, reduzida a um CNPJ-raiz. Nunca trate
     `orgao_cnpj` ou outra entidade contratante como lead.
   - Antes de gerar novas mensagens, selecione as versões vencidas em
     **Recuperar versões anteriores**. A recuperação relê a fonte atual,
     deduplica fornecedores e cria texto e hashes novos; não carrega APPROVE ou
     agendamento antigos.
   - Para ampliar o backlog, use **Criar próxima cohort sem repetição**. Cada
     clique reserva até dez CNPJs-raiz e destinatários ainda não usados. Confira
     `fornecedores únicos reservados` e pare no total adicional pretendido.
   - Não existe offset digitável. Paginação e claims pertencem ao servidor para
     que duas abas ou dois operadores não escolham a mesma empresa.
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
6. Um `APPROVE` efetivo registra a decisão e agenda a mensagem exata para a
   próxima janela comercial elegível na mesma operação. Não existe GO nem
   entrega manual da cohort no contrato vigente. Agendar não é enviar: o worker
   continua sob pausa, kill switch, janela útil (`09:00–18:00
   America/Sao_Paulo`) e teto de 10/hora.
7. **Antes de ampliar o backlog**, um `admin` executa **Reconciliar aprovações
   antigas com a fila**. A operação é naturalmente idempotente e mostra:
   registros APPROVE, bindings vigentes, candidatos únicos, agendados agora, já
   agendados e falhas. Ela existe para que aprovações anteriores à implantação
   do agendamento sejam atendidas primeiro. Ela não envia e não retoma o
   disparo. Se houver falhas, não crie as 100 novas mensagens até classificar
   cada motivo.
8. Em timeout, não repita às cegas. Recarregue a mesma versão e compare receipt
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
| Criar repetia os primeiros fornecedores | Próxima cohort usa claims transacionais por fornecedor e destinatário | Dez cohorts formam um backlog disjunto sem relaxar o limite de dez por autorização |
| Versões vencidas eram apenas históricas | Recuperação relê os mesmos fornecedores na fonte atual | Fatos, texto e hashes vencidos não podem ser reaproveitados como se fossem atuais |
| APPROVE antigo podia ficar sem fila | APPROVE agenda a mensagem; reconciliação cobre o histórico | A decisão humana e o efeito operacional ficam convergentes e idempotentes |

O que **não** mudou: `acknowledged=true` continua viajando no corpo do APPROVE e
o adaptador recusa antes do fio um APPROVE sem ele; o Warmbly continua recusando
APPROVE fora de uma validação VALID vigente; HOLD/REJECT continuam exigindo
motivo escrito; e o Control Center continua sem qualquer rota de **send**. A
reconciliação chama somente `POST {prefix}/reconcile-approved`, sem destinatário
ou conteúdo controlável pelo navegador.

**Auto-send global continua proibido por construção.**
`CONFENGE_AUTO_SEND_ENABLED=true` derruba o boot do Warmbly (invariante testada,
não é flag para ligar). O `auto_send=true` do agendamento é por mensagem e nasce
somente de um APPROVE humano efetivo; não habilita autorun global.

## Métricas e alertas

Use os denominadores do próprio snapshot, nunca contagem de linhas da tela:
`accounts_considered`, `accounts_eligible`, `accounts_excluded`,
`recipients_final`, exclusões por reason, validations por estado, reviews
efetivos/invalidados e agendamentos efetivos/invalidados. A trilha estruturada
`warmbly.human_gate.before/after` mede tentativas, recusas, 401/403, 409,
timeouts e latência por upstream status sem recipient, subject ou body.

Alertar e manter o disparo pausado quando: freshness STALE, validação UNKNOWN por timeout,
qualquer late suppression/opt-out, conflito repetido, 5xx, divergência de
denominadores, ou qualquer indício de auto-send/green autorun habilitado.

## Smoke e rollback

- Smoke de produção: somente GET de lista/detalhe com conta autorizada. POST é
  reservado à operação comercial explicitamente autorizada neste runbook.
- Escritas: sandbox/fixtures, mailbox `.invalid`/Mailpit e kill switch ativo.
- Nunca use reconciliação ou APPROVE para validar uma entrega e nunca envie mail
  como parte de um smoke: são decisões comerciais, não passos de verificação.
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
   `operators` continua podendo revisar; a reconciliação em lote exige `admins`.
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
