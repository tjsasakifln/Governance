# Matriz requisito → teste → evidência

| Requisito | Teste/evidência |
|---|---|
| Contrato versionado; frontend não rederiva | `human_gate.go`, `human-gate-api.md`; UI renderiza `manifest.preview` e `blocked_by` |
| Idempotência, duplicata, retry/two tabs/restart | uniques de migration 000116 + request hash; `human-gate.test.ts` preserva key e prova zero retry |
| Preview exacto | `GetConfengeHumanGateCandidate`; web shell revela subject/body/hashes congelados |
| VALID/RISKY/INVALID/UNKNOWN/STALE | `TestNormalizeHumanGateValidationStatus`; UI `data-validation-status` |
| Invalidation recipient/message/policy/evidence/expiry | `TestHumanGateApprovalInvalidatesEveryBoundDimension` |
| suppression tardia/opt-out/bounce/removal | `GetHumanGateCohort` relê candidato canônico e invalida fail-closed |
| APPROVE/REJECT/HOLD e GO/NO-GO | `TestHumanGateValidApprovalRemainsEffectiveAndHoldNeverDoes`; formulários UI com confirmações |
| Cohort vazia e stale | `DecideHumanGateCohort` retorna 409 `cohort_not_ready` |
| MX ausente/risky/invalid/unknown | verificador existente + normalização/teste; somente VALID permite APPROVE |
| Authelia, 401/403 e least privilege | `human-gate.test.ts`: identidade ausente não chega ao upstream; GO exige admins |
| timeout/partial/conflict/write denied | proxy retorna UNKNOWN sem retry; handler 400; request-hash 409; RBAC 403 |
| sem PII nos logs | proxy loga somente actor/id/path/status/receipt; Warmbly audit usa ids/hashes/status |
| resume e last-mile gates | contratos Warmbly existentes de `ValidateBoundedCohortAuthorization`; UI não oferece queue/dispatch/send |
| auto-send OFF / nenhum e-mail real | snapshots fixam false; testes usam `.invalid`; runbook proíbe POST em produção |

Evidência executada em 2026-08-23:

- TypeScript typecheck: connector, Context Service e web-shell — PASS.
- Contract cross-repo: 1/1 — PASS; cópia Governance idêntica ao schema Warmbly.
- Connector + UI human gate: 12/12 — PASS (rotas/filtros/denominadores/preview/confirmations,
  401, 403, fixed allowlist, actor spoof,
  idempotency, timeout/no retry, ator Authelia opaco em log e dispatch negado).
- Web-shell: 257/257 — PASS sobre a `main` atual, inclusive os fluxos
  existentes de pause/resume.
- Go targeted human gate + handler compile — PASS.
- PostgreSQL integration — PASS: duas escritas concorrentes produzem um único
  vencedor, payload divergente conflita e o receipt sobrevive ao restart do pool.
- Migration PostgreSQL 16 up/down — PASS; rollback deixou zero tabelas residuais.
- Smoke produção read-only: `/` respondeu 302 para Authelia e `/healthz`
  respondeu 200; nenhum POST foi executado.
- Suíte ampla `internal/app/confenge`: compilou; dois testes preexistentes exigem
  Git checkout/Mailpit e são classificados como bloqueios ambientais, não como
  aprovação do gate.

Screenshots produzidos com fixture sanitizada, sem mailbox, company, subject ou
body reais:

- `docs/evidence/human-gate-cohorts.png` — lista, filtros e denominadores.
- `docs/evidence/human-gate-revisao.png` — detalhe progressivo, validações e
  confirmações humanas.
