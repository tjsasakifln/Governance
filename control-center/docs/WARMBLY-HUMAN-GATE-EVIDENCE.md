# Matriz requisito → teste → evidência

| Requisito | Teste/evidência |
|---|---|
| Contrato versionado; frontend não rederiva | `human_gate.go`, `human-gate-api.md`; UI renderiza `manifest.preview` e `blocked_by` |
| Idempotência, duplicata, retry/two tabs/crash/restart | uniques de migration 000116 + request hash + advisory lock por intenção; `human-gate-idempotency.test.ts` preserva key e `TestHumanGatePostgres*` prova serialização/receipt após restart |
| Preview exacto | `GetConfengeHumanGateCandidate`; web shell revela subject/body/hashes congelados |
| VALID/RISKY/INVALID/UNKNOWN/STALE | `TestNormalizeHumanGateValidationStatus`; UI `data-validation-status` |
| Invalidation recipient/message/policy/evidence/expiry | `TestHumanGateApprovalInvalidatesEveryBoundDimension` |
| suppression tardia/opt-out/bounce/removal | `GetHumanGateCohort` relê candidato canônico e invalida fail-closed |
| APPROVE/REJECT/HOLD e agendamento | `TestHumanGateValidApprovalRemainsEffectiveAndHoldNeverDoes`; testes de approval-time scheduling; adapter e proxy preservam `acknowledged` e expõem `scheduling` |
| Seleção disjunta de fornecedores | teste PostgreSQL concorrente 10×10 prova 100 CNPJs-raiz e destinatários únicos; replay idempotente devolve a mesma cohort |
| Recuperação de versão stale | testes de `RECOVER_PRIOR` provam releitura da fonte atual e ausência de approval/agendamento herdado |
| MX ausente/risky/invalid/unknown | verificador existente + normalização/teste; somente VALID permite APPROVE |
| Authelia, 401/403 e least privilege | `human-gate.test.ts`: identidade ausente não chega ao upstream; reconciliação exige admins; GO/dispatch não existem no allowlist atual |
| timeout/payload parcial/conflito/write denied | proxy retorna UNKNOWN sem retry e envelope completo; handler 400; request-hash 409; RBAC 403 |
| sem PII nos logs | proxy loga somente actor/id/path/status/receipt; Warmbly audit usa ids/hashes/status |
| pausa e last-mile gates | worker Warmbly revalida pause/kill switch/janela/teto/suppression; UI não oferece GO/queue/dispatch/send no contrato atual |
| auto-send global OFF / nenhum e-mail real | boot fail-closed fixa global false; `auto_send=true` é somente por touchpoint aprovado; testes usam `.invalid` |

Evidência executada em 2026-08-24 para esta revisão:

- Web-shell: 415/415 — PASS, incluindo contrato de scheduling, ocultação de
  GO/dispatch, reconciliação e cohorts sem repetição.
- Connector Warmbly: 161/161 + 1 canário ignorado — PASS, incluindo
  reconciliação `admins`, fixed allowlist sem GO/dispatch e exclusão de ator
  controlável pelo navegador.
- TypeScript typecheck: connector e web-shell — PASS.
- Warmbly PostgreSQL 16: migration até 122 e integração 10×10 — PASS, com 100
  fornecedores CNPJ-raiz e 100 destinatários distintos, além de replay
  idempotente.
- Nenhum POST de envio foi executado; dispatch permaneceu pausado.

Evidência histórica executada em 2026-08-23:

- TypeScript typecheck: connector, Context Service e web-shell — PASS.
- Contract cross-repo: 1/1 — PASS; cópia Governance idêntica ao schema Warmbly.
- Connector Warmbly: 105/105 — PASS (rotas/filtros/denominadores/preview,
  401, 403, fixed allowlist, actor spoof, acknowledgement/version confirmation,
  timeout/no retry, envelope de recusa completo, ator Authelia opaco em log e
  dispatch negado).
- Web-shell: 260/260 — PASS sobre a `main` atual, inclusive idempotência entre
  reload/duas abas e confirmações proporcionais, além dos fluxos
  existentes de pause/resume.
- Context Service: 93/93 — PASS, incluindo token file-backed e fail-closed em
  credential ausente, vazia ou ilegível.
- Deploy: 22/22; security: 40/40 — PASS na entrega inicial, incluindo compose
  canônico, rede explícita, secret 0600, rotação atômica e ausência de token em
  output. O smoke pós-deploy encontrou e corrigiu o ownership do bind mount:
  `0600` agora pertence ao UID/GID 1000 do runtime `node`, e o Context continua
  falhando fechado quando a credencial é ausente, vazia ou ilegível.
- Go targeted human gate + handler compile — PASS.
- PostgreSQL 16 integration — PASS: duas escritas concorrentes são serializadas,
  produzem um único receipt, payload divergente conflita e todos os receipts
  sobrevivem ao restart do pool.
- Migration PostgreSQL 16 up/down — PASS; rollback deixou zero tabelas residuais.
- Rollout ordenado: Warmbly PR #135 (`c27259b`), Governance PR #92
  (`f70938c`) e correção do owner do secret no Governance PR #93 (`7beffc1`).
  Migration 116 aplicada; backend/consumer/worker e Control Center saudáveis.
- Smoke de negócio em produção foi somente leitura: anônimo `/` respondeu 302
  para Authelia e `/healthz` respondeu 200. Uma identidade temporária com os
  grupos `operators,admins` concluiu first factor + TOTP (200/200), abriu o shell
  (200) e leu `GET /v1/warmbly/operator/cohorts?limit=1` pelo proxy (200), com
  `confenge.human-gate.v1`, `receipt`, `correlation_id` e zero cohorts. A
  identidade e sua configuração TOTP foram removidas ao final. Nenhum endpoint
  de cohort, validation, review, decision, queue ou envio recebeu POST em
  produção.
- A credencial ativa foi confirmada com máscara exata 196 e sem permissão de
  envio. A credencial legada de máscara 128 foi revogada pelo endpoint auditado,
  a sessão técnica foi encerrada e a variável stale foi retirada do `.env`;
  o token file-backed ativo permaneceu separado do collector.
- Guardrails de runtime confirmados no host: auto-send OFF, GREEN autorun OFF,
  human approval obrigatório e kill switch engajado. Nenhum e-mail real foi
  enviado.
- Suíte ampla `internal/app/confenge`: PASS (Mailpit local/sandbox, nenhuma
  entrega externa). Handler/API compilado contra o contrato novo — PASS.

Screenshots produzidos com fixture sanitizada, sem mailbox, company, subject ou
body reais:

- `docs/evidence/human-gate-cohorts.png` — lista, filtros e denominadores.
- `docs/evidence/human-gate-revisao.png` — detalhe progressivo, validações e
  confirmações humanas.
