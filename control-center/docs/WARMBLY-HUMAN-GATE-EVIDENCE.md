# Matriz requisito → teste → evidência

| Requisito | Teste/evidência |
|---|---|
| Contrato versionado; frontend não rederiva | `human_gate.go`, `human-gate-api.md`; UI renderiza `manifest.preview` e `blocked_by` |
| Idempotência, duplicata, retry/two tabs/crash/restart | uniques de migration 000116 + request hash + advisory lock por intenção; `human-gate-idempotency.test.ts` preserva key e `TestHumanGatePostgres*` prova serialização/receipt após restart |
| Preview exacto | `GetConfengeHumanGateCandidate`; web shell revela subject/body/hashes congelados |
| VALID/RISKY/INVALID/UNKNOWN/STALE | `TestNormalizeHumanGateValidationStatus`; UI `data-validation-status` |
| Invalidation recipient/message/policy/evidence/expiry | `TestHumanGateApprovalInvalidatesEveryBoundDimension` |
| suppression tardia/opt-out/bounce/removal | `GetHumanGateCohort` relê candidato canônico e invalida fail-closed |
| APPROVE/REJECT/HOLD e GO/NO-GO | `TestHumanGateValidApprovalRemainsEffectiveAndHoldNeverDoes`; `TestHumanGateHumanConfirmationsAreServerEnforced`; adapter e proxy preservam `acknowledged` e `confirmation` |
| Cohort vazia e stale | `DecideHumanGateCohort` retorna 409 `cohort_not_ready` |
| MX ausente/risky/invalid/unknown | verificador existente + normalização/teste; somente VALID permite APPROVE |
| Authelia, 401/403 e least privilege | `human-gate.test.ts`: identidade ausente não chega ao upstream; GO exige admins |
| timeout/payload parcial/conflito/write denied | proxy retorna UNKNOWN sem retry e envelope completo; handler 400; request-hash 409; RBAC 403 |
| sem PII nos logs | proxy loga somente actor/id/path/status/receipt; Warmbly audit usa ids/hashes/status |
| resume e last-mile gates | contratos Warmbly existentes de `ValidateBoundedCohortAuthorization`; autoridade órfã de crash falha `human_gate_decision_missing`; UI não oferece queue/dispatch/send |
| auto-send OFF / nenhum e-mail real | snapshots fixam false; testes usam `.invalid`; runbook proíbe POST em produção |

Evidência executada em 2026-08-23:

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
- Deploy: 22/22; security: 40/40 — PASS, incluindo compose canônico, rede
  explícita, secret 0600, rotação atômica e ausência de token em output.
- Go targeted human gate + handler compile — PASS.
- PostgreSQL 16 integration — PASS: duas escritas concorrentes são serializadas,
  produzem um único receipt, payload divergente conflita e todos os receipts
  sobrevivem ao restart do pool.
- Migration PostgreSQL 16 up/down — PASS; rollback deixou zero tabelas residuais.
- Smoke produção read-only: `/` respondeu 302 para Authelia e `/healthz`
  respondeu 200; nenhum POST foi executado.
- Suíte ampla `internal/app/confenge`: PASS (Mailpit local/sandbox, nenhuma
  entrega externa). Handler/API compilado contra o contrato novo — PASS.

Screenshots produzidos com fixture sanitizada, sem mailbox, company, subject ou
body reais:

- `docs/evidence/human-gate-cohorts.png` — lista, filtros e denominadores.
- `docs/evidence/human-gate-revisao.png` — detalhe progressivo, validações e
  confirmações humanas.
