# Runbook — gate humano de exceções Warmbly

Este runbook preserva o caminho humano para `UNKNOWN`, conflito, drift,
reprovação ou mensagem fora da policy. Desde 2026-08-25, um first touch que
passa integralmente `CFG-FIRST-TOUCH-ROUTING-v1` usa
`DELEGATED_POLICY_APPROVE` e não entra nesta fila como trabalho humano pendente.

## Revisão de exceções

1. Autentique em `ops.confenge.com.br` pelo Authelia. `operators` revisam e
   aprovam; `admins` somente reprocessam aprovações já registradas.
2. Abra **Warmbly → Cohorts**, confira source, `as_of`, freshness e os
   denominadores do servidor.
   - Antes de gerar novas mensagens, selecione versões vencidas em **Recuperar
     versões anteriores**. A recuperação relê a fonte atual e cria texto,
     evidência e hashes novos; não carrega APPROVE ou agendamento antigos.
   - Para ampliar o backlog, use **Criar próxima cohort sem repetição**. Cada
     clique reserva até dez fornecedores e destinatários ainda não usados.
   - Não existe offset digitável. Paginação e claims pertencem ao servidor para
     que duas abas ou dois operadores não escolham a mesma empresa.
   Abra a versão escolhida em **Revisão**.
3. Antes de qualquer trabalho, leia o banner de outbound no topo. Se o kill
   switch ou a pausa estiver ativo, APPROVE ainda agenda, mas nenhuma mensagem
   sairá enquanto o bloqueio durar. Estado ausente/desconhecido não é liberado.
4. Para uma exceção que recebeu correção/evidência humana suficiente, leia
   destinatário, fato/proveniência, assunto e corpo exatos. O botão
   **Aprovar e enfileirar para envio** registra `HUMAN_APPROVE`; ele não deve ser
   aplicado em massa aos first touches que a policy já aprovou.
   Ele:
   - obtém uma validation quando necessário e só continua se voltar `VALID`;
   - envia `acknowledged=true` e um comentário opcional (ou
     `approved_by_human_reviewer`);
   - grava APPROVE e agenda a mensagem pelo mesmo caminho;
   - só é considerado concluído quando a releitura confirma APPROVE efetivo,
     `auto_send=true`, `state=QUEUED|SENT` e `due_at`.
5. Confira no card “Agendamento confirmado pelo servidor”, estado e `due_at`.
   Não há GO nem “Entregar à fila”. O worker envia em dias úteis,
   `09:00–18:00 America/Sao_Paulo`, no máximo 10/hora, quando pausa, kill switch
   e revalidação de última milha permitirem.
6. HOLD/REJECT exigem motivo. Quando aplicados antes de `SENT`, invalidam o
   agendamento e cancelam a fila; não há NO_GO operacional.

Se API, transporte ou releitura divergir, trate como não confirmado. O card
volta para Pendentes e o retry mantém a idempotency key. Não reaprove uma decisão
que o servidor já mostra como APPROVE; use o reparo administrativo.

## Reparo/backfill de APPROVEs existentes

O card **Reprocessar aprovações já registradas** é global, exige `admins` e não é
um passo normal. Ele chama `POST /v1/confenge/cohorts/reconcile-approved` pelo
conector fixo. A operação usa o mesmo agendador de APPROVE, deduplica mensagens e
é reexecutável.

Antes da execução planejada, capture no PostgreSQL Warmbly:

```sql
SELECT count(*) AS approval_records
FROM confenge_cohort_candidate_reviews
WHERE decision = 'APPROVE';

WITH latest AS (
  SELECT DISTINCT ON (cohort_version_id, candidate_id)
    cohort_version_id, candidate_id, decision
  FROM confenge_cohort_candidate_reviews
  ORDER BY cohort_version_id, candidate_id, created_at DESC, id DESC
)
SELECT count(*) FILTER (WHERE decision = 'APPROVE') AS latest_approved_bindings
FROM latest;

SELECT count(*) AS mapping_rows,
       count(DISTINCT touchpoint_id) AS unique_messages
FROM confenge_cohort_candidate_dispatches;

SELECT state, count(*)
FROM outreach_touchpoints
GROUP BY state
ORDER BY state;
```

Execute o reparo uma vez pelo Control Center administrativo durante a janela de
release. Registre todos os contadores da resposta e releia o banco:

