# Runbook — gate humano Warmbly

## Operação segura

1. Autentique em `ops.confenge.com.br` pelo Authelia. `operators` revisam;
   `admins` registram GO/NO-GO.
2. Abra **Warmbly → Cohorts**. Confirme source/as_of/freshness e os quatro
   denominadores (considerados, elegíveis, excluídos, finais). Crie no máximo 10.
3. Abra a versão em **Revisão**. Para cada candidato, revele o preview exato,
   confira recipient/route/provenance/subject/body e solicite validation.
4. VALID vigente permite APPROVE depois da ciência explícita. A UI e o Warmbly
   exigem `acknowledged=true`; RISKY/INVALID/UNKNOWN/STALE ficam bloqueados;
   registre HOLD ou REJECT com motivo. Se recipient, copy, policy, evidence ou
   suppression mudar, a aprovação aparece inválida e deve ser refeita.
5. GO exige todos aprovados, source fresh e a confirmação digitada da versão.
   O Warmbly compara o valor (por exemplo `v3`) à versão imutável; o proxy não
   consegue remover ou fabricar essa confirmação.
   Use NO_GO para interromper/revogar. GO cria a autoridade bounded exata em
   `READY_FOR_LIVE_PREFLIGHT`; não enfileira, não envia e não liga auto-send.
6. Em timeout, não repita às cegas. Recarregue a mesma versão e compare receipt
   e correlation id. O frontend preserva a idempotency key da intenção incerta;
   só depois repita a mesma intenção.

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
   `install-warmbly-operator-token.sh`; não altere a chave do collector.
4. Aplique `docker-compose.warmbly-human-gate.override.yml` e faça apenas smoke
   GET em produção.
   Valide POST exclusivamente no sandbox. Auto-send e GREEN autorun permanecem
   OFF durante e depois do rollout.