```sql
SELECT d.cohort_version_id, d.candidate_id, d.touchpoint_id,
       d.auto_send, d.due_at, d.invalidated_at,
       t.state, t.sent_at
FROM confenge_cohort_candidate_dispatches d
JOIN outreach_touchpoints t ON t.id = d.touchpoint_id
ORDER BY d.due_at, d.cohort_version_id, d.candidate_id;
```

Execute o mesmo reparo uma segunda vez. A segunda resposta deve ter
`scheduled=0`, aumentar/confirmar `already_scheduled` e não alterar contagem de
mapping nem touchpoints únicos. Qualquer `failed>0`, APPROVE efetivo sem mapping,
mapping com `auto_send<>true`, estado diferente de `QUEUED|SENT` ou `due_at`
ausente bloqueia a conclusão do rollout.

Não use SQL para criar a fila. SQL é somente prova antes/depois.

## Auto-send e bloqueios

O campo correto é `auto_send=true` na mensagem aprovada. As flags globais
continuam obrigatoriamente desligadas:

```text
CONFENGE_AUTO_SEND_ENABLED=false
GREEN_AUTORUN=false
CONFENGE_REQUIRE_HUMAN_APPROVAL=true
CONFENGE_DELEGATED_FIRST_TOUCH_ENABLED=true  # somente após grant founder ativo e policy/hash exatos
```

`CONFENGE_REQUIRE_HUMAN_APPROVAL=true` mantém a automação global irrestrita
proibida; ele não anula a exceção estreita, versionada e auditável da policy.
Ligar auto-send/autorun global derruba o boot e não é procedimento operacional.
Não remova o kill switch durante deploy ou backfill. Não rode POST de smoke em
produção além da reconciliação planejada.

## Ordem de deploy

1. **Warmbly primeiro.** Merge/deploy até
   `000122_confenge_cohort_selection`, incluindo
   `000121_confenge_human_gate_scheduling`, com backend e worker compatíveis. Prove
   `/healthz`/`/ready`, flags globais falsas e kill switch intacto.
2. **Governance depois.** O conector viaja na imagem de `context`; sempre build e
   suba `context` junto com `web`:

   ```bash
   docker compose -p confenge-control-center \
     -f docker-compose.production-edge.yml \
     -f docker-compose.warmbly-human-gate.override.yml \
     build context web
   docker compose -p confenge-control-center \
     -f docker-compose.production-edge.yml \
     -f docker-compose.warmbly-human-gate.override.yml \
     up -d context web
   ```

3. Prove `/healthz` duas vezes; `/ready` interno duas vezes em web/context/mcp
   com `ready=true`; cockpit não autenticado 302 para Authelia; nginx em
   `:80/:443`, Caddy somente loopback; zero erro novo nos logs.
4. Só então execute e prove o backfill duas vezes.

Rollback binário segue a ordem inversa: retire Governance antes de voltar o
Warmbly. O down da migration 121 cancela trabalho `HUMAN_GATE_APPROVAL` não
enviado para que o binário antigo não transporte autoridade que não compreende;
o down da 122 também desfaz a seleção disjunta de cohorts. Use qualquer down
somente com autorização explícita e prova preservada.

## RBAC e teste

`operators` deliberadamente podem fazer e-mail sair no futuro porque APPROVE
agenda. `admins` reparam. A instalação atual mantém o fundador nos dois grupos;
não há mudança de membership necessária. Teste ambas as identidades ForwardAuth:

- `operators`: APPROVE permitido, reconciliação 403 antes do upstream;
- `operators,admins`: APPROVE e reconciliação permitidos;
- identidade sem `operators`: review recusado antes do upstream.

Nunca envie `Remote-*` ou ator a partir do navegador. A borda injeta identidade
e descarta query string de writes.

## Métricas e alertas

Observe validation por estado, reviews efetivos/invalidados, mappings de
agendamento, touchpoints por estado, `due_at`, falhas de reconciliação, pausa,
kill switch e envios por hora. GO/NO_GO pode aparecer somente como auditoria
histórica, nunca como gate atual.

Alerta imediato para: HUMAN_APPROVE ou DELEGATED_POLICY_APPROVE efetivo sem scheduling, `effective` ausente
tratado como aprovado, `auto_send` da mensagem diferente de true, drift depois
do agendamento, write `UNKNOWN`, reconciliação com falha, flags globais ligadas,
ou outbound mostrado como liberado sem leitura completa do servidor.
